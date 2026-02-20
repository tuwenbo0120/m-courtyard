import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Play, Square, Gauge, Layers, Target, Gem, BarChart3, FileText, FolderOpen, Copy, Check, ArrowRight, Trash2, ChevronDown, ChevronRight, ChevronLeft, X, CheckCircle2, Circle, Trophy, Upload, Clock, TrendingDown, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProjectStore } from "@/stores/projectStore";
import { useTrainingStore } from "@/stores/trainingStore";
import { useTaskStore } from "@/stores/taskStore";
import { type TrainingParams } from "@/services/training";
import { ModelSelector } from "@/components/ModelSelector";
import { StepProgress } from "@/components/StepProgress";

type HealthLevel = "green" | "yellow" | "red";
type AlertLevel = "warning" | "critical";

interface SmartAlert {
  id: "memory" | "runtime" | "thermal" | "stalled" | "lossRising";
  level: AlertLevel;
  titleKey: string;
  detailKey: string;
  actionKey: string;
}

function formatDurationShort(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function deriveTrainingHealth(logs: string[], trainLossData: [number, number][]): {
  level: HealthLevel;
  hintKey: string;
  trendKey: string;
} {
  const recentLogs = logs.slice(-80).join("\n").toLowerCase();
  if (
    recentLogs.includes("out of memory") ||
    recentLogs.includes("oom") ||
    recentLogs.includes("memory error")
  ) {
    return {
      level: "red",
      hintKey: "health.hintOutOfMemory",
      trendKey: "trend.warning",
    };
  }

  if (recentLogs.includes("error") || recentLogs.includes("traceback")) {
    return {
      level: "red",
      hintKey: "health.hintError",
      trendKey: "trend.warning",
    };
  }

  const recentLoss = trainLossData
    .slice(-4)
    .map(([, loss]) => loss)
    .filter((loss) => Number.isFinite(loss));

  if (recentLoss.length >= 2) {
    const first = recentLoss[0];
    const last = recentLoss[recentLoss.length - 1];
    const ratio = (last - first) / (Math.abs(first) + 1e-6);

    if (ratio <= -0.03) {
      return {
        level: "green",
        hintKey: "health.hintNormal",
        trendKey: "trend.good",
      };
    }

    if (ratio <= 0.05) {
      return {
        level: "yellow",
        hintKey: "health.hintLossFluctuating",
        trendKey: "trend.stable",
      };
    }

    return {
      level: "yellow",
      hintKey: "health.hintLossRising",
      trendKey: "trend.warning",
    };
  }

  return {
    level: "green",
    hintKey: "health.hintNormal",
    trendKey: "trend.stable",
  };
}

function deriveSmartAlerts({
  logs,
  trainLossData,
  elapsedSeconds,
  currentIter,
  stalledSeconds,
}: {
  logs: string[];
  trainLossData: [number, number][];
  elapsedSeconds: number;
  currentIter: number;
  stalledSeconds: number;
}): SmartAlert[] {
  const recentLogs = logs.slice(-120).join("\n").toLowerCase();
  const alerts: SmartAlert[] = [];

  const pushAlert = (alert: SmartAlert) => {
    if (!alerts.some((item) => item.id === alert.id)) {
      alerts.push(alert);
    }
  };

  const containsAny = (keywords: string[]) =>
    keywords.some((keyword) => recentLogs.includes(keyword));

  if (
    containsAny([
      "out of memory",
      "cuda out of memory",
      "mps backend out of memory",
      "oom",
      "memory error",
    ])
  ) {
    pushAlert({
      id: "memory",
      level: "critical",
      titleKey: "alerts.memory.title",
      detailKey: "alerts.memory.detail",
      actionKey: "alerts.memory.action",
    });
  }

  if (
    containsAny([
      "traceback",
      "runtimeerror",
      "fatal error",
      "segmentation fault",
      "exception",
    ])
  ) {
    pushAlert({
      id: "runtime",
      level: "critical",
      titleKey: "alerts.runtime.title",
      detailKey: "alerts.runtime.detail",
      actionKey: "alerts.runtime.action",
    });
  }

  if (
    containsAny(["thermal", "throttl", "overheat", "temperature", "too hot"])
  ) {
    pushAlert({
      id: "thermal",
      level: "warning",
      titleKey: "alerts.thermal.title",
      detailKey: "alerts.thermal.detail",
      actionKey: "alerts.thermal.action",
    });
  }

  if (
    (currentIter === 0 && elapsedSeconds >= 120) ||
    (currentIter > 0 && stalledSeconds >= 90)
  ) {
    pushAlert({
      id: "stalled",
      level: "warning",
      titleKey: "alerts.stalled.title",
      detailKey: "alerts.stalled.detail",
      actionKey: "alerts.stalled.action",
    });
  }

  const recentLoss = trainLossData
    .slice(-6)
    .map(([, loss]) => loss)
    .filter((loss) => Number.isFinite(loss));

  if (recentLoss.length >= 4) {
    const first = recentLoss[0];
    const last = recentLoss[recentLoss.length - 1];
    const ratio = (last - first) / (Math.abs(first) + 1e-6);
    if (ratio > 0.12) {
      pushAlert({
        id: "lossRising",
        level: "warning",
        titleKey: "alerts.lossRising.title",
        detailKey: "alerts.lossRising.detail",
        actionKey: "alerts.lossRising.action",
      });
    }
  }

  return alerts.sort((a, b) => {
    if (a.level === b.level) return 0;
    return a.level === "critical" ? -1 : 1;
  });
}

function LossChart({ trainLoss, valLoss, totalIters, emptyText }: {
  trainLoss: [number, number][];
  valLoss: [number, number][];
  totalIters: number;
  emptyText: string;
}) {
  if (trainLoss.length < 2 && valLoss.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
        {emptyText}
      </div>
    );
  }
  const W = 480, H = 260;
  const P = { t: 30, r: 20, b: 28, l: 52 };
  const plotW = W - P.l - P.r;
  const plotH = H - P.t - P.b;
  const allPts = [...trainLoss, ...valLoss];
  const maxIter = Math.max(totalIters, ...allPts.map((p) => p[0]));
  const losses = allPts.map((p) => p[1]);
  const maxL = Math.max(...losses) * 1.05;
  const minL = Math.min(...losses) * 0.95;
  const range = maxL - minL || 1;
  const sx = (i: number) => P.l + (i / (maxIter || 1)) * plotW;
  const sy = (l: number) => P.t + ((maxL - l) / range) * plotH;
  const toPath = (pts: [number, number][]) => pts.map(([i, l]) => `${sx(i)},${sy(l)}`).join(" ");
  const yTicks = Array.from({ length: 5 }, (_, i) => minL + (range * i) / 4);
  // X-axis ticks (5 evenly spaced)
  const xTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxIter * (i + 1)) / 5));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Legend - positioned above plot, right-aligned */}
      <g>
        <rect x={W - P.r - 155} y={4} width="8" height="8" fill="#3b82f6" rx="1" />
        <text x={W - P.r - 143} y={11} fill="currentColor" fillOpacity="0.6" fontSize="9">Train Loss</text>
        <rect x={W - P.r - 70} y={4} width="8" height="8" fill="#f59e0b" rx="1" />
        <text x={W - P.r - 58} y={11} fill="currentColor" fillOpacity="0.6" fontSize="9">Val Loss</text>
      </g>
      {/* Plot border */}
      <rect x={P.l} y={P.t} width={plotW} height={plotH} fill="none" stroke="currentColor" strokeOpacity="0.08" />
      {/* Y-axis grid lines and labels */}
      {yTicks.map((v, i) => (
        <g key={`y${i}`}>
          <line x1={P.l} y1={sy(v)} x2={W - P.r} y2={sy(v)} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="2 3" />
          <text x={P.l - 6} y={sy(v) + 3} textAnchor="end" fill="currentColor" fillOpacity="0.45" fontSize="9">{v.toFixed(2)}</text>
        </g>
      ))}
      {/* X-axis labels */}
      {xTicks.map((v, i) => (
        <g key={`x${i}`}>
          <line x1={sx(v)} y1={P.t} x2={sx(v)} y2={P.t + plotH} stroke="currentColor" strokeOpacity="0.05" />
          <text x={sx(v)} y={P.t + plotH + 14} textAnchor="middle" fill="currentColor" fillOpacity="0.4" fontSize="9">{v}</text>
        </g>
      ))}
      {/* Data lines */}
      {trainLoss.length > 1 && <polyline points={toPath(trainLoss)} fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinejoin="round" />}
      {valLoss.length > 1 && <polyline points={toPath(valLoss)} fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeDasharray="5 3" strokeLinejoin="round" />}
      {/* Data points */}
      {trainLoss.map(([i, l], idx) => (
        <circle key={`t${idx}`} cx={sx(i)} cy={sy(l)} r="2.5" fill="#3b82f6" />
      ))}
      {valLoss.map(([i, l], idx) => (
        <circle key={`v${idx}`} cx={sx(i)} cy={sy(l)} r="2.5" fill="#f59e0b" />
      ))}
    </svg>
  );
}

