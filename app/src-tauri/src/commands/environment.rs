use serde::Serialize;
use tauri::Emitter;
use crate::python::PythonExecutor;
use crate::fs::ProjectDirManager;

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

#[tauri::command]
pub async fn list_ollama_models() -> Result<Vec<OllamaModel>, String> {
    let ollama_bin = match PythonExecutor::find_ollama() {
        Some(bin) => bin,
        None => return Ok(vec![]),
    };

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
