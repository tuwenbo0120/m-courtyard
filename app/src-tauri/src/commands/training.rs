use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use uuid::Uuid;
use tauri::Emitter;
use crate::fs::ProjectDirManager;
use crate::python::PythonExecutor;
use crate::commands::config::{load_config, hf_endpoint_for_source};

static TRAINING_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn start_training(
    app: tauri::AppHandle,
    project_id: String,
    params: String,
    dataset_path: Option<String>,
) -> Result<String, String> {
    let job_id = Uuid::new_v4().to_string();
    let executor = PythonExecutor::default();

    if !executor.is_ready() {
        return Err("Python environment not ready. Please configure it in Settings.".into());
    }

    let dir_manager = ProjectDirManager::new();
    let project_path = dir_manager.project_path(&project_id);

    let training_params: serde_json::Value =
        serde_json::from_str(&params).map_err(|e| format!("Invalid params: {}", e))?;

    let model = training_params["model"]
        .as_str()
        .ok_or("Missing model parameter")?
        .to_string();
    // Require explicit dataset version path to avoid accidentally training on stale/legacy data.
    let data_dir = match dataset_path {
        Some(ref p) if !p.trim().is_empty() => std::path::PathBuf::from(p),
        _ => {
            return Err(
                "Dataset version is required. Please select a dataset version before starting training."
                    .into(),
            )
        }
    };
    let adapter_path = project_path.join("adapters").join(&job_id);
    let fine_tune_type = training_params["fine_tune_type"].as_str().unwrap_or("lora").to_string();
    let optimizer = training_params["optimizer"].as_str().unwrap_or("adam").to_string();
    let iters = training_params["iters"].as_u64().unwrap_or(1000);
    let batch_size = training_params["batch_size"].as_u64().unwrap_or(4);
    let lora_layers = training_params["lora_layers"].as_u64().unwrap_or(16);
    let lora_rank = training_params["lora_rank"].as_u64().unwrap_or(8);
    let lora_scale = training_params["lora_scale"].as_f64().unwrap_or(20.0);
    let lora_dropout = training_params["lora_dropout"].as_f64().unwrap_or(0.0);
    let learning_rate = training_params["learning_rate"].as_f64().unwrap_or(1e-5);
    let max_seq_length = training_params["max_seq_length"].as_u64().unwrap_or(2048);
    let grad_checkpoint = training_params["grad_checkpoint"].as_bool().unwrap_or(false);
    let grad_accumulation_steps = training_params["grad_accumulation_steps"].as_u64().unwrap_or(1);
    let save_every = training_params["save_every"].as_u64().unwrap_or(100);
    let mask_prompt = training_params["mask_prompt"].as_bool().unwrap_or(false);
    let steps_per_eval = training_params["steps_per_eval"].as_u64().unwrap_or(200);
    let steps_per_report = training_params["steps_per_report"].as_u64().unwrap_or(10);
    let val_batches = training_params["val_batches"].as_u64().unwrap_or(25);
    let seed = training_params["seed"].as_u64().unwrap_or(0);

    // Verify dataset exists
    if !data_dir.join("train.jsonl").exists() {
        return Err("Dataset train.jsonl not found. Please generate a dataset first.".into());
    }
    if !data_dir.join("valid.jsonl").exists() {
        return Err("Dataset valid.jsonl not found. Please generate a dataset first.".into());
    }

    // Auto-clamp batch_size so it never exceeds the smallest dataset split
    let count_lines = |path: &std::path::Path| -> usize {
        std::fs::read_to_string(path)
            .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
            .unwrap_or(0)
    };
    let train_count = count_lines(&data_dir.join("train.jsonl"));
    let valid_count = count_lines(&data_dir.join("valid.jsonl"));
    let min_dataset = std::cmp::min(train_count, valid_count) as u64;
    let batch_size = if min_dataset > 0 && batch_size > min_dataset {
        min_dataset
    } else {
        batch_size
    };

    std::fs::create_dir_all(&adapter_path)
        .map_err(|e| format!("Failed to create adapter directory: {}", e))?;

    // Save training metadata for export page to read base model
    let meta = serde_json::json!({
        "base_model": &model,
        "fine_tune_type": &fine_tune_type,
        "optimizer": &optimizer,
        "iters": iters,
        "batch_size": batch_size,
        "lora_layers": lora_layers,
        "lora_rank": lora_rank,
        "lora_scale": lora_scale,
        "lora_dropout": lora_dropout,
        "learning_rate": learning_rate,
        "max_seq_length": max_seq_length,
        "grad_checkpoint": grad_checkpoint,
        "grad_accumulation_steps": grad_accumulation_steps,
        "save_every": save_every,
        "mask_prompt": mask_prompt,
        "steps_per_eval": steps_per_eval,
        "steps_per_report": steps_per_report,
        "val_batches": val_batches,
        "created_at": chrono::Local::now().format("%Y-%m-%d %H:%M").to_string(),
    });
    let _ = std::fs::write(
        adapter_path.join("training_meta.json"),
        serde_json::to_string_pretty(&meta).unwrap_or_default(),
    );

    // Generate a YAML config for lora/dora parameters (--lora-rank is NOT a valid CLI arg)
    let config_path = adapter_path.join("lora_config.yaml");
    let config_content = if fine_tune_type == "full" {
        // Full fine-tuning does not use lora_parameters
        String::new()
    } else {
        format!(
            "lora_parameters:\n  rank: {}\n  alpha: {}\n  dropout: {}\n  scale: {}\n",
            lora_rank,
            lora_rank * 2,
            lora_dropout,
            lora_scale,
        )
    };
    std::fs::write(&config_path, &config_content)
        .map_err(|e| format!("Failed to write lora config: {}", e))?;

    let python_bin = executor.python_bin().clone();
    let job_id_clone = job_id.clone();

    // Read configured HF download source for HF_ENDPOINT env var
    let app_config = load_config();
    let hf_endpoint = hf_endpoint_for_source(&app_config.hf_source);

    tokio::spawn(async move {
        // Build args: python -m mlx_lm lora --train ...
        let mut py_args = vec![
            "-m".to_string(),
            "mlx_lm".to_string(),
            "lora".to_string(),
            "--train".to_string(),
            "--model".to_string(),
            model,
            "--data".to_string(),
            data_dir.to_string_lossy().to_string(),
            "--fine-tune-type".to_string(),
            fine_tune_type,
            "--optimizer".to_string(),
            optimizer,
            "--adapter-path".to_string(),
            adapter_path.to_string_lossy().to_string(),
            "--iters".to_string(),
            iters.to_string(),
            "--batch-size".to_string(),
            batch_size.to_string(),
            "--learning-rate".to_string(),
            format!("{:.2e}", learning_rate),
            "--max-seq-length".to_string(),
            max_seq_length.to_string(),
            "--steps-per-eval".to_string(),
            steps_per_eval.to_string(),
            "--steps-per-report".to_string(),
            steps_per_report.to_string(),
            "--val-batches".to_string(),
            val_batches.to_string(),
            "--save-every".to_string(),
            save_every.to_string(),
            "--seed".to_string(),
            seed.to_string(),
        ];
        // Only pass -c config YAML and --num-layers for lora/dora
        if config_content.len() > 0 {
            py_args.push("-c".to_string());
            py_args.push(config_path.to_string_lossy().to_string());
            py_args.push("--num-layers".to_string());
            py_args.push(lora_layers.to_string());
        }
        if grad_checkpoint {
            py_args.push("--grad-checkpoint".to_string());
        }
        if mask_prompt {
            py_args.push("--mask-prompt".to_string());
        }
        if grad_accumulation_steps > 1 {
            py_args.push("--grad-accumulation-steps".to_string());
            py_args.push(grad_accumulation_steps.to_string());
        }

        // Wrap with caffeinate -i to prevent idle sleep during training
        let mut caffeinate_args: Vec<String> = vec![
            "-i".to_string(),
            python_bin.to_string_lossy().to_string(),
        ];
        caffeinate_args.extend(py_args);

        let mut cmd = tokio::process::Command::new("caffeinate");
        cmd.args(&caffeinate_args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        // Set HF_ENDPOINT if user configured a mirror source
        if let Some(ref endpoint) = hf_endpoint {
            cmd.env("HF_ENDPOINT", endpoint);
        }
        let result = cmd.spawn();

        match result {
            Ok(mut child) => {
                if let Some(pid) = child.id() {
                    if let Ok(mut map) = TRAINING_PROCESSES.lock() {
                        map.insert(job_id_clone.clone(), pid);
                    }
                }

                use tokio::io::{AsyncBufReadExt, BufReader};

                // Read both stdout and stderr concurrently
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();

                let app_out = app.clone();
                let jid_out = job_id_clone.clone();
                let stdout_task = tokio::spawn(async move {
                    if let Some(out) = stdout {
                        let mut lines = BufReader::new(out).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            let _ = app_out.emit("training-log", serde_json::json!({
                                "job_id": jid_out,
                                "line": line,
                            }));
                        }
                    }
                });

                let app_err = app.clone();
                let jid_err = job_id_clone.clone();
                let stderr_task = tokio::spawn(async move {
                    if let Some(err) = stderr {
                        let mut lines = BufReader::new(err).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            let _ = app_err.emit("training-log", serde_json::json!({
                                "job_id": jid_err,
                                "line": line,
                            }));
                        }
                    }
                });

                let _ = tokio::join!(stdout_task, stderr_task);

                match child.wait().await {
                    Ok(status) => {
                        let _ = app.emit("training-complete", serde_json::json!({
                            "job_id": job_id_clone,
                            "success": status.success(),
                        }));
                    }
                    Err(e) => {
                        let _ = app.emit("training-error", serde_json::json!({
                            "job_id": job_id_clone,
                            "error": e.to_string(),
                        }));
                    }
                }

                if let Ok(mut map) = TRAINING_PROCESSES.lock() {
                    map.remove(&job_id_clone);
                }
            }
            Err(e) => {
                let _ = app.emit("training-error", serde_json::json!({
                    "job_id": job_id_clone,
                    "error": e.to_string(),
                }));
            }
        }
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn stop_training(job_id: String) -> Result<(), String> {
    let pid = {
        let map = TRAINING_PROCESSES.lock().map_err(|e| e.to_string())?;
        map.get(&job_id).copied()
    };
    match pid {
        Some(pid) => {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGTERM);
                libc::kill(pid as i32, libc::SIGTERM);
            }
            if let Ok(mut map) = TRAINING_PROCESSES.lock() {
                map.remove(&job_id);
            }
            Ok(())
        }
        None => Err("Training process not found or already finished".into()),
    }
}

