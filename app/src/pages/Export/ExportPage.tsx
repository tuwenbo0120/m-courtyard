import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Upload, AlertCircle, CheckCircle2, FolderOpen, ChevronDown, ChevronRight, Circle, Trash2, Loader2, Copy, Check } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useExportStore } from "@/stores/exportStore";
import { StepProgress } from "@/components/StepProgress";

// Export pipeline step keys (labels come from i18n)
const EXPORT_STEP_KEYS = ["check", "resolve", "fuse", "convert", "ollama"] as const;

interface AdapterInfo {
  name: string;
  path: string;
  created: string;
  has_weights: boolean;
  base_model: string;
}

export function ExportPage() {
  const { t, i18n } = useTranslation("export");
  const { t: tc } = useTranslation("common");
  const { currentProject } = useProjectStore();

  // Persistent export state from store
  const {
    isExporting, result, exportLogs, currentStep, exportProgress,
    outputDir, startExport, clearAll: clearExportState, initListeners,
  } = useExportStore();

  const [modelName, setModelName] = useState("");
  const [baseModel, setBaseModel] = useState("");
  const [quantization, setQuantization] = useState("");
  const [quantEdited, setQuantEdited] = useState(false);
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // i18n labels for export pipeline steps
  const EXPORT_STEPS = EXPORT_STEP_KEYS.map((key) => ({
    key,
    label: t(`pipeline.${key}`),
  }));
  const [ollamaInstalled, setOllamaInstalled] = useState<boolean | null>(null);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [selectedAdapter, setSelectedAdapter] = useState("");
  const [adapterDropdownOpen, setAdapterDropdownOpen] = useState(false);

  // Init store listeners once
  useEffect(() => { initListeners(); }, []);

  const selectAdapter = (adapter: AdapterInfo) => {
    setSelectedAdapter(adapter.path);
    if (adapter.base_model) {
      setBaseModel(adapter.base_model);
    }
    // Auto-generate model name from base model
    const baseName = (adapter.base_model || "my-model")
      .split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "-") || "my-model";
    setModelName(`${baseName}-finetuned`);
    setAdapterDropdownOpen(false);
  };

  const selectedAdapterInfo = adapters.find((a) => a.path === selectedAdapter);

  // Auto-complete 4.3: when 4.1 + 4.2 are both done, auto-select first tab
  const step1Done = !!selectedAdapter;
  const step2Done = !!modelName.trim();
  const quantDone = (step1Done && step2Done) || quantEdited;

  useEffect(() => {
    if (step1Done && step2Done && !quantization && !quantEdited) {
      setQuantization("q4");
    }
  }, [step1Done, step2Done]);

  const loadAdapters = async () => {
    if (!currentProject) return;
    try {
      const list = await invoke<AdapterInfo[]>("list_adapters", { projectId: currentProject.id });
      const withWeights = list.filter((a) => a.has_weights);
      setAdapters(withWeights);
      // Auto-select latest adapter
      if (withWeights.length > 0 && !selectedAdapter) {
        selectAdapter(withWeights[0]);
      }
    } catch {
      setAdapters([]);
    }
  };

  useEffect(() => {
    invoke<{ installed: boolean }>("check_ollama_status")
      .then((r) => setOllamaInstalled(r.installed))
      .catch(() => setOllamaInstalled(false));
  }, []);

  // Clear export state when current project doesn't match the export owner
  useEffect(() => {
    const storeProjectId = useExportStore.getState().activeProjectId;
    // If store has data from a different project, clear it
    if (storeProjectId && storeProjectId !== currentProject?.id) {
      clearExportState();
    }
    if (currentProject) loadAdapters();
  }, [currentProject?.id]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [exportLogs]);

  const handleExport = async () => {
    if (!modelName.trim() || !currentProject || !baseModel) return;
    startExport(currentProject.id);
    try {
      await invoke("export_to_ollama", {
        projectId: currentProject.id,
        modelName: modelName.trim(),
        model: baseModel,
        adapterPath: selectedAdapter || null,
        quantization,
        lang: i18n.language,
      });
    } catch (e) {
      useExportStore.getState().setResult(`Error: ${String(e)}`);
    }
  };

  // Parse result type and model name
  const isSuccess = result?.startsWith("__success__:");
  const isError = result?.startsWith("Error");
  const successModelName = isSuccess ? result!.replace("__success__:", "") : "";
  const [cmdCopied, setCmdCopied] = useState(false);

  const [step1Open, setStep1Open] = useState(true);
  const [step2Open, setStep2Open] = useState(true);
  const [step3Open, setStep3Open] = useState(true);
  const sectionStep1Ref = useRef<HTMLDivElement>(null);
  const sectionStep2Ref = useRef<HTMLDivElement>(null);
  const sectionStep3Ref = useRef<HTMLDivElement>(null);
  const [validationHint, setValidationHint] = useState<string | null>(null);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const exportSubSteps = [
    { key: "export", label: t("step.export"), done: !!selectedAdapter },
    { key: "name", label: t("step.name"), done: !!modelName.trim() },
    { key: "size", label: t("step.size"), done: quantDone },
  ];

  // Show a validation hint on the first incomplete section, auto-dismiss after 3s
  const showValidationHint = (hintKey: string, targetRef: React.RefObject<HTMLDivElement | null>) => {
    if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
    setValidationHint(hintKey);
    targetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    validationTimerRef.current = setTimeout(() => setValidationHint(null), 3500);
  };

  // Validate form completeness before exporting; scroll to first incomplete section
  const handleExportWithValidation = () => {
    if (!selectedAdapter) {
      setStep1Open(true);
      showValidationHint("validation.needAdapter", sectionStep1Ref);
      return;
    }
    if (!modelName.trim()) {
      setStep2Open(true);
      showValidationHint("validation.needModelName", sectionStep2Ref);
      return;
    }
    if (!quantization) {
      setStep3Open(true);
      showValidationHint("validation.needQuantization", sectionStep3Ref);
      return;
    }
    if (ollamaInstalled === false || isExporting) return;
    handleExport();
  };

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {currentProject.name}
          </p>
        </div>
        <button
          onClick={() => { setSelectedAdapter(""); setModelName(""); setBaseModel(""); setQuantization(""); setQuantEdited(false); clearExportState(); }}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent"
        >
          <Trash2 size={14} />
          {tc("clearAll")}
        </button>
      </div>

      {/* Unified Step Progress */}
      <StepProgress subSteps={exportSubSteps} />

      {/* Ollama Export */}
      <section className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("ollama.description")}</p>

        <div className="space-y-3">
          {/* 4.1 Adapter Selection - Collapsible Card */}
          <div ref={sectionStep1Ref} className="rounded-lg border border-border bg-card">
            <button
              onClick={() => setStep1Open(!step1Open)}
              className="flex w-full items-center justify-between p-4"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {step1Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="flex items-center gap-1.5">
                  {selectedAdapter ? <CheckCircle2 size={18} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
                  4.1 {t("section.selectAdapter")}
                  {validationHint === "validation.needAdapter" && (
                    <span className="ml-2 animate-pulse rounded bg-destructive/90 px-2 py-0.5 text-[11px] font-medium text-destructive-foreground">{t(validationHint)}</span>
                  )}
                </span>
              </h3>
              {selectedAdapter && (
                <button
                  onClick={(e) => { e.stopPropagation(); invoke("open_adapter_folder", { adapterPath: selectedAdapter }); }}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <FolderOpen size={10} />
                  {tc("openFolder")}
                </button>
              )}
            </button>
            {step1Open && (
            <div className="border-t border-border p-4 space-y-2">
            {adapters.length === 0 ? (
              <p className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                {t("ollama.noAdapter")}
              </p>
            ) : (
              <div className="relative">
                {/* Collapsed: show selected */}
                <button
                  onClick={() => setAdapterDropdownOpen(!adapterDropdownOpen)}
                  disabled={isExporting}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span>
                  <div className="min-w-0 flex-1">
                    {selectedAdapterInfo ? (
                      <>
                        <span className="font-medium text-foreground">{selectedAdapterInfo.created}</span>
                        <span className="ml-1.5 text-muted-foreground/50">{selectedAdapterInfo.name.slice(0, 8)}</span>
                        {selectedAdapterInfo.base_model && (
                          <span className="ml-1.5 text-muted-foreground/40">· {selectedAdapterInfo.base_model}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{t("selectAdapterPlaceholder")}</span>
                    )}
                  </div>
                  <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${adapterDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {/* Expanded: all options */}
                {adapterDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-background p-2 shadow-lg">
                    {adapters.map((a) => {
                      const isSelected = selectedAdapter === a.path;
                      return (
                        <button
                          key={a.path}
                          onClick={() => selectAdapter(a)}
                          className={`flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          {isSelected ? <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span> : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />}
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-foreground">{a.created}</span>
                            <span className="ml-1.5 text-muted-foreground/50">{a.name.slice(0, 8)}</span>
                            {a.base_model && (
                              <span className="ml-1.5 text-muted-foreground/40">· {a.base_model}</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {/* Base model info (read-only, auto from adapter) */}
            {baseModel && (
              <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                {t("baseModel")}{baseModel}
              </p>
            )}
            </div>
            )}
          </div>

          {/* 4.2 Model Name - Collapsible Card */}
          <div ref={sectionStep2Ref} className="rounded-lg border border-border bg-card">
            <button
              onClick={() => setStep2Open(!step2Open)}
              className="flex w-full items-center justify-between p-4"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {step2Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="flex items-center gap-1.5">
                  {modelName.trim() ? <CheckCircle2 size={18} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
                  4.2 {t("section.modelName")}
                  {validationHint === "validation.needModelName" && (
                    <span className="ml-2 animate-pulse rounded bg-destructive/90 px-2 py-0.5 text-[11px] font-medium text-destructive-foreground">{t(validationHint)}</span>
                  )}
                </span>
              </h3>
              {!step2Open && modelName.trim() && (
                <span className="text-xs text-primary truncate max-w-xs">{modelName}</span>
              )}
            </button>
            {step2Open && (
            <div className="border-t border-border p-4">
            <input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={t("ollama.modelNameHint")}
              disabled={isExporting}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
            </div>
            )}
          </div>

          {/* 4.3 Quantization - Collapsible Card */}
          <div ref={sectionStep3Ref} className="rounded-lg border border-border bg-card">
            <button
              onClick={() => setStep3Open(!step3Open)}
              className="flex w-full items-center justify-between p-4"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {step3Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="flex items-center gap-1.5">
                  {quantDone ? <CheckCircle2 size={18} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
                  4.3 {t("section.quantization")}
                  {validationHint === "validation.needQuantization" && (
                    <span className="ml-2 animate-pulse rounded bg-destructive/90 px-2 py-0.5 text-[11px] font-medium text-destructive-foreground">{t(validationHint)}</span>
                  )}
                </span>
              </h3>
              {!step3Open && (
                <span className="text-xs text-muted-foreground">{t(`ollama.${quantization}`)}</span>
              )}
            </button>
            {step3Open && (
            <div className="border-t border-border p-4">
            <div className="flex gap-2">
              {(["q4", "q8", "f16"] as const).map((q) => (
                <button
                  key={q}
                  onClick={() => { setQuantization(q); setQuantEdited(true); }}
                  disabled={isExporting}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    quantization === q
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent"
                  } disabled:opacity-50`}
                >
                  {t(`ollama.${q}`)}
                </button>
              ))}
            </div>
            </div>
            )}
          </div>

          {ollamaInstalled === false && (
            <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
              <AlertCircle size={16} className="text-warning shrink-0" />
              <p className="text-sm text-warning">
                {t("ollama.notInstalled")}
              </p>
            </div>
          )}

          <button
            onClick={handleExportWithValidation}
            className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-colors ${
              isExporting || !modelName.trim() || !baseModel.trim() || !quantization || adapters.length === 0 || ollamaInstalled === false
                ? "bg-primary/50 text-primary-foreground/70 cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            }`}
          >
            <Upload size={16} />
            {isExporting ? t("ollama.exporting") : t("ollama.exportButton")}
          </button>

          {/* Export Progress Panel */}
          {(isExporting || exportLogs.length > 0) && (
            <div className="space-y-3">
              {/* Step Progress Bar */}
              {isExporting && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  {/* Step indicators */}
                  <div className="flex items-center gap-1">
                    {EXPORT_STEPS.map((s, i) => {
                      // Map intermediate steps to their position
                      const stepMap: Record<string, number> = {};
                      EXPORT_STEPS.forEach((x, idx) => { stepMap[x.key] = idx; });
                      // "fuse_done" = after convert, before ollama
                      if (currentStep === "fuse_done") stepMap["fuse_done"] = stepMap["ollama"];
                      const stepIdx = stepMap[currentStep] ?? -1;
                      const isDone = stepIdx > i || currentStep === "done";
                      const isActive = stepIdx === i;
                      return (
                        <div key={s.key} className="flex items-center gap-1 flex-1">
                          <div className={`flex items-center gap-1 text-[10px] font-medium truncate ${
                            isDone ? "text-success" : isActive ? "text-primary" : "text-muted-foreground/40"
                          }`}>
                            {isDone ? (
                              <CheckCircle2 size={12} className="shrink-0 text-success" />
                            ) : isActive ? (
                              <Loader2 size={12} className="shrink-0 animate-spin" />
                            ) : (
                              <Circle size={12} className="shrink-0" />
                            )}
                            <span className="hidden sm:inline">{s.label}</span>
                          </div>
                          {i < EXPORT_STEPS.length - 1 && (
                            <div className={`h-px flex-1 ${
                              isDone ? "bg-success/40" : "bg-border"
                            }`} />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    {(() => {
                      const idx = EXPORT_STEPS.findIndex((x) => x.key === currentStep);
                      const pct = currentStep === "done" ? 100
                        : currentStep === "fuse_done" ? Math.round(((EXPORT_STEPS.findIndex((x) => x.key === "ollama")) / EXPORT_STEPS.length) * 100)
                        : idx >= 0 ? Math.round(((idx + 1) / EXPORT_STEPS.length) * 100) : 5;
                      return (
                        <div className="h-full rounded-full bg-primary animate-pulse"
                          style={{ width: `${Math.max(5, pct)}%`, transition: "width 0.5s ease" }} />
                      );
                    })()}
                  </div>

                  {/* Current step description */}
                  {exportProgress && (
                    <p className="text-xs text-muted-foreground whitespace-pre-line">{exportProgress}</p>
                  )}
                </div>
              )}

              {/* Log area */}
              {exportLogs.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-foreground">
                      {t("exportLog") || "Export Log"}
                    </h3>
                    <button
                      onClick={() => { navigator.clipboard.writeText(exportLogs.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 3000); }}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                    >
                      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                      {copied ? tc("copied") : tc("copyLog")}
                    </button>
                  </div>
                  <div
                    ref={logRef}
                    className="h-[200px] overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-xs leading-relaxed"
                  >
                    {exportLogs.map((line, i) => (
                      <div key={i} className={
                        line.includes("!!!") || line.includes("Error") || line.includes("failed") ? "text-red-400" :
                        line.includes("---") || line.includes("successfully") || line.includes("done") || line.includes("ready") ? "text-success" :
                        line.includes("GGUF") || line.includes("Converting") ? "text-blue-400" :
                        "text-foreground"
                      }>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Result banner (success/error) */}
          {result && !isExporting && isError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 whitespace-pre-wrap">
              {result}
            </div>
          )}
          {result && !isExporting && isSuccess && (
            <div className="rounded-lg border border-success/30 bg-success/10 p-4 space-y-3">
              {/* Row 1: Success title + open folder button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-success shrink-0" />
                  <span className="text-sm font-medium text-success">{t("ollama.success")}</span>
                </div>
                {outputDir && (
                  <button
                    onClick={() => invoke("open_adapter_folder", { adapterPath: outputDir })}
                    className="flex items-center gap-1 text-[11px] text-success/60 hover:text-success transition-colors"
                  >
                    <FolderOpen size={12} />
                    {tc("openFolder")}
                  </button>
                )}
              </div>
              {/* Row 2: Run hint for beginners */}
              <p className="text-xs text-success/60">{t("ollama.successRunHint")}</p>
              {/* Row 3: Command with copy button */}
              <div className="flex items-center gap-2 rounded-md bg-background/50 border border-success/20 px-3 py-2">
                <code className="flex-1 text-xs text-success font-mono select-all">
                  ollama run {successModelName}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`ollama run ${successModelName}`);
                    setCmdCopied(true);
                    setTimeout(() => setCmdCopied(false), 3000);
                  }}
                  className="shrink-0 rounded p-1 text-success/50 hover:text-success hover:bg-success/10 transition-colors"
                  title={tc("copyLog")}
                >
                  {cmdCopied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* GGUF Export */}
      <div className="rounded-lg border border-border bg-card opacity-60 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{t("gguf.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("gguf.description")}</p>
        <p className="text-xs text-muted-foreground italic">{t("gguf.comingSoon")}</p>
      </div>
    </div>
  );
}
