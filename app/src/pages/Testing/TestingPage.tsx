import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Send, Trash2, MessageSquare, Settings, FolderOpen, ChevronDown, ChevronRight, CheckCircle2, Circle, GitCompare } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useTestingStore } from "@/stores/testingStore";

interface AdapterInfo {
  name: string;
  path: string;
  created: string;
  has_weights: boolean;
  base_model: string;
}

interface InferenceResponsePayload {
  text?: string;
  request_id?: string;
}

interface InferenceErrorPayload {
  message?: string;
  request_id?: string;
}

type ABMode = "auto" | "sequential" | "parallel";
type ResolvedABMode = "sequential" | "parallel";

interface ABRunResult {
  response: string;
  durationMs: number;
  tokens: number;
  tokensPerSec: number;
  error?: string;
}

interface ABExecutionResult {
  prompt: string;
  mode: ResolvedABMode;
  base: ABRunResult;
  tuned: ABRunResult;
  createdAt: number;
}

export function TestingPage() {
  const { t, i18n } = useTranslation("testing");
  const { t: tc } = useTranslation("common");
  const { currentProject } =
    useProjectStore();
  const {
    messages, selectedAdapter, modelId,
    addMessage, setSelectedAdapter, setModelId, resetAll: resetTestingState,
    switchProject,
  } = useTestingStore();
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isABRunning, setIsABRunning] = useState(false);
  const [maxTokens, setMaxTokens] = useState(512);
  const [temperature, setTemperature] = useState(0.7);
  const [showConfig, setShowConfig] = useState(false);
  const [abPrompt, setABPrompt] = useState("");
  const [abMode, setABMode] = useState<ABMode>("auto");
  const [abResult, setABResult] = useState<ABExecutionResult | null>(null);
  const [advancedABOpen, setAdvancedABOpen] = useState(false);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [adapterDropdownOpen, setAdapterDropdownOpen] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const selectAdapter = (adapter: AdapterInfo | null) => {
    if (adapter) {
      setSelectedAdapter(adapter.path);
      if (adapter.base_model) setModelId(adapter.base_model);
    } else {
      setSelectedAdapter("");
    }
    setAdapterDropdownOpen(false);
  };

  const selectedAdapterInfo = adapters.find((a) => a.path === selectedAdapter);

  const loadAdapters = async () => {
    if (!currentProject) return;
    try {
      const list = await invoke<AdapterInfo[]>("list_adapters", {
        projectId: currentProject.id,
      });
      const withWeights = list.filter((a) => a.has_weights);
      setAdapters(withWeights);
      // Auto-select the latest adapter with weights if none selected for this project
      if (withWeights.length > 0 && !selectedAdapter) {
        selectAdapter(withWeights[0]);
      }
    } catch {
      setAdapters([]);
    }
  };

  // Switch testing store context when project changes
  useEffect(() => {
    if (currentProject) {
      switchProject(currentProject.id);
      loadAdapters();
    }
  }, [currentProject]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  const createRequestId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const runInference = async ({
    prompt,
    adapterPath,
    requestId,
  }: {
    prompt: string;
    adapterPath: string | null;
    requestId: string;
  }): Promise<ABRunResult> => {
    const startedAt = performance.now();

    return new Promise<ABRunResult>((resolve) => {
      let finished = false;
      let timeoutId: number | null = null;
      let offResponse: UnlistenFn | null = null;
      let offError: UnlistenFn | null = null;

      const done = (payload: { response?: string; error?: string }) => {
        if (finished) return;
        finished = true;

        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        if (offResponse) offResponse();
        if (offError) offError();

        const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
        const response = payload.response ?? "";
        const tokens = response.trim() ? response.trim().split(/\s+/).length : 0;
        const tokensPerSec = tokens > 0 ? tokens / (durationMs / 1000) : 0;

        resolve({
          response,
          durationMs,
          tokens,
          tokensPerSec,
          error: payload.error,
        });
      };

      Promise.all([
        listen<InferenceResponsePayload>("inference:response", (e) => {
          if ((e.payload.request_id || "") !== requestId) return;
          done({ response: e.payload.text || "" });
        }),
        listen<InferenceErrorPayload>("inference:error", (e) => {
          if ((e.payload.request_id || "") !== requestId) return;
          done({ error: e.payload.message || t("ab.errorUnknown") });
        }),
      ])
        .then(([u1, u2]) => {
          offResponse = u1;
          offError = u2;

          timeoutId = window.setTimeout(() => {
            done({ error: t("ab.errorTimeout") });
          }, 120000);

          invoke("start_inference", {
            projectId: currentProject?.id,
            prompt,
            model: modelId,
            adapterPath,
            maxTokens,
            temperature,
            lang: i18n.language,
            requestId,
          }).catch((err) => {
            done({ error: String(err) });
          });
        })
        .catch((err) => {
          done({ error: String(err) });
        });
    });
  };

  const resolveABMode = (): ResolvedABMode => {
    if (abMode !== "auto") return abMode;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const memory = nav.deviceMemory ?? 8;
    return memory >= 16 ? "parallel" : "sequential";
  };

  const handleSend = async () => {
    if (!input.trim() || isGenerating || isABRunning || !currentProject) return;
    const userMsg = { role: "user" as const, content: input.trim() };
    addMessage(userMsg);
    setInput("");
    setIsGenerating(true);

    try {
      const result = await runInference({
        prompt: userMsg.content,
        adapterPath: selectedAdapter || null,
        requestId: createRequestId(),
      });

      if (result.error) {
        addMessage({ role: "assistant", content: `Error: ${result.error}` });
      } else {
        addMessage({ role: "assistant", content: result.response });
      }
    } catch (err) {
      addMessage({ role: "assistant", content: `Error: ${String(err)}` });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRunAB = async () => {
    if (!currentProject || !modelId || !selectedAdapter || !abPrompt.trim() || isABRunning || isGenerating) {
      return;
    }

    const prompt = abPrompt.trim();
    const mode = resolveABMode();

    setIsABRunning(true);

    try {
      const baseRequestId = createRequestId();
      const tunedRequestId = createRequestId();

      let baseResult: ABRunResult;
      let tunedResult: ABRunResult;

      if (mode === "parallel") {
        [baseResult, tunedResult] = await Promise.all([
          runInference({
            prompt,
            adapterPath: null,
            requestId: baseRequestId,
          }),
          runInference({
            prompt,
            adapterPath: selectedAdapter,
            requestId: tunedRequestId,
          }),
        ]);
      } else {
        baseResult = await runInference({
          prompt,
          adapterPath: null,
          requestId: baseRequestId,
        });
        tunedResult = await runInference({
          prompt,
          adapterPath: selectedAdapter,
          requestId: tunedRequestId,
        });
      }

      setABResult({
        prompt,
        mode,
        base: baseResult,
        tuned: tunedResult,
        createdAt: Date.now(),
      });
    } finally {
      setIsABRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const [step1Open, setStep1Open] = useState(false);

  const adapterValid = !!selectedAdapter && adapters.some((a) => a.path === selectedAdapter);
  const canRunAB = !!(adapterValid && modelId && abPrompt.trim() && !isABRunning && !isGenerating);
  const hasABResult = !!abResult;
  const formatDuration = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

  if (!currentProject) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{tc("selectProjectHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between pb-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {currentProject.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`rounded-md border border-border p-2 transition-colors hover:bg-accent ${showConfig ? "bg-accent text-foreground" : "text-muted-foreground"}`}
          >
            <Settings size={16} />
          </button>
          <button
            onClick={() => resetTestingState()}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            <Trash2 size={14} />
            {tc("clearAll")}
          </button>
        </div>
      </div>

      {/* Adapter - collapsible card */}
      <div className="mb-3 rounded-lg border border-border bg-card">
        <button
          onClick={() => setStep1Open(!step1Open)}
          className="flex w-full items-center justify-between p-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {step1Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="flex items-center gap-1.5">
              {adapterValid ? <CheckCircle2 size={18} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
              {t("section.selectAdapter")}
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
          <p className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            {t("noAdapter")}
          </p>
        ) : (
          <div className="relative">
            {/* Collapsed: show selected adapter */}
            <button
              onClick={() => setAdapterDropdownOpen(!adapterDropdownOpen)}
              disabled={isGenerating || isABRunning}
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
                  <span className="text-muted-foreground">{t("noAdapterOption")}</span>
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
                      </div>
                    </button>
                  );
                })}
                {/* No adapter - at bottom */}
                <button
                  onClick={() => selectAdapter(null)}
                  className={`flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs transition-colors ${
                    !selectedAdapter
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {!selectedAdapter ? <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span> : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />}
                  <span>{t("noAdapterOption")}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Base model info (read-only) */}
        {modelId && (
          <p className="text-[10px] text-muted-foreground/60">
            {t("baseModel")}{modelId}
          </p>
        )}

        {/* Advanced Config */}
        {showConfig && (
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("config.maxTokens")}
              </label>
              <input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("config.temperature")}
              </label>
              <input
                type="number"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        )}
          </div>
        )}
      </div>

      {/* Chat Messages */}
      <div
        ref={chatRef}
        className="flex-1 min-h-[360px] overflow-y-auto space-y-4 rounded-lg border border-border bg-card p-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-16">
            <MessageSquare size={40} className="text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">
              {t("chat.empty")}
            </p>
            {selectedAdapter && (
              <p className="mt-1 text-xs text-muted-foreground/70">
                {t("adapterLoaded")}
              </p>
            )}
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              </div>
            </div>
          ))
        )}
        {isGenerating && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">
              {t("chat.thinking")}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="mt-4 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("chat.placeholder")}
          rows={3}
          className="flex-1 min-h-[96px] resize-y rounded-md border border-input bg-background px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isGenerating || isABRunning}
          className="rounded-md bg-primary px-4 py-2.5 text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </div>

      {/* Advanced A/B (on-demand) */}
      <div className="mt-3 rounded-lg border border-border bg-card">
        <button
          onClick={() => setAdvancedABOpen(!advancedABOpen)}
          className="flex w-full items-center justify-between p-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {advancedABOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <GitCompare size={14} />
            {t("ab.advancedTitle")}
          </h3>
          <span className="text-[11px] text-muted-foreground">{t("ab.advancedTip")}</span>
        </button>

        {advancedABOpen && (
          <div className="space-y-3 border-t border-border p-4">
            <p className="text-xs text-muted-foreground">{t("ab.hint")}</p>

            <textarea
              value={abPrompt}
              onChange={(e) => setABPrompt(e.target.value)}
              placeholder={t("ab.promptPlaceholder")}
              rows={3}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />

            <div className="flex flex-wrap items-center gap-2">
              {(["auto", "sequential", "parallel"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setABMode(mode)}
                  disabled={isABRunning || isGenerating}
                  className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                    abMode === mode
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {t(`ab.mode.${mode}`)}
                </button>
              ))}

              <button
                onClick={handleRunAB}
                disabled={!canRunAB}
                className="ml-auto rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isABRunning ? t("ab.running") : t("ab.run")}
              </button>
            </div>

            <p className="text-[11px] text-muted-foreground">{t(`ab.modeDesc.${abMode}`)}</p>

            {!adapterValid && <p className="text-xs text-warning">{t("ab.needAdapter")}</p>}

            {hasABResult && abResult && (
              <>
                <p className="text-xs text-muted-foreground">
                  {t("ab.modeUsed", { mode: t(`ab.mode.${abResult.mode}`) })}
                </p>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-md border border-border/70 bg-background/60 p-3">
                    <p className="text-xs font-semibold text-foreground">{t("ab.model.base")}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("ab.metrics.duration", { value: formatDuration(abResult.base.durationMs) })}
                      {" · "}
                      {t("ab.metrics.tokens", { value: abResult.base.tokens })}
                      {" · "}
                      {t("ab.metrics.tps", { value: abResult.base.tokensPerSec.toFixed(2) })}
                    </p>
                    {abResult.base.error ? (
                      <p className="mt-2 text-xs text-destructive">{abResult.base.error}</p>
                    ) : (
                      <pre className="mt-2 whitespace-pre-wrap text-xs text-foreground">{abResult.base.response || t("ab.emptyResponse")}</pre>
                    )}
                  </div>

                  <div className="rounded-md border border-success/40 bg-success/5 p-3">
                    <p className="text-xs font-semibold text-success">{t("ab.model.tuned")}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("ab.metrics.duration", { value: formatDuration(abResult.tuned.durationMs) })}
                      {" · "}
                      {t("ab.metrics.tokens", { value: abResult.tuned.tokens })}
                      {" · "}
                      {t("ab.metrics.tps", { value: abResult.tuned.tokensPerSec.toFixed(2) })}
                    </p>
                    {abResult.tuned.error ? (
                      <p className="mt-2 text-xs text-destructive">{abResult.tuned.error}</p>
                    ) : (
                      <pre className="mt-2 whitespace-pre-wrap text-xs text-foreground">{abResult.tuned.response || t("ab.emptyResponse")}</pre>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
