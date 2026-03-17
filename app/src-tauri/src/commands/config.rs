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
    /// Custom path to the ollama binary (overrides auto-detection)
    pub ollama_bin: Option<String>,
    /// LM Studio local API base URL (default: http://localhost:1234)
    pub lmstudio_api_url: Option<String>,
}

fn default_hf_source() -> String {
    "huggingface".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ModelPaths {
    pub huggingface: Option<String>,
    pub modelscope: Option<String>,
    pub ollama: Option<String>,
    pub lmstudio: Option<String>,
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
        lmstudio: config.model_paths.lmstudio
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".lmstudio").join("models")),
    }
}

pub struct ResolvedPaths {
    pub huggingface: PathBuf,
    pub modelscope: PathBuf,
    pub ollama: PathBuf,
    pub lmstudio: PathBuf,
}

// ─── Tauri Commands ───

#[derive(Serialize)]
pub struct AppConfigResponse {
    pub huggingface: String,
    pub modelscope: String,
    pub ollama: String,
    pub lmstudio: String,
    pub huggingface_custom: bool,
    pub modelscope_custom: bool,
    pub ollama_custom: bool,
    pub lmstudio_custom: bool,
    pub export_path: Option<String>,
    pub default_export_root: String,
    pub ollama_installed: bool,
    pub lmstudio_installed: bool,
    pub lmstudio_api_url: String,
    pub hf_source: String,
    pub ollama_bin_path: String,
    pub ollama_bin_custom: bool,
}

#[tauri::command]
pub fn get_app_config() -> Result<AppConfigResponse, String> {
    let config = load_config();
    let resolved = resolve_model_paths();
    let (ollama_bin_path, ollama_installed) = resolve_ollama_bin_status(&config);
    let default_export_root = ProjectDirManager::new()
        .project_path("__template__")
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "./projects".to_string());
    let ollama_bin_custom = config.ollama_bin.is_some();

    let lmstudio_installed = resolved.lmstudio.exists();
    let lmstudio_api_url = config.lmstudio_api_url.clone()
        .unwrap_or_else(|| "http://localhost:1234".to_string());

    Ok(AppConfigResponse {
        huggingface: resolved.huggingface.to_string_lossy().to_string(),
        modelscope: resolved.modelscope.to_string_lossy().to_string(),
        ollama: resolved.ollama.to_string_lossy().to_string(),
        lmstudio: resolved.lmstudio.to_string_lossy().to_string(),
        huggingface_custom: config.model_paths.huggingface.is_some(),
        modelscope_custom: config.model_paths.modelscope.is_some(),
        ollama_custom: config.model_paths.ollama.is_some(),
        lmstudio_custom: config.model_paths.lmstudio.is_some(),
        export_path: config.export_path,
        default_export_root,
        ollama_installed,
        lmstudio_installed,
        lmstudio_api_url,
        hf_source: config.hf_source,
        ollama_bin_path,
        ollama_bin_custom,
    })
}

#[tauri::command]
pub fn set_model_source_path(source: String, path: Option<String>) -> Result<(), String> {
    let mut config = load_config();
    match source.as_str() {
        "huggingface" => config.model_paths.huggingface = path,
        "modelscope" => config.model_paths.modelscope = path,
        "ollama" => config.model_paths.ollama = path,
        "lmstudio" => config.model_paths.lmstudio = path,
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

/// Resolve the ollama binary path: config override > auto-detect > bare name.
pub fn resolve_ollama_bin_path(config: &AppConfig) -> String {
    if let Some(ref custom) = config.ollama_bin {
        let p = std::path::Path::new(custom);
        if p.exists() && is_ollama_bin_available(custom) {
            return custom.clone();
        }
    }
    PythonExecutor::find_ollama()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "ollama".to_string())
}

/// Lightweight check for whether the given ollama binary can actually execute.
pub fn is_ollama_bin_available(bin_path: &str) -> bool {
    std::process::Command::new(bin_path)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Resolve ollama binary path and whether it is runnable.
pub fn resolve_ollama_bin_status(config: &AppConfig) -> (String, bool) {
    let path = resolve_ollama_bin_path(config);
    let installed = is_ollama_bin_available(&path);
    (path, installed)
}

/// Convenience wrapper for commands that read from app config directly.
pub fn resolve_ollama_bin_status_from_config() -> (String, bool) {
    let config = load_config();
    resolve_ollama_bin_status(&config)
}

#[tauri::command]
pub fn set_ollama_bin_path(path: Option<String>) -> Result<(), String> {
    let mut config = load_config();
    config.ollama_bin = path;
    save_config(&config)
}

/// Set LM Studio API base URL (or reset to default).
#[tauri::command]
pub fn set_lmstudio_api_url(url: Option<String>) -> Result<(), String> {
    let mut config = load_config();
    config.lmstudio_api_url = url;
    save_config(&config)
}

/// Check LM Studio API connectivity by hitting GET /v1/models.
/// Returns list of model identifiers on success.
#[tauri::command]
pub async fn check_lmstudio_api() -> Result<Vec<String>, String> {
    let config = load_config();
    let base_url = config.lmstudio_api_url
        .unwrap_or_else(|| "http://localhost:1234".to_string());
    let url = format!("{}/v1/models", base_url.trim_end_matches('/'));

    let resp = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("LM Studio API unreachable: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("LM Studio API returned status {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await
        .map_err(|e| format!("Failed to parse LM Studio response: {}", e))?;

    let models = body["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().map(String::from))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(models)
}

/// Return the HF_ENDPOINT URL for the configured source (empty = default HuggingFace)
pub fn hf_endpoint_for_source(source: &str) -> Option<String> {
    match source {
        "hf-mirror" => Some("https://hf-mirror.com".to_string()),
        _ => None, // huggingface uses default, modelscope not supported via HF_ENDPOINT
    }
}
