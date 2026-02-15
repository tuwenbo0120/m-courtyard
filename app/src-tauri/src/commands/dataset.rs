use tauri::Emitter;
use crate::fs::ProjectDirManager;
use crate::python::PythonExecutor;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU32, Ordering};

static GENERATION_PID: AtomicU32 = AtomicU32::new(0);

#[tauri::command]
pub async fn stop_generation() -> Result<(), String> {
    let pid = GENERATION_PID.swap(0, Ordering::SeqCst);
    if pid == 0 {
        return Err("No generation process running".into());
    }
    unsafe {
        // Kill the process group (negative PID) to stop both caffeinate and python
        libc::kill(-(pid as i32), libc::SIGTERM);
        // Also kill the direct process in case pgid differs
        libc::kill(pid as i32, libc::SIGTERM);
    }
    Ok(())
}

#[tauri::command]
pub async fn start_cleaning(
    app: tauri::AppHandle,
    project_id: String,
    lang: Option<String>,
) -> Result<(), String> {
    let executor = PythonExecutor::default();
    if !executor.is_ready() {
        return Err("Python environment is not ready. Please set up the environment first.".into());
    }

    let dir_manager = ProjectDirManager::new();
    let project_path = dir_manager.project_path(&project_id);

    if !project_path.join("raw").exists() {
        return Err("No raw data directory found. Import files first.".into());
    }

    // Clear cleaned/ directory before re-cleaning to ensure data isolation
    let cleaned_dir = project_path.join("cleaned");
    if cleaned_dir.exists() {
        let _ = std::fs::remove_dir_all(&cleaned_dir);
    }
    let _ = std::fs::create_dir_all(&cleaned_dir);

    let scripts_dir = PythonExecutor::scripts_dir();
    let script = scripts_dir.join("clean_data.py");
    if !script.exists() {
        return Err(format!("Cleaning script not found at: {}", script.display()));
    }
    let supports_lang = script_supports_lang_arg(&script);

    let python_bin = executor.python_bin().clone();

    tokio::spawn(async move {
        let mut caffeinate_args: Vec<String> = vec![
            "-i".to_string(),
            python_bin.to_string_lossy().to_string(),
            script.to_string_lossy().to_string(),
            "--project-dir".to_string(),
            project_path.to_string_lossy().to_string(),
        ];
        let lang_value = lang.unwrap_or_else(|| "en".to_string());
        if supports_lang {
            caffeinate_args.push("--lang".to_string());
            caffeinate_args.push(lang_value);
        } else {
            let _ = app.emit(
                "cleaning:log",
                serde_json::json!({
                    "message": "⚠️ Cleaning script does not support --lang, fallback to script default language."
                }),
            );
        }

        // Wrap with caffeinate -i to prevent idle sleep during cleaning
        let result = tokio::process::Command::new("caffeinate")
            .args(&caffeinate_args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();

        match result {
            Ok(mut child) => {
                use tokio::io::{AsyncBufReadExt, BufReader};

                let mut stdout_task = None;
                if let Some(stdout) = child.stdout.take() {
                    let app_stdout = app.clone();
                    stdout_task = Some(tokio::spawn(async move {
                        let reader = BufReader::new(stdout);
                        let mut lines = reader.lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            // Parse JSON events from Python script
                            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                                let event_type = event["type"].as_str().unwrap_or("unknown");
                                let _ = app_stdout.emit(&format!("cleaning:{}", event_type), &event);
                            } else {
                                let _ = app_stdout.emit("cleaning:log", serde_json::json!({ "line": line }));
                            }
                        }
                    }));
                }

                let mut stderr_task = None;
                if let Some(stderr) = child.stderr.take() {
                    let app_stderr = app.clone();
                    stderr_task = Some(tokio::spawn(async move {
                        let reader = BufReader::new(stderr);
                        let mut lines = reader.lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            let line = line.trim();
                            if !line.is_empty() {
                                let _ = app_stderr.emit("cleaning:log", serde_json::json!({ "line": line }));
                            }
                        }
                    }));
                }

                match child.wait().await {
                    Ok(status) => {
                        if !status.success() {
                            let _ = app.emit("cleaning:error", serde_json::json!({
                                "message": "Cleaning process exited with error"
                            }));
                        }
                    }
                    Err(e) => {
                        let _ = app.emit("cleaning:error", serde_json::json!({
                            "message": e.to_string()
                        }));
                    }
                }

                if let Some(task) = stdout_task {
                    let _ = task.await;
                }
                if let Some(task) = stderr_task {
                    let _ = task.await;
                }
            }
            Err(e) => {
                let _ = app.emit("cleaning:error", serde_json::json!({
                    "message": e.to_string()
                }));
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn generate_dataset(
    app: tauri::AppHandle,
    project_id: String,
    model: String,
    mode: String,
    source: String,
    resume: Option<bool>,
    lang: Option<String>,
) -> Result<String, String> {
    let executor = PythonExecutor::default();
    if !executor.is_ready() {
        return Err("Python environment is not ready.".into());
    }

    let dir_manager = ProjectDirManager::new();
    let project_path = dir_manager.project_path(&project_id);

    let segments_path = project_path.join("cleaned").join("segments.jsonl");
    if !segments_path.exists() {
        return Err("No cleaned data found. Run cleaning first.".into());
    }

    let scripts_dir = PythonExecutor::scripts_dir();

    // Select script based on source
    let script_name = match source.as_str() {
        "ollama" => "generate_dataset_ollama.py",
        "builtin" => "generate_dataset_builtin.py",
        _ => "generate_dataset.py", // legacy mlx-lm fallback
    };
    let script = scripts_dir.join(script_name);
    if !script.exists() {
        return Err(format!("Dataset generation script not found: {}", script.display()));
    }
    let supports_lang = script_supports_lang_arg(&script);

    let python_bin = executor.python_bin().clone();
    let should_resume = resume.unwrap_or(false);

    // Create timestamped output directory for this generation run
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let dataset_root = project_path.join("dataset");
    let output_dir = dataset_root.join(&timestamp);
    let _ = std::fs::create_dir_all(&output_dir);

    // Save generation metadata (raw files, mode, source, model)
    let raw_dir = project_path.join("raw");
    let raw_file_names: Vec<String> = std::fs::read_dir(&raw_dir)
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_file())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    let meta = serde_json::json!({
        "raw_files": raw_file_names,
        "mode": &mode,
        "source": &source,
        "model": if source != "builtin" { &model } else { "" },
    });
    let _ = std::fs::write(
        output_dir.join("meta.json"),
        serde_json::to_string_pretty(&meta).unwrap_or_default(),
    );

    let ts_clone = timestamp.clone();

    tokio::spawn(async move {
        // Build args for the python command
        let mut py_args: Vec<String> = vec![
            script.to_string_lossy().to_string(),
            "--project-dir".to_string(),
            project_path.to_string_lossy().to_string(),
            "--output-dir".to_string(),
            output_dir.to_string_lossy().to_string(),
            "--mode".to_string(),
            mode,
        ];
        if source != "builtin" {
            py_args.push("--model".to_string());
            py_args.push(model);
        }
        if should_resume {
            py_args.push("--resume".to_string());
        }
        if supports_lang {
            py_args.push("--lang".to_string());
            py_args.push(lang.unwrap_or_else(|| "en".to_string()));
        } else {
            let _ = app.emit(
                "dataset:log",
                serde_json::json!({
                    "message": "⚠️ Dataset script does not support --lang, fallback to script default language."
                }),
            );
        }

        // Wrap with caffeinate -i to prevent idle sleep during generation
        let mut caffeinate_args: Vec<String> = vec![
            "-i".to_string(),
            python_bin.to_string_lossy().to_string(),
        ];
        caffeinate_args.extend(py_args);

        let result = tokio::process::Command::new("caffeinate")
            .args(&caffeinate_args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();

        match result {
            Ok(mut child) => {
                // Store PID for stop_generation
                if let Some(pid) = child.id() {
                    GENERATION_PID.store(pid, Ordering::SeqCst);
                }

                use tokio::io::{AsyncBufReadExt, BufReader};

                let mut stdout_task = None;
                if let Some(stdout) = child.stdout.take() {
                    let app_stdout = app.clone();
                    stdout_task = Some(tokio::spawn(async move {
                        let reader = BufReader::new(stdout);
                        let mut lines = reader.lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                                let event_type = event["type"].as_str().unwrap_or("unknown");
                                let _ = app_stdout.emit(&format!("dataset:{}", event_type), &event);
                            } else {
                                let _ = app_stdout.emit("dataset:log", serde_json::json!({ "line": line }));
                            }
                        }
                    }));
                }

                let mut stderr_task = None;
                if let Some(stderr) = child.stderr.take() {
                    let app_stderr = app.clone();
                    stderr_task = Some(tokio::spawn(async move {
                        let reader = BufReader::new(stderr);
                        let mut lines = reader.lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            let line = line.trim();
                            if !line.is_empty() {
                                let _ = app_stderr.emit("dataset:log", serde_json::json!({ "line": line }));
                            }
                        }
                    }));
                }

                // Clear PID
                GENERATION_PID.store(0, Ordering::SeqCst);

                match child.wait().await {
                    Ok(status) => {
                        if status.success() {
                            // Rename directory to completion timestamp
                            let final_ts = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
                            let final_dir = dataset_root.join(&final_ts);
                            let version_id = if std::fs::rename(&output_dir, &final_dir).is_ok() {
                                final_ts
                            } else {
                                ts_clone.clone()
                            };
                            // Success: emit with version id
                            let _ = app.emit("dataset:version", serde_json::json!({
                                "version": version_id
                            }));
                        } else {
                            let code = status.code().unwrap_or(-1);
                            // Clean up incomplete directory on failure/stop
                            let _ = std::fs::remove_dir_all(&output_dir);
                            if code == 143 || code == -1 {
                                let _ = app.emit("dataset:stopped", serde_json::json!({
                                    "message": "Generation stopped, incomplete data cleaned up"
                                }));
                            } else {
                                let msg = if code == 2 {
                                    "Generation exited with code 2 (argument parsing failed). Check AI logs for stderr details."
                                        .to_string()
                                } else {
                                    format!("Generation exited with code {}", code)
                                };
                                let _ = app.emit("dataset:error", serde_json::json!({
                                    "message": msg
                                }));
                            }
                        }
                    }
                    Err(e) => {
                        let _ = std::fs::remove_dir_all(&output_dir);
                        let _ = app.emit("dataset:error", serde_json::json!({
                            "message": e.to_string()
                        }));
                    }
                }

                if let Some(task) = stdout_task {
                    let _ = task.await;
                }
                if let Some(task) = stderr_task {
                    let _ = task.await;
                }
            }
            Err(e) => {
                let _ = std::fs::remove_dir_all(&output_dir);
                let _ = app.emit("dataset:error", serde_json::json!({
                    "message": e.to_string()
                }));
            }
        }
    });

    Ok(timestamp)
}

