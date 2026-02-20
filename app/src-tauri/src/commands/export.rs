use tauri::Emitter;
use crate::python::PythonExecutor;
use crate::fs::ProjectDirManager;
use crate::commands::config::load_config;
use crate::commands::environment::{
    apply_ollama_models_dir_and_restart,
    default_ollama_models_dir,
    resolve_ollama_models_dir,
};

// ── Shared helper: read process stdout with timeout, emit events ──────────────
async fn run_python_and_emit(
    app: tauri::AppHandle,
    mut child: tokio::process::Child,
    event_prefix: &str,
    project_id: String,
    timeout_secs: u64,
) {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let stderr_handle = if let Some(stderr) = child.stderr.take() {
        let h = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            let mut out = Vec::new();
            while let Ok(Some(l)) = lines.next_line().await { out.push(l); }
            out
        });
        Some(h)
    } else { None };

    let (emitted_error, emitted_complete, timed_out) =
        if let Some(stdout) = child.stdout.take() {
            let mut lines = BufReader::new(stdout).lines();
            let app2 = app.clone();
            let pid2 = project_id.clone();
            let prefix2 = event_prefix.to_string();
            let read_fut = async move {
                let mut emitted_error = false;
                let mut emitted_complete = false;
                while let Ok(Some(line)) = lines.next_line().await {
                    if let Ok(mut event) = serde_json::from_str::<serde_json::Value>(&line) {
                        let event_type = event["type"].as_str().unwrap_or("unknown").to_string();
                        if event_type == "error" { emitted_error = true; }
                        else if event_type == "complete" { emitted_complete = true; }
                        if let Some(obj) = event.as_object_mut() {
                            obj.insert("project_id".to_string(), serde_json::Value::String(pid2.clone()));
                        }
                        let _ = app2.emit(&format!("{}:{}", prefix2, event_type), &event);
                    }
                }
                (emitted_error, emitted_complete)
            };
            match tokio::time::timeout(tokio::time::Duration::from_secs(timeout_secs), read_fut).await {
                Ok((e, c)) => (e, c, false),
                Err(_) => (false, false, true),
            }
        } else { (false, false, false) };

    if timed_out {
        let _ = child.kill().await;
        let _ = app.emit(&format!("{}:error", event_prefix), serde_json::json!({
            "message": "Export timed out after 30 minutes and was cancelled.",
            "project_id": project_id
        }));
        return;
    }

    match child.wait().await {
        Ok(status) => {
            let silent = !emitted_error && !emitted_complete;
            if (!status.success() || silent) && !emitted_error {
                let stderr_text = if let Some(h) = stderr_handle {
                    h.await.unwrap_or_default().join("\n")
                } else { String::new() };
                let msg = if stderr_text.is_empty() {
                    "Process exited unexpectedly. Check that mlx-lm is installed.".to_string()
                } else {
                    let tail: Vec<&str> = stderr_text.lines().rev().take(12)
                        .collect::<Vec<_>>().into_iter().rev().collect();
                    tail.join("\n")
                };
                let _ = app.emit(&format!("{}:error", event_prefix), serde_json::json!({
                    "message": msg, "project_id": project_id
                }));
            }
        }
        Err(e) => {
            let _ = app.emit(&format!("{}:error", event_prefix), serde_json::json!({
                "message": e.to_string(), "project_id": project_id
            }));
        }
    }
}

/// Resolve target OLLAMA_MODELS for export.
/// Uses model_paths.ollama (Ollama 模型目录) as the export destination.
/// export_path is reserved for GGUF-only exports and is NOT used here.
/// Fallback to default ~/.ollama/models only when the configured path is not writable.
fn resolve_ollama_models_dir_for_export() -> (std::path::PathBuf, Option<(String, String)>) {
    let app_config = load_config();
    let default_dir = default_ollama_models_dir();

    if let Some(configured) = app_config.model_paths.ollama {
        let dir = std::path::PathBuf::from(configured);
        if std::fs::create_dir_all(&dir).is_ok() {
            return (dir, None);
        }
        return (
            default_dir.clone(),
            Some((dir.to_string_lossy().to_string(), default_dir.to_string_lossy().to_string())),
        );
    }

    (default_dir, None)
}

