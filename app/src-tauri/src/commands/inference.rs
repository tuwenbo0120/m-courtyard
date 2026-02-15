use tauri::Emitter;
use crate::python::PythonExecutor;

#[tauri::command]
pub async fn start_inference(
    app: tauri::AppHandle,
    _project_id: String,
    prompt: String,
    model: String,
    adapter_path: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f64>,
    lang: Option<String>,
    request_id: Option<String>,
) -> Result<(), String> {
    let executor = PythonExecutor::default();
    if !executor.is_ready() {
        return Err("Python environment is not ready.".into());
    }

    let scripts_dir = PythonExecutor::scripts_dir();
    let script = scripts_dir.join("inference.py");
    if !script.exists() {
        return Err(format!("Inference script not found at: {}", script.display()));
    }

    let resolved_adapter = adapter_path.filter(|p| !p.is_empty());

    let python_bin = executor.python_bin().clone();
    let max_tok = max_tokens.unwrap_or(512);
    let temp = temperature.unwrap_or(0.7);
    let req_id = request_id.unwrap_or_default();

    tokio::spawn(async move {
        let mut args = vec![
            script.to_string_lossy().to_string(),
            "--model".to_string(),
            model,
            "--prompt".to_string(),
            prompt,
            "--max-tokens".to_string(),
            max_tok.to_string(),
            "--temp".to_string(),
            format!("{:.2}", temp),
        ];

        if let Some(adapter) = resolved_adapter {
            args.push("--adapter-path".to_string());
            args.push(adapter);
        }
        args.push("--lang".to_string());
        args.push(lang.unwrap_or_else(|| "en".to_string()));

        let result = tokio::process::Command::new(&python_bin)
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();

        match result {
            Ok(mut child) => {
                use tokio::io::{AsyncBufReadExt, BufReader};

                // Collect stderr in background for error reporting
                let stderr_handle = child.stderr.take().map(|stderr| {
                    tokio::spawn(async move {
                        let reader = BufReader::new(stderr);
                        let mut lines = reader.lines();
                        let mut stderr_lines = Vec::new();
                        while let Ok(Some(line)) = lines.next_line().await {
                            stderr_lines.push(line);
                        }
                        stderr_lines
                    })
                });

                if let Some(stdout) = child.stdout.take() {
                    let reader = BufReader::new(stdout);
                    let mut lines = reader.lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        if let Ok(mut event) = serde_json::from_str::<serde_json::Value>(&line) {
                            if !req_id.is_empty() {
                                if let Some(obj) = event.as_object_mut() {
                                    obj.insert(
                                        "request_id".to_string(),
                                        serde_json::Value::String(req_id.clone()),
                                    );
                                }
                            }
                            let event_type = event["type"].as_str().unwrap_or("unknown");
                            let _ = app.emit(&format!("inference:{}", event_type), &event);
                        }
                    }
                }

                match child.wait().await {
                    Ok(status) => {
                        if !status.success() {
                            // Try to get stderr content for better error message
                            let stderr_msg = if let Some(handle) = stderr_handle {
                                handle.await.ok()
                                    .map(|lines| lines.join("\n"))
                                    .filter(|s| !s.is_empty())
                            } else {
                                None
                            };
                            let msg = stderr_msg.unwrap_or_else(|| "Inference process failed".to_string());
                            let _ = app.emit("inference:error", serde_json::json!({
                                "message": msg,
                                "request_id": req_id
                            }));
                        }
                    }
                    Err(e) => {
                        let _ = app.emit("inference:error", serde_json::json!({
                            "message": e.to_string(),
                            "request_id": req_id
                        }));
                    }
                }
            }
            Err(e) => {
                let _ = app.emit("inference:error", serde_json::json!({
                    "message": e.to_string(),
                    "request_id": req_id
                }));
            }
        }
    });

    Ok(())
}