// Info about a single dataset version
#[derive(serde::Serialize, Clone)]
pub struct DatasetVersionInfo {
    pub version: String,       // timestamp string e.g. "20260211_103031"
    pub path: String,          // full path to the version directory
    pub train_count: usize,
    pub valid_count: usize,
    pub train_size: u64,       // bytes
    pub valid_size: u64,       // bytes
    pub created: String,       // human-readable date
    pub raw_files: Vec<String>,
    pub mode: String,
    pub source: String,
    pub model: String,
}

/// List all dataset versions for a project, sorted newest first
#[tauri::command]
pub fn list_dataset_versions(
    project_id: String,
) -> Result<Vec<DatasetVersionInfo>, String> {
    let dir_manager = ProjectDirManager::new();
    let dataset_root = dir_manager.project_path(&project_id).join("dataset");

    if !dataset_root.exists() {
        return Ok(vec![]);
    }

    let mut versions: Vec<DatasetVersionInfo> = Vec::new();

    let entries = std::fs::read_dir(&dataset_root)
        .map_err(|e| format!("Failed to read dataset directory: {}", e))?;

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_dir() { continue; }

        let dir_name = entry.file_name().to_string_lossy().to_string();
        let train_path = path.join("train.jsonl");
        let valid_path = path.join("valid.jsonl");

        // Skip directories without train.jsonl
        if !train_path.exists() { continue; }

        let train_count = count_jsonl_lines(&train_path);
        let valid_count = count_jsonl_lines(&valid_path);
        let train_size = std::fs::metadata(&train_path).map(|m| m.len()).unwrap_or(0);
        let valid_size = std::fs::metadata(&valid_path).map(|m| m.len()).unwrap_or(0);

        // Parse timestamp from directory name for display
        let created = parse_timestamp_display(&dir_name);

        // Read metadata if available
        let meta_path = path.join("meta.json");
        let (raw_files, gen_mode, gen_source, gen_model) = if meta_path.exists() {
            match std::fs::read_to_string(&meta_path) {
                Ok(content) => {
                    let m: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
                    let rf = m["raw_files"].as_array()
                        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                        .unwrap_or_default();
                    let mode = m["mode"].as_str().unwrap_or("").to_string();
                    let source = m["source"].as_str().unwrap_or("").to_string();
                    let model = m["model"].as_str().unwrap_or("").to_string();
                    (rf, mode, source, model)
                }
                Err(_) => (vec![], String::new(), String::new(), String::new()),
            }
        } else {
            (vec![], String::new(), String::new(), String::new())
        };

        versions.push(DatasetVersionInfo {
            version: dir_name,
            path: path.to_string_lossy().to_string(),
            train_count,
            valid_count,
            train_size,
            valid_size,
            created,
            raw_files,
            mode: gen_mode,
            source: gen_source,
            model: gen_model,
        });
    }

    // Also check for legacy flat dataset (train.jsonl directly in dataset/)
    let legacy_train = dataset_root.join("train.jsonl");
    if legacy_train.exists() {
        let legacy_valid = dataset_root.join("valid.jsonl");
        let train_count = count_jsonl_lines(&legacy_train);
        let valid_count = count_jsonl_lines(&legacy_valid);
        let train_size = std::fs::metadata(&legacy_train).map(|m| m.len()).unwrap_or(0);
        let valid_size = std::fs::metadata(&legacy_valid).map(|m| m.len()).unwrap_or(0);
        let created = std::fs::metadata(&legacy_train)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                let dt = chrono::DateTime::from_timestamp(d.as_secs() as i64, 0).unwrap_or_default();
                let local: chrono::DateTime<chrono::Local> = dt.into();
                local.format("%Y-%m-%d %H:%M").to_string()
            })
            .unwrap_or_else(|| "legacy".to_string());

        versions.push(DatasetVersionInfo {
            version: "legacy".to_string(),
            path: dataset_root.to_string_lossy().to_string(),
            train_count,
            valid_count,
            train_size,
            valid_size,
            created,
            raw_files: vec![],
            mode: String::new(),
            source: String::new(),
            model: String::new(),
        });
    }

    // Sort by version name descending (newest timestamp first)
    versions.sort_by(|a, b| b.version.cmp(&a.version));
    Ok(versions)
}