// ── E-2: Post-export regression verification ──────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct VerifyResult {
    pub ok: bool,
    pub preview: String,
    pub error: Option<String>,
}

fn ollama_server_log_tail(max_lines: usize) -> Option<String> {
    let log_path = dirs::home_dir()?
        .join(".ollama")
        .join("logs")
        .join("server.log");
    let content = std::fs::read_to_string(log_path).ok()?;
    let mut tail: Vec<&str> = content.lines().rev().take(max_lines).collect();
    tail.reverse();
    Some(tail.join("\n"))
}

fn diagnose_ollama_load_error(raw_error: &str) -> Option<String> {
    if !raw_error.to_lowercase().contains("unable to load model") {
        return None;
    }

    let tail = ollama_server_log_tail(200)?;
    if tail.to_lowercase().contains("duplicate tensor name") {
        return Some(
            "Ollama server log detected duplicate tensor names in the exported model blob. \
This usually means stale or duplicate safetensors shards were imported. Please re-export with a clean output directory.".to_string(),
        );
    }

    let mut lines: Vec<String> = tail
        .lines()
        .rev()
        .filter(|line| {
            line.contains("gguf_init_from_file_impl")
                || line.contains("llama_model_load")
                || line.contains("failed to load model")
        })
        .take(3)
        .map(|s| s.trim().to_string())
        .collect();
    if lines.is_empty() {
        return None;
    }
    lines.reverse();
    Some(format!("Ollama server diagnostics: {}", lines.join(" | ")))
}

#[tauri::command]
pub async fn verify_export_model(model_name: String) -> Result<VerifyResult, String> {
    let ollama_bin = PythonExecutor::find_ollama()
        .unwrap_or_else(|| std::path::PathBuf::from("ollama"));
    let ollama_models_dir_str = resolve_ollama_models_dir().to_string_lossy().to_string();

    // 1) Fast existence/manifest check first.
    let show_result = tokio::time::timeout(
        tokio::time::Duration::from_secs(15),
        tokio::process::Command::new(&ollama_bin)
            .env("OLLAMA_MODELS", &ollama_models_dir_str)
            .args(["show", &model_name])
            .output(),
    ).await;

    match show_result {
        Ok(Ok(output)) if output.status.success() => {}
        Ok(Ok(output)) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let err = if !stderr.is_empty() { stderr } else if !stdout.is_empty() { stdout } else { "Failed to inspect exported model".into() };
            return Ok(VerifyResult { ok: false, preview: String::new(), error: Some(err) });
        }
        Ok(Err(e)) => {
            return Ok(VerifyResult { ok: false, preview: String::new(), error: Some(e.to_string()) });
        }
        Err(_) => {
            return Ok(VerifyResult {
                ok: false,
                preview: String::new(),
                error: Some("Verification timed out while checking model metadata (15 s).".into()),
            });
        }
    }

    // 2) Runtime smoke tests with multiple prompts.
    let prompts = [
        "Reply with exactly one word: OK",
        "Say OK",
    ];
    let mut last_error = String::new();

    for prompt in prompts {
        let result = tokio::time::timeout(
            tokio::time::Duration::from_secs(45),
            tokio::process::Command::new(&ollama_bin)
                .env("OLLAMA_MODELS", &ollama_models_dir_str)
                .args(["run", "--nowordwrap", &model_name, prompt])
                .output(),
        ).await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if output.status.success() {
                    let preview: String = if stdout.is_empty() {
                        "(model loaded; empty response)".to_string()
                    } else {
                        stdout.chars().take(120).collect()
                    };
                    return Ok(VerifyResult { ok: true, preview, error: None });
                }
                last_error = if !stderr.is_empty() { stderr } else if !stdout.is_empty() { stdout } else { "Model returned no output".into() };
                if last_error.to_lowercase().contains("unable to load model") {
                    break;
                }
            }
            Ok(Err(e)) => {
                last_error = e.to_string();
            }
            Err(_) => {
                last_error = "Verification timed out (45 s). Model may still be loading — try again shortly.".to_string();
            }
        }
    }

    if let Some(extra) = diagnose_ollama_load_error(&last_error) {
        last_error = format!("{}\n{}", last_error, extra);
    }

    Ok(VerifyResult {
        ok: false,
        preview: String::new(),
        error: Some(if last_error.is_empty() {
            "Model verification failed for unknown reason".to_string()
        } else {
            last_error
        }),
    })
}

