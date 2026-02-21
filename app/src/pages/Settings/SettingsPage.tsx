import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { useLocation } from "react-router-dom";
import { Monitor, Languages, Info, FolderOpen, RefreshCw, Download, RotateCcw, Globe, Palette, Trash2, HardDrive } from "lucide-react";
import { checkEnvironment, setupEnvironment, installUv, type EnvironmentStatus } from "@/services/environment";
import { useThemeStore, type ThemeId } from "@/stores/themeStore";
import { useTaskStore } from "@/stores/taskStore";
import { useExportStore } from "@/stores/exportStore";
import { useExportGgufStore } from "@/stores/exportGgufStore";

interface AppConfigResponse {
  huggingface: string;
  modelscope: string;
  ollama: string;
  huggingface_custom: boolean;
  modelscope_custom: boolean;
  ollama_custom: boolean;
  export_path: string | null;
  default_export_root: string;
  ollama_installed: boolean;
  hf_source: string;
}

interface OllamaPathInfo {
  default_path: string;
  effective_path: string;
  configured_path: string | null;
  configured_has_layout: boolean;
  configured_model_count: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

export function SettingsPage() {
  const { t, i18n } = useTranslation("settings");
  const location = useLocation();
  const taskLocked = useTaskStore((s) => s.activeProjectId !== null);
  const isOllamaExporting = useExportStore((s) => s.isExporting);
  const isGgufExporting = useExportGgufStore((s) => s.isExporting);
  const cleanupBlockedByTask = taskLocked || isOllamaExporting || isGgufExporting;
  const downloadSourceRef = useRef<HTMLElement | null>(null);
  const cacheRef = useRef<HTMLElement | null>(null);
  const [env, setEnv] = useState<EnvironmentStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupMsg, setSetupMsg] = useState<string | null>(null);
  const [config, setConfig] = useState<AppConfigResponse | null>(null);
  const [ollamaPathInfo, setOllamaPathInfo] = useState<OllamaPathInfo | null>(null);
  const [storageMsg, setStorageMsg] = useState<{ type: "success" | "warning"; text: string } | null>(null);
  const [cacheUsage, setCacheUsage] = useState<{
    total_bytes: number;
    cleanable_bytes: number;
    export_fused_bytes: number;
    empty_adapter_count: number;
    tmp_bytes: number;
    checkpoint_bytes: number;
  } | null>(null);
  const [cacheScanning, setCacheScanning] = useState(false);
  const [cacheCleaning, setCacheCleaning] = useState(false);
  const [cacheMsg, setCacheMsg] = useState<{ type: "success" | "warning"; text: string } | null>(null);
  const [appVersion, setAppVersion] = useState<string>("...");

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await invoke<AppConfigResponse>("get_app_config");
      setConfig(cfg);
    } catch { /* ignore */ }
  }, []);

  const loadOllamaPathInfo = useCallback(async (): Promise<OllamaPathInfo | null> => {
    try {
      const info = await invoke<OllamaPathInfo>("get_ollama_path_info");
      setOllamaPathInfo(info);
      return info;
    } catch {
      setOllamaPathInfo(null);
      return null;
    }
  }, []);

  const browseAndSetPath = async (source: string) => {
    const selected = await dialogOpen({ directory: true, multiple: false, title: t("environment.browseModelDir", { source }) });
    if (selected && typeof selected === "string") {
      if (source === "export") {
        await invoke("set_export_path", { path: selected });
      } else {
        await invoke("set_model_source_path", { source, path: selected });
      }
      await loadConfig();
      if (source === "ollama") {
        const info = await loadOllamaPathInfo();
        if (info?.configured_path) {
          if (!info.configured_has_layout) {
            setStorageMsg({
              type: "warning",
              text: t("storage.ollamaPathInvalidLayout", { path: info.configured_path }),
            });
          } else {
            try {
              await invoke("fix_ollama_models_path");
              await loadOllamaPathInfo();
            } catch (e) {
              setStorageMsg({
                type: "warning",
                text: t("storage.ollamaApplyFailed", { error: String(e) }),
              });
              return;
            }
            if (info.configured_model_count === 0) {
              setStorageMsg({
                type: "warning",
                text: t("storage.ollamaPathNoModels", { path: info.configured_path }),
              });
            } else {
              setStorageMsg({
                type: "success",
                text: t("storage.ollamaPathValid", { count: info.configured_model_count }),
              });
            }
          }
        }
      }
    }
  };

  const resetPath = async (source: string) => {
    if (source === "export") {
      await invoke("set_export_path", { path: null });
    } else {
      await invoke("set_model_source_path", { source, path: null });
    }
    if (source === "ollama") {
      try {
        await invoke("reset_ollama_models_path");
      } catch (e) {
        setStorageMsg({
          type: "warning",
          text: t("storage.ollamaResetFailed", { error: String(e) }),
        });
      }
      await loadConfig();
      const info = await loadOllamaPathInfo();
      if (info && info.effective_path === info.default_path) {
        setStorageMsg({
          type: "success",
          text: t("storage.ollamaResetApplied"),
        });
      } else if (info) {
        setStorageMsg({
          type: "warning",
          text: t("storage.ollamaEffectivePathPersistHint"),
        });
      }
      return;
    }
    await loadConfig();
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const status = await checkEnvironment();
      setEnv(status);
    } catch (e) {
      console.error("Failed to check environment:", e);
    } finally {
      setLoading(false);
    }
  };

  const scanCache = useCallback(async () => {
    setCacheScanning(true);
    try {
      const usage = await invoke<{
        total_bytes: number;
        cleanable_bytes: number;
        export_fused_bytes: number;
        empty_adapter_count: number;
        tmp_bytes: number;
        checkpoint_bytes: number;
      }>("scan_storage_usage");
      setCacheUsage(usage);
    } catch { /* ignore */ }
    setCacheScanning(false);
  }, []);

  const handleCleanup = async () => {
    if (cleanupBlockedByTask) {
      setCacheMsg({ type: "warning", text: t("storage.cleanupBlockedByTask") });
      return;
    }
    setCacheCleaning(true);
    setCacheMsg(null);
    try {
      const result = await invoke<{
        freed_bytes: number;
        removed_export_fused: number;
        removed_empty_adapters: number;
        removed_tmp: boolean;
      }>("cleanup_project_cache");
      setCacheMsg({
        type: "success",
        text: t("storage.cleanupDone", {
          size: formatBytes(result.freed_bytes),
          exportCount: result.removed_export_fused,
          adapterCount: result.removed_empty_adapters,
        }),
      });
      await scanCache();
    } catch (e) {
      setCacheMsg({ type: "warning", text: t("storage.cleanupError", { error: String(e) }) });
    }
    setCacheCleaning(false);
  };

  useEffect(() => {
    refresh();
    loadConfig();
    loadOllamaPathInfo();
    scanCache();
    // Load app version
    import("@tauri-apps/api/app")
      .then(api => api.getVersion())
      .then(setAppVersion)
      .catch(console.error);
  }, [loadConfig, loadOllamaPathInfo, scanCache]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const focus = params.get("focus");
    if (!focus) return;
    
    let el: HTMLElement | null = null;
    if (focus === "download-source") el = downloadSourceRef.current;
    else if (focus === "cache") el = cacheRef.current;
    
    if (!el) return;
    requestAnimationFrame(() => {
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [location.search]);

  const handleSetup = async () => {
    setSetupLoading(true);
    setSetupMsg(null);
    try {
      await setupEnvironment();
      setSetupMsg(t("environment.setupSuccess"));
      await refresh();
    } catch (e) {
      setSetupMsg(t("environment.setupError", { error: String(e) }));
    } finally {
      setSetupLoading(false);
    }
  };

  const [uvInstalling, setUvInstalling] = useState(false);

  const handleInstallUv = async () => {
    setUvInstalling(true);
    setSetupMsg(null);
    try {
      await installUv();
      setSetupMsg(t("environment.uvInstallSuccess"));
      await refresh();
    } catch (e) {
      setSetupMsg(t("environment.setupError", { error: String(e) }));
    } finally {
      setUvInstalling(false);
    }
  };

  const { theme, setTheme } = useThemeStore();

  const setLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  const themes: { id: ThemeId; dotColor: string }[] = [
    { id: "midnight", dotColor: "#52525b" },
    { id: "ocean", dotColor: "#60a5fa" },
    { id: "sunset", dotColor: "#f59e0b" },
    { id: "nebula", dotColor: "#a78bfa" },
    { id: "light", dotColor: "#d4d4d8" },
  ];

  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>

      {/* Environment Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Monitor size={18} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            {t("environment.title")}
          </h2>
          <button
            onClick={refresh}
            disabled={loading}
            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            {t("environment.refreshButton")}
          </button>
        </div>
        <div className="rounded-lg border border-border divide-y divide-border">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">{t("environment.chip")}</span>
            <span className="text-sm font-medium text-foreground">{env?.chip || "..."}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">{t("environment.memory")}</span>
            <span className="text-sm font-medium text-foreground">
              {env ? `${env.memory_gb.toFixed(0)} GB` : "..."}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">{t("environment.os")}</span>
            <span className="text-sm font-medium text-foreground">{env?.os_version || "..."}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">{t("environment.python")}</span>
            <span className={`text-sm font-medium ${env?.python_ready ? "text-success" : "text-warning"}`}>
              {env ? (env.python_ready ? t("environment.pythonReady") : t("environment.pythonNotReady")) : "..."}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">{t("environment.mlxLm")}</span>
            <span className={`text-sm font-medium ${env?.mlx_lm_ready ? "text-success" : "text-warning"}`}>
              {env ? (env.mlx_lm_ready ? t("environment.mlxLmReady", { version: env.mlx_lm_version || "?" }) : t("environment.mlxLmNotReady")) : "..."}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">{t("environment.uv")}</span>
            <span className={`text-sm font-medium ${env?.uv_available ? "text-success" : "text-warning"}`}>
              {env ? (env.uv_available ? t("environment.uvReady") : t("environment.uvNotReady")) : "..."}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">{t("environment.ollama")}</span>
            <span className={`text-sm font-medium ${env?.ollama_installed ? "text-success" : "text-muted-foreground"}`}>
              {env ? (env.ollama_installed ? t("environment.ollamaReady") : t("environment.ollamaNotReady")) : "..."}
            </span>
          </div>
        </div>

        {/* Install uv button - shown when uv is not found */}
        {env && !env.uv_available && (
          <div className="space-y-2">
            <button
              onClick={handleInstallUv}
              disabled={uvInstalling}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Download size={16} />
              {uvInstalling ? t("environment.uvInstalling") : t("environment.installUv")}
            </button>
            <p className="text-xs text-muted-foreground text-center">
              {t("environment.installUvDesc")}
            </p>
          </div>
        )}

        {/* Setup Button - shown when uv is available but python/mlx-lm is not ready */}
        {env && (!env.python_ready || !env.mlx_lm_ready) && env.uv_available && (
          <div className="space-y-2">
            <button
              onClick={handleSetup}
              disabled={setupLoading}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Download size={16} />
              {setupLoading
                ? t("environment.setupRunning")
                : env.python_ready && !env.mlx_lm_ready
                  ? t("environment.installMlxLm")
                  : t("environment.setupButton")}
            </button>
            <p className="text-xs text-muted-foreground text-center">
              {env.python_ready && !env.mlx_lm_ready
                ? t("environment.installMlxLmDesc")
                : t("environment.setupDesc")}
            </p>
          </div>
        )}
        {setupMsg && (
          <p className={`text-sm ${setupMsg.includes("failed") || setupMsg.includes("error") ? "text-red-400" : "text-success"}`}>
            {setupMsg}
          </p>
        )}
      </section>

      {/* Theme Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Palette size={18} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            {t("theme.title")}
          </h2>
        </div>
        <div className="flex gap-3">
          {themes.map((th) => (
            <button
              key={th.id}
              onClick={() => setTheme(th.id)}
              className={`flex-1 rounded-lg border px-3 py-3 text-left transition-colors ${
                theme === th.id
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-accent"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="inline-block h-4 w-4 rounded-full border border-foreground/20 shadow-sm"
                  style={{ backgroundColor: th.dotColor, boxShadow: theme === th.id ? `0 0 8px ${th.dotColor}80` : undefined }}
                />
                <span className={`text-sm font-medium ${
                  theme === th.id ? "text-foreground" : "text-muted-foreground"
                }`}>{t(`theme.${th.id}`)}</span>
              </div>
              <span className="block text-[10px] text-muted-foreground/70">{t(`theme.${th.id}Desc`)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Language Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Languages size={18} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            {t("language.title")}
          </h2>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setLanguage("en")}
            className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
              i18n.language === "en"
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            {t("language.en")}
          </button>
          <button
            onClick={() => setLanguage("zh-CN")}
            className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
              i18n.language === "zh-CN"
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            {t("language.zhCN")}
          </button>
        </div>
      </section>

      {/* Download Source Section */}
      <section id="download-source" ref={downloadSourceRef} className="space-y-4 scroll-mt-24">
        <div className="flex items-center gap-2">
          <Globe size={18} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            {t("downloadSource.title")}
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("downloadSource.desc")}
        </p>
        <div className="flex gap-3">
          {[
            { key: "huggingface", label: t("downloadSource.huggingface"), desc: t("downloadSource.huggingfaceDesc") },
            { key: "hf-mirror", label: t("downloadSource.hfMirror"), desc: t("downloadSource.hfMirrorDesc") },
            { key: "modelscope", label: t("downloadSource.modelscope"), desc: t("downloadSource.modelscopeDesc") },
          ].map((src) => (
            <button
              key={src.key}
              onClick={async () => {
                await invoke("set_hf_source", { source: src.key });
                await loadConfig();
              }}
              className={`flex-1 rounded-lg border px-3 py-3 text-left transition-colors ${
                config?.hf_source === src.key
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-accent"
              }`}
            >
              <span className={`block text-sm font-medium ${
                config?.hf_source === src.key ? "text-foreground" : "text-muted-foreground"
              }`}>{src.label}</span>
              <span className="block text-[10px] text-muted-foreground/70 mt-0.5">{src.desc}</span>
            </button>
          ))}
        </div>
        {config?.hf_source === "modelscope" && (
          <p className="text-xs text-warning/80">
            ⚠ {t("downloadSource.modelscopeWarn")}
          </p>
        )}
      </section>

      {/* Storage Section */}
      <section id="storage" className="space-y-4">
        <div className="flex items-center gap-2">
          <FolderOpen size={18} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            {t("storage.title")}
          </h2>
        </div>

        {storageMsg && (
          <p className={`text-xs ${storageMsg.type === "warning" ? "text-warning" : "text-success"}`}>
            {storageMsg.text}
          </p>
        )}

        <div className="rounded-lg border border-border divide-y divide-border">
          {/* Data Directory (read-only) */}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">{t("storage.dataDir")}</span>
            <span className="text-xs font-mono text-muted-foreground">~/Courtyard</span>
          </div>
        </div>

        {/* Model Storage Locations */}
        <div className="space-y-2">
          <div>
            <p className="text-xs font-medium text-foreground">{t("storage.modelPaths")}</p>
            <p className="text-xs text-muted-foreground/70">{t("storage.modelPathsDesc")}</p>
          </div>
          <div className="rounded-lg border border-border divide-y divide-border">
            {/* HuggingFace */}
            <div className="px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("storage.hfPath")}</span>
                <div className="flex items-center gap-2">
                  {config?.huggingface_custom && (
                    <button onClick={() => resetPath("huggingface")} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                      <RotateCcw size={10} />
                      {t("storage.resetDefault")}
                    </button>
                  )}
                  <button onClick={() => browseAndSetPath("huggingface")} className="text-xs text-primary hover:underline">
                    {t("storage.browse")}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-mono text-muted-foreground/70">{config?.huggingface || "..."}</span>
                {config && (
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${config.huggingface_custom ? "bg-tag-trained/15 text-tag-trained" : "bg-muted text-muted-foreground"}`}>
                    {config.huggingface_custom ? t("storage.custom") : t("storage.default")}
                  </span>
                )}
              </div>
            </div>
            {/* ModelScope */}
            <div className="px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("storage.msPath")}</span>
                <div className="flex items-center gap-2">
                  {config?.modelscope_custom && (
                    <button onClick={() => resetPath("modelscope")} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                      <RotateCcw size={10} />
                      {t("storage.resetDefault")}
                    </button>
                  )}
                  <button onClick={() => browseAndSetPath("modelscope")} className="text-xs text-primary hover:underline">
                    {t("storage.browse")}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-mono text-muted-foreground/70">{config?.modelscope || "..."}</span>
                {config && (
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${config.modelscope_custom ? "bg-tag-trained/15 text-tag-trained" : "bg-muted text-muted-foreground"}`}>
                    {config.modelscope_custom ? t("storage.custom") : t("storage.default")}
                  </span>
                )}
              </div>
            </div>
            {/* Ollama */}
            <div className="px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("storage.ollamaPath")}</span>
                <div className="flex items-center gap-2">
                  {config?.ollama_custom && (
                    <button onClick={() => resetPath("ollama")} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                      <RotateCcw size={10} />
                      {t("storage.resetDefault")}
                    </button>
                  )}
                  <button onClick={() => browseAndSetPath("ollama")} className="text-xs text-primary hover:underline">
                    {t("storage.browse")}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-mono text-muted-foreground/70">{config?.ollama || "..."}</span>
                {config && (
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${config.ollama_custom ? "bg-tag-trained/15 text-tag-trained" : "bg-muted text-muted-foreground"}`}>
                    {config.ollama_custom ? t("storage.custom") : t("storage.default")}
                  </span>
                )}
              </div>
              {ollamaPathInfo && (
                <div className="space-y-1 pt-1 text-[10px] text-muted-foreground/70">
                  <p>
                    {t("storage.defaultPath")}: <span className="font-mono">{ollamaPathInfo.default_path}</span>
                  </p>
                  <p>
                    {t("storage.effectivePath")}: <span className="font-mono">{ollamaPathInfo.effective_path}</span>
                  </p>
                  {ollamaPathInfo.configured_path && !ollamaPathInfo.configured_has_layout && (
                    <p className="text-warning">{t("storage.ollamaPathLayoutMissing")}</p>
                  )}
                  {ollamaPathInfo.configured_path && ollamaPathInfo.configured_has_layout && ollamaPathInfo.configured_model_count === 0 && (
                    <p className="text-warning">{t("storage.ollamaPathNoModelHint")}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Export Storage Location */}
        <div className="space-y-2">
          <div>
            <p className="text-xs font-medium text-foreground">{t("storage.exportPath")}</p>
            <p className="text-xs text-muted-foreground/70">{t("storage.exportPathDesc")}</p>
          </div>
          <div className="rounded-lg border border-border px-4 py-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="truncate text-xs font-mono text-muted-foreground/70">
                {config?.export_path || (config ? `${config.default_export_root}/<project>/export` : "...")}
              </span>
              <div className="flex items-center gap-2">
                {config && (
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${config.export_path ? "bg-tag-trained/15 text-tag-trained" : "bg-muted text-muted-foreground"}`}>
                    {config.export_path ? t("storage.custom") : t("storage.default")}
                  </span>
                )}
                {config?.export_path && (
                  <button onClick={() => resetPath("export")} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                    <RotateCcw size={10} />
                    {t("storage.resetDefault")}
                  </button>
                )}
                <button onClick={() => browseAndSetPath("export")} className="text-xs text-primary hover:underline">
                  {t("storage.browse")}
                </button>
              </div>
            </div>
            {!config?.export_path && config && (
              <p className="text-[10px] text-muted-foreground/60">
                {t("storage.exportDefaultHint", { path: `${config.default_export_root}/<project>/export` })}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Cache Management Section */}
      <section ref={cacheRef} className="space-y-4">
        <div className="flex items-center gap-2">
          <HardDrive size={18} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            {t("storage.cacheManagement")}
          </h2>
          <button
            onClick={scanCache}
            disabled={cacheScanning}
            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            <RefreshCw size={12} className={cacheScanning ? "animate-spin" : ""} />
            {t("environment.refreshButton")}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("storage.cacheManagementDesc")}
        </p>

        {cacheMsg && (
          <p className={`text-xs ${cacheMsg.type === "warning" ? "text-warning" : "text-success"}`}>
            {cacheMsg.text}
          </p>
        )}

        {cacheScanning && !cacheUsage ? (
          <p className="text-xs text-muted-foreground">{t("storage.scanning")}</p>
        ) : cacheUsage ? (
          <>
            <div className="rounded-lg border border-border divide-y divide-border">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">{t("storage.totalProjectData")}</span>
                <span className="text-sm font-medium text-foreground">{formatBytes(cacheUsage.total_bytes)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">{t("storage.cleanableCache")}</span>
                <span className={`text-sm font-medium ${cacheUsage.cleanable_bytes > 0 ? "text-warning" : "text-success"}`}>
                  {formatBytes(cacheUsage.cleanable_bytes)}
                </span>
              </div>
            </div>

            {cacheUsage.cleanable_bytes > 0 && (
              <>
                <div className="rounded-lg border border-border divide-y divide-border">
                  {cacheUsage.export_fused_bytes > 0 && (
                    <div className="px-4 py-3 space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t("storage.exportIntermediates")}</span>
                        <span className="text-sm font-medium text-warning">{formatBytes(cacheUsage.export_fused_bytes)}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground/70">{t("storage.exportIntermediatesDesc")}</p>
                    </div>
                  )}
                  {cacheUsage.checkpoint_bytes > 0 && (
                    <div className="px-4 py-3 space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t("storage.trainingCheckpoints")}</span>
                        <span className="text-sm font-medium text-warning">{formatBytes(cacheUsage.checkpoint_bytes)}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground/70">{t("storage.trainingCheckpointsDesc")}</p>
                    </div>
                  )}
                  {cacheUsage.tmp_bytes > 0 && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm text-muted-foreground">{t("storage.tempFiles")}</span>
                      <span className="text-sm font-medium text-warning">{formatBytes(cacheUsage.tmp_bytes)}</span>
                    </div>
                  )}
                  {cacheUsage.empty_adapter_count > 0 && (
                    <div className="px-4 py-3 space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t("storage.emptyAdapters")}</span>
                        <span className="text-sm font-medium text-muted-foreground">{cacheUsage.empty_adapter_count}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground/70">{t("storage.emptyAdaptersDesc")}</p>
                    </div>
                  )}
                </div>

                <button
                  onClick={handleCleanup}
                  disabled={cacheCleaning || cleanupBlockedByTask}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-warning/15 border border-warning/30 px-4 py-2.5 text-sm font-medium text-warning transition-colors hover:bg-warning/25 disabled:opacity-50"
                >
                  <Trash2 size={16} />
                  {cacheCleaning ? t("storage.cleaning") : t("storage.cleanupButton")}
                </button>
                {cleanupBlockedByTask && (
                  <p className="text-xs text-warning">{t("storage.cleanupBlockedByTask")}</p>
                )}
              </>
            )}

            {cacheUsage.cleanable_bytes === 0 && (
              <p className="text-xs text-success">{t("storage.noCache")}</p>
            )}
          </>
        ) : null}
      </section>

      {/* About Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Info size={18} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            {t("about.title")}
          </h2>
        </div>
        <div className="rounded-lg border border-border divide-y divide-border">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">{t("about.version")}</span>
            <span className="text-sm font-medium text-foreground">{appVersion}</span>
          </div>
          <div className="px-4 py-3">
            <p className="text-sm text-muted-foreground">{t("about.description")}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
