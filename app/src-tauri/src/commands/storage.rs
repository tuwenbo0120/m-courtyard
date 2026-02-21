use serde::Serialize;
use std::path::Path;
use crate::fs::ProjectDirManager;

/// Per-project storage breakdown
#[derive(Serialize, Clone)]
pub struct ProjectStorageInfo {
    pub project_id: String,
    pub project_name: Option<String>,
    pub total_bytes: u64,
    pub export_fused_bytes: u64,
    pub empty_adapter_count: u32,
    pub checkpoint_bytes: u64,
}

/// Overall storage usage summary
#[derive(Serialize)]
pub struct StorageUsage {
    pub total_bytes: u64,
    pub cleanable_bytes: u64,
    pub export_fused_bytes: u64,
    pub empty_adapter_count: u32,
    pub tmp_bytes: u64,
    pub checkpoint_bytes: u64,
    pub projects: Vec<ProjectStorageInfo>,
}

/// Cleanup result
#[derive(Serialize)]
pub struct CleanupResult {
    pub freed_bytes: u64,
    pub removed_export_fused: u32,
    pub removed_empty_adapters: u32,
    pub removed_tmp: bool,
}

fn dir_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    let mut total: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                total += entry.metadata().map(|m| m.len()).unwrap_or(0);
            } else if p.is_dir() {
                total += dir_size(&p);
            }
        }
    }
    total
}

fn scan_project(project_path: &Path, project_id: &str) -> ProjectStorageInfo {
    let total_bytes = dir_size(project_path);

    // export/fused + export/ollama/fused + export/gguf (intermediate fused files)
    let export_dir = project_path.join("export");
    let mut export_fused_bytes: u64 = 0;
    // export/fused
    let fused = export_dir.join("fused");
    if fused.is_dir() {
        export_fused_bytes += dir_size(&fused);
    }
    // export/ollama/fused
    let ollama_fused = export_dir.join("ollama").join("fused");
    if ollama_fused.is_dir() {
        export_fused_bytes += dir_size(&ollama_fused);
    }

    // Empty adapter folders (interrupted training)
    let adapters_dir = project_path.join("adapters");
    let mut empty_adapter_count: u32 = 0;
    if adapters_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&adapters_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() && dir_size(&p) == 0 {
                    empty_adapter_count += 1;
                }
            }
        }
    }

    // Training checkpoint files (intermediate *_adapters.safetensors, not the final adapters.safetensors)
    let mut checkpoint_bytes: u64 = 0;
    if adapters_dir.is_dir() {
        if let Ok(adapter_entries) = std::fs::read_dir(&adapters_dir) {
            for adapter_entry in adapter_entries.flatten() {
                let adapter_path = adapter_entry.path();
                if !adapter_path.is_dir() {
                    continue;
                }
                // Check if this adapter folder has a final adapters.safetensors
                let final_adapter = adapter_path.join("adapters.safetensors");
                if !final_adapter.exists() {
                    continue;
                }
                // Count intermediate checkpoint files (pattern: NNNNNNN_adapters.safetensors)
                if let Ok(files) = std::fs::read_dir(&adapter_path) {
                    for file in files.flatten() {
                        let name = file.file_name().to_string_lossy().to_string();
                        if name.ends_with("_adapters.safetensors") && name != "adapters.safetensors" {
                            // Matches pattern like 0000200_adapters.safetensors
                            if name.chars().take_while(|c| c.is_ascii_digit()).count() >= 3 {
                                checkpoint_bytes += file.metadata().map(|m| m.len()).unwrap_or(0);
                            }
                        }
                    }
                }
            }
        }
    }

    ProjectStorageInfo {
        project_id: project_id.to_string(),
        project_name: None,
        total_bytes,
        export_fused_bytes,
        empty_adapter_count,
        checkpoint_bytes,
    }
}

