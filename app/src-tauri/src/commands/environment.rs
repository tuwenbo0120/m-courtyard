use serde::Serialize;
use tauri::Emitter;
use crate::python::PythonExecutor;
use crate::fs::ProjectDirManager;
use std::path::PathBuf;

#[derive(Clone, Serialize)]
pub struct EnvironmentStatus {
    pub python_ready: bool,
    pub mlx_lm_ready: bool,
    pub mlx_lm_version: Option<String>,
    pub chip: String,
    pub memory_gb: f64,
    pub os_version: String,
    pub uv_available: bool,
    pub ollama_installed: bool,
}

#[derive(Clone, Serialize)]
pub struct OllamaStatus {
    pub installed: bool,
    pub running: bool,
}

#[derive(Clone, Serialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: String,
}

#[derive(Clone, Serialize)]
pub struct OllamaPathInfo {
    pub default_path: String,
    pub effective_path: String,
    pub configured_path: Option<String>,
    pub configured_has_layout: bool,
    pub configured_model_count: usize,
}

#[tauri::command]
pub async fn check_environment() -> Result<EnvironmentStatus, String> {
    let executor = PythonExecutor::default();
    let chip = get_chip_name();
    let memory_gb = get_system_memory_gb();
    let os_version = get_os_version();
    let uv_available = PythonExecutor::find_uv().is_some();

    let mut mlx_lm_ready = false;
    let mut mlx_lm_version = None;

    // If python exists, check mlx-lm directly (no dependency on external script)
    if executor.is_ready() {
        if let Ok(output) = std::process::Command::new(executor.python_bin())
            .args(["-c", "import mlx_lm; print(mlx_lm.__version__)"])
            .output()
        {
            if output.status.success() {
                let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !ver.is_empty() {
                    mlx_lm_ready = true;
                    mlx_lm_version = Some(ver);
                }
            }
        }
    }

    let ollama_installed = PythonExecutor::find_ollama().is_some();

    Ok(EnvironmentStatus {
        python_ready: executor.is_ready(),
        mlx_lm_ready,
        mlx_lm_version,
        chip,
        memory_gb,
        os_version,
        uv_available,
        ollama_installed,
    })
}

#[tauri::command]
pub async fn setup_environment(app: tauri::AppHandle) -> Result<(), String> {
    let executor = PythonExecutor::default();
    let dir_manager = ProjectDirManager::new();
    dir_manager.ensure_base_dirs().map_err(|e| format!("Failed to create dirs: {}", e))?;

    let uv_path = PythonExecutor::find_uv()
        .ok_or_else(|| "uv not found. Please install uv first: curl -LsSf https://astral.sh/uv/install.sh | sh".to_string())?;

    let venv_dir = executor.venv_dir();
    let python_dir = venv_dir.parent()
        .ok_or("Invalid venv path")?
        .to_path_buf();
    std::fs::create_dir_all(&python_dir)
        .map_err(|e| format!("Failed to create python dir: {}", e))?;

    // Step 1: Create venv with uv
    let _ = app.emit("env:setup-progress", serde_json::json!({
        "step": "Creating Python virtual environment...",
        "percent": 10
    }));

    let venv_result = tokio::process::Command::new(&uv_path)
        .args(["venv", &venv_dir.to_string_lossy(), "--python", "3.11"])
        .output()
        .await
        .map_err(|e| format!("Failed to create venv: {}", e))?;

    if !venv_result.status.success() {
        let stderr = String::from_utf8_lossy(&venv_result.stderr);
        return Err(format!("uv venv failed: {}", stderr));
    }

    let _ = app.emit("env:setup-progress", serde_json::json!({
        "step": "Installing mlx-lm...",
        "percent": 30
    }));

    // Step 2: Install mlx-lm
    let pip_result = tokio::process::Command::new(&uv_path)
        .args([
            "pip", "install", "mlx-lm",
            "--python", &executor.python_bin().to_string_lossy(),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to install mlx-lm: {}", e))?;

    if !pip_result.status.success() {
        let stderr = String::from_utf8_lossy(&pip_result.stderr);
        return Err(format!("mlx-lm install failed: {}", stderr));
    }

    let _ = app.emit("env:setup-progress", serde_json::json!({
        "step": "Environment ready!",
        "percent": 100
    }));

    Ok(())
}

/// Install uv package manager via the official installer script.
/// Uses `curl -LsSf https://astral.sh/uv/install.sh | sh` which installs to ~/.local/bin/uv.
#[tauri::command]
pub async fn install_uv(app: tauri::AppHandle) -> Result<(), String> {
    let _ = app.emit("env:setup-progress", serde_json::json!({
        "step": "Downloading uv package manager...",
        "percent": 20
    }));

    // Use the official uv installer script
    let result = tokio::process::Command::new("/bin/sh")
        .args(["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"])
        .output()
        .await
        .map_err(|e| format!("Failed to run uv installer: {}", e))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!("uv installation failed: {}", stderr));
    }

    let _ = app.emit("env:setup-progress", serde_json::json!({
        "step": "Verifying uv installation...",
        "percent": 80
    }));

    // Verify uv is now findable
    if PythonExecutor::find_uv().is_none() {
        return Err("uv was installed but could not be found. Please restart the app and try again.".to_string());
    }

    let _ = app.emit("env:setup-progress", serde_json::json!({
        "step": "uv installed successfully!",
        "percent": 100
    }));

    Ok(())
}