/// Sample raw file content for mode compatibility detection
#[tauri::command]
pub fn sample_raw_files(project_id: String) -> Result<Vec<RawFileSample>, String> {
    let dir_manager = ProjectDirManager::new();
    let raw_dir = dir_manager.project_path(&project_id).join("raw");
    if !raw_dir.exists() {
        return Ok(vec![]);
    }

    let mut samples = Vec::new();
    let entries = std::fs::read_dir(&raw_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let ext = path.extension().unwrap_or_default().to_string_lossy().to_lowercase();
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

        // Read first 2000 bytes for content analysis
        let snippet = match std::fs::read(&path) {
            Ok(bytes) => {
                let take = bytes.len().min(2000);
                // Try UTF-8, fallback to lossy
                String::from_utf8(bytes[..take].to_vec())
                    .unwrap_or_else(|_| String::from_utf8_lossy(&bytes[..take]).to_string())
            }
            Err(_) => String::new(),
        };

        samples.push(RawFileSample { name, ext, size, snippet });
    }

    Ok(samples)
}

#[derive(serde::Serialize, Clone)]
pub struct RawFileSample {
    pub name: String,
    pub ext: String,
    pub size: u64,
    pub snippet: String,
}

#[derive(serde::Serialize, Clone)]
pub struct SegmentPreviewItem {
    pub id: usize,
    pub text_preview: String,
    pub char_count: usize,
    pub line_count: usize,
    pub strategy: String,
    pub source_file: String,
}