#[tauri::command]
pub fn scan_storage_usage() -> Result<StorageUsage, String> {
    let dm = ProjectDirManager::new();
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let base_dir = home.join("Courtyard");
    let projects_dir = base_dir.join("projects");
    let tmp_dir = base_dir.join("tmp");

    let tmp_bytes = dir_size(&tmp_dir);

    let mut projects = Vec::new();
    let mut total_bytes: u64 = 0;
    let mut export_fused_bytes: u64 = 0;
    let mut empty_adapter_count: u32 = 0;
    let mut checkpoint_bytes: u64 = 0;

    if projects_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                let project_id = entry.file_name().to_string_lossy().to_string();
                let info = scan_project(&p, &project_id);
                total_bytes += info.total_bytes;
                export_fused_bytes += info.export_fused_bytes;
                empty_adapter_count += info.empty_adapter_count;
                checkpoint_bytes += info.checkpoint_bytes;
                projects.push(info);
            }
        }
    }

    total_bytes += tmp_bytes;
    let cleanable_bytes = export_fused_bytes + tmp_bytes + checkpoint_bytes;

    Ok(StorageUsage {
        total_bytes,
        cleanable_bytes,
        export_fused_bytes,
        empty_adapter_count,
        tmp_bytes,
        checkpoint_bytes,
        projects,
    })
}

#[tauri::command]
pub fn cleanup_project_cache() -> Result<CleanupResult, String> {
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let base_dir = home.join("Courtyard");
    let projects_dir = base_dir.join("projects");
    let tmp_dir = base_dir.join("tmp");

    let mut freed_bytes: u64 = 0;
    let mut removed_export_fused: u32 = 0;
    let mut removed_empty_adapters: u32 = 0;

    // 1. Clean tmp/
    let tmp_size = dir_size(&tmp_dir);
    if tmp_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&tmp_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let _ = std::fs::remove_dir_all(&p);
                } else {
                    let _ = std::fs::remove_file(&p);
                }
            }
        }
        freed_bytes += tmp_size;
    }

    // 2. Clean per-project export intermediates, empty adapters, checkpoints
    if projects_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                let project_path = entry.path();
                if !project_path.is_dir() {
                    continue;
                }

                // export/fused
                let fused = project_path.join("export").join("fused");
                if fused.is_dir() {
                    let size = dir_size(&fused);
                    if std::fs::remove_dir_all(&fused).is_ok() {
                        freed_bytes += size;
                        removed_export_fused += 1;
                    }
                }

                // export/ollama/fused
                let ollama_fused = project_path.join("export").join("ollama").join("fused");
                if ollama_fused.is_dir() {
                    let size = dir_size(&ollama_fused);
                    if std::fs::remove_dir_all(&ollama_fused).is_ok() {
                        freed_bytes += size;
                        removed_export_fused += 1;
                    }
                }

                // Empty adapter folders
                let adapters_dir = project_path.join("adapters");
                if adapters_dir.is_dir() {
                    if let Ok(adapter_entries) = std::fs::read_dir(&adapters_dir) {
                        for ae in adapter_entries.flatten() {
                            let ap = ae.path();
                            if ap.is_dir() && dir_size(&ap) == 0 {
                                if std::fs::remove_dir_all(&ap).is_ok() {
                                    removed_empty_adapters += 1;
                                }
                            }
                        }
                    }
                }

                // Training checkpoints (only when final adapters.safetensors exists)
                if adapters_dir.is_dir() {
                    if let Ok(adapter_entries) = std::fs::read_dir(&adapters_dir) {
                        for ae in adapter_entries.flatten() {
                            let ap = ae.path();
                            if !ap.is_dir() {
                                continue;
                            }
                            let final_adapter = ap.join("adapters.safetensors");
                            if !final_adapter.exists() {
                                continue;
                            }
                            if let Ok(files) = std::fs::read_dir(&ap) {
                                for file in files.flatten() {
                                    let name = file.file_name().to_string_lossy().to_string();
                                    if name.ends_with("_adapters.safetensors")
                                        && name != "adapters.safetensors"
                                        && name.chars().take_while(|c| c.is_ascii_digit()).count() >= 3
                                    {
                                        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
                                        if std::fs::remove_file(file.path()).is_ok() {
                                            freed_bytes += size;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(CleanupResult {
        freed_bytes,
        removed_export_fused,
        removed_empty_adapters,
        removed_tmp: tmp_size > 0,
    })
}
