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

/// Returns true when the model identifier indicates a quantized model.
/// Checks common naming conventions used by mlx-community and other sources.
fn is_quantized_model(model: &str) -> bool {
    let lower = model.to_lowercase();
    let patterns = ["4bit", "8bit", "4-bit", "8-bit", "-q4", "-q8", "q4_", "q8_",
                    "quantized", "gptq", "awq", "gguf", "bnb"];
    patterns.iter().any(|p| lower.contains(p))
}

#[derive(serde::Serialize)]
pub struct StartTrainingResult {
    pub job_id: String,
    pub adapter_path: String,
}

#[tauri::command]
pub async fn start_training(
    app: tauri::AppHandle,
    project_id: String,
    params: String,
    dataset_path: Option<String>,
) -> Result<StartTrainingResult, String> {
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

    // Intercept: quantized model + full fine-tuning is unsupported by MLX
    // (MLX raises [QuantizedMatmul::vjp] no gradient wrt the quantized weights)
    if fine_tune_type == "full" && is_quantized_model(&model) {
        return Err(
            "Quantized models (4-bit / 8-bit) cannot be trained with Full fine-tuning. \
             The MLX framework does not support gradient computation for quantized weights. \
             Please switch to LoRA or DoRA — both support quantized models via QLoRA."
                .into(),
        );
    }

    let optimizer = training_params["optimizer"].as_str().unwrap_or("adam").to_string();
    let iters = training_params["iters"].as_u64().unwrap_or(1000);
    let batch_size = training_params["batch_size"].as_u64().unwrap_or(4);
    let lora_layers = training_params["lora_layers"].as_u64().unwrap_or(16);
    let lora_rank = training_params["lora_rank"].as_u64().unwrap_or(8);
    let lora_scale = training_params["lora_scale"].as_f64().unwrap_or(20.0);
    let lora_dropout = training_params["lora_dropout"].as_f64().unwrap_or(0.0);
    let use_rslora = training_params["lora_scale_strategy"].as_str().unwrap_or("standard") == "rslora";
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
    let train_path = data_dir.join("train.jsonl");
    let valid_path = data_dir.join("valid.jsonl");
    if !train_path.exists() {
        return Err("Dataset train.jsonl not found. Please generate a dataset first.".into());
    }
    if !valid_path.exists() {
        // D-11 allows importing dataset folders without valid.jsonl.
        // For mlx_lm.lora compatibility, create a fallback valid split from train.
        std::fs::copy(&train_path, &valid_path).map_err(|e| {
            format!(
                "Dataset valid.jsonl not found, and failed to auto-generate from train.jsonl: {}",
                e
            )
        })?;
    }

    // Auto-clamp batch_size so it never exceeds the smallest dataset split
    let count_lines = |path: &std::path::Path| -> usize {
        std::fs::read_to_string(path)
            .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
            .unwrap_or(0)
    };
    let train_count = count_lines(&train_path);
    let valid_count = count_lines(&valid_path);
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
        "lora_scale_strategy": if use_rslora { "rslora" } else { "standard" },
        "use_rslora": use_rslora,
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
        "seed": seed,
        "dataset_path": data_dir.to_string_lossy(),
        "train_samples": train_count,
        "valid_samples": valid_count,
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
        let base = format!(
            "lora_parameters:\n  rank: {}\n  alpha: {}\n  dropout: {}\n  scale: {}\n",
            lora_rank,
            lora_rank * 2,
            lora_dropout,
            lora_scale,
        );
        if use_rslora {
            format!("{}  use_rslora: true\n", base)
        } else {
            base
        }
    };
    std::fs::write(&config_path, &config_content)
        .map_err(|e| format!("Failed to write lora config: {}", e))?;

    let python_bin = executor.python_bin().clone();
    let job_id_clone = job_id.clone();
    let adapter_path_str = adapter_path.to_string_lossy().to_string();
    let adapter_path_str_spawn = adapter_path_str.clone();

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

                let started_at_ms: f64 = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as f64)
                    .unwrap_or(0.0);

                // Collect all log lines for post-training loss parsing
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();
                let collected: std::sync::Arc<std::sync::Mutex<Vec<String>>> =
                    std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));

                let app_out = app.clone();
                let jid_out = job_id_clone.clone();
                let col_out = std::sync::Arc::clone(&collected);
                let stdout_task = tokio::spawn(async move {
                    if let Some(out) = stdout {
                        let mut lines = BufReader::new(out).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            let _ = app_out.emit("training-log", serde_json::json!({
                                "job_id": jid_out,
                                "line": &line,
                            }));
                            if let Ok(mut v) = col_out.lock() { v.push(line); }
                        }
                    }
                });

                let app_err = app.clone();
                let jid_err = job_id_clone.clone();
                let col_err = std::sync::Arc::clone(&collected);
                let stderr_task = tokio::spawn(async move {
                    if let Some(err) = stderr {
                        let mut lines = BufReader::new(err).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            let _ = app_err.emit("training-log", serde_json::json!({
                                "job_id": jid_err,
                                "line": &line,
                            }));
                            if let Ok(mut v) = col_err.lock() { v.push(line); }
                        }
                    }
                });

                let _ = tokio::join!(stdout_task, stderr_task);

                let completed_at_ms: f64 = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as f64)
                    .unwrap_or(0.0);

                // Parse training/validation loss from collected log lines
                let mut train_series: Vec<serde_json::Value> = Vec::new();
                let mut val_series: Vec<serde_json::Value> = Vec::new();
                let mut last_iter: u64 = 0;
                if let Ok(lines) = collected.lock() {
                    for line in lines.iter() {
                        if !line.starts_with("Iter ") { continue; }
                        let after_iter = &line[5..];
                        let iter_end = after_iter.find(|c: char| !c.is_ascii_digit()).unwrap_or(after_iter.len());
                        let iter: u64 = match after_iter[..iter_end].parse() { Ok(n) => n, Err(_) => continue };
                        last_iter = last_iter.max(iter);
                        if let Some(rest) = line.split("Train loss ").nth(1) {
                            let s = rest.split(',').next().unwrap_or("").trim();
                            if let Ok(loss) = s.parse::<f64>() {
                                train_series.push(serde_json::json!([iter as f64, loss]));
                            }
                        }
                        if let Some(rest) = line.split("Val loss ").nth(1) {
                            let s = rest.split(',').next()
                                .and_then(|p| p.split_whitespace().next())
                                .unwrap_or("");
                            if let Ok(loss) = s.parse::<f64>() {
                                val_series.push(serde_json::json!([iter as f64, loss]));
                            }
                        }
                    }
                }
                let final_train = train_series.last().and_then(|v| v.as_array()).and_then(|a| a.get(1)).and_then(|v| v.as_f64());
                let first_train = train_series.first().and_then(|v| v.as_array()).and_then(|a| a.get(1)).and_then(|v| v.as_f64());
                let final_val   = val_series.last().and_then(|v| v.as_array()).and_then(|a| a.get(1)).and_then(|v| v.as_f64());
                let loss_improvement = match (first_train, final_train) {
                    (Some(f), Some(l)) if f > 0.0 => Some((f - l) / f * 100.0),
                    _ => None,
                };

                match child.wait().await {
                    Ok(exit_status) => {
                        let success = exit_status.success();
                        let final_status = if success { "completed" } else { "stopped" };
                        let result_json = serde_json::json!({
                            "status": final_status,
                            "started_at": started_at_ms,
                            "completed_at": completed_at_ms,
                            "duration_ms": completed_at_ms - started_at_ms,
                            "final_train_loss": final_train,
                            "final_val_loss": final_val,
                            "first_train_loss": first_train,
                            "loss_improvement_pct": loss_improvement,
                            "total_iters_completed": last_iter,
                            "train_loss_series": train_series,
                            "val_loss_series": val_series,
                        });
                        let _ = std::fs::write(
                            std::path::Path::new(&adapter_path_str_spawn).join("training_result.json"),
                            serde_json::to_string(&result_json).unwrap_or_default(),
                        );
                        let _ = app.emit("training-complete", serde_json::json!({
                            "job_id": job_id_clone,
                            "success": success,
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

    Ok(StartTrainingResult {
        job_id,
        adapter_path: adapter_path_str,
    })
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

    // 4. Scan LM Studio models directory
    scan_lmstudio_models(&resolved.lmstudio, "lmstudio", &mut models);

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
        let model_dir = entry.path();

        let detected = if dir_name.starts_with("models--") {
            let snapshots = model_dir.join("snapshots");
            if !snapshots.exists() { None } else {
                let latest_snapshot = std::fs::read_dir(&snapshots)
                    .ok()
                    .and_then(|rd| {
                        rd.filter_map(|e| e.ok())
                            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                            .max_by_key(|e| e.metadata().ok().and_then(|m| m.modified().ok()))
                    });

                latest_snapshot.and_then(|snap| {
                    let snap_path = snap.path();
                    let has_model_files = std::fs::read_dir(&snap_path).ok()
                        .map(|rd| rd.filter_map(|e| e.ok())
                            .any(|e| {
                                let n = e.file_name().to_string_lossy().to_string();
                                n.ends_with(".safetensors") || n == "config.json"
                            }))
                        .unwrap_or(false);

                    if !has_model_files { return None; }

                    let model_id = dir_name.trim_start_matches("models--").replace("--", "/");
                    let blobs_dir = model_dir.join("blobs");
                    let size_mb = dir_size_recursive(&blobs_dir);
                    Some((model_id, snap_path, size_mb))
                })
            }
        } else {
            let has_direct_model_files = std::fs::read_dir(&model_dir).ok()
                .map(|rd| rd.filter_map(|e| e.ok())
                    .any(|e| {
                        let n = e.file_name().to_string_lossy().to_string();
                        n.ends_with(".safetensors") || n == "config.json"
                    }))
                .unwrap_or(false);

            if !has_direct_model_files {
                None
            } else {
                Some((dir_name.clone(), model_dir.clone(), dir_size_recursive(&model_dir)))
            }
        };

        if let Some((model_id, model_path, size_mb)) = detected {
            let name_lower = model_id.to_lowercase();
            let is_mlx = name_lower.contains("mlx")
                || name_lower.contains("4bit")
                || name_lower.contains("8bit")
                || name_lower.contains("-quantized");

            models.push(LocalModelInfo {
                name: model_id,
                path: model_path.to_string_lossy().to_string(),
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

/// Scan LM Studio models directory.
/// LM Studio 2.x stores models under <root>/hub/models/{publisher}/{model}/
/// with manifest.json + model.yaml (hub format, no direct .gguf in model dir).
/// We probe multiple candidate roots to handle different LM Studio configurations.
fn scan_lmstudio_models(
    models_dir: &std::path::Path,
    source: &str,
    models: &mut Vec<LocalModelInfo>,
) {
    // Build candidate scan roots
    let mut scan_roots: Vec<std::path::PathBuf> = Vec::new();

    // 1. Try the configured path directly
    if models_dir.exists() { scan_roots.push(models_dir.to_path_buf()); }

    // 2. <configured>/hub/models (hub inside the configured root)
    let hub_sub = models_dir.join("hub").join("models");
    if hub_sub.exists() && !scan_roots.contains(&hub_sub) { scan_roots.push(hub_sub); }

    // 3. Sibling hub: parent(configured)/hub/models
    //    e.g. configured=~/.lmstudio/models → parent=~/.lmstudio → ~/.lmstudio/hub/models
    if let Some(parent) = models_dir.parent() {
        let sibling_hub = parent.join("hub").join("models");
        if sibling_hub.exists() && !scan_roots.contains(&sibling_hub) {
            scan_roots.push(sibling_hub);
        }
    }

    let mut seen = std::collections::HashSet::<String>::new();

    for scan_root in scan_roots {
        let Ok(publishers) = std::fs::read_dir(&scan_root) else { continue; };
        for pub_entry in publishers.filter_map(|e| e.ok()) {
            if !pub_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
            let publisher = pub_entry.file_name().to_string_lossy().to_string();
            if publisher.starts_with('.') { continue; }

            let Ok(model_entries) = std::fs::read_dir(pub_entry.path()) else { continue; };
            for model_entry in model_entries.filter_map(|e| e.ok()) {
                if !model_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
                let model_name = model_entry.file_name().to_string_lossy().to_string();
                if model_name.starts_with('.') { continue; }
                let model_path = model_entry.path();

                let dir_entries: Vec<_> = std::fs::read_dir(&model_path).ok()
                    .map(|rd| rd.filter_map(|e| e.ok()).collect())
                    .unwrap_or_default();

                // LM Studio hub format uses manifest.json/model.yaml (no direct .gguf)
                let has_manifest = model_path.join("manifest.json").exists()
                    || model_path.join("model.yaml").exists();
                let has_safetensors = dir_entries.iter()
                    .any(|e| e.file_name().to_string_lossy().ends_with(".safetensors"));
                let has_gguf = dir_entries.iter()
                    .any(|e| e.file_name().to_string_lossy().ends_with(".gguf"));
                let has_config = model_path.join("config.json").exists();

                // Valid model: hub manifest OR actual weight files
                if !has_manifest && !has_safetensors && !has_gguf { continue; }

                let model_id = format!("{}/{}", publisher, model_name);
                if seen.contains(&model_id) { continue; }
                seen.insert(model_id.clone());

                let size_mb = dir_size_recursive(&model_path);
                let name_lower = model_id.to_lowercase();

                let is_mlx = (has_safetensors && has_config)
                    || (has_safetensors && (name_lower.contains("mlx")
                        || name_lower.contains("4bit")
                        || name_lower.contains("8bit")
                        || name_lower.contains("-quantized")));

                models.push(LocalModelInfo {
                    name: model_id,
                    path: model_path.to_string_lossy().to_string(),
                    size_mb,
                    is_mlx,
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
        Some("lmstudio") => resolved.lmstudio,
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

/// Open the LM Studio application on macOS.
#[tauri::command]
pub fn open_lmstudio_app() -> Result<(), String> {
    // Try the standard macOS app name
    let result = std::process::Command::new("open")
        .arg("-a")
        .arg("LM Studio")
        .spawn();
    match result {
        Ok(_) => Ok(()),
        Err(_) => {
            // Fallback: try bundle identifier
            let result2 = std::process::Command::new("open")
                .arg("-b")
                .arg("ai.lmstudio")
                .spawn();
            match result2 {
                Ok(_) => Ok(()),
                Err(e) => Err(format!("Cannot open LM Studio: {}. Is it installed?", e)),
            }
        }
    }
}

/// Check if LM Studio's local API server is running and return model list.
#[tauri::command]
pub async fn check_lmstudio_server() -> Result<LmStudioServerStatus, String> {
    let cfg = crate::commands::config::load_config();
    let api_url = cfg.lmstudio_api_url
        .unwrap_or_else(|| "http://localhost:1234".to_string());
    let url = format!("{}/v1/models", api_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    match client.get(&url).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
                let models: Vec<String> = body.get("data")
                    .and_then(|d| d.as_array())
                    .map(|arr| arr.iter()
                        .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
                        .collect())
                    .unwrap_or_default();
                Ok(LmStudioServerStatus {
                    running: true,
                    models,
                    error: None,
                })
            } else {
                Ok(LmStudioServerStatus {
                    running: false,
                    models: vec![],
                    error: Some(format!("HTTP {}", resp.status())),
                })
            }
        }
        Err(e) => {
            Ok(LmStudioServerStatus {
                running: false,
                models: vec![],
                error: Some(e.to_string()),
            })
        }
    }
}

#[derive(serde::Serialize)]
pub struct LmStudioServerStatus {
    pub running: bool,
    pub models: Vec<String>,
    pub error: Option<String>,
}

// ─── Training History ───────────────────────────────────────────────

/// Save training result data (loss curves, metrics, status) alongside the adapter.
/// Called by the frontend when training completes, fails, or is stopped.
#[tauri::command]
pub fn save_training_result(adapter_path: String, result_json: String) -> Result<(), String> {
    let path = std::path::Path::new(&adapter_path);
    if !path.exists() {
        return Err(format!("Adapter path does not exist: {}", adapter_path));
    }
    let result_path = path.join("training_result.json");
    std::fs::write(&result_path, &result_json)
        .map_err(|e| format!("Failed to save training result: {}", e))?;
    Ok(())
}

/// A single training history record combining metadata + results.
#[derive(serde::Serialize)]
pub struct TrainingHistoryRecord {
    pub id: String,
    pub adapter_path: String,
    pub has_weights: bool,
    // From training_meta.json
    pub base_model: String,
    pub fine_tune_type: String,
    pub optimizer: String,
    pub iters: u64,
    pub batch_size: u64,
    pub lora_layers: u64,
    pub lora_rank: u64,
    pub lora_scale: f64,
    pub lora_scale_strategy: String,
    pub lora_dropout: f64,
    pub learning_rate: f64,
    pub max_seq_length: u64,
    pub grad_checkpoint: bool,
    pub grad_accumulation_steps: u64,
    pub save_every: u64,
    pub mask_prompt: bool,
    pub steps_per_eval: u64,
    pub steps_per_report: u64,
    pub val_batches: u64,
    pub seed: u64,
    pub dataset_path: String,
    pub train_samples: u64,
    pub valid_samples: u64,
    pub created_at: String,
    // From training_result.json (optional — may not exist if training was interrupted)
    pub status: String,
    pub started_at: Option<f64>,
    pub completed_at: Option<f64>,
    pub duration_ms: Option<f64>,
    pub final_train_loss: Option<f64>,
    pub final_val_loss: Option<f64>,
    pub first_train_loss: Option<f64>,
    pub loss_improvement_pct: Option<f64>,
    pub total_iters_completed: Option<u64>,
    pub train_loss_series: Vec<[f64; 2]>,
    pub val_loss_series: Vec<[f64; 2]>,
    pub note: String,
}

/// List all training history records for a project by scanning adapter directories.
#[tauri::command]
pub fn list_training_history(project_id: String) -> Result<Vec<TrainingHistoryRecord>, String> {
    let dir_manager = ProjectDirManager::new();
    let adapters_dir = dir_manager.project_path(&project_id).join("adapters");
    if !adapters_dir.exists() {
        return Ok(vec![]);
    }

    let mut records: Vec<TrainingHistoryRecord> = Vec::new();

    let entries = std::fs::read_dir(&adapters_dir).map_err(|e| e.to_string())?;
    for entry in entries.filter_map(|e| e.ok()) {
        let meta_result = entry.metadata();
        if meta_result.is_err() { continue; }
        let meta = meta_result.unwrap();
        if !meta.is_dir() { continue; }

        let path = entry.path();
        let meta_path = path.join("training_meta.json");
        // Only include directories that have training_meta.json (i.e., created by our training flow)
        if !meta_path.exists() { continue; }

        let meta_json: serde_json::Value = match std::fs::read_to_string(&meta_path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => continue,
        };

        let has_weights = path.join("adapters.safetensors").exists()
            || std::fs::read_dir(&path).ok()
                .map(|rd| rd.filter_map(|e| e.ok())
                    .any(|e| e.file_name().to_string_lossy().ends_with("_adapters.safetensors")))
                .unwrap_or(false);

        // Read optional result file
        let result_path = path.join("training_result.json");
        let result_json: serde_json::Value = std::fs::read_to_string(&result_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        let adapter_id = entry.file_name().to_string_lossy().to_string();

        let record = TrainingHistoryRecord {
            id: adapter_id,
            adapter_path: path.to_string_lossy().to_string(),
            has_weights,
            // Meta fields
            base_model: meta_json["base_model"].as_str().unwrap_or("").to_string(),
            fine_tune_type: meta_json["fine_tune_type"].as_str().unwrap_or("lora").to_string(),
            optimizer: meta_json["optimizer"].as_str().unwrap_or("adam").to_string(),
            iters: meta_json["iters"].as_u64().unwrap_or(0),
            batch_size: meta_json["batch_size"].as_u64().unwrap_or(0),
            lora_layers: meta_json["lora_layers"].as_u64().unwrap_or(0),
            lora_rank: meta_json["lora_rank"].as_u64().unwrap_or(0),
            lora_scale: meta_json["lora_scale"].as_f64().unwrap_or(0.0),
            lora_scale_strategy: meta_json["lora_scale_strategy"].as_str().unwrap_or("standard").to_string(),
            lora_dropout: meta_json["lora_dropout"].as_f64().unwrap_or(0.0),
            learning_rate: meta_json["learning_rate"].as_f64().unwrap_or(0.0),
            max_seq_length: meta_json["max_seq_length"].as_u64().unwrap_or(0),
            grad_checkpoint: meta_json["grad_checkpoint"].as_bool().unwrap_or(false),
            grad_accumulation_steps: meta_json["grad_accumulation_steps"].as_u64().unwrap_or(1),
            save_every: meta_json["save_every"].as_u64().unwrap_or(100),
            mask_prompt: meta_json["mask_prompt"].as_bool().unwrap_or(false),
            steps_per_eval: meta_json["steps_per_eval"].as_u64().unwrap_or(200),
            steps_per_report: meta_json["steps_per_report"].as_u64().unwrap_or(10),
            val_batches: meta_json["val_batches"].as_u64().unwrap_or(25),
            seed: meta_json["seed"].as_u64().unwrap_or(0),
            dataset_path: meta_json["dataset_path"].as_str().unwrap_or("").to_string(),
            train_samples: meta_json["train_samples"].as_u64().unwrap_or(0),
            valid_samples: meta_json["valid_samples"].as_u64().unwrap_or(0),
            created_at: meta_json["created_at"].as_str().unwrap_or("").to_string(),
            // Result fields
            status: result_json["status"].as_str().unwrap_or(
                if has_weights { "completed" } else { "stopped" }
            ).to_string(),
            started_at: result_json["started_at"].as_f64(),
            completed_at: result_json["completed_at"].as_f64(),
            duration_ms: result_json["duration_ms"].as_f64(),
            final_train_loss: result_json["final_train_loss"].as_f64(),
            final_val_loss: result_json["final_val_loss"].as_f64(),
            first_train_loss: result_json["first_train_loss"].as_f64(),
            loss_improvement_pct: result_json["loss_improvement_pct"].as_f64(),
            total_iters_completed: result_json["total_iters_completed"].as_u64(),
            train_loss_series: result_json["train_loss_series"].as_array()
                .map(|arr| arr.iter().filter_map(|v| {
                    let a = v.as_array()?;
                    Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?])
                }).collect())
                .unwrap_or_default(),
            val_loss_series: result_json["val_loss_series"].as_array()
                .map(|arr| arr.iter().filter_map(|v| {
                    let a = v.as_array()?;
                    Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?])
                }).collect())
                .unwrap_or_default(),
            note: result_json["note"].as_str().unwrap_or("").to_string(),
        };

        records.push(record);
    }

    // Sort by created_at descending (newest first)
    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(records)
}

/// Update the note field in a training result file.
#[tauri::command]
pub fn update_training_note(adapter_path: String, note: String) -> Result<(), String> {
    let path = std::path::Path::new(&adapter_path);
    let result_path = path.join("training_result.json");
    let mut result_json: serde_json::Value = std::fs::read_to_string(&result_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}));
    result_json["note"] = serde_json::Value::String(note);
    std::fs::write(&result_path, serde_json::to_string_pretty(&result_json).unwrap_or_default())
        .map_err(|e| format!("Failed to update note: {}", e))?;
    Ok(())
}