#[derive(serde::Serialize, Clone)]
pub struct SegmentPreviewSummary {
    pub total_segments: usize,
    pub avg_chars: usize,
    pub min_chars: usize,
    pub max_chars: usize,
    pub short_segments: usize,
    pub long_segments: usize,
    pub primary_strategy: String,
}

#[derive(serde::Serialize, Clone)]
pub struct SegmentPreviewResponse {
    pub summary: SegmentPreviewSummary,
    pub items: Vec<SegmentPreviewItem>,
}

impl SegmentPreviewResponse {
    fn empty() -> Self {
        Self {
            summary: SegmentPreviewSummary {
                total_segments: 0,
                avg_chars: 0,
                min_chars: 0,
                max_chars: 0,
                short_segments: 0,
                long_segments: 0,
                primary_strategy: "paragraph_balanced".to_string(),
            },
            items: vec![],
        }
    }
}

/// Read cleaned segments and return a compact visual preview payload.
#[tauri::command]
pub fn preview_clean_segments(
    project_id: String,
    limit: Option<usize>,
) -> Result<SegmentPreviewResponse, String> {
    let dir_manager = ProjectDirManager::new();
    let project_path = dir_manager.project_path(&project_id);
    let raw_dir = project_path.join("raw");
    let segments_path = project_path
        .join("cleaned")
        .join("segments.jsonl");
    let manifest_path = project_path
        .join("cleaned")
        .join("segments_manifest.json");

    let mut raw_names: HashSet<String> = HashSet::new();
    let mut raw_signatures: Vec<(String, u64, u64)> = Vec::new();
    let mut newest_raw_modified = 0u64;

    if raw_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&raw_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let Ok(meta) = entry.metadata() else {
                    continue;
                };
                let name = entry.file_name().to_string_lossy().to_string();
                let size_bytes = meta.len();
                let modified_ts = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                newest_raw_modified = newest_raw_modified.max(modified_ts);
                raw_names.insert(name.clone());
                raw_signatures.push((name, size_bytes, modified_ts));
            }
        }
    }

    if raw_names.is_empty() {
        return Ok(SegmentPreviewResponse::empty());
    }

    raw_signatures.sort_by(|a, b| a.0.cmp(&b.0));

    if !segments_path.exists() {
        return Ok(SegmentPreviewResponse::empty());
    }

    let segments_modified = std::fs::metadata(&segments_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    if manifest_path.exists() {
        let Ok(manifest_content) = std::fs::read_to_string(&manifest_path) else {
            return Ok(SegmentPreviewResponse::empty());
        };
        let Ok(manifest_json) = serde_json::from_str::<serde_json::Value>(&manifest_content) else {
            return Ok(SegmentPreviewResponse::empty());
        };
        let Some(files) = manifest_json.get("raw_files").and_then(|v| v.as_array()) else {
            return Ok(SegmentPreviewResponse::empty());
        };

        let mut manifest_signatures: Vec<(String, u64, u64)> = Vec::new();
        for file in files {
            let Some(name) = file.get("name").and_then(|v| v.as_str()) else {
                continue;
            };
            if name.trim().is_empty() {
                continue;
            }
            let size_bytes = file
                .get("size_bytes")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let modified_ts = file
                .get("modified_ts")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            manifest_signatures.push((name.to_string(), size_bytes, modified_ts));
        }
        manifest_signatures.sort_by(|a, b| a.0.cmp(&b.0));

        if manifest_signatures != raw_signatures {
            return Ok(SegmentPreviewResponse::empty());
        }
    } else if newest_raw_modified > segments_modified {
        return Ok(SegmentPreviewResponse::empty());
    }

    let content = std::fs::read_to_string(&segments_path)
        .map_err(|e| format!("Failed to read segments.jsonl: {}", e))?;

    let max_items = limit.unwrap_or(8).clamp(1, 50);
    let mut total_segments = 0usize;
    let mut total_chars = 0usize;
    let mut min_chars = usize::MAX;
    let mut max_chars = 0usize;
    let mut short_segments = 0usize;
    let mut long_segments = 0usize;
    let mut strategy_count: HashMap<String, usize> = HashMap::new();
    let mut items: Vec<SegmentPreviewItem> = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let Ok(obj) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };

        let text = obj
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();

        if text.is_empty() {
            continue;
        }

        let source_file = obj
            .get("source_file")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if source_file.is_empty() || !raw_names.contains(source_file.as_str()) {
            continue;
        }

        total_segments += 1;
        let char_count = text.chars().count();
        total_chars += char_count;
        min_chars = min_chars.min(char_count);
        max_chars = max_chars.max(char_count);
        if char_count < 160 {
            short_segments += 1;
        }
        if char_count > 1800 {
            long_segments += 1;
        }

        let strategy = obj
            .get("strategy")
            .and_then(|v| v.as_str())
            .unwrap_or("paragraph_balanced")
            .to_string();
        *strategy_count.entry(strategy.clone()).or_insert(0) += 1;

        if items.len() >= max_items {
            continue;
        }

        let line_count = text.lines().filter(|l| !l.trim().is_empty()).count().max(1);
        let id = obj
            .get("id")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(total_segments.saturating_sub(1));

        items.push(SegmentPreviewItem {
            id,
            text_preview: truncate_preview(text, 180),
            char_count,
            line_count,
            strategy,
            source_file,
        });
    }

    if total_segments == 0 {
        return Ok(SegmentPreviewResponse::empty());
    }

    let primary_strategy = strategy_count
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(key, _)| key)
        .unwrap_or_else(|| "paragraph_balanced".to_string());

    Ok(SegmentPreviewResponse {
        summary: SegmentPreviewSummary {
            total_segments,
            avg_chars: total_chars / total_segments,
            min_chars,
            max_chars,
            short_segments,
            long_segments,
            primary_strategy,
        },
        items,
    })
}