#[tauri::command]
pub async fn check_ollama_status() -> Result<OllamaStatus, String> {
    let ollama_bin = PythonExecutor::find_ollama();
    let installed = ollama_bin.is_some();
    let mut running = false;

    if let Some(ref bin) = ollama_bin {
        if let Ok(output) = std::process::Command::new(bin)
            .arg("list")
            .output()
        {
            running = output.status.success();
        }
    }

    Ok(OllamaStatus { installed, running })
}

fn get_chip_name() -> String {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "Unknown".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        "Unknown".to_string()
    }
}

fn get_system_memory_gb() -> f64 {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
            .map(|bytes| bytes as f64 / 1_073_741_824.0)
            .unwrap_or(0.0)
    }
    #[cfg(not(target_os = "macos"))]
    {
        0.0
    }
}

fn get_os_version() -> String {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| format!("macOS {}", s.trim()))
            .unwrap_or_else(|| "macOS".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        "Unknown".to_string()
    }
}

pub fn default_ollama_models_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".ollama")
        .join("models")
}

fn config_ollama_models_dir() -> Option<PathBuf> {
    let cfg = crate::commands::config::load_config();
    cfg.model_paths.ollama.map(PathBuf::from)
}

fn launchctl_update_ollama_models(path: Option<&str>) -> Result<(), String> {
    let mut cmd = std::process::Command::new("launchctl");
    if let Some(p) = path {
        cmd.args(["setenv", "OLLAMA_MODELS", p]);
    } else {
        cmd.args(["unsetenv", "OLLAMA_MODELS"]);
    }

    let out = cmd
        .output()
        .map_err(|e| format!("launchctl failed: {}", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("launchctl error: {}", detail));
    }
    Ok(())
}

fn restart_ollama_app() -> Result<(), String> {
    // 1) Graceful quit of the Ollama GUI app.
    let _ = std::process::Command::new("osascript")
        .args(["-e", "quit app \"Ollama\""])
        .output();

    // 2) Force-kill any lingering `ollama serve` daemon processes so we don't
    //    read stale OLLAMA_MODELS from the old process after restart.
    let _ = std::process::Command::new("pkill")
        .args(["-f", "ollama serve"])
        .output();

    // 3) Wait until all `ollama serve` processes are gone (up to 4 s).
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
    while std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(300));
        if running_ollama_daemon_pids().is_empty() {
            break;
        }
    }

    // 4) Relaunch Ollama.
    let out = std::process::Command::new("open")
        .args(["-a", "Ollama"])
        .output()
        .map_err(|e| format!("Failed to restart Ollama: {}", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("Failed to open Ollama app: {}", detail));
    }

    // 5) Wait until the new `ollama serve` daemon appears (up to 6 s).
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(6);
    while std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if !running_ollama_daemon_pids().is_empty() {
            break;
        }
    }

    Ok(())
}

/// Apply OLLAMA_MODELS into launchctl env and restart Ollama app.
/// - Some(path): set custom OLLAMA_MODELS
/// - None: unset OLLAMA_MODELS (daemon falls back to ~/.ollama/models)
pub fn apply_ollama_models_dir_and_restart(path: Option<&std::path::Path>) -> Result<(), String> {
    let value = path.map(|p| p.to_string_lossy().to_string());
    launchctl_update_ollama_models(value.as_deref())?;
    restart_ollama_app()
}

fn ollama_library_dir(base: &std::path::Path) -> PathBuf {
    base.join("manifests")
        .join("registry.ollama.ai")
        .join("library")
}

fn count_ollama_models(base: &std::path::Path) -> usize {
    let lib = ollama_library_dir(base);
    std::fs::read_dir(&lib)
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .count()
        })
        .unwrap_or(0)
}

