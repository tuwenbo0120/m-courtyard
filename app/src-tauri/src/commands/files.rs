use serde::Serialize;
use std::fs;
use std::sync::OnceLock;
use crate::fs::ProjectDirManager;
use crate::python::PythonExecutor;
use crate::commands::config::build_uv_env;

/// Whether doc-parsing deps (PyPDF2, python-docx) have been checked/installed this session.
static DOC_DEPS_OK: OnceLock<bool> = OnceLock::new();

/// Ensure PyPDF2 and python-docx are installed in the app venv.
/// Runs the check only once per app session; auto-installs via uv if missing.
pub fn ensure_doc_deps() {
    DOC_DEPS_OK.get_or_init(|| {
        let executor = PythonExecutor::default();
        if !executor.is_ready() {
            return false;
        }

        // Quick check: can we import both?
        if let Ok(output) = std::process::Command::new(executor.python_bin())
            .args(["-c", "import PyPDF2; from docx import Document"])
            .output()
        {
            if output.status.success() {
                return true; // Already installed
            }
        }

        // Auto-install via uv
        if let Some(uv) = PythonExecutor::find_uv() {
            if let Ok(output) = std::process::Command::new(&uv)
                .args([
                    "pip", "install", "PyPDF2", "python-docx",
                    "--python", &executor.python_bin().to_string_lossy(),
                ])
                .envs(build_uv_env())
                .output()
            {
                return output.status.success();
            }
        }

        false
    });
}

#[derive(Clone, Serialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
}

const SUPPORTED_EXTENSIONS: &[&str] = &["txt", "json", "jsonl", "md", "docx", "pdf"];

fn is_supported_file(path: &std::path::Path) -> bool {
    if let Some(ext) = path.extension() {
        let ext_lower = ext.to_string_lossy().to_lowercase();
        SUPPORTED_EXTENSIONS.contains(&ext_lower.as_str())
    } else {
        false
    }
}

fn collect_files_recursive(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                collect_files_recursive(&p, out);
            } else if p.is_file() && is_supported_file(&p) {
                out.push(p);
            }
        }
    }
}

#[tauri::command]
pub async fn import_files(
    project_id: String,
    source_paths: Vec<String>,
) -> Result<Vec<FileInfo>, String> {
    let dir_manager = ProjectDirManager::new();
    let raw_dir = dir_manager.project_path(&project_id).join("raw");
    fs::create_dir_all(&raw_dir)
        .map_err(|e| format!("Failed to create raw directory: {}", e))?;

    // Expand directories into individual files recursively
    let mut all_files: Vec<std::path::PathBuf> = Vec::new();
    for source in &source_paths {
        let src = std::path::Path::new(source);
        if !src.exists() {
            continue;
        }
        if src.is_dir() {
            collect_files_recursive(src, &mut all_files);
        } else if src.is_file() && is_supported_file(src) {
            all_files.push(src.to_path_buf());
        }
    }

    let mut imported = Vec::new();

    for src in &all_files {
        let file_name = src
            .file_name()
            .ok_or_else(|| "Invalid file name".to_string())?
            .to_string_lossy()
            .to_string();
        // Avoid overwriting: append _N if name already exists
        let mut dest = raw_dir.join(&file_name);
        if dest.exists() {
            let stem = src.file_stem().unwrap_or_default().to_string_lossy().to_string();
            let ext = src.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
            let mut counter = 1u32;
            loop {
                let new_name = if ext.is_empty() {
                    format!("{}_{}", stem, counter)
                } else {
                    format!("{}_{}.{}", stem, counter, ext)
                };
                dest = raw_dir.join(&new_name);
                if !dest.exists() { break; }
                counter += 1;
            }
        }
        fs::copy(src, &dest).map_err(|e| format!("Failed to copy {}: {}", file_name, e))?;

        let metadata = fs::metadata(&dest)
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        imported.push(FileInfo {
            name: dest.file_name().unwrap_or_default().to_string_lossy().to_string(),
            path: dest.to_string_lossy().to_string(),
            size_bytes: metadata.len(),
        });
    }

    Ok(imported)
}

#[tauri::command]
pub async fn list_project_files(
    project_id: String,
    subdir: String,
) -> Result<Vec<FileInfo>, String> {
    let dir_manager = ProjectDirManager::new();
    let target_dir = dir_manager.project_path(&project_id).join(&subdir);

    if !target_dir.exists() {
        return Ok(vec![]);
    }

    let mut files = Vec::new();
    let entries = fs::read_dir(&target_dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry.metadata().map_err(|e| format!("Metadata error: {}", e))?;
        if metadata.is_file() {
            files.push(FileInfo {
                name: entry.file_name().to_string_lossy().to_string(),
                path: entry.path().to_string_lossy().to_string(),
                size_bytes: metadata.len(),
            });
        }
    }

    Ok(files)
}

/// Binary document extensions that require Python-based text extraction.
const BINARY_DOC_EXTENSIONS: &[&str] = &["pdf", "docx", "doc"];

fn is_binary_doc(path: &std::path::Path) -> bool {
    path.extension()
        .map(|e| BINARY_DOC_EXTENSIONS.contains(&e.to_string_lossy().to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Extract text from a binary document (PDF/DOCX) via the bundled Python helper.
/// `max_chars`: 0 means unlimited.
/// Automatically ensures PyPDF2/python-docx are installed before running.
pub fn extract_text_via_python(file_path: &str, max_chars: usize) -> Result<String, String> {
    let executor = PythonExecutor::default();
    if !executor.is_ready() {
        return Err("Python environment is not ready. Please set up the environment first.".into());
    }

    // Auto-install document parsing deps if missing (once per session)
    ensure_doc_deps();

    let script = PythonExecutor::scripts_dir().join("extract_text.py");
    if !script.exists() {
        return Err(format!("extract_text.py not found at: {}", script.display()));
    }

    let mut args = vec![
        script.to_string_lossy().to_string(),
        file_path.to_string(),
    ];
    if max_chars > 0 {
        args.push("--max-chars".to_string());
        args.push(max_chars.to_string());
    }

    let output = std::process::Command::new(executor.python_bin())
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run extract_text.py: {}", e))?;

    if !output.status.success() {
        return Err("Text extraction failed".into());
    }

    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if text == "__EXTRACT_LIB_MISSING__" {
        return Err("PyPDF2/python-docx auto-install failed. Please check your Python environment.".into());
    }
    Ok(text)
}

#[tauri::command]
pub async fn read_file_content(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if is_binary_doc(p) {
        extract_text_via_python(&path, 0)
    } else {
        fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
    }
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))
}

#[tauri::command]
pub async fn clear_project_data(project_id: String) -> Result<(), String> {
    let dir_manager = crate::fs::ProjectDirManager::new();
    let project_path = dir_manager.project_path(&project_id);
    for subdir in &["raw", "cleaned", "dataset"] {
        let dir = project_path.join(subdir);
        if dir.exists() {
            std::fs::remove_dir_all(&dir)
                .map_err(|e| format!("Failed to clear {}: {}", subdir, e))?;
        }
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to recreate {}: {}", subdir, e))?;
    }
    Ok(())
}