/// Open the dataset root directory in Finder
#[tauri::command]
pub fn open_dataset_folder(project_id: String) -> Result<(), String> {
    let dir_manager = ProjectDirManager::new();
    let dataset_root = dir_manager.project_path(&project_id).join("dataset");
    if !dataset_root.exists() {
        std::fs::create_dir_all(&dataset_root).map_err(|e| e.to_string())?;
    }
    std::process::Command::new("open")
        .arg(&dataset_root)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_dataset_preview(
    project_id: String,
    version: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let dir_manager = ProjectDirManager::new();
    let dataset_root = dir_manager.project_path(&project_id).join("dataset");

    // Determine train.jsonl path based on version
    let train_path = match version.as_deref() {
        Some("legacy") | None => {
            // Try legacy flat path first, then find latest versioned
            let legacy = dataset_root.join("train.jsonl");
            if legacy.exists() {
                legacy
            } else {
                // Find latest versioned dataset
                find_latest_train_path(&dataset_root)
                    .ok_or_else(|| "No dataset found".to_string())?
            }
        }
        Some(v) => dataset_root.join(v).join("train.jsonl"),
    };

    if !train_path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&train_path)
        .map_err(|e| format!("Failed to read train.jsonl: {}", e))?;

    let mut items = Vec::new();
    for (i, line) in content.lines().enumerate() {
        if i >= 50 { break; }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            items.push(val);
        }
    }

    Ok(items)
}