#[tauri::command]
pub fn open_project_folder(project_id: String) -> Result<(), String> {
    let dir_manager = ProjectDirManager::new();
    let project_path = dir_manager.project_path(&project_id);
    if !project_path.exists() {
        return Err("Project directory does not exist".into());
    }
    std::process::Command::new("open")
        .arg(&project_path)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct AdapterInfo {
    pub name: String,
    pub path: String,
    pub created: String,
    pub has_weights: bool,
    pub base_model: String,
}

#[tauri::command]
pub fn list_adapters(project_id: String) -> Result<Vec<AdapterInfo>, String> {
    let dir_manager = ProjectDirManager::new();
    let adapters_dir = dir_manager.project_path(&project_id).join("adapters");
    if !adapters_dir.exists() {
        return Ok(vec![]);
    }
    let mut adapters: Vec<AdapterInfo> = std::fs::read_dir(&adapters_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let meta = entry.metadata().ok()?;
            if !meta.is_dir() { return None; }
            let path = entry.path();
            let has_weights = path.join("adapters.safetensors").exists()
                || path.join("0001000_adapters.safetensors").exists()
                || std::fs::read_dir(&path).ok()
                    .map(|rd| rd.filter_map(|e| e.ok())
                        .any(|e| e.file_name().to_string_lossy().ends_with("_adapters.safetensors")))
                    .unwrap_or(false);
            let created = meta.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| {
                    let secs = d.as_secs() as i64;
                    let dt = chrono::DateTime::from_timestamp(secs, 0)
                        .unwrap_or_default();
                    let local: chrono::DateTime<chrono::Local> = dt.into();
                    local.format("%Y-%m-%d %H:%M").to_string()
                })
                .unwrap_or_default();
            // Read base_model from training_meta.json, fallback to adapter_config.json
            let base_model = std::fs::read_to_string(path.join("training_meta.json"))
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v["base_model"].as_str().map(|s| s.to_string()))
                .or_else(|| {
                    // Fallback: read "model" field from adapter_config.json (created by mlx-lm)
                    std::fs::read_to_string(path.join("adapter_config.json"))
                        .ok()
                        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                        .and_then(|v| v["model"].as_str().map(|s| s.to_string()))
                })
                .unwrap_or_default();
            Some(AdapterInfo {
                name: entry.file_name().to_string_lossy().to_string(),
                path: path.to_string_lossy().to_string(),
                created,
                has_weights,
                base_model,
            })
        })
        .collect();
    adapters.sort_by(|a, b| b.created.cmp(&a.created));
    Ok(adapters)
}