fn running_ollama_daemon_pids() -> Vec<String> {
    let output = match std::process::Command::new("pgrep")
        .args(["-f", "ollama serve"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return vec![],
    };
    if !output.status.success() {
        return vec![];
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn ollama_models_from_daemon_pid(pid: &str) -> Option<PathBuf> {
    let out = std::process::Command::new("ps")
        .args(["eww", "-p", pid, "-o", "command="])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let cmdline = String::from_utf8_lossy(&out.stdout);
    cmdline
        .split_whitespace()
        .find_map(|tok| tok.strip_prefix("OLLAMA_MODELS="))
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

fn running_ollama_models_dir() -> Option<PathBuf> {
    let pids = running_ollama_daemon_pids();
    if pids.is_empty() {
        return None;
    }
    for pid in pids {
        if let Some(path) = ollama_models_from_daemon_pid(&pid) {
            return Some(path);
        }
    }
    // Daemon is running but has no OLLAMA_MODELS in its env → use Ollama default.
    Some(default_ollama_models_dir())
}

/// Get OLLAMA_MODELS from the user's shell env (sources .zshrc + .zprofile).
/// Returns None when not set.
pub fn get_ollama_models_dir() -> Option<String> {
    let out = std::process::Command::new("/bin/zsh")
        .args(["-c", "source ~/.zprofile 2>/dev/null; source ~/.zshrc 2>/dev/null; printf '%s' \"$OLLAMA_MODELS\""])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

/// Resolve the effective Ollama models directory using a single source-of-truth strategy:
/// 1) running daemon env (OLLAMA_MODELS),
/// 2) running daemon default (~/.ollama/models when env missing),
/// 3) shell env OLLAMA_MODELS,
/// 4) app config model_paths.ollama,
/// 5) default ~/.ollama/models.
pub fn resolve_ollama_models_dir() -> PathBuf {
    if let Some(path) = running_ollama_models_dir() {
        return path;
    }
    if let Some(path) = get_ollama_models_dir() {
        return PathBuf::from(path);
    }
    if let Some(path) = config_ollama_models_dir() {
        return path;
    }
    default_ollama_models_dir()
}

#[tauri::command]
pub fn get_ollama_path_info() -> Result<OllamaPathInfo, String> {
    let default_path = default_ollama_models_dir();
    let effective_path = resolve_ollama_models_dir();
    let configured_path_buf = config_ollama_models_dir();

    let (configured_has_layout, configured_model_count) = if let Some(ref p) = configured_path_buf {
        (ollama_library_dir(p).exists(), count_ollama_models(p))
    } else {
        (false, 0)
    };

    Ok(OllamaPathInfo {
        default_path: default_path.to_string_lossy().to_string(),
        effective_path: effective_path.to_string_lossy().to_string(),
        configured_path: configured_path_buf.map(|p| p.to_string_lossy().to_string()),
        configured_has_layout,
        configured_model_count,
    })
}

#[tauri::command]
pub async fn list_ollama_models() -> Result<Vec<OllamaModel>, String> {
    let ollama_bin = match PythonExecutor::find_ollama() {
        Some(bin) => bin,
        None => return Ok(vec![]),
    };

    // `ollama list` communicates with the running daemon via HTTP (/api/tags).
    // The OLLAMA_MODELS env var has no effect on this call — the daemon uses
    // whatever path it was started with.  We query without any env override so
    // the result faithfully reflects what the daemon currently knows about.
    let output = std::process::Command::new(&ollama_bin)
        .arg("list")
        .output()
        .map_err(|e| format!("Failed to run ollama list: {}", e))?;

    if !output.status.success() {
        return Ok(vec![]);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut models = Vec::new();

    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            models.push(OllamaModel {
                name: parts[0].to_string(),
                size: parts.get(2).unwrap_or(&"").to_string(),
            });
        }
    }

    Ok(models)
}

/// Apply the user's configured custom Ollama models path to the running daemon
/// by setting the launchctl environment variable and restarting the Ollama app.
/// Returns the path that was applied, or an error string.
#[tauri::command]
pub async fn fix_ollama_models_path() -> Result<String, String> {
    let custom_dir = config_ollama_models_dir()
        .ok_or_else(|| "No custom Ollama path configured in app settings.".to_string())?;

    apply_ollama_models_dir_and_restart(Some(&custom_dir))?;
    Ok(custom_dir.to_string_lossy().to_string())
}

/// Clear OLLAMA_MODELS from launchctl and restart Ollama, so daemon falls back
/// to the default ~/.ollama/models path.
#[tauri::command]
pub async fn reset_ollama_models_path() -> Result<String, String> {
    apply_ollama_models_dir_and_restart(None)?;
    Ok(default_ollama_models_dir().to_string_lossy().to_string())
}