fn count_jsonl_lines(path: &std::path::Path) -> usize {
    if !path.exists() { return 0; }
    std::fs::read_to_string(path)
        .map(|c| c.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0)
}

fn script_supports_lang_arg(script_path: &std::path::Path) -> bool {
    std::fs::read_to_string(script_path)
        .map(|s| s.contains("--lang") || s.contains("add_lang_arg"))
        .unwrap_or(false)
}

fn truncate_preview(text: &str, max_chars: usize) -> String {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = String::new();

    for (idx, ch) in normalized.chars().enumerate() {
        if idx >= max_chars {
            out.push('…');
            return out;
        }
        out.push(ch);
    }

    out
}

fn parse_timestamp_display(ts: &str) -> String {
    // Parse "20260211_103031" -> "2026-02-11 10:30"
    if ts.len() >= 15 {
        format!(
            "{}-{}-{} {}:{}",
            &ts[0..4], &ts[4..6], &ts[6..8], &ts[9..11], &ts[11..13]
        )
    } else {
        ts.to_string()
    }
}

fn find_latest_train_path(dataset_root: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut dirs: Vec<_> = std::fs::read_dir(dataset_root).ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir() && e.path().join("train.jsonl").exists())
        .collect();
    dirs.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    dirs.first().map(|e| e.path().join("train.jsonl"))
}