#[derive(serde::Serialize)]
pub struct LocalModelInfo {
    pub name: String,
    pub path: String,
    pub size_mb: u64,
    pub is_mlx: bool,
    pub source: String,
}

#[tauri::command]
pub fn scan_local_models() -> Result<Vec<LocalModelInfo>, String> {
    let resolved = crate::commands::config::resolve_model_paths();
    let mut models = Vec::new();

    // 1. Scan HuggingFace cache
    scan_hf_style_cache(&resolved.huggingface, "huggingface", &mut models);

    // 2. Scan ModelScope cache
    scan_hf_style_cache(&resolved.modelscope, "modelscope", &mut models);

    // 3. Scan the single effective Ollama path (daemon-aware: uses actual running path)
    let ollama_dir = crate::commands::environment::resolve_ollama_models_dir();
    let ollama_lib = ollama_dir
        .join("manifests").join("registry.ollama.ai").join("library");
    scan_ollama_models(&ollama_lib, &ollama_dir, "ollama", &mut models);

    // MLX models first, then by source, then by name
    models.sort_by(|a, b| {
        b.is_mlx.cmp(&a.is_mlx)
            .then(a.source.cmp(&b.source))
            .then(a.name.cmp(&b.name))
    });
    Ok(models)
}

fn scan_hf_style_cache(cache_dir: &std::path::Path, source: &str, models: &mut Vec<LocalModelInfo>) {
    if !cache_dir.exists() { return; }
    let Ok(entries) = std::fs::read_dir(cache_dir) else { return; };

    for entry in entries.filter_map(|e| e.ok()) {
        let dir_name = entry.file_name().to_string_lossy().to_string();
        if !dir_name.starts_with("models--") { continue; }
        let model_dir = entry.path();
        let snapshots = model_dir.join("snapshots");
        if !snapshots.exists() { continue; }

        let latest_snapshot = std::fs::read_dir(&snapshots)
            .ok()
            .and_then(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .max_by_key(|e| e.metadata().ok().and_then(|m| m.modified().ok()))
            });

        if let Some(snap) = latest_snapshot {
            let snap_path = snap.path();
            let has_model_files = std::fs::read_dir(&snap_path).ok()
                .map(|rd| rd.filter_map(|e| e.ok())
                    .any(|e| {
                        let n = e.file_name().to_string_lossy().to_string();
                        n.ends_with(".safetensors") || n == "config.json"
                    }))
                .unwrap_or(false);

            if !has_model_files { continue; }

            let model_id = dir_name.trim_start_matches("models--").replace("--", "/");

            // Calculate size from blobs/ directory (actual files, not symlinks)
            let blobs_dir = model_dir.join("blobs");
            let size_mb = dir_size_recursive(&blobs_dir);

            let name_lower = model_id.to_lowercase();
            let is_mlx = name_lower.contains("mlx")
                || name_lower.contains("4bit")
                || name_lower.contains("8bit")
                || name_lower.contains("-quantized");

            models.push(LocalModelInfo {
                name: model_id,
                path: snap_path.to_string_lossy().to_string(),
                size_mb,
                is_mlx,
                source: source.to_string(),
            });
        }
    }
}

