use std::path::PathBuf;
use std::sync::OnceLock;

pub struct PythonExecutor {
    python_path: PathBuf,
    base_dir: PathBuf,
}

/// Cached full PATH obtained from the user's login shell.
/// In .app bundles macOS provides only a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
/// We run `zsh -l -c 'echo $PATH'` once and cache the result so every
/// subsequent `find_binary` call can search the real PATH.
static SHELL_PATH: OnceLock<String> = OnceLock::new();

fn get_shell_path() -> &'static str {
    SHELL_PATH.get_or_init(|| {
        // Try login shell to pick up ~/.zshrc / ~/.zprofile / conda init etc.
        if let Ok(output) = std::process::Command::new("/bin/zsh")
            .args(["-l", "-c", "echo $PATH"])
            .output()
        {
            if output.status.success() {
                let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !p.is_empty() {
                    return p;
                }
            }
        }
        // Fallback: current process PATH (good enough in dev mode)
        std::env::var("PATH").unwrap_or_default()
    })
}

/// Search for a binary by name.
/// 1. Check well-known hardcoded paths first (fast, no shell needed).
/// 2. Parse the full login-shell PATH and check each directory.
fn find_binary(name: &str, extra_candidates: &[PathBuf]) -> Option<PathBuf> {
    // Phase 1: hardcoded candidates
    for c in extra_candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }

    // Phase 2: search every directory in the user's real shell PATH
    let shell_path = get_shell_path();
    for dir in shell_path.split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = PathBuf::from(dir).join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

impl PythonExecutor {
    pub fn python_bin(&self) -> &PathBuf {
        &self.python_path
    }

    pub fn venv_dir(&self) -> PathBuf {
        self.base_dir.join("python").join(".venv")
    }

    pub fn is_ready(&self) -> bool {
        self.python_path.exists()
    }

    /// Check if uv is available on the system
    pub fn find_uv() -> Option<PathBuf> {
        let home = std::env::var("HOME").unwrap_or_default();
        let candidates = vec![
            // Standard package-manager locations
            PathBuf::from("/usr/local/bin/uv"),
            PathBuf::from("/opt/homebrew/bin/uv"),
            // Rust / cargo install
            PathBuf::from(format!("{}/.cargo/bin/uv", home)),
            // pipx / uv self-install
            PathBuf::from(format!("{}/.local/bin/uv", home)),
            // uv standalone installer (newer versions)
            PathBuf::from(format!("{}/.uv/bin/uv", home)),
            // Conda / Miniconda (Homebrew cask)
            PathBuf::from("/opt/homebrew/Caskroom/miniconda/base/bin/uv"),
            PathBuf::from(format!("{}/miniconda3/bin/uv", home)),
            PathBuf::from(format!("{}/miniforge3/bin/uv", home)),
            PathBuf::from(format!("{}/anaconda3/bin/uv", home)),
            PathBuf::from(format!("{}/mambaforge/bin/uv", home)),
        ];
        find_binary("uv", &candidates)
    }

    /// Check if ollama is available on the system
    pub fn find_ollama() -> Option<PathBuf> {
        let candidates = vec![
            PathBuf::from("/usr/local/bin/ollama"),
            PathBuf::from("/opt/homebrew/bin/ollama"),
        ];
        find_binary("ollama", &candidates)
    }

    /// Returns the path to bundled scripts directory
    pub fn scripts_dir() -> PathBuf {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()));

        if let Some(dir) = exe_dir {
            let candidates = vec![
                // macOS app bundle: Contents/Resources/scripts (Tauri resources)
                dir.join("../Resources/scripts"),
                // Direct next to binary
                dir.join("scripts"),
                // Parent dirs (dev builds)
                dir.join("../scripts"),
                dir.join("../../scripts"),
            ];
            for c in candidates {
                if c.exists() {
                    return c.canonicalize().unwrap_or(c);
                }
            }
        }

        // Fallback: source tree scripts dir (works during development)
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest_dir.join("scripts")
    }
}

impl Default for PythonExecutor {
    fn default() -> Self {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let base_dir = home.join("Courtyard");
        let python_path = base_dir
            .join("python")
            .join(".venv")
            .join("bin")
            .join("python");
        Self { python_path, base_dir }
    }
}
