import { invoke } from "@tauri-apps/api/core";

export interface EnvironmentStatus {
  python_ready: boolean;
  mlx_lm_ready: boolean;
  mlx_lm_version: string | null;
  chip: string;
  memory_gb: number;
  os_version: string;
  uv_available: boolean;
  ollama_installed: boolean;
}

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
}

export async function checkEnvironment(): Promise<EnvironmentStatus> {
  return invoke("check_environment");
}

export async function setupEnvironment(): Promise<void> {
  return invoke("setup_environment");
}

export async function installUv(): Promise<void> {
  return invoke("install_uv");
}

export async function checkOllamaStatus(): Promise<OllamaStatus> {
  return invoke("check_ollama_status");
}