interface DatasetVersionInfo {
  version: string;
  path: string;
  train_count: number;
  valid_count: number;
  train_size: number;
  valid_size: number;
  created: string;
  raw_files: string[];
  mode: string;
  source: string;
  model: string;
}

export function TrainingPage() {
  const { t } = useTranslation("training");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const { currentProject } =
    useProjectStore();
  const {
    status, logs, currentJobId, trainLossData, valLossData, currentIter,
    adapterPath, startedAt, completedAt, startTraining, stopTraining: storeStopTraining, resetAll,
    initListeners, params, modelValid, updateParam, setModelValid, resetParams,
  } = useTrainingStore();

  const logRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef(status);
  const [copied, setCopied] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const [datasetVersions, setDatasetVersions] = useState<DatasetVersionInfo[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [expandedDataset, setExpandedDataset] = useState<string | null>(null);
  const [datasetPage, setDatasetPage] = useState(0);
  const DATASETS_PER_PAGE = 10;
  const sectionStep1Ref = useRef<HTMLDivElement>(null);
  const sectionStep2Ref = useRef<HTMLDivElement>(null);
  const sectionStep3Ref = useRef<HTMLDivElement>(null);
  const [validationHint, setValidationHint] = useState<string | null>(null);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Collapsible step states
  const [step1Open, setStep1Open] = useState(true);
  const [step2Open, setStep2Open] = useState(true);
  const [step3MethodOpen, setStep3MethodOpen] = useState(true);
  const [step4Open, setStep4Open] = useState(true);
  const [paramsEdited, setParamsEdited] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const [lastIterChangeAt, setLastIterChangeAt] = useState<number | null>(null);

  // Model-level validation (dataset selection is validated separately before start)
  const canStartTraining = !!(params.model && (modelValid !== false));

  // Auto-collapse steps when training starts, expand when idle
  useEffect(() => {
    if (status === "running") {
      setStep1Open(false);
      setStep2Open(false);
      setStep3MethodOpen(false);
      setStep4Open(false);
    }
  }, [status]);

  useEffect(() => {
    if (status !== "running") return;
    setNowTs(Date.now());
    const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status !== "running") {
      setLastIterChangeAt(null);
      return;
    }
    if (currentIter > 0) {
      setLastIterChangeAt(Date.now());
    }
  }, [status, currentIter]);

  // Handle model selection from ModelSelector
  const handleModelSelect = (modelId: string, isLocalPath?: boolean) => {
    updateParam("model", modelId);
    if (isLocalPath) {
      invoke<boolean>("validate_model_path", { path: modelId })
        .then((valid) => setModelValid(valid))
        .catch(() => setModelValid(false));
    } else {
      setModelValid(null);
    }
  };

  // Load dataset versions from backend
  const loadDatasetVersions = async () => {
    if (!currentProject) return;
    try {
      const versions = await invoke<DatasetVersionInfo[]>(
        "list_dataset_versions", { projectId: currentProject.id }
      );
      setDatasetVersions(versions);
      // Auto-select latest (first) version if none selected or current selection no longer exists
      if (versions.length > 0) {
        const currentStillExists = selectedVersion && versions.some((v) => v.version === selectedVersion);
        if (!currentStillExists) {
          setSelectedVersion(versions[0].version);
        }
      } else {
        setSelectedVersion("");
      }
    } catch {
      setDatasetVersions([]);
      setSelectedVersion("");
    }
  };

  const selectedDataset = datasetVersions.find((v) => v.version === selectedVersion) || null;

  // Method is considered done when model+dataset selected and a method is set
  const methodDone = !!(params.model && selectedDataset && params.fine_tune_type);
  const isLoraLike = params.fine_tune_type === "lora" || params.fine_tune_type === "dora";

  useEffect(() => {
    initListeners();
  }, [initListeners]);

  useEffect(() => {
    if (currentProject) loadDatasetVersions();
  }, [currentProject]);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    if (prevStatus === "running" && status === "completed") {
      const frameId = window.requestAnimationFrame(() => {
        const mainScroller = document.getElementById("app-main-scroll");
        if (mainScroller) {
          mainScroller.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
      prevStatusRef.current = status;
      return () => window.cancelAnimationFrame(frameId);
    }
    prevStatusRef.current = status;
  }, [status]);

  // Auto scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const applyPreset = (preset: "quick" | "standard" | "thorough" | "extreme") => {
    const ft = params.fine_tune_type;
    const isLora = ft === "lora" || ft === "dora";
    // Common params shared by all methods
    const common: Record<string, Partial<TrainingParams>> = {
      quick: { iters: 100, batch_size: 4, learning_rate: 1e-5, max_seq_length: 2048, grad_checkpoint: false, grad_accumulation_steps: 1, save_every: 100, mask_prompt: false, optimizer: "adam", steps_per_eval: 100, steps_per_report: 10, val_batches: 10, seed: 0 },
      standard: { iters: 1000, batch_size: 4, learning_rate: 1e-5, max_seq_length: 2048, grad_checkpoint: false, grad_accumulation_steps: 1, save_every: 100, mask_prompt: false, optimizer: "adam", steps_per_eval: 200, steps_per_report: 10, val_batches: 25, seed: 0 },
      thorough: { iters: 2000, batch_size: 4, learning_rate: 5e-6, max_seq_length: 2048, grad_checkpoint: false, grad_accumulation_steps: 1, save_every: 200, mask_prompt: false, optimizer: "adam", steps_per_eval: 200, steps_per_report: 10, val_batches: 25, seed: 0 },
      extreme: { iters: 5000, batch_size: 2, learning_rate: 2e-6, max_seq_length: 4096, grad_checkpoint: true, grad_accumulation_steps: 2, save_every: 500, mask_prompt: false, optimizer: "adam", steps_per_eval: 500, steps_per_report: 10, val_batches: 50, seed: 0 },
    };
    // LoRA/DoRA specific params
    const loraPresets: Record<string, Partial<TrainingParams>> = {
      quick: { lora_layers: 8, lora_rank: 8, lora_scale: 20.0, lora_dropout: 0.0 },
      standard: { lora_layers: 16, lora_rank: 8, lora_scale: 20.0, lora_dropout: 0.0 },
      thorough: { lora_layers: 16, lora_rank: 16, lora_scale: 20.0, lora_dropout: 0.05 },
      extreme: { lora_layers: 32, lora_rank: 32, lora_scale: 20.0, lora_dropout: 0.05 },
    };
    const p = { ...common[preset], ...(isLora ? loraPresets[preset] : {}) };
    for (const [k, v] of Object.entries(p)) {
      updateParam(k as keyof TrainingParams, v as any);
    }
    setParamsEdited(true);
  };

  const paramsDone = (!!params.model && !!selectedDataset) || paramsEdited;

  const elapsedSeconds = startedAt
    ? Math.max(1, Math.floor((nowTs - startedAt) / 1000))
    : 0;

  const remainingIters = Math.max(0, params.iters - currentIter);
  const iterPerSec = currentIter > 0 && elapsedSeconds > 0 ? currentIter / elapsedSeconds : 0;
  const etaSeconds = iterPerSec > 0 ? Math.ceil(remainingIters / iterPerSec) : null;

  const etaText =
    remainingIters <= 0
      ? t("eta.done")
      : currentIter <= 0 || etaSeconds === null
        ? t("eta.estimating")
        : t("eta.format", { time: formatDurationShort(etaSeconds) });

  const stalledSeconds =
    status === "running" && lastIterChangeAt
      ? Math.max(0, Math.floor((nowTs - lastIterChangeAt) / 1000))
      : 0;

  const smartAlerts = deriveSmartAlerts({
    logs,
    trainLossData,
    elapsedSeconds,
    currentIter,
    stalledSeconds,
  });
  const visibleAlerts = smartAlerts.slice(0, 2);

  const health = deriveTrainingHealth(logs, trainLossData);
  const criticalAlert = smartAlerts.find((alert) => alert.level === "critical");
  const warningAlert = smartAlerts.find((alert) => alert.level === "warning");
  const healthLevel: HealthLevel =
    criticalAlert
      ? "red"
      : warningAlert && health.level === "green"
        ? "yellow"
        : health.level;
  const healthHintKey =
    criticalAlert?.detailKey ||
    (warningAlert && health.level === "green"
      ? warningAlert.detailKey
      : health.hintKey);
  const healthTrendKey = criticalAlert ? "trend.warning" : health.trendKey;

  const healthDotClass =
    healthLevel === "green"
      ? "bg-success"
      : healthLevel === "yellow"
        ? "bg-warning"
        : "bg-destructive";

  const stoppedByUser =
    status !== "running" && logs.some((line) => line.includes("Training stopped by user"));
  const lossEmptyText = stoppedByUser
    ? t("lossStopped")
    : status === "running"
      ? t("waitingData")
      : t("lossNoData");

  const durationMs = (startedAt && completedAt) ? completedAt - startedAt : 0;
  const durationMin = Math.floor(durationMs / 60000);
  const durationSec = Math.floor((durationMs % 60000) / 1000);
  const durationStr = durationMin > 0 ? `${durationMin}m ${durationSec}s` : `${durationSec}s`;
  const finalTrainLoss = trainLossData.length > 0 ? trainLossData[trainLossData.length - 1][1] : null;
  const firstTrainLoss = trainLossData.length > 0 ? trainLossData[0][1] : null;
  const finalValLoss = valLossData.length > 0 ? valLossData[valLossData.length - 1][1] : null;
  const lossImprove = (firstTrainLoss !== null && finalTrainLoss !== null)
    ? (1 - finalTrainLoss / firstTrainLoss) * 100
    : null;
  const modelShort = params.model.split("/").pop() || params.model;

  const buildTrainingCsv = () => {
    const byIter = new Map<number, { train?: number; val?: number }>();
    for (const [iter, loss] of trainLossData) {
      const old = byIter.get(iter) || {};
      byIter.set(iter, { ...old, train: loss });
    }
    for (const [iter, loss] of valLossData) {
      const old = byIter.get(iter) || {};
      byIter.set(iter, { ...old, val: loss });
    }
    const rows = [...byIter.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([iter, values]) => {
        const train = values.train !== undefined ? values.train.toFixed(6) : "";
        const val = values.val !== undefined ? values.val.toFixed(6) : "";
        return `${iter},${train},${val}`;
      });
    return ["iter,train_loss,val_loss", ...rows].join("\n");
  };

  const buildTrainingReportMarkdown = () => {
    const startedText = startedAt ? new Date(startedAt).toLocaleString() : "-";
    const completedText = completedAt ? new Date(completedAt).toLocaleString() : "-";
    const platform = typeof navigator !== "undefined" ? navigator.platform : "unknown";
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
    const csvContent = buildTrainingCsv();
    const logTail = logs.slice(-200).join("\n");

    return [
      `# ${t("summary.title")}`,
      "",
      `- ${t("summary.baseModel")}: ${params.model || "-"}`,
      `- ${t("summary.totalIters")}: ${currentIter}`,
      `- ${t("summary.duration")}: ${durationMs > 0 ? durationStr : t("summary.noData")}`,
      `- ${t("summary.finalTrainLoss")}: ${finalTrainLoss !== null ? finalTrainLoss.toFixed(4) : t("summary.noData")}`,
      `- ${t("summary.finalValLoss")}: ${finalValLoss !== null ? finalValLoss.toFixed(4) : t("summary.noData")}`,
      `- ${t("summary.lossImprove")}: ${lossImprove !== null ? `${lossImprove > 0 ? "↓" : "↑"} ${Math.abs(lossImprove).toFixed(1)}%` : t("summary.noData")}`,
      `- ${t("summary.adapterPath")}: ${adapterPath || "-"}`,
      `- started_at: ${startedText}`,
      `- completed_at: ${completedText}`,
      "",
      "## Params",
      "",
      `- fine_tune_type: ${params.fine_tune_type}`,
      `- optimizer: ${params.optimizer}`,
      `- learning_rate: ${params.learning_rate}`,
      `- batch_size: ${params.batch_size}`,
      `- iters: ${params.iters}`,
      `- max_seq_length: ${params.max_seq_length}`,
      "",
      "## Environment",
      "",
      `- platform: ${platform}`,
      `- user_agent: ${userAgent}`,
      "",
      "## Loss Series",
      "",
      "```csv",
      csvContent,
      "```",
      "",
      "## Training Log (last 200 lines)",
      "",
      "```text",
      logTail,
      "```",
    ].join("\n");
  };

  const handleCopyReportMarkdown = async () => {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(buildTrainingReportMarkdown());
      setReportCopied(true);
      window.setTimeout(() => setReportCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleShareReport = async () => {
    const markdown = buildTrainingReportMarkdown();
    const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string }) => Promise<void> };
    if (typeof nav.share === "function") {
      try {
        await nav.share({ title: t("summary.title"), text: markdown });
        return;
      } catch {
        // user canceled or share failed, fallback to copy
      }
    }
    await handleCopyReportMarkdown();
  };

  const { canStart: taskCanStart, acquireTask } = useTaskStore();
  const taskCheck = currentProject ? taskCanStart(currentProject.id, "training") : { allowed: true };

  // Parse task lock reason into i18n message
  const getTaskLockHint = (reason?: string): string => {
    if (!reason) return "";
    if (reason.startsWith("otherProject:")) {
      const parts = reason.split(":");
      const pName = parts[1] || "";
      const taskKey = parts[2] === "datasetGenerating" ? tc("taskLock.taskGenerating") : tc("taskLock.taskTraining");
      return tc("taskLock.otherProject", { name: pName, task: taskKey });
    }
    return tc(`taskLock.${reason}`);
  };

  // Show a validation hint on the first incomplete section, auto-dismiss after 3s
  const showValidationHint = (hintKey: string, targetRef: React.RefObject<HTMLDivElement | null>) => {
    if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
    setValidationHint(hintKey);
    targetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    validationTimerRef.current = setTimeout(() => setValidationHint(null), 3500);
  };

  // Validate form completeness before starting; scroll to first incomplete section
  const handleStartWithValidation = () => {
    if (!params.model) {
      setStep1Open(true);
      showValidationHint("validation.needModel", sectionStep1Ref);
      return;
    }
    if (!selectedDataset) {
      setStep2Open(true);
      showValidationHint("validation.needDataset", sectionStep2Ref);
      return;
    }
    if (!params.fine_tune_type) {
      setStep3MethodOpen(true);
      showValidationHint("validation.needMethod", sectionStep3Ref);
      return;
    }
    if (!taskCheck.allowed) return;
    handleStart();
  };

  const handleStart = async () => {
    if (!currentProject || !params.model || !selectedDataset) return;
    // Check global task lock
    const check = taskCanStart(currentProject.id, "training");
    if (!check.allowed) return;
    if (!acquireTask(currentProject.id, currentProject.name, "training")) return;
    try {
      const jobId = await invoke<string>("start_training", {
        projectId: currentProject.id,
        params: JSON.stringify(params),
        datasetPath: selectedDataset?.path || "",
      });
      startTraining(jobId);
    } catch (e) {
      useTrainingStore.getState().setStatus("failed");
      useTrainingStore.getState().addLog(`Error: ${e}`);
      useTaskStore.getState().releaseTask();
    }
  };

  const handleStop = async () => {
    if (!currentJobId) return;
    try {
      await invoke("stop_training", { jobId: currentJobId });
      storeStopTraining();
      useTaskStore.getState().releaseTask();
    } catch (e) {
      useTrainingStore.getState().addLog(`Stop error: ${e}`);
    }
  };


  const trainingSubSteps = [
    { key: "model", label: t("step.model"), done: !!params.model },
    { key: "data", label: t("step.data"), done: !!selectedDataset },
    { key: "method", label: t("step.method"), done: methodDone },
    { key: "params", label: t("step.params"), done: methodDone && (paramsEdited || (!!params.model && !!selectedDataset)), active: status === "running" },
    { key: "done", label: t("step.done"), done: status === "completed" },
  ];

  if (!currentProject) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{tc("selectProjectHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ===== Header ===== */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {currentProject.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { resetAll(); resetParams(); setParamsEdited(false); updateParam("model", ""); setModelValid(null); }} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent">
            <Trash2 size={14} />
            {tc("clearAll")}
          </button>
        </div>
      </div>

      {/* Unified Step Progress */}
      <StepProgress subSteps={trainingSubSteps} />

      {/* Training Summary Panel */}
      {status === "completed" && (
          <div className="rounded-lg border border-success/30 bg-success/5 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-success/20 bg-success/10 px-5 py-3">
              <Trophy size={18} className="text-success" />
              <div>
                <h3 className="text-sm font-semibold text-success">{t("summary.title")}</h3>
                <p className="text-[11px] text-muted-foreground">{t("completedBanner")}</p>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-px bg-border/30 lg:grid-cols-4">
              {/* Duration */}
              <div className="bg-card px-4 py-3 space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Clock size={10} />
                  {t("summary.duration")}
                </div>
                <p className="text-lg font-semibold text-foreground font-mono">{durationMs > 0 ? durationStr : t("summary.noData")}</p>
              </div>
              {/* Final Train Loss */}
              <div className="bg-card px-4 py-3 space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <TrendingDown size={10} />
                  {t("summary.finalTrainLoss")}
                </div>
                <p className="text-lg font-semibold text-foreground font-mono">{finalTrainLoss !== null ? finalTrainLoss.toFixed(4) : t("summary.noData")}</p>
              </div>
              {/* Final Val Loss */}
              <div className="bg-card px-4 py-3 space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <BarChart3 size={10} />
                  {t("summary.finalValLoss")}
                </div>
                <p className="text-lg font-semibold text-foreground font-mono">{finalValLoss !== null ? finalValLoss.toFixed(4) : t("summary.noData")}</p>
              </div>
              {/* Loss Improvement */}
              <div className="bg-card px-4 py-3 space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Target size={10} />
                  {t("summary.lossImprove")}
                </div>
                <p className={`text-lg font-semibold font-mono ${lossImprove !== null && lossImprove > 0 ? "text-success" : "text-foreground"}`}>
                  {lossImprove !== null ? `${lossImprove > 0 ? "↓" : "↑"} ${Math.abs(lossImprove).toFixed(1)}%` : t("summary.noData")}
                </p>
              </div>
            </div>

            {/* Details */}
            <div className="px-5 py-3 space-y-2 border-t border-border/30">
              <div className="grid grid-cols-1 gap-1.5 text-xs lg:grid-cols-2">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{t("summary.baseModel")}:</span>
                  <span className="font-mono text-foreground truncate" title={params.model}>{modelShort}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{t("summary.totalIters")}:</span>
                  <span className="font-mono text-foreground">{currentIter}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{t("summary.keyParams")}:</span>
                  <span className="font-mono text-foreground">LR {params.learning_rate} · Batch {params.batch_size}{isLoraLike ? ` · ${params.fine_tune_type.toUpperCase()} R${params.lora_rank} L${params.lora_layers}` : " · Full"}</span>
                </div>
                {adapterPath && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{t("summary.adapterPath")}:</span>
                    <span className="font-mono text-foreground truncate" title={adapterPath}>{adapterPath.split("/").slice(-2).join("/")}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 border-t border-border/30 px-5 py-3">
              {adapterPath && (
                <button onClick={() => invoke("open_adapter_folder", { adapterPath })} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent">
                  <FolderOpen size={12} />
                  {tc("openModelFolder")}
                </button>
              )}
              <button onClick={() => navigate("/testing")} className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success/20 px-3 py-1.5 text-xs text-success transition-colors hover:bg-success/30">
                {t("goToTest")}
                <ArrowRight size={12} />
              </button>
              <button onClick={() => navigate("/export")} className="flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/20 px-3 py-1.5 text-xs text-blue-400 transition-colors hover:bg-blue-500/30">
                <Upload size={12} />
                {t("summary.goToExport")}
              </button>
              <button onClick={handleCopyReportMarkdown} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent">
                <Copy size={12} />
                {reportCopied ? tc("copied") : t("summary.report.copyMd")}
              </button>
              <button onClick={handleShareReport} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent">
                {t("summary.report.share")}
              </button>
            </div>
          </div>
      )}

      {/* ===== Step 1: Select Model (collapsible) ===== */}
      <div ref={sectionStep1Ref} className="rounded-lg border border-border bg-card">
        <button
          onClick={() => setStep1Open(!step1Open)}
          className="flex w-full items-center justify-between p-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {step1Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="flex items-center gap-1.5">
              {params.model ? <CheckCircle2 size={18} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
              2.1 {t("section.selectModel")}
              {validationHint === "validation.needModel" && (
                <span className="ml-2 animate-pulse rounded bg-destructive/90 px-2 py-0.5 text-[11px] font-medium text-destructive-foreground">{t(validationHint)}</span>
              )}
            </span>
          </h3>
          {/* Show selected model summary when collapsed */}
          {!step1Open && params.model && (
            <span className="truncate max-w-xs text-xs text-primary">{params.model}</span>
          )}
        </button>
        {step1Open && (
          <div className="border-t border-border p-4 space-y-3">
            {/* Selected Model Display */}
            {params.model ? (
              <div className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                modelValid === false ? "border-red-500/30 bg-red-500/5" : "border-primary/30 bg-primary/5"
              }`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{params.model}</p>
                  <p className="text-xs text-muted-foreground/70">
                    {params.model.startsWith("/") || params.model.startsWith("~")
                      ? (modelValid === false ? `⚠️ ${t("invalidModelPath")}` : t("localModelPath"))
                      : t("hfModelHint")}
                  </p>
                </div>
                {status !== "running" && (
                  <button onClick={() => { updateParam("model", ""); setModelValid(null); }} className="ml-2 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="Clear selection">
                    <X size={14} />
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/70">{t("selectModelHint")}</p>
            )}

            {/* Unified Model Selector */}
            {status !== "running" && (
              <ModelSelector
                mode="training"
                selectedModel={params.model}
                onSelect={handleModelSelect}
                projectId={currentProject.id}
              />
            )}
          </div>
        )}
      </div>

      {/* ===== Step 2: Dataset (collapsible) ===== */}
      <div ref={sectionStep2Ref} className="rounded-lg border border-border bg-card">
        <button
          onClick={() => setStep2Open(!step2Open)}
          className="flex w-full items-center justify-between p-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {step2Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="flex items-center gap-1.5">
              {selectedDataset ? <CheckCircle2 size={18} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
              2.2 {t("section.selectDataset")}
              {validationHint === "validation.needDataset" && (
                <span className="ml-2 animate-pulse rounded bg-destructive/90 px-2 py-0.5 text-[11px] font-medium text-destructive-foreground">{t(validationHint)}</span>
              )}
            </span>
          </h3>
          {selectedDataset && (
            <button
              onClick={(e) => { e.stopPropagation(); invoke("open_dataset_folder", { projectId: currentProject.id }); }}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <FolderOpen size={10} />
              {tc("openFolder")}
            </button>
          )}
        </button>
        {step2Open && (
          <div className="border-t border-border p-4 space-y-2">
            {datasetVersions.length > 0 ? (
              <div className="space-y-1">
                {(() => {
                  const totalPages = Math.ceil(datasetVersions.length / DATASETS_PER_PAGE);
                  const paged = datasetVersions.slice(datasetPage * DATASETS_PER_PAGE, (datasetPage + 1) * DATASETS_PER_PAGE);
                  return (
                    <>
                {paged.map((v) => {
                  const isSelected = selectedVersion === v.version;
                  const isExpanded = expandedDataset === v.version;
                  const modeLabel: Record<string, string> = {
                    qa: t("dataset.modeQa"),
                    style: t("dataset.modeStyle"),
                    chat: t("dataset.modeChat"),
                    instruct: t("dataset.modeInstruct"),
                  };
                  return (
                    <div
                      key={v.version}
                      className={`rounded-md border text-xs transition-colors ${isSelected ? "border-primary" : "border-border"}`}
                    >
                      <div className="flex items-center gap-1.5 px-2 py-2">
                        {/* Expand toggle */}
                        <button
                          onClick={() => setExpandedDataset(isExpanded ? null : v.version)}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>
                        {/* Select row */}
                        <button
                          onClick={() => { if (status !== "running") setSelectedVersion(v.version); }}
                          disabled={status === "running"}
                          className="flex flex-1 items-center gap-2 text-left disabled:opacity-50"
                        >
                          {isSelected
                            ? <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span>
                            : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />
                          }
                          <span className={`font-medium ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
                            {v.version === "legacy" ? t("datasetLegacy") : v.created}
                          </span>
                          <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground/50">
                            train: {v.train_count} · valid: {v.valid_count}
                          </span>
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-border/50 bg-muted/10 px-4 py-2 space-y-1 text-[11px]">
                          <div className="flex gap-2">
                            <span className="shrink-0 text-muted-foreground">{t("dataset.trainSet")}:</span>
                            <span className="text-foreground">{t("dataset.samples", { count: v.train_count })}</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="shrink-0 text-muted-foreground">{t("dataset.validSet")}:</span>
                            <span className="text-foreground">{t("dataset.samples", { count: v.valid_count })}</span>
                          </div>
                          {v.raw_files?.length > 0 && (
                            <div className="flex gap-2">
                              <span className="shrink-0 text-muted-foreground">{t("dataset.sourceFiles")}:</span>
                              <span className="text-foreground break-all">{v.raw_files.join(", ")}</span>
                            </div>
                          )}
                          {v.mode && (
                            <div className="flex gap-2">
                              <span className="shrink-0 text-muted-foreground">{t("dataset.genType")}:</span>
                              <span className="text-foreground">{modeLabel[v.mode] || v.mode}</span>
                            </div>
                          )}
                          {v.source && (
                            <div className="flex gap-2">
                              <span className="shrink-0 text-muted-foreground">{t("dataset.genMethod")}:</span>
                              <span className="text-foreground">
                                {v.source === "ollama"
                                  ? t("dataset.methodOllama", { model: v.model || "?" })
                                  : t("dataset.methodBuiltin")}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between pt-1">
                        <button
                          disabled={datasetPage === 0}
                          onClick={() => setDatasetPage((p) => Math.max(0, p - 1))}
                          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
                        >
                          <ChevronLeft size={12} />
                          {t("dataset.prevPage")}
                        </button>
                        <span className="text-[11px] text-muted-foreground">{t("dataset.page", { current: datasetPage + 1, total: totalPages })}</span>
                        <button
                          disabled={datasetPage === totalPages - 1}
                          onClick={() => setDatasetPage((p) => Math.min(totalPages - 1, p + 1))}
                          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
                        >
                          {t("dataset.nextPage")}
                          <ChevronRight size={12} />
                        </button>
                      </div>
                    )}
                    </>
                  );
                })()}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/70">{t("noDataset")}</p>
            )}
          </div>
        )}
      </div>

      {/* ===== Step 3: Training Method (collapsible) ===== */}
      <div ref={sectionStep3Ref} className="rounded-lg border border-border bg-card">
        <button
          onClick={() => setStep3MethodOpen(!step3MethodOpen)}
          className="flex w-full items-center justify-between p-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {step3MethodOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="flex items-center gap-1.5">
              {methodDone ? <CheckCircle2 size={18} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
              2.3 {t("section.method")}
              {validationHint === "validation.needMethod" && (
                <span className="ml-2 animate-pulse rounded bg-destructive/90 px-2 py-0.5 text-[11px] font-medium text-destructive-foreground">{t(validationHint)}</span>
              )}
            </span>
          </h3>
          {!step3MethodOpen && methodDone && (
            <span className="text-xs text-primary font-medium">{t(`method.${params.fine_tune_type}`)}</span>
          )}
        </button>
        {step3MethodOpen && (
          <div className="border-t border-border p-4 space-y-3">
            {!(params.model && selectedDataset) && (
              <p className="text-xs text-muted-foreground/70">{t("method.hint")}</p>
            )}
            <div className="flex gap-3">
              {(["lora", "dora", "full"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { updateParam("fine_tune_type", m); setParamsEdited(true); }}
                  disabled={status === "running" || !(params.model && selectedDataset)}
                  className={`flex-1 rounded-lg border px-3 py-3 text-left transition-colors disabled:opacity-40 ${
                    params.fine_tune_type === m
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  <span className={`block text-sm font-semibold ${
                    params.fine_tune_type === m ? "text-foreground" : "text-muted-foreground"
                  }`}>{t(`method.${m}`)}</span>
                  <span className="block text-[10px] text-muted-foreground/70 mt-0.5">{t(`method.${m}Desc`)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ===== Step 4: Training Parameters (collapsible) ===== */}
      <div className="rounded-lg border border-border bg-card">
        <button
          onClick={() => setStep4Open(!step4Open)}
          className="flex w-full items-center justify-between p-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {step4Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="flex items-center gap-1.5">
              {paramsDone ? <CheckCircle2 size={18} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
              2.4 {t("section.params")}
            </span>
          </h3>
          {!step4Open && (
            <span className="text-xs text-muted-foreground">
              {t("paramsSummary", { iters: params.iters, batch: params.batch_size, method: t(`method.${params.fine_tune_type}`) + (isLoraLike ? ` R${params.lora_rank} L${params.lora_layers}` : "") })}
            </span>
          )}
        </button>
        {step4Open && (
          <div className="border-t border-border p-4 space-y-4">
            {/* Presets */}
            <div className="flex flex-wrap gap-2">
              {(["quick", "standard", "thorough", "extreme"] as const).map((preset) => {
                const PresetIcon = { quick: Gauge, standard: Layers, thorough: Target, extreme: Gem }[preset];
                return (
                  <button key={preset} onClick={() => applyPreset(preset)} disabled={status === "running"}
                    className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50">
                    <PresetIcon size={12} />
                    {t(`presets.${preset}`)}
                  </button>
                );
              })}
            </div>

            {/* Basic Params Grid — common to all methods */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {/* Iterations */}
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">{t("params.iters")}</label>
                <input type="number" value={params.iters}
                  onChange={(e) => { updateParam("iters", Number(e.target.value)); setParamsEdited(true); }}
                  disabled={status === "running"}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.itersHint")}</p>
              </div>
              {/* Batch Size */}
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">{t("params.batchSize")}</label>
                <input type="number" value={params.batch_size}
                  onChange={(e) => { updateParam("batch_size", Number(e.target.value)); setParamsEdited(true); }}
                  disabled={status === "running"}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.batchSizeHint")}</p>
              </div>
              {/* Learning Rate */}
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">{t("params.learningRate")}</label>
                <input type="text" value={params.learning_rate}
                  onChange={(e) => { updateParam("learning_rate", e.target.value as any); setParamsEdited(true); }}
                  disabled={status === "running"}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.learningRateHint")}</p>
              </div>
              {/* LoRA Layers — only for lora/dora */}
              {isLoraLike && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">{t("params.loraLayers")}</label>
                  <input type="number" value={params.lora_layers}
                    onChange={(e) => { updateParam("lora_layers", Number(e.target.value)); setParamsEdited(true); }}
                    disabled={status === "running"}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.loraLayersHint")}</p>
                </div>
              )}
              {/* LoRA Rank — only for lora/dora */}
              {isLoraLike && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">{t("params.loraRank")}</label>
                  <input type="number" value={params.lora_rank}
                    onChange={(e) => { updateParam("lora_rank", Number(e.target.value)); setParamsEdited(true); }}
                    disabled={status === "running"}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.loraRankHint")}</p>
                </div>
              )}
              {/* Seed */}
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">{t("params.seed")}</label>
                <input type="number" value={params.seed}
                  onChange={(e) => { updateParam("seed", Number(e.target.value)); setParamsEdited(true); }}
                  disabled={status === "running"}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.seedHint")}</p>
              </div>
            </div>

            {/* Advanced Params Toggle */}
            <button
              onClick={() => { setShowAdvanced(!showAdvanced); setActiveDropdown(null); }}
              className="flex items-center gap-2 text-sm font-semibold text-foreground transition-colors"
            >
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {showAdvanced ? t("params.hideAdvanced") : t("params.showAdvanced")}
            </button>

            {/* Advanced Params Grid */}
            {showAdvanced && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 rounded-md border border-border/50 p-3">
                {/* Optimizer — custom dropdown */}
                <div className="relative">
                  <label className="mb-1 block text-xs font-medium text-foreground">{t("params.optimizer")}</label>
                  <button
                    onClick={() => setActiveDropdown(activeDropdown === "optimizer" ? null : "optimizer")}
                    disabled={status === "running"}
                    className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-50"
                  >
                    <span>{{ adam: "Adam", adamw: "AdamW", sgd: "SGD", adafactor: "Adafactor" }[params.optimizer]}</span>
                    <ChevronDown size={14} className={`text-muted-foreground transition-transform ${activeDropdown === "optimizer" ? "rotate-180" : ""}`} />
                  </button>
                  {activeDropdown === "optimizer" && (
                    <div className="absolute left-0 right-0 top-full z-10 mt-1 space-y-1 rounded-lg border border-border bg-background p-2 shadow-lg">
                      {([["adam", "Adam"], ["adamw", "AdamW"], ["sgd", "SGD"], ["adafactor", "Adafactor"]] as const).map(([val, label]) => (
                        <button key={val}
                          onClick={() => { updateParam("optimizer", val as any); setParamsEdited(true); setActiveDropdown(null); }}
                          className={`flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs transition-colors ${
                            params.optimizer === val ? "border-primary bg-primary/10 text-foreground" : "border-transparent text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          {params.optimizer === val
                            ? <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /></span>
                            : <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-muted-foreground/30" />}
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.optimizerHint")}</p>
                </div>
                {/* LoRA Scale — only for lora/dora */}
                {isLoraLike && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground">{t("params.loraScale")}</label>
                    <input type="number" step="0.1" value={params.lora_scale}
                      onChange={(e) => { updateParam("lora_scale", Number(e.target.value)); setParamsEdited(true); }}
                      disabled={status === "running"}
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                    <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.loraScaleHint")}</p>
                  </div>
                )}
                {/* LoRA Dropout — only for lora/dora */}
                {isLoraLike && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground">{t("params.loraDropout")}</label>
                    <input type="number" step="0.01" min="0" max="1" value={params.lora_dropout}
                      onChange={(e) => { updateParam("lora_dropout", Number(e.target.value)); setParamsEdited(true); }}
                      disabled={status === "running"}
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                    <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.loraDropoutHint")}</p>
                  </div>
                )}
                {/* Max Seq Length — custom dropdown */}
                <div className="relative">
                  <label className="mb-1 block text-xs font-medium text-foreground">{t("params.maxSeqLength")}</label>
                  <button
                    onClick={() => setActiveDropdown(activeDropdown === "seqLength" ? null : "seqLength")}
                    disabled={status === "running"}
                    className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-50"
                  >
                    <span>{params.max_seq_length}</span>
                    <ChevronDown size={14} className={`text-muted-foreground transition-transform ${activeDropdown === "seqLength" ? "rotate-180" : ""}`} />
                  </button>
                  {activeDropdown === "seqLength" && (
                    <div className="absolute left-0 right-0 top-full z-10 mt-1 space-y-1 rounded-lg border border-border bg-background p-2 shadow-lg">
                      {[512, 1024, 2048, 4096].map((val) => (
                        <button key={val}
                          onClick={() => { updateParam("max_seq_length", val); setParamsEdited(true); setActiveDropdown(null); }}
                          className={`flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs transition-colors ${
                            params.max_seq_length === val ? "border-primary bg-primary/10 text-foreground" : "border-transparent text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          {params.max_seq_length === val
                            ? <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /></span>
                            : <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-muted-foreground/30" />}
                          {val}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.maxSeqLengthHint")}</p>
                </div>
                {/* Gradient Accumulation Steps */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">{t("params.gradAccumulationSteps")}</label>
                  <input type="number" min="1" value={params.grad_accumulation_steps}
                    onChange={(e) => { updateParam("grad_accumulation_steps", Number(e.target.value)); setParamsEdited(true); }}
                    disabled={status === "running"}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.gradAccumulationStepsHint")}</p>
                </div>
                {/* Save Every */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">{t("params.saveEvery")}</label>
                  <input type="number" min="1" value={params.save_every}
                    onChange={(e) => { updateParam("save_every", Number(e.target.value)); setParamsEdited(true); }}
                    disabled={status === "running"}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.saveEveryHint")}</p>
                </div>
                {/* Grad Checkpoint — toggle */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">{t("params.gradCheckpoint")}</label>
                  <button
                    onClick={() => { updateParam("grad_checkpoint", !params.grad_checkpoint); setParamsEdited(true); }}
                    disabled={status === "running"}
                    className={`w-full rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                      params.grad_checkpoint
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-input bg-background text-muted-foreground hover:bg-accent"
                    }`}>
                    {params.grad_checkpoint ? "ON" : "OFF"}
                  </button>
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.gradCheckpointHint")}</p>
                </div>
                {/* Mask Prompt — toggle */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">{t("params.maskPrompt")}</label>
                  <button
                    onClick={() => { updateParam("mask_prompt", !params.mask_prompt); setParamsEdited(true); }}
                    disabled={status === "running"}
                    className={`w-full rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                      params.mask_prompt
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-input bg-background text-muted-foreground hover:bg-accent"
                    }`}>
                    {params.mask_prompt ? "ON" : "OFF"}
                  </button>
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.maskPromptHint")}</p>
                </div>
                {/* Steps Per Eval */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">{t("params.stepsPerEval")}</label>
                  <input type="number" value={params.steps_per_eval}
                    onChange={(e) => { updateParam("steps_per_eval", Number(e.target.value)); setParamsEdited(true); }}
                    disabled={status === "running"}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.stepsPerEvalHint")}</p>
                </div>
                {/* Steps Per Report */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">{t("params.stepsPerReport")}</label>
                  <input type="number" value={params.steps_per_report}
                    onChange={(e) => { updateParam("steps_per_report", Number(e.target.value)); setParamsEdited(true); }}
                    disabled={status === "running"}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.stepsPerReportHint")}</p>
                </div>
                {/* Val Batches */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">{t("params.valBatches")}</label>
                  <input type="number" value={params.val_batches}
                    onChange={(e) => { updateParam("val_batches", Number(e.target.value)); setParamsEdited(true); }}
                    disabled={status === "running"}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{t("params.valBatchesHint")}</p>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* ===== Start / Stop Button (always visible) ===== */}
      {status === "running" ? (
        <button onClick={handleStop}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-destructive px-4 py-3 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90">
          <Square size={16} />
          {t("stop")}
        </button>
      ) : (
        <div className="space-y-2">
          <button onClick={handleStartWithValidation}
            className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-medium transition-colors ${
              !canStartTraining || !selectedDataset || !taskCheck.allowed
                ? "bg-primary/50 text-primary-foreground/70 cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            }`}>
            <Play size={16} />
            {t("start")}
          </button>
          {!canStartTraining && params.model && (
            <p className="text-center text-xs text-red-400">{t("invalidModelError")}</p>
          )}
          {!taskCheck.allowed && (
            <p className="text-center text-xs text-warning">{getTaskLockHint(taskCheck.reason)}</p>
          )}
        </div>
      )}

      {/* ===== Training Progress & Log (full width, main area during training) ===== */}
      {(status === "running" || logs.length > 0 || trainLossData.length > 0) && (
        <div className="space-y-4">
          {/* Progress Bar */}
          {status === "running" && (
            <div className="space-y-1.5 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">
                  {t("trainProgress")}
                  {currentIter > 0 && <span className="ml-1 text-muted-foreground">Iter {currentIter} / {params.iters}</span>}
                </span>
                <span className="text-muted-foreground">
                  {currentIter > 0 ? `${Math.round((currentIter / params.iters) * 100)}%` : t("initializing")}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.round((currentIter / params.iters) * 100))}%` }} />
              </div>
              <div className="mt-2 grid gap-2 lg:grid-cols-3">
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("eta.title")}</p>
                  <p className="mt-1 text-xs font-medium text-foreground">{etaText}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("health.title")}</p>
                  <p className="mt-1 flex items-center gap-2 text-xs font-medium text-foreground">
                    <span className={`h-2 w-2 rounded-full ${healthDotClass}`} />
                    {t(`health.level.${healthLevel}`)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{t(healthHintKey)}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("trend.title")}</p>
                  <p className="mt-1 text-xs font-medium text-foreground">{t(healthTrendKey)}</p>
                </div>
              </div>
              <div className="mt-2 rounded-md border border-border/70 bg-background/60 p-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("alerts.title")}</p>
                  {smartAlerts.length > 0 && (
                    <p className="text-[10px] text-muted-foreground">{t("alerts.count", { count: smartAlerts.length })}</p>
                  )}
                </div>
                {smartAlerts.length === 0 ? (
                  <p className="mt-1 text-xs text-success">{t("alerts.none")}</p>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {visibleAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        className={`rounded-md border px-2 py-1.5 ${
                          alert.level === "critical"
                            ? "border-destructive/40 bg-destructive/10"
                            : "border-warning/40 bg-warning/10"
                        }`}
                      >
                        <p
                          className={`flex items-center gap-1.5 text-xs font-semibold ${
                            alert.level === "critical" ? "text-destructive" : "text-warning"
                          }`}
                        >
                          <AlertTriangle size={12} />
                          {t(alert.titleKey)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-foreground">{t(alert.detailKey)}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{t(alert.actionKey)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {trainLossData.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("latestTrainLoss")} <span className="font-mono text-foreground">{trainLossData[trainLossData.length - 1][1].toFixed(4)}</span>
                  {valLossData.length > 0 && (
                    <> · Val Loss: <span className="font-mono text-foreground">{valLossData[valLossData.length - 1][1].toFixed(4)}</span></>
                  )}
                </p>
              )}
            </div>
          )}

          {/* Loss Chart + Log side by side on wide, stacked on narrow */}
          <div className={`grid gap-4 ${trainLossData.length > 0 || valLossData.length > 0 ? "lg:grid-cols-[1fr_1fr]" : ""}`}>
            {/* Loss Chart */}
            {(trainLossData.length > 0 || valLossData.length > 0) && (
              <div className="rounded-lg border border-border bg-card p-3">
                <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold text-foreground">
                  <BarChart3 size={12} />
                  {t("lossCurve")}
                </h3>
                <LossChart
                  trainLoss={trainLossData}
                  valLoss={valLossData}
                  totalIters={params.iters}
                  emptyText={lossEmptyText}
                />
              </div>
            )}

            {/* Training Log */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FileText size={14} />
                  {t("log")}
                </h3>
                {logs.length > 0 && (
                  <button
                    onClick={() => { navigator.clipboard.writeText(logs.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  >
                    {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                    {copied ? tc("copied") : tc("copyLog")}
                  </button>
                )}
              </div>
              <div
                ref={logRef}
                className="h-[400px] overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-xs leading-relaxed"
              >
                {logs.length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground">{t("noLog")}</p>
                ) : (
                  logs.map((line, i) => (
                    <div key={i} className={
                      line.startsWith("ERROR") || line.includes("error") ? "text-red-400" :
                      line.includes("Train loss") ? "text-blue-400" :
                      line.includes("Val loss") ? "text-warning" :
                      line.includes("Saved") ? "text-success" :
                      "text-foreground"
                    }>
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