fn scan_ollama_models(
    library_dir: &std::path::Path,
    ollama_base: &std::path::Path,
    source: &str,
    models: &mut Vec<LocalModelInfo>,
) {
    if !library_dir.exists() { return; }
    let Ok(entries) = std::fs::read_dir(library_dir) else { return; };

    let ollama_models_dir = ollama_base.to_path_buf();

    for entry in entries.filter_map(|e| e.ok()) {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
        let model_name = entry.file_name().to_string_lossy().to_string();
        let model_dir = entry.path();

        // Collect tags (versions) for this model
        if let Ok(tags) = std::fs::read_dir(&model_dir) {
            for tag in tags.filter_map(|e| e.ok()) {
                let tag_name = tag.file_name().to_string_lossy().to_string();
                let display = if tag_name == "latest" {
                    model_name.clone()
                } else {
                    format!("{}:{}", model_name, tag_name)
                };

                models.push(LocalModelInfo {
                    name: display,
                    path: ollama_models_dir.to_string_lossy().to_string(),
                    size_mb: 0, // Ollama blob sizes require manifest parsing
                    is_mlx: false,
                    source: source.to_string(),
                });
            }
        }
    }
}

fn dir_size_recursive(path: &std::path::Path) -> u64 {
    let mut total: u64 = 0;
    if !path.exists() { return 0; }
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.filter_map(|e| e.ok()) {
            let p = entry.path();
            // Use std::fs::metadata to follow symlinks
            if let Ok(meta) = std::fs::metadata(&p) {
                if meta.is_file() {
                    total += meta.len();
                } else if meta.is_dir() {
                    total += dir_size_recursive(&p);
                }
            }
        }
    }
    total / (1024 * 1024)
}