#[tauri::command]
pub async fn export_to_ollama(
    app: tauri::AppHandle,
    project_id: String,
    model_name: String,
    model: String,
    adapter_path: Option<String>,
    quantization: Option<String>,
    lang: Option<String>,
) -> Result<(), String> {
    let executor = PythonExecutor::default();
    if !executor.is_ready() {
        return Err("Python environment is not ready.".into());
    }

    let scripts_dir = PythonExecutor::scripts_dir();
    let script = scripts_dir.join("export_ollama.py");
    if !script.exists() {
        return Err(format!("Export script not found at: {}", script.display()));
    }

    let dir_manager = ProjectDirManager::new();
    let project_path = dir_manager.project_path(&project_id);

    // Use provided adapter path or find latest
    let adapter_path = if let Some(ap) = adapter_path {
        if !std::path::Path::new(&ap).exists() {
            return Err(format!("Adapter path not found: {}", ap));
        }
        ap
    } else {
        let adapters_dir = project_path.join("adapters");
        std::fs::read_dir(&adapters_dir)
            .ok()
            .and_then(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .max_by_key(|e| e.metadata().ok().and_then(|m| m.modified().ok()))
                    .map(|e| e.path().to_string_lossy().to_string())
            })
            .ok_or_else(|| "No trained adapter found. Complete training first.".to_string())?
    };

    // Intermediate fused files always go into the project's own export/ollama/ dir.
    // We deliberately do NOT use the user-configured export_path here — that path is
    // for GGUF physical output. Keeping fused files separate prevents UUID folders from
    // appearing inside the user's OLLAMA_MODELS directory.
    let output_dir = project_path.join("export").join("ollama");
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create Ollama export dir: {}", e))?;

    let python_bin = executor.python_bin().clone();
    let quant = quantization.unwrap_or_else(|| "q4".to_string());

    let (ollama_models_dir, path_fallback_info) = resolve_ollama_models_dir_for_export();
    if let Some((configured, fallback)) = path_fallback_info {
        let _ = app.emit("export:path_warning", serde_json::json!({
            "configured_path": configured,
            "fallback_path": fallback,
            "project_id": project_id
        }));
    }

    // Ensure the running daemon is aligned with the selected export target path
    // so ollama create/import actually lands in the intended OLLAMA_MODELS dir.
    let current_effective = resolve_ollama_models_dir();
    if current_effective != ollama_models_dir {
        if ollama_models_dir == default_ollama_models_dir() {
            apply_ollama_models_dir_and_restart(None)
                .map_err(|e| format!("Failed to switch Ollama daemon to default path: {}", e))?;
        } else {
            apply_ollama_models_dir_and_restart(Some(&ollama_models_dir))
                .map_err(|e| format!("Failed to switch Ollama daemon path: {}", e))?;
        }
    }

    let ollama_models_dir_str = ollama_models_dir.to_string_lossy().to_string();

    let pid = project_id.clone();
    tokio::spawn(async move {
        let mut cmd = tokio::process::Command::new(&python_bin);
        cmd.args([
                "-u",
                script.to_string_lossy().as_ref(),
                "--model", &model,
                "--adapter-path", &adapter_path,
                "--model-name", &model_name,
                "--output-dir", &output_dir.to_string_lossy(),
                "--quantization", &quant,
                "--ollama-models-dir", &ollama_models_dir_str,
                "--lang", &lang.unwrap_or_else(|| "en".to_string()),
            ])
            .env("PYTHONUNBUFFERED", "1")
            .env("OLLAMA_MODELS", &ollama_models_dir_str)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        match cmd.spawn()
        {
            Ok(child) => run_python_and_emit(app, child, "export", pid, 1800).await,
            Err(e) => {
                let _ = app.emit("export:error", serde_json::json!({
                    "message": e.to_string(), "project_id": pid
                }));
            }
        }
    });

    Ok(())
}

