import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  FolderPlus, Cpu, BookOpen, Database, Upload, Settings, HardDrive,
  CheckCircle2, XCircle, AlertCircle,
} from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { checkEnvironment, type EnvironmentStatus } from "@/services/environment";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

export function DashboardPage() {
  const { t } = useTranslation(["nav", "common", "settings"]);
  const navigate = useNavigate();
  const { projects, fetchProjects } = useProjectStore();
  const [env, setEnv] = useState<EnvironmentStatus | null>(null);
  const [cacheUsage, setCacheUsage] = useState<{ cleanable_bytes: number } | null>(null);

  useEffect(() => {
    fetchProjects();
    checkEnvironment().then(setEnv).catch(console.error);
    invoke<{ cleanable_bytes: number }>("scan_storage_usage")
      .then(setCacheUsage)
      .catch(console.error);
  }, [fetchProjects]);

  const { ensureCurrentProject } = useProjectStore();
  const hasProjects = projects.length > 0;

  const goWithProject = (path: string) => {
    ensureCurrentProject();
    navigate(path);
  };

  const quickActions = [
    {
      icon: <FolderPlus size={24} />,
      label: t("nav:projects"),
      description: t("project:emptyDescription"),
      onClick: () => navigate("/projects"),
      disabled: false,
    },
    {
      icon: <Database size={24} />,
      label: t("nav:dataPrep"),
      description: t("common:importAndClean"),
      onClick: () => goWithProject("/data-prep"),
      disabled: !hasProjects,
    },
    {
      icon: <Cpu size={24} />,
      label: t("nav:training"),
      description: t("common:configAndTrain"),
      onClick: () => goWithProject("/training"),
      disabled: !hasProjects,
    },
    {
      icon: <BookOpen size={24} />,
      label: t("nav:testing"),
      description: t("common:testModel"),
      onClick: () => goWithProject("/testing"),
      disabled: !hasProjects,
    },
    {
      icon: <Upload size={24} />,
      label: t("nav:export"),
      description: t("common:exportOllama"),
      onClick: () => goWithProject("/export"),
      disabled: !hasProjects,
    },
    {
      icon: <Settings size={24} />,
      label: t("nav:settings"),
      description: t("common:envAndLang"),
      onClick: () => navigate("/settings"),
      disabled: false,
    },
  ];

  const StatusIcon = ({ ok }: { ok: boolean }) =>
    ok ? (
      <CheckCircle2 size={14} className="text-success" />
    ) : (
      <XCircle size={14} className="text-warning" />
    );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {t("common:appName")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("common:appDescription")}
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {/* Projects count */}
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("nav:projects")}
          </p>
          <p className="mt-2 text-3xl font-bold text-foreground">{projects.length}</p>
        </div>

        {/* Environment */}
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("common:environment")}
          </p>
          {env ? (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-foreground">
                <StatusIcon ok={env.python_ready} /> Python
              </div>
              <div className="flex items-center gap-1.5 text-xs text-foreground">
                <StatusIcon ok={env.mlx_lm_ready} /> mlx-lm
                {env.mlx_lm_version && <span className="text-muted-foreground">v{env.mlx_lm_version}</span>}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-foreground">
                <StatusIcon ok={env.ollama_installed} /> Ollama
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">...</p>
          )}
        </div>

        {/* Hardware */}
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("common:hardware")}
          </p>
          {env ? (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-foreground">{env.chip}</p>
              <p className="text-xs text-foreground">{env.memory_gb.toFixed(0)} GB RAM</p>
              <p className="text-xs text-muted-foreground">{env.os_version}</p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">...</p>
          )}
        </div>

        {/* Cache */}
        <div className="flex flex-col rounded-lg border border-border p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <HardDrive size={14} />
            {t("settings:storage.cleanableCache")}
          </p>
          <div className="mt-2 flex-1">
            <p className={`text-3xl font-bold ${cacheUsage && cacheUsage.cleanable_bytes > 0 ? "text-warning" : "text-success"}`}>
              {cacheUsage ? formatBytes(cacheUsage.cleanable_bytes) : "..."}
            </p>
          </div>
          <button
            onClick={() => navigate("/settings?focus=cache")}
            className="mt-3 w-full rounded bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            {t("settings:storage.cleanupButton")}
          </button>
        </div>
      </div>

      {/* Setup hint */}
      {env && !env.python_ready && (
        <div
          onClick={() => navigate("/settings")}
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3"
        >
          <AlertCircle size={18} className="text-warning" />
          <p className="text-sm text-warning">
            {t("common:setupHint")}
          </p>
        </div>
      )}
      {env && env.python_ready && !env.mlx_lm_ready && (
        <div
          onClick={() => navigate("/settings")}
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-info/30 bg-info/10 px-4 py-3"
        >
          <AlertCircle size={18} className="text-info" />
          <p className="text-sm text-info">
            {t("common:mlxHint")}
          </p>
        </div>
      )}

      {/* Quick Actions */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("common:quickActions")}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              disabled={action.disabled}
              className={`flex flex-col items-start gap-3 rounded-lg border border-border p-5 text-left transition-colors ${
                action.disabled
                  ? "cursor-not-allowed opacity-40"
                  : "hover:bg-accent"
              }`}
            >
              <div className="text-muted-foreground">{action.icon}</div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {action.label}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {action.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