#[tauri::command]
pub fn validate_model_path(path: String) -> Result<bool, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() || !p.is_dir() { return Ok(false); }

    let has_config = p.join("config.json").exists();
    let has_safetensors = std::fs::read_dir(p).ok()
        .map(|rd| rd.filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().ends_with(".safetensors")))
        .unwrap_or(false);
    let has_tokenizer = p.join("tokenizer.json").exists()
        || p.join("tokenizer_config.json").exists()
        || p.join("tokenizer.model").exists();

    Ok(has_config && (has_safetensors || has_tokenizer))
}

#[tauri::command]
pub fn open_model_cache(source: Option<String>) -> Result<(), String> {
    let resolved = crate::commands::config::resolve_model_paths();
    let target = match source.as_deref() {
        Some("ollama") => crate::commands::environment::resolve_ollama_models_dir(),
        Some("modelscope") => resolved.modelscope,
        _ => resolved.huggingface,
    };
    if !target.exists() {
        std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    }
    std::process::Command::new("open")
        .arg(&target)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn delete_adapter(adapter_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&adapter_path);
    if !path.exists() {
        return Err(format!("Adapter not found: {}", adapter_path));
    }
    if !path.is_dir() {
        return Err("Adapter path must be a directory".to_string());
    }
    // Safety: must contain "adapters" somewhere in the path to avoid accidental deletion
    if !adapter_path.contains("/adapters/") {
        return Err("Path does not look like an adapter directory".to_string());
    }
    std::fs::remove_dir_all(path)
        .map_err(|e| format!("Failed to delete adapter: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn open_adapter_folder(adapter_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&adapter_path);
    // If the path is a file, open its parent directory; otherwise open the directory itself
    let dir = if path.is_file() {
        path.parent().ok_or("Cannot resolve parent directory")?
    } else if path.is_dir() {
        path
    } else {
        // Path doesn't exist - try parent in case it's a stale file reference
        path.parent()
            .filter(|p| p.exists())
            .ok_or_else(|| format!("Path not found: {}", adapter_path))?
    };
    std::process::Command::new("open")
        .arg(dir)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    Ok(())
}