// ── GGUF export ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn export_to_gguf(
    app: tauri::AppHandle,
    project_id: String,
    model: String,
    adapter_path: Option<String>,
    lang: Option<String>,
) -> Result<(), String> {
    let executor = PythonExecutor::default();
    if !executor.is_ready() {
        return Err("Python environment is not ready.".into());
    }

    let scripts_dir = PythonExecutor::scripts_dir();
    let script = scripts_dir.join("export_gguf.py");
    if !script.exists() {
        return Err(format!("GGUF export script not found at: {}", script.display()));
    }

    let dir_manager = ProjectDirManager::new();
    let project_path = dir_manager.project_path(&project_id);

    // Resolve adapter path
    let adapter_path = if let Some(ap) = adapter_path {
        if !std::path::Path::new(&ap).exists() {
            return Err(format!("Adapter path not found: {}", ap));
        }
        ap
    } else {
        let adapters_dir = project_path.join("adapters");
        std::fs::read_dir(&adapters_dir)
            .ok()
            .and_then(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .max_by_key(|e| e.metadata().ok().and_then(|m| m.modified().ok()))
                    .map(|e| e.path().to_string_lossy().to_string())
            })
            .ok_or_else(|| "No trained adapter found. Complete training first.".to_string())?
    };

    // Output directory — use configured path if writable, else fall back
    let app_config = load_config();
    let (output_dir, path_fallback_info) = {
        let (preferred, configured_str) = if let Some(ref ep) = app_config.export_path {
            (std::path::PathBuf::from(ep).join(&project_id).join("gguf"), Some(ep.clone()))
        } else {
            (project_path.join("export").join("gguf"), None)
        };
        if std::fs::create_dir_all(&preferred).is_ok() {
            (preferred, None::<(String, String)>)
        } else {
            let fallback = project_path.join("export").join("gguf");
            std::fs::create_dir_all(&fallback)
                .map_err(|e| format!("Failed to create GGUF output dir: {}", e))?;
            let info = configured_str.map(|cp| (cp, fallback.to_string_lossy().to_string()));
            (fallback, info)
        }
    };

    if let Some((configured, fallback)) = path_fallback_info {
        let _ = app.emit("gguf:path_warning", serde_json::json!({
            "configured_path": configured,
            "fallback_path": fallback,
            "project_id": project_id
        }));
    }

    let python_bin = executor.python_bin().clone();
    let pid = project_id.clone();
    tokio::spawn(async move {
        match tokio::process::Command::new(&python_bin)
            .args([
                "-u",
                script.to_string_lossy().as_ref(),
                "--model", &model,
                "--adapter-path", &adapter_path,
                "--output-dir", &output_dir.to_string_lossy(),
                "--lang", &lang.unwrap_or_else(|| "en".to_string()),
            ])
            .env("PYTHONUNBUFFERED", "1")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(child) => run_python_and_emit(app, child, "gguf", pid, 1800).await,
            Err(e) => {
                let _ = app.emit("gguf:error", serde_json::json!({
                    "message": e.to_string(), "project_id": pid
                }));
            }
        }
    });

    Ok(())
}
