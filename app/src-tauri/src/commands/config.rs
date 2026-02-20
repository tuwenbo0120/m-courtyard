use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::python::PythonExecutor;
use crate::fs::ProjectDirManager;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppConfig {
    #[serde(default)]
    pub model_paths: ModelPaths,
    pub export_path: Option<String>,
    /// Model download source: "huggingface" (default), "hf-mirror", "modelscope"
    #[serde(default = "default_hf_source")]
    pub hf_source: String,
}

fn default_hf_source() -> String {
    "huggingface".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ModelPaths {
    pub huggingface: Option<String>,
    pub modelscope: Option<String>,
    pub ollama: Option<String>,
}

fn config_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join("Courtyard").join("config.json")
}

pub fn load_config() -> AppConfig {
    let path = config_path();
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        AppConfig::default()
    }
}

fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Resolve actual paths (custom or default)
pub fn resolve_model_paths() -> ResolvedPaths {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let config = load_config();
    ResolvedPaths {
        huggingface: config.model_paths.huggingface
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".cache").join("huggingface").join("hub")),
        modelscope: config.model_paths.modelscope
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".cache").join("modelscope").join("hub")),
        ollama: config.model_paths.ollama
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".ollama").join("models")),
    }
}

pub struct ResolvedPaths {
    pub huggingface: PathBuf,
    pub modelscope: PathBuf,
    pub ollama: PathBuf,
}

// ─── Tauri Commands ───

#[derive(Serialize)]
pub struct AppConfigResponse {
    pub huggingface: String,
    pub modelscope: String,
    pub ollama: String,
    pub huggingface_custom: bool,
    pub modelscope_custom: bool,
    pub ollama_custom: bool,
    pub export_path: Option<String>,
    pub default_export_root: String,
    pub ollama_installed: bool,
    pub hf_source: String,
}

#[tauri::command]
pub fn get_app_config() -> Result<AppConfigResponse, String> {
    let config = load_config();
    let resolved = resolve_model_paths();
    let ollama_installed = PythonExecutor::find_ollama().is_some();
    let default_export_root = ProjectDirManager::new()
        .project_path("__template__")
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "./projects".to_string());
    Ok(AppConfigResponse {
        huggingface: resolved.huggingface.to_string_lossy().to_string(),
        modelscope: resolved.modelscope.to_string_lossy().to_string(),
        ollama: resolved.ollama.to_string_lossy().to_string(),
        huggingface_custom: config.model_paths.huggingface.is_some(),
        modelscope_custom: config.model_paths.modelscope.is_some(),
        ollama_custom: config.model_paths.ollama.is_some(),
        export_path: config.export_path,
        default_export_root,
        ollama_installed,
        hf_source: config.hf_source,
    })
}

#[tauri::command]
pub fn set_model_source_path(source: String, path: Option<String>) -> Result<(), String> {
    let mut config = load_config();
    match source.as_str() {
        "huggingface" => config.model_paths.huggingface = path,
        "modelscope" => config.model_paths.modelscope = path,
        "ollama" => config.model_paths.ollama = path,
        _ => return Err(format!("Unknown source: {}", source)),
    }
    save_config(&config)
}

#[tauri::command]
pub fn set_export_path(path: Option<String>) -> Result<(), String> {
    let mut config = load_config();
    config.export_path = path;
    save_config(&config)
}

#[tauri::command]
pub fn set_hf_source(source: String) -> Result<(), String> {
    let valid = ["huggingface", "hf-mirror", "modelscope"];
    if !valid.contains(&source.as_str()) {
        return Err(format!("Invalid source: {}. Must be one of: {:?}", source, valid));
    }
    let mut config = load_config();
    config.hf_source = source;
    save_config(&config)
}

/// Return the HF_ENDPOINT URL for the configured source (empty = default HuggingFace)
pub fn hf_endpoint_for_source(source: &str) -> Option<String> {
    match source {
        "hf-mirror" => Some("https://hf-mirror.com".to_string()),
        _ => None, // huggingface uses default, modelscope not supported via HF_ENDPOINT
    }
}
