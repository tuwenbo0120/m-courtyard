import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Upload, Trash2, Eye, ArrowRight, FolderOpen, Square, Play, ChevronDown, ChevronRight, CheckCircle2, Circle, AlertTriangle, Settings, Check, AlertCircle, ChevronLeft, ListPlus, X, Info } from "lucide-react";
import i18nGlobal from "@/i18n";
import { useNavigate } from "react-router-dom";
import { useProjectStore } from "@/stores/projectStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useTaskStore } from "@/stores/taskStore";
import { useTrainingQueueStore } from "@/stores/trainingQueueStore";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ModelSelector } from "@/components/ModelSelector";
import { StepProgress } from "@/components/StepProgress";

interface FileInfo {
  name: string;
  path: string;
  size_bytes: number;
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
  failed_count: number;
  quality_score?: number | null;
  quality_grade?: string;
  quality_scoring_enabled?: boolean;
}

interface RawFileSample {
  name: string;
  ext: string;
  size: number;
  snippet: string;
}

interface SegmentPreviewItem {
  id: number;
  text_preview: string;
  char_count: number;
  line_count: number;
  strategy: string;
  source_file: string;
}

interface SegmentPreviewSummary {
  total_segments: number;
  avg_chars: number;
  min_chars: number;
  max_chars: number;
  short_segments: number;
  long_segments: number;
  primary_strategy: string;
}

interface SegmentPreviewResponse {
  summary: SegmentPreviewSummary;
  items: SegmentPreviewItem[];
}

type ModeStatus = "recommended" | "available" | "cautious";
type ModeStatusMap = Record<"qa" | "style" | "chat" | "instruct", ModeStatus>;

const SEGMENT_STRATEGY_KEY_MAP: Record<string, string> = {
  markdown_recursive: "segment.strategy.markdown_recursive",
  code_aware: "segment.strategy.code_aware",
  fixed_length: "segment.strategy.fixed_length",
  paragraph_balanced: "segment.strategy.paragraph_balanced",
};

function analyzeContentForModes(samples: RawFileSample[]): { status: ModeStatusMap; hintKey: string } {
  if (samples.length === 0) {
    return {
      status: { qa: "available", style: "available", chat: "available", instruct: "available" },
      hintKey: "generate.modeCheckNoFiles",
    };
  }

  const structuredExts = new Set(["json", "jsonl", "csv", "tsv", "xml", "yaml", "yml"]);
  const proseExts = new Set(["txt", "md", "markdown", "doc", "docx", "pdf", "rtf"]);

  let proseScore = 0;
  let structuredScore = 0;
  let dialogueScore = 0;
  let headingScore = 0;
  let totalSnippetLen = 0;

  for (const s of samples) {
    // Extension-based signals
    if (structuredExts.has(s.ext)) structuredScore += 2;
    if (proseExts.has(s.ext)) proseScore += 2;

    const text = s.snippet;
    if (!text) continue;
    totalSnippetLen += text.length;

    // Content heuristics
    const lines = text.split("\n").filter((l) => l.trim());
    const avgLineLen = lines.length > 0 ? text.length / lines.length : 0;

    // Long paragraphs → prose/narrative
    if (avgLineLen > 80) proseScore += 2;
    // Short lines with many line breaks → structured/list
    if (avgLineLen < 30 && lines.length > 5) structuredScore += 1;

    // JSON-like content
    if (/^\s*[[{]/.test(text) && /[}\]]\s*$/.test(text.trim())) structuredScore += 3;
    // Key-value patterns
    if ((text.match(/[""]\s*:\s*/g) || []).length > 3) structuredScore += 2;

    // Dialogue markers → good for chat mode
    const dialogueMarkers = (text.match(/["「『"]/g) || []).length;
    if (dialogueMarkers > 2) dialogueScore += 2;
    // Quotation patterns like "xxx说" or "xxx道"
    if ((text.match(/[说道问答叫喊笑哭]：/g) || []).length > 0) dialogueScore += 2;
    // English dialogue: "said", "asked"
    if ((text.match(/\b(said|asked|replied|exclaimed)\b/gi) || []).length > 0) dialogueScore += 2;

    // Headings → good for QA extraction
    if ((text.match(/^#{1,6}\s+/gm) || []).length > 0) headingScore += 2;
    if ((text.match(/^第[一二三四五六七八九十\d]+[章节部分]/gm) || []).length > 0) headingScore += 2;

    // Narrative continuity (paragraph connectors)
    const narrativeWords = (text.match(/[然而但是因此所以接着随后于是不过]/g) || []).length;
    if (narrativeWords > 2) proseScore += 1;
  }

  // Normalize: is the content primarily structured or prose?
  const isMainlyStructured = structuredScore > proseScore * 2 && proseScore < 3;
  const isMainlyProse = proseScore > structuredScore * 2;
  const hasDialogue = dialogueScore >= 2;
  const hasHeadings = headingScore >= 2;

  const status: ModeStatusMap = {
    qa: "recommended",
    style: "available",
    chat: "available",
    instruct: "recommended",
  };

  // QA: best when there are headings or structured knowledge
  if (hasHeadings) status.qa = "recommended";
  if (isMainlyStructured && !hasHeadings) status.qa = "available";

  // Style: best for rich narrative prose
  if (isMainlyProse) {
    status.style = "recommended";
  } else if (isMainlyStructured) {
    status.style = "cautious";
  }

  // Chat: best with dialogue-like content
  if (hasDialogue) {
    status.chat = "recommended";
  } else if (isMainlyStructured) {
    status.chat = "cautious";
  }

  // Instruct: versatile, works with most content
  status.instruct = "recommended";
  if (totalSnippetLen < 100) status.instruct = "available";

  let hintKey = "generate.modeCheckGeneralHint";
  if (isMainlyStructured) hintKey = "generate.modeCheckStructuredHint";
  else if (isMainlyProse && hasDialogue) hintKey = "generate.modeCheckDialogueHint";
  else if (isMainlyProse) hintKey = "generate.modeCheckProseHint";

  return { status, hintKey };
}

export function DataPrepPage() {
  const { t } = useTranslation("dataPrep");
  const { t: tc } = useTranslation("common");
  const { t: tTrain } = useTranslation("training");
  const navigate = useNavigate();
  const { projects, fetchProjects, currentProject, setCurrentProject } =
    useProjectStore();
  const [rawFiles, setRawFiles] = useState<FileInfo[]>([]);
  const [_cleanedFiles, setCleanedFiles] = useState<FileInfo[]>([]);
  const [datasetVersions, setDatasetVersions] = useState<DatasetVersionInfo[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");
  const [importing, setImporting] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [_cleanProgress, setCleanProgress] = useState("");
  const [autoFixing, setAutoFixing] = useState(false);
  const [autoFixMsg, setAutoFixMsg] = useState("");
  const [autoFixOk, setAutoFixOk] = useState(false);
  const {
    generating, genProgress, genStep, genTotal, genError, aiLogs,
    ollamaPathMismatch,
    initListeners, setReloadFiles, clearLogs, newVersionIds, setScrollToDatasets,
    genFiles, genCurrentFileIdx, setGenFiles, genSuccessCount, genFailCount,
  } = useGenerationStore();
  const { queue: trainingQueue, removeFromQueue, clearQueue: clearTrainingQueue } = useTrainingQueueStore();
  const {
    formGenMode: genMode, formGenSource: genSource, formGenModel: genModel,
    formEnablePrivacyFilter: enablePrivacyFilter,
    formEnableFuzzyDedup: enableFuzzyDedup,
    formFuzzyDedupThreshold: fuzzyDedupThreshold,
    formEnableQualityScoring: enableQualityScoring,
    setFormField,
  } = useGenerationStore();
  const setGenMode = (v: string) => setFormField("formGenMode", v);
  const setGenSource = (v: "ollama" | "lmstudio" | "builtin") => setFormField("formGenSource", v);
  const setGenModel = (v: string) => setFormField("formGenModel", v);
  const setEnablePrivacyFilter = (v: boolean) => setFormField("formEnablePrivacyFilter", v);
  const setEnableFuzzyDedup = (v: boolean) => setFormField("formEnableFuzzyDedup", v);
  const setFuzzyDedupThreshold = (v: number) => setFormField("formFuzzyDedupThreshold", v);
  const setEnableQualityScoring = (v: boolean) => setFormField("formEnableQualityScoring", v);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pipelineStage, setPipelineStage] = useState<"idle" | "cleaning" | "generating">("idle");
  const autoGenAfterClean = useRef(false);
  const [deleteConfirm, setDeleteConfirm] = useState<FileInfo | null>(null);
  const [ollamaReady, setOllamaReady] = useState<boolean | null>(null); // null = checking
  const sectionStep1Ref = useRef<HTMLDivElement>(null);
  const sectionStep2Ref = useRef<HTMLDivElement>(null);
  const [validationHint, setValidationHint] = useState<string | null>(null);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [segmentPreview, setSegmentPreview] = useState<SegmentPreviewResponse | null>(null);
  const [segmentPreviewLoading, setSegmentPreviewLoading] = useState(false);
  const [previewTab, setPreviewTab] = useState<"data" | "segment">("data");
  const [autoSegment, setAutoSegment] = useState(true);
  const datasetSectionRef = useRef<HTMLDivElement>(null);
  const [datasetPage, setDatasetPage] = useState(0);
  const DATASETS_PER_PAGE = 10;
  const [expandedDataset, setExpandedDataset] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [dragFileCount, setDragFileCount] = useState(0);
  const [filePage, setFilePage] = useState(0);
  const FILES_PER_PAGE = 10;
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [retryingVersion, setRetryingVersion] = useState<string | null>(null);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  // Show scrollbar on scroll, hide after 3 seconds of inactivity
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      el.classList.add("is-scrolling");
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        el.classList.remove("is-scrolling");
      }, 3000);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  const MODE_LABELS: Record<string, string> = {
    qa: t("generate.mode_qa"),
    style: t("generate.mode_style"),
    chat: t("generate.mode_chat"),
    instruct: t("generate.mode_instruct"),
  };

  const getStrategyLabel = (strategy: string) =>
    t(SEGMENT_STRATEGY_KEY_MAP[strategy] || "segment.strategy.paragraph_balanced");

  const [modeCapability, setModeCapability] = useState<{ status: ModeStatusMap; hintKey: string }>({
    status: { qa: "available", style: "available", chat: "available", instruct: "available" },
    hintKey: "generate.modeCheckNoFiles",
  });
  const modeCapabilityReady = useRef(false);

  // Check Ollama availability on mount
  useEffect(() => {
    invoke<{ installed: boolean; running: boolean }>("check_ollama_status")
      .then((status) => setOllamaReady(status.installed && status.running))
      .catch(() => setOllamaReady(false));
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // On mount (key prop in App.tsx guarantees fresh remount per project),
  // reset generation store if idle and load this project's files.
  useEffect(() => {
    const genStore = useGenerationStore.getState();
    if (!genStore.generating) {
      genStore.resetForm();
      genStore.resetGeneration();
    }
    if (currentProject) {
      loadFiles();
    }
  }, [currentProject?.id]);

  // Listen for cleaning events (local to this page)
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    listen<{ desc?: string }>("cleaning:progress", (e) => {
      setCleanProgress(e.payload.desc || "");
    }).then((u) => unsubs.push(u));

    listen("cleaning:complete", () => {
      setCleaning(false);
      setCleanProgress("");
      reloadFiles();
      // Auto-start generation if in pipeline mode
      if (autoGenAfterClean.current) {
        autoGenAfterClean.current = false;
        setTimeout(() => startGenerationStep(), 300);
      } else {
        // Auto-segment completed — switch to segment tab for preview
        setPreviewTab("segment");
      }
    }).then((u) => unsubs.push(u));

    listen<{ message?: string }>("cleaning:error", (e) => {
      setCleaning(false);
      setPipelineStage("idle");
      setCleanProgress(e.payload.message || "Error");
      autoGenAfterClean.current = false;
    }).then((u) => unsubs.push(u));

    return () => { unsubs.forEach((u) => u()); };
  }, []);

  // Initialize global generation event listeners (idempotent - only runs once)
  useEffect(() => {
    initListeners();
  }, [initListeners]);

  // Pass reloadFiles to the generation store so it can refresh file list on complete/stop
  useEffect(() => {
    setReloadFiles(reloadFiles);
  }, [currentProject, setReloadFiles]);

  // Register scroll-to-datasets callback for auto-scroll on generation complete
  useEffect(() => {
    setScrollToDatasets(() => {
      datasetSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [setScrollToDatasets]);

  // Reset pipeline stage when generation finishes
  useEffect(() => {
    if (!generating && !cleaning) {
      setPipelineStage("idle");
    }
  }, [generating, cleaning]);


  // Drag-and-drop file import via Tauri webview window events
  useEffect(() => {
    const appWindow = getCurrentWebviewWindow();
    let unlisten: (() => void) | null = null;

    appWindow.onDragDropEvent((event) => {
      if (event.payload.type === "enter") {
        setIsDragging(true);
        setDragFileCount(event.payload.paths?.length ?? 0);
      } else if (event.payload.type === "leave") {
        setIsDragging(false);
        setDragFileCount(0);
      } else if (event.payload.type === "drop") {
        setIsDragging(false);
        setDragFileCount(0);
        const paths = event.payload.paths;
        if (paths && paths.length > 0 && currentProject) {
          // Pass all paths (files + directories) to backend; it handles recursive expansion & filtering
          invoke("import_files", {
            projectId: currentProject.id,
            sourcePaths: paths,
          }).then(() => {
            loadFiles();
            triggerAutoSegment();
          }).catch((e) => console.error("Drag-drop import failed:", e));
        }
      }
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [currentProject]);

  const loadFiles = async () => {
    if (!currentProject) return;
    const projectId = currentProject.id;
    try {
      const raw: FileInfo[] = await invoke("list_project_files", {
        projectId,
        subdir: "raw",
      });
      const cleaned: FileInfo[] = await invoke("list_project_files", {
        projectId,
        subdir: "cleaned",
      });
      const versions: DatasetVersionInfo[] = await invoke("list_dataset_versions", {
        projectId,
      });

      if (useProjectStore.getState().currentProject?.id !== projectId) return;

      setRawFiles(raw);
      setCleanedFiles(cleaned);
      setDatasetVersions(versions);
      setDatasetPage(0);
      setExpandedDataset(null);
      await loadSegmentPreview(projectId);

      // Sample file content for mode detection
      if (raw.length > 0) {
        try {
          const samples: RawFileSample[] = await invoke("sample_raw_files", {
            projectId,
          });
          if (useProjectStore.getState().currentProject?.id !== projectId) return;
          const result = analyzeContentForModes(samples);
          setModeCapability(result);
          // Smart default: auto-select first recommended mode if user hasn't chosen one yet
          const { formGenMode } = useGenerationStore.getState();
          if (!formGenMode) {
            const preferredOrder: ("qa" | "style" | "chat" | "instruct")[] = ["qa", "instruct", "style", "chat"];
            const firstRecommended = preferredOrder.find((m) => result.status[m] === "recommended");
            if (firstRecommended) {
              setGenMode(firstRecommended);
            }
          }
          modeCapabilityReady.current = true;
        } catch (e) {
          console.error("Failed to sample files:", e);
        }
      } else {
        setModeCapability({
          status: { qa: "available", style: "available", chat: "available", instruct: "available" },
          hintKey: "generate.modeCheckNoFiles",
        });
        modeCapabilityReady.current = false;
      }
    } catch (e) {
      console.error("Failed to load files:", e);
    }
  };

  const loadSegmentPreview = async (projectId: string) => {
    setSegmentPreviewLoading(true);
    try {
      const payload: SegmentPreviewResponse = await invoke("preview_clean_segments", {
        projectId,
        limit: 8,
      });
      if (useProjectStore.getState().currentProject?.id !== projectId) return;
      setSegmentPreview(payload);
    } catch (e) {
      console.error("Failed to preview cleaned segments:", e);
      setSegmentPreview(null);
    } finally {
      setSegmentPreviewLoading(false);
    }
  };


  // Auto-segment: trigger cleaning after file import (algorithmic, no AI)
  const triggerAutoSegment = async () => {
    if (!currentProject || !autoSegment) return;
    if (generating || cleaning) return;
    try {
      setCleaning(true);
      setCleanProgress(t("generate.cleaningStatus"));
      autoGenAfterClean.current = false; // don't auto-generate, just segment
      await invoke("start_cleaning", {
        projectId: currentProject.id,
        lang: i18nGlobal.language,
        options: {
          privacyFilter: enablePrivacyFilter,
          fuzzyDedup: enableFuzzyDedup,
          fuzzyDedupThreshold: fuzzyDedupThreshold,
        },
      });
    } catch {
      setCleaning(false);
      setCleanProgress("");
    }
  };

  const { canStart: taskCanStart, acquireTask } = useTaskStore();
  const taskCheck = currentProject ? taskCanStart(currentProject.id, "generating") : { allowed: true };

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

  const scrollToPreviewTop = () => {
    const mainEl = document.querySelector("main");
    if (mainEl instanceof HTMLElement) {
      mainEl.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    previewPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    if (rawFiles.length === 0) {
      setStep1Open(true);
      showValidationHint("validation.needFiles", sectionStep1Ref);
      return;
    }
    if ((genSource === "ollama" || genSource === "lmstudio") && !genModel.trim()) {
      setStep2Open(true);
      showValidationHint("validation.needModel", sectionStep2Ref);
      return;
    }
    if (!genMode) {
      setStep2Open(true);
      showValidationHint("validation.needMode", sectionStep2Ref);
      return;
    }
    if (!taskCheck.allowed) return;
    handleStartPipeline();
  };

  // Start the generation pipeline: always clean current raw files → generate
  const handleStartPipeline = async () => {
    if (!currentProject) return;
    if ((genSource === "ollama" || genSource === "lmstudio") && !genModel.trim()) return;
    // Check global task lock
    const check = taskCanStart(currentProject.id, "generating");
    if (!check.allowed) return;
    if (!acquireTask(currentProject.id, currentProject.name, "generating")) return;
    const store = useGenerationStore.getState();
    store.clearLogs();
    setGenFiles(rawFiles.map(f => ({ name: f.name, sizeBytes: f.size_bytes })));
    setPreviewTab("data");
    scrollToPreviewTop();
    setQueueExpanded(false);
    // Stage 1: always clean first so generated dataset strictly matches current raw files
    setPipelineStage("cleaning");
    setCleaning(true);
    setCleanProgress(t("generate.cleaningStatus"));
    autoGenAfterClean.current = true;
    try {
      await invoke("start_cleaning", {
        projectId: currentProject.id,
        lang: i18nGlobal.language,
        options: {
          privacyFilter: enablePrivacyFilter,
          fuzzyDedup: enableFuzzyDedup,
          fuzzyDedupThreshold: fuzzyDedupThreshold,
        },
      });
    } catch (e) {
      setCleaning(false);
      setPipelineStage("idle");
      setCleanProgress(String(e));
      autoGenAfterClean.current = false;
    }
  };

  const handleAutoFixOllamaPath = async () => {
    setAutoFixing(true);
    setAutoFixMsg("");
    setAutoFixOk(false);
    try {
      const appliedPath = await invoke<string>("fix_ollama_models_path");
      setAutoFixMsg(t("ollamaPathMismatch.autoFixSuccess") + (appliedPath ? ` (${appliedPath})` : ""));
      setAutoFixOk(true);
    } catch (e) {
      setAutoFixMsg(t("ollamaPathMismatch.autoFixError", { error: String(e) }));
      setAutoFixOk(false);
    } finally {
      setAutoFixing(false);
    }
  };

  const startGenerationStep = async () => {
    if (!currentProject) return;
    // Read form values from store to avoid stale closure (this fn is called from useEffect listener)
    const {
      formGenMode,
      formGenSource,
      formGenModel,
      formEnableQualityScoring,
    } = useGenerationStore.getState();
    if (!formGenMode) {
      useGenerationStore.setState({ genError: t("generate.noModeSelected") });
      setPipelineStage("idle");
      return;
    }
    setPipelineStage("generating");
    setPreviewTab("data"); // Ensure preview tab is explicitly switched to data to prevent panel collapsing
    setDatasetPage(0);
    setExpandedDataset(null);
    const store = useGenerationStore.getState();
    store.startGeneration();
    try {
      await invoke("generate_dataset", {
        projectId: currentProject.id,
        model: (formGenSource === "ollama" || formGenSource === "lmstudio") ? formGenModel : "",
        mode: formGenMode,
        source: formGenSource,
        resume: false,
        lang: i18nGlobal.language,
        qualityScoring: formEnableQualityScoring,
        retryFailedOnly: false,
      });
    } catch (e) {
      useGenerationStore.setState({
        generating: false,
        genProgress: "",
        genError: String(e),
      });
      setPipelineStage("idle");
    }
  };

  const handleStop = async () => {
    try {
      await invoke("stop_generation");
    } catch (e) {
      console.error("Stop failed:", e);
    }
    // Fallback: reset frontend state in case backend event doesn't fire
    setCleaning(false);
    setCleanProgress("");
    useGenerationStore.getState().stopGeneration();
    setPreview(null);
    setPreviewName("");
    setSegmentPreview(null);
    setRetryingVersion(null);
    setQueueExpanded(false);
    autoGenAfterClean.current = false;
    setPipelineStage("idle");
    useTaskStore.getState().releaseTask();
  };


  // Reload files using the store's currentProject to avoid stale closures
  const reloadFiles = async () => {
    const proj = useProjectStore.getState().currentProject;
    if (!proj) return;
    const projectId = proj.id;
    try {
      const raw: FileInfo[] = await invoke("list_project_files", { projectId, subdir: "raw" });
      const cleaned: FileInfo[] = await invoke("list_project_files", { projectId, subdir: "cleaned" });
      const versions: DatasetVersionInfo[] = await invoke("list_dataset_versions", { projectId });
      if (useProjectStore.getState().currentProject?.id !== projectId) return;
      setRawFiles(raw);
      setCleanedFiles(cleaned);
      setDatasetVersions(versions);
      setDatasetPage(0);
      setExpandedDataset(null);
      await loadSegmentPreview(projectId);
    } catch (e) {
      console.error("Reload files failed:", e);
    }
  };

  const handleImport = async () => {
    if (!currentProject) return;
    setImporting(true);
    try {
      const selected = await dialogOpen({
        multiple: true,
        filters: [
          { name: "Text Files", extensions: ["txt", "json", "jsonl", "md", "docx", "pdf"] },
        ],
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected as string[] : [selected as string];
        await invoke("import_files", {
          projectId: currentProject.id,
          sourcePaths: paths,
        });
        await loadFiles();
        triggerAutoSegment();
      }
    } catch (e) {
      console.error("Import failed:", e);
    } finally {
      setImporting(false);
    }
  };

  const handleImportFolder = async () => {
    if (!currentProject) return;
    setImporting(true);
    try {
      const selected = await dialogOpen({
        directory: true,
      });
      if (selected) {
        const dir = selected as string;
        await invoke("import_files", {
          projectId: currentProject.id,
          sourcePaths: [dir],
        });
        await loadFiles();
        triggerAutoSegment();
      }
    } catch (e) {
      console.error("Import folder failed:", e);
    } finally {
      setImporting(false);
    }
  };

  const handlePreview = async (file: FileInfo) => {
    try {
      const content: string = await invoke("read_file_content", {
        path: file.path,
      });
      if (!content || content.trim().length === 0) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        if (["pdf", "docx", "doc"].includes(ext)) {
          setPreview(t("preview.binaryEmpty"));
        } else {
          setPreview(t("preview.empty"));
        }
      } else {
        setPreview(content.slice(0, 5000));
      }
      setPreviewName(file.name);
    } catch (e: any) {
      const msg = typeof e === "string" ? e : e?.message || "Unknown error";
      setPreview(msg);
      setPreviewName(file.name);
    }
  };

  const handleDeleteFile = async (file: FileInfo) => {
    try {
      await invoke("delete_file", { path: file.path });
      await loadFiles();
      if (previewName === file.name) {
        setPreview(null);
        setPreviewName("");
      }
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  const handleResetProject = async () => {
    if (!currentProject) return;
    try {
      await invoke("clear_project_data", { projectId: currentProject.id });
    } catch (e) {
      console.error("Clear project data failed:", e);
    }
    setRawFiles([]);
    setCleanedFiles([]);
    setDatasetVersions([]);
    setDatasetPage(0);
    setExpandedDataset(null);
    setPreview(null);
    setPreviewName("");
    setSegmentPreview(null);
    setPreviewTab("data");
    useGenerationStore.getState().resetForm();
    useGenerationStore.getState().resetGeneration();
    setShowResetDialog(false);
  };

  const handleClearAllFiles = async () => {
    if (!currentProject || rawFiles.length === 0) return;
    try {
      for (const f of rawFiles) {
        await invoke("delete_file", { path: f.path });
      }
      await loadFiles();
      setFilePage(0);
      setPreview(null);
      setPreviewName("");
      setShowClearAllDialog(false);
    } catch (e) {
      console.error("Clear all failed:", e);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getQualityGradeTone = (grade?: string) => {
    const g = (grade || "").toUpperCase();
    if (g === "A") return "bg-success/15 text-success border-success/30";
    if (g === "B") return "bg-warning/15 text-warning border-warning/30";
    if (g === "C") return "bg-destructive/15 text-destructive border-destructive/30";
    return "bg-muted text-muted-foreground border-border";
  };

  const handleRetryFailed = async (version: string) => {
    if (!currentProject || retryingVersion || generating || cleaning) return;
    if (!acquireTask(currentProject.id, currentProject.name, "generating")) return;

    setRetryingVersion(version);
    setPipelineStage("generating");
    setPreviewTab("data"); // Ensure preview tab is active during generation to avoid panel collapse
    const store = useGenerationStore.getState();
    store.clearLogs();
    store.startGeneration();

    try {
      await invoke("generate_dataset", {
        projectId: currentProject.id,
        model: "",
        mode: "",
        source: "",
        resume: false,
        lang: i18nGlobal.language,
        qualityScoring: enableQualityScoring,
        retryFailedOnly: true,
        retryVersion: version,
      });
    } catch (e) {
      useGenerationStore.setState({
        generating: false,
        genProgress: "",
        genError: String(e),
      });
      setPipelineStage("idle");
      useTaskStore.getState().releaseTask();
    } finally {
      setRetryingVersion(null);
    }
  };

  if (!currentProject) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("selectProject")}</p>
        <div className="space-y-2">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setCurrentProject(p)}
              className="flex w-full items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent/50"
            >
              <FolderOpen size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{p.name}</span>
            </button>
          ))}
          {projects.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("files.emptyHint")}</p>
          )}
        </div>
      </div>
    );
  }

  // Collapsible step states
  const [step1Open, setStep1Open] = useState(true);
  const [step2Open, setStep2Open] = useState(false);
  const [step3Open, setStep3Open] = useState(false);

  // Auto-expand 1.2 and 1.3 when 1.1 is complete (files added or loaded)
  useEffect(() => {
    if (rawFiles.length > 0) {
      setStep2Open(true);
      setStep3Open(true);
    }
  }, [rawFiles.length]);

  const methodDone = genSource === "builtin" || ((genSource === "ollama" || genSource === "lmstudio") && !!genModel);
  const typeDone = !!genMode;

  const dataPrepSubSteps = [
    { key: "add", label: t("step.add"), done: rawFiles.length > 0 },
    { key: "method", label: t("step.method"), done: methodDone },
    { key: "type", label: t("step.type"), done: typeDone },
    { key: "segment", label: t("step.segment"), done: (segmentPreview?.summary.total_segments || 0) > 0 },
    { key: "generating", label: t("step.generating"), done: false, active: pipelineStage === "generating" || generating || pipelineStage === "cleaning" },
    { key: "done", label: t("step.done"), done: datasetVersions.length > 0 && !generating },
  ].filter((s) => s.active || s.done || s.key !== "generating");

  const segmentMaxChars = Math.max(segmentPreview?.summary.max_chars || 1, 1);
  const segmentFilteredItems = (previewName && segmentPreview)
    ? segmentPreview.items.filter(item => !item.source_file || item.source_file === previewName)
    : (segmentPreview?.items ?? []);

  return (
    <div className="space-y-4">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">{t("pageTitle")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {currentProject.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowResetDialog(true)}
            disabled={generating || cleaning}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Trash2 size={14} />
            {tc("clearAll")}
          </button>
          <button
            onClick={() => invoke("open_project_folder", { projectId: currentProject.id })}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={tc("openFinderTitle")}
          >
            <FolderOpen size={12} />
            {tc("openFolder")}
          </button>
        </div>
      </div>

      {/* Unified Step Progress */}
      <StepProgress subSteps={dataPrepSubSteps} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 items-start">
        {/* File Lists */}
        <div className="space-y-4">
          {/* 1.1 Select raw data files - collapsible card with drag-drop */}
          <div ref={sectionStep1Ref} className="relative rounded-lg border border-border bg-card shadow-sm transition-all duration-300">
            {/* Drag-and-drop overlay */}
            {isDragging && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3"><Upload size={24} /></div>
                <p className="text-base font-semibold text-foreground">
                  {dragFileCount > 0 ? t("dropZone.dropping", { count: dragFileCount }) : t("dropZone.hint")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("dropZone.supportedFormats")}
                </p>
              </div>
            )}
            
            <button
              onClick={() => setStep1Open(!step1Open)}
              className="flex w-full items-center justify-between p-4 bg-muted/30 hover:bg-muted/50 transition-colors rounded-t-lg"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
                    {step1Open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="flex items-center gap-1.5">
                      {rawFiles.length > 0 ? <CheckCircle2 size={20} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={20} className="text-muted-foreground/30" />}
                      1.1 {t("section.selectFiles")}
                      {rawFiles.length > 0 && <span className="ml-1 text-muted-foreground font-normal text-xs">({rawFiles.length})</span>}
                      {validationHint === "validation.needFiles" && (
                        <span className="ml-2 animate-pulse rounded bg-destructive/90 px-2 py-0.5 text-[0.6875rem] font-medium text-destructive-foreground">{t(validationHint)}</span>
                      )}
                      <Info size={13} className="text-muted-foreground/50" />
                    </span>
                  </h3>
                </TooltipTrigger>
                <TooltipContent className="max-w-[450px]">{t("section.selectFilesHint")}</TooltipContent>
              </Tooltip>
            </button>
            {step1Open && (
              <div ref={dropZoneRef} className="border-t border-border p-4 space-y-4">
                {rawFiles.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 py-8 text-center transition-colors hover:border-primary/50 hover:bg-primary/5">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Upload size={18} /></div>
                    <p className="mb-1 text-sm font-medium text-foreground">{t("dropZone.hint")}</p>
                    <p className="mb-5 text-xs text-muted-foreground">{t("dropZone.supportedFormats")}</p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={handleImport}
                        disabled={importing}
                        className="flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
                      >
                        <Upload size={14} />
                        {t("import.button")}
                      </button>
                      <button
                        onClick={handleImportFolder}
                        disabled={importing}
                        className="flex items-center gap-1.5 rounded-md border border-input bg-background px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        <FolderOpen size={14} />
                        {t("selectFolder")}
                      </button>
                    </div>
                  </div>
                ) : (cleaning || generating) && genFiles.length > 0 ? (
                  /* ─── Queue view: replaces static list during generation ─── */
                  <div className="space-y-1.5">
                    {/* Collapsed summary row — always visible */}
                    <button
                      onClick={() => setQueueExpanded(!queueExpanded)}
                      className="flex w-full items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-left transition-colors hover:bg-primary/10"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
                        <span className="truncate text-xs font-medium text-foreground">
                          {cleaning ? t("generate.cleaningStatus") : (genFiles[genCurrentFileIdx]?.name ?? genFiles[0]?.name ?? "...")}
                        </span>
                        {!cleaning && genTotal > 0 && (
                          <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                            {genStep}/{genTotal} {t("queue.segUnit")}
                            {genProgress && ` · ${genProgress}`}
                          </span>
                        )}
                      </span>
                      {queueExpanded ? <ChevronDown size={13} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={13} className="shrink-0 text-muted-foreground" />}
                    </button>

                    {/* Expanded file queue list */}
                    {queueExpanded && (
                      <div className="max-h-52 overflow-y-auto rounded-md border border-border space-y-px">
                        {genFiles.map((f, idx) => {
                          const isDone = idx < genCurrentFileIdx;
                          const isActive = idx === genCurrentFileIdx && !cleaning;
                          return (
                            <div
                              key={f.name}
                              className={`flex items-center gap-2 px-3 py-2 text-xs ${
                                isActive ? "bg-primary/5" : isDone ? "bg-muted/30" : ""
                              }`}
                            >
                              {isDone ? (
                                <CheckCircle2 size={13} className="shrink-0 text-success" />
                              ) : isActive ? (
                                <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                              ) : (
                                <Circle size={13} className="shrink-0 text-muted-foreground/60" />
                              )}
                              <span className={`truncate ${isActive ? "font-medium text-foreground" : isDone ? "text-muted-foreground" : "text-muted-foreground/80"}`}>
                                {f.name}
                              </span>
                              <span className="ml-auto shrink-0 text-[0.625rem] text-muted-foreground">
                                {formatSize(f.sizeBytes)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {/* Paginated file list */}
                    {rawFiles.slice(filePage * FILES_PER_PAGE, (filePage + 1) * FILES_PER_PAGE).map((f) => (
                      <div
                        key={f.path}
                        onClick={() => handlePreview(f)}
                        className={`group flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer transition-colors ${previewName === f.name ? "border-primary/40 bg-primary/5" : "border-border hover:border-border/80 hover:bg-muted/30"}`}
                      >
                        <div className="flex items-center gap-2 text-left text-sm text-foreground group-hover:text-primary">
                          <Eye size={14} className="text-muted-foreground" />
                          <span className="truncate max-w-48">{f.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatSize(f.size_bytes)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {pipelineStage === "idle" && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteFile(f); }}
                              className="p-1 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {/* Pagination controls */}
                    {rawFiles.length > FILES_PER_PAGE && (
                      <div className="flex items-center justify-between pt-1.5">
                        <button
                          onClick={() => setFilePage(Math.max(0, filePage - 1))}
                          disabled={filePage === 0}
                          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <span className="text-[0.6875rem] text-muted-foreground">
                          {t("filePage", { current: filePage + 1, total: Math.ceil(rawFiles.length / FILES_PER_PAGE) })}
                        </span>
                        <button
                          onClick={() => setFilePage(Math.min(Math.ceil(rawFiles.length / FILES_PER_PAGE) - 1, filePage + 1))}
                          disabled={filePage >= Math.ceil(rawFiles.length / FILES_PER_PAGE) - 1}
                          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"
                        >
                          <ChevronRight size={12} />
                        </button>
                      </div>
                    )}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={handleImport}
                          disabled={importing}
                          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
                        >
                          <Upload size={12} />
                          {t("addFile")}
                        </button>
                        <button
                          onClick={handleImportFolder}
                          disabled={importing}
                          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
                        >
                          <FolderOpen size={12} />
                          {t("addFolder")}
                        </button>
                        {rawFiles.length > 1 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowClearAllDialog(true); }}
                            disabled={cleaning || generating}
                            className="flex items-center gap-1 rounded-md bg-destructive px-2.5 py-1.5 text-[0.6875rem] font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                          >
                            {t("clearAll")}
                          </button>
                        )}
                      </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 1.2 Generation method + 1.3 Generation type + Generate - collapsible card */}
            <div ref={sectionStep2Ref} className="rounded-lg border border-border bg-card shadow-sm transition-all duration-300">
            <button
              onClick={() => setStep2Open(!step2Open)}
              className="flex w-full items-center justify-between p-4 bg-muted/30 hover:bg-muted/50 transition-colors rounded-t-lg"
            >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
                      {step2Open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <span className="flex items-center gap-1.5">
                        {methodDone ? <CheckCircle2 size={20} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={20} className="text-muted-foreground/30" />}
                        1.2 {t("section.genMethod")}
                        {(validationHint === "validation.needModel" || validationHint === "validation.needMode") && (
                          <span className="ml-2 animate-pulse rounded bg-destructive/90 px-2 py-0.5 text-[0.6875rem] font-medium text-destructive-foreground">{t(validationHint)}</span>
                        )}
                        <Info size={13} className="text-muted-foreground/50" />
                      </span>
                    </h3>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[450px]">{t("section.genMethodHint")}</TooltipContent>
                </Tooltip>
                {!step2Open && (
                  <span className="text-xs text-muted-foreground">
                    {genSource === "ollama" ? t("generate.source_ollama") : genSource === "lmstudio" ? t("generate.source_lmstudio") : t("generate.source_builtin")}
                  </span>
                )}
              </button>
              {step2Open && (
                <div className="border-t border-border p-4 space-y-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setGenSource("ollama")}
                      disabled={generating}
                      className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                        genSource === "ollama"
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-input bg-background text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {t("generate.source_ollama")}
                    </button>
                    <button
                      onClick={() => setGenSource("lmstudio")}
                      disabled={generating}
                      className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                        genSource === "lmstudio"
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-input bg-background text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {t("generate.source_lmstudio")}
                    </button>
                    <button
                      onClick={() => setGenSource("builtin")}
                      disabled={generating}
                      className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                        genSource === "builtin"
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-input bg-background text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {t("generate.source_builtin")}
                    </button>
                  </div>

                  {genSource === "lmstudio" && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-1">
                        <p className="text-xs text-muted-foreground">{t("generate.lmstudioHint")}</p>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info size={12} className="text-muted-foreground/50 cursor-default shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[360px]">{t("generate.lmstudioScanGuide")}</TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="pt-1">
                        {genModel && (
                          <div className="mb-2 flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                            <span className="truncate text-sm font-medium text-foreground">{genModel}</span>
                            {!generating && (
                              <button onClick={() => setGenModel("")} className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        )}
                        {!genModel && !generating && (
                          <ModelSelector
                            mode="dataprep"
                            selectedModel={genModel}
                            onSelect={(modelId) => setGenModel(modelId)}
                            defaultOpen={true}
                            disabled={generating}
                            projectId={currentProject?.id}
                            source="lmstudio"
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {genSource === "ollama" && (
                    <div className="space-y-3">
                      {ollamaReady === false ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
                            <AlertTriangle size={14} className="shrink-0" />
                            <span>{t("generate.noOllama")}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{t("generate.installOllamaHint")}</p>
                          <button
                            onClick={() => navigate("/settings")}
                            className="flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                          >
                            <Settings size={14} />
                            {t("generate.envCheck")}
                          </button>
                        </div>
                      ) : (
                        <div className="pt-1">
                          {genModel && (
                            <div className="mb-2 flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                              <span className="truncate text-sm font-medium text-foreground">{genModel}</span>
                              {!generating && (
                                <button onClick={() => setGenModel("")} className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                          )}
                          {!genModel && !generating && (
                            <ModelSelector
                              mode="dataprep"
                              selectedModel={genModel}
                              onSelect={(modelId) => setGenModel(modelId)}
                              defaultOpen={true}
                              disabled={generating}
                              projectId={currentProject?.id}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}
            </div>

          <div className="rounded-lg border border-border bg-card shadow-sm transition-all duration-300">
            <button
              onClick={() => setStep3Open(!step3Open)}
              className="flex w-full items-center justify-between p-4 bg-muted/30 hover:bg-muted/50 transition-colors rounded-t-lg"
            >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
                      {step3Open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <span className="flex items-center gap-1.5">
                        {typeDone ? <CheckCircle2 size={20} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={20} className="text-muted-foreground/30" />}
                        1.3 {t("section.genType")}
                        <Info size={13} className="text-muted-foreground/50" />
                      </span>
                    </h3>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[450px]">{t("section.genTypeHint")}</TooltipContent>
                </Tooltip>
              </button>
              {step3Open && (
                <div className="border-t border-border p-4 space-y-3">
                  {/* Content-based mode detection hint */}
                  {rawFiles.length > 0 && modeCapabilityReady.current && (
                    <p className="text-[0.6875rem] text-muted-foreground leading-relaxed">{t(modeCapability.hintKey)}</p>
                  )}
                  <div className="flex gap-2">
                    {(["qa", "style", "chat", "instruct"] as const).map((m) => {
                      const st = modeCapability.status[m];
                      return (
                        <button
                          key={m}
                          onClick={() => setGenMode(m)}
                          disabled={generating}
                          className={`relative flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                            genMode === m
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          {MODE_LABELS[m]}
                          {/* Badge icon in top-right corner: recommended/cautious only */}
                          {rawFiles.length > 0 && modeCapabilityReady.current && st !== "available" && (
                            <span className={`absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[8px] ${
                              st === "recommended"
                                ? "bg-success text-success-foreground"
                                : "bg-warning text-warning-foreground"
                            }`}>
                              {st === "recommended" ? <Check size={9} /> : <AlertCircle size={9} />}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {genMode && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t(`generate.mode_${genMode}_desc`)}
                    </p>
                  )}
                </div>
              )}
            </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-3 shadow-sm transition-all duration-300">
                  {/* Advanced Settings */}
                  <div className="rounded-md border border-border/60">
                    <button
                      onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                      className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium transition-colors hover:bg-accent/50"
                    >
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Settings size={12} />
                        {t("generate.advancedSettings")}
                      </span>
                      {showAdvancedSettings ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
                    </button>
                    {showAdvancedSettings && (
                      <div className="border-t border-border/50 p-3 space-y-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <label className="flex items-center justify-between gap-2 text-xs cursor-default">
                              <div className="flex items-center gap-2">
                                <input type="checkbox" className="h-3.5 w-3.5 rounded border-border" checked={enablePrivacyFilter} onChange={(e) => setEnablePrivacyFilter(e.target.checked)} disabled={generating || cleaning} />
                                <span className="text-foreground">{t("generate.privacyFilter")}</span>
                                <Info size={12} className="text-muted-foreground" />
                              </div>
                            </label>
                          </TooltipTrigger>
                          <TooltipContent>{t("generate.privacyFilterHint")}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <label className="flex items-center justify-between gap-2 text-xs cursor-default">
                              <div className="flex items-center gap-2">
                                <input type="checkbox" className="h-3.5 w-3.5 rounded border-border" checked={enableFuzzyDedup} onChange={(e) => setEnableFuzzyDedup(e.target.checked)} disabled={generating || cleaning} />
                                <span className="text-foreground">{t("generate.fuzzyDedup")}</span>
                                <Info size={12} className="text-muted-foreground" />
                              </div>
                            </label>
                          </TooltipTrigger>
                          <TooltipContent>{t("generate.fuzzyDedupHint")}</TooltipContent>
                        </Tooltip>
                        {enableFuzzyDedup && (
                          <div className="space-y-1 pl-6">
                            <div className="flex items-center justify-between text-[0.6875rem] text-muted-foreground">
                              <span>{t("generate.fuzzyThreshold")}</span>
                              <span>{fuzzyDedupThreshold.toFixed(2)}</span>
                            </div>
                            <input type="range" min={0.5} max={1.0} step={0.05} value={fuzzyDedupThreshold} onChange={(e) => setFuzzyDedupThreshold(Number(e.target.value))} disabled={generating || cleaning} className="w-full" />
                          </div>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <label className="flex items-center justify-between gap-2 text-xs cursor-default">
                              <div className="flex items-center gap-2">
                                <input type="checkbox" className="h-3.5 w-3.5 rounded border-border" checked={enableQualityScoring} onChange={(e) => setEnableQualityScoring(e.target.checked)} disabled={generating || cleaning} />
                                <span className="text-foreground">{t("generate.qualityScoring")}</span>
                                <Info size={12} className="text-muted-foreground" />
                              </div>
                            </label>
                          </TooltipTrigger>
                          <TooltipContent>{t("generate.qualityScoringHint")}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <label className="flex items-center justify-between gap-2 text-xs cursor-default">
                              <div className="flex items-center gap-2">
                                <input type="checkbox" className="h-3.5 w-3.5 rounded border-border" checked={autoSegment} onChange={(e) => setAutoSegment(e.target.checked)} disabled={generating || cleaning} />
                                <span className="text-foreground">{t("autoSegment.label")}</span>
                                <Info size={12} className="text-muted-foreground" />
                              </div>
                            </label>
                          </TooltipTrigger>
                          <TooltipContent>{t("autoSegment.hint")}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <label className="flex items-center justify-between gap-2 text-xs cursor-default">
                              <div className="flex items-center gap-2">
                                <input type="checkbox" className="h-3.5 w-3.5 rounded border-border" checked={mergeMode} onChange={(e) => setMergeMode(e.target.checked)} disabled={generating || cleaning} />
                                <span className="text-foreground">{t("mergeToggle.label")}</span>
                                <Info size={12} className="text-muted-foreground" />
                              </div>
                            </label>
                          </TooltipTrigger>
                          <TooltipContent>{t("mergeToggle.hint")}</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </div>

                  {/* Generate / Stop Buttons */}
                  {generating || cleaning ? (
                    <button
                      onClick={handleStop}
                      disabled={cleaning}
                      className="flex w-full items-center justify-center gap-2 rounded-md bg-destructive px-3 py-2.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                    >
                      <Square size={14} />
                      {cleaning ? t("generate.cleaningStatus") : t("generate.stopGeneration")}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleStartWithValidation}
                        className={`flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                          !genMode || ((genSource === "ollama" || genSource === "lmstudio") && !genModel.trim()) || rawFiles.length === 0 || !taskCheck.allowed
                            ? "bg-primary/50 text-primary-foreground/70 cursor-not-allowed"
                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                        }`}
                      >
                        <Play size={14} />
                        {t("generate.button")}
                      </button>
                      {!taskCheck.allowed && (
                        <p className="text-xs text-warning">{getTaskLockHint(taskCheck.reason)}</p>
                      )}
                    </>
                  )}

                  {genError && !ollamaPathMismatch && (
                    <p className="text-xs text-red-400">{genError}</p>
                  )}
                  {ollamaPathMismatch && (
                    <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                      <div className="flex items-center gap-1.5 font-semibold text-amber-400 mb-1">
                        <AlertTriangle size={13} />
                        {t("ollamaPathMismatch.title")}
                      </div>
                      <p className="text-muted-foreground mb-2">{t("ollamaPathMismatch.desc")}</p>
                      <p className="text-muted-foreground mb-1">{t("ollamaPathMismatch.terminalHint")}</p>
                      <pre className="rounded bg-muted/60 px-2 py-1.5 font-mono text-[0.6875rem] text-foreground select-all mb-2 overflow-x-auto whitespace-pre">{t("ollamaPathMismatch.commandExample")}</pre>
                      {autoFixMsg ? (
                        <p className={`text-[0.6875rem] ${autoFixOk ? "text-success" : "text-red-400"}`}>{autoFixMsg}</p>
                      ) : (
                        <button
                          onClick={handleAutoFixOllamaPath}
                          disabled={autoFixing}
                          className="mt-1 rounded-md border border-amber-500/50 bg-amber-500/20 px-3 py-1.5 text-[0.6875rem] font-medium text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                        >
                          {autoFixing ? t("ollamaPathMismatch.autoFixing") : t("ollamaPathMismatch.autoFix")}
                        </button>
                      )}
                    </div>
                  )}
            </div>

        </div>

        {/* Preview Panel / AI Log Panel — outer border aligned with left 1.1 card */}
        <div ref={previewPanelRef} className="sticky top-4 space-y-4">
          <div className="rounded-lg border border-border bg-card shadow-sm transition-all duration-300">
            {/* ─── Tab header: Data Preview / Smart Segmentation ─── */}
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-t-lg border-b border-border/50">
              <div className="flex items-center gap-1">
                {/* During generation, only show data tab; otherwise show both */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setPreviewTab("data")}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        (generating || cleaning || previewTab === "data")
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                    >
                      {t("previewTab.data")}
                      {generating && <span className="ml-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-success" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[450px]">{t("previewTab.dataHint")}</TooltipContent>
                </Tooltip>
                {!generating && !cleaning && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setPreviewTab("segment")}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          previewTab === "segment"
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent"
                        }`}
                      >
                        {t("previewTab.segment")}
                        {segmentPreview && segmentPreview.summary.total_segments > 0 && (
                          <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[0.625rem] font-medium text-primary">
                            {previewName
                              ? segmentPreview.items.filter(i => !i.source_file || i.source_file === previewName).length
                              : segmentPreview.summary.total_segments}
                          </span>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[450px]">{t("previewTab.segmentHint")}</TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="flex items-center gap-2">
                {previewTab === "data" && !generating && aiLogs.length > 0 && (
                  <button
                    onClick={() => clearLogs()}
                    className="text-[0.6875rem] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {tc("clearLogs")}
                  </button>
                )}
              </div>
            </div>
            <div className="px-4 pb-4 pt-0">
              {/* ─── Data Preview tab content ─── */}
              {(generating || cleaning || previewTab === "data") && (
                <div ref={logScrollRef} className="log-scroll-container h-[480px] overflow-auto rounded-md border border-border bg-background p-3 mt-3">
                  {(generating || aiLogs.length > 0) ? (
                    <div className="space-y-0.5 font-mono text-xs leading-loose">
                      {aiLogs.length === 0 && generating && (
                        <p className="text-muted-foreground">{t("connectingAI")}</p>
                      )}
                      {aiLogs.map((log, idx) => (
                        <p
                          key={idx}
                          className={`whitespace-pre-wrap ${
                            log.includes("✅") ? "text-success" :
                            log.includes("❌") ? "text-red-400" :
                            log.includes("⚠️") ? "text-warning" :
                            log.includes("🤖") ? "text-info" :
                            log.includes("📡") || log.includes("💾") ? "text-tag-trained" :
                            log.includes("──") || log.includes("══") ? "text-muted-foreground font-semibold" :
                            "text-foreground"
                          }`}
                        >
                          {log}
                        </p>
                      ))}
                      <div ref={logEndRef} />
                    </div>
                  ) : preview ? (
                    <pre className="whitespace-pre-wrap text-xs text-foreground font-mono leading-relaxed">
                      {preview}
                    </pre>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-center">
                      <p className="text-sm font-medium text-foreground">{t("preview.noContent")}</p>
                    </div>
                  )}
                </div>
              )}
              {/* ─── Smart Segmentation tab content ─── */}
              {!generating && !cleaning && previewTab === "segment" && (
                <div className="h-[480px] overflow-auto rounded-md border border-border bg-background p-3 mt-3">
                  {segmentPreviewLoading ? (
                    <div className="flex h-full items-center justify-center">
                      <p className="text-sm text-muted-foreground animate-pulse">{t("segment.loading")}</p>
                    </div>
                  ) : segmentPreview && segmentPreview.summary.total_segments > 0 ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-md border border-border bg-card/60 px-3 py-2">
                          <p className="text-xs text-muted-foreground">{t("segment.summary.total")}</p>
                          <p className="mt-0.5 text-base font-semibold text-foreground">
                            {previewName
                              ? segmentPreview.items.filter(i => !i.source_file || i.source_file === previewName).length
                              : segmentPreview.summary.total_segments}
                          </p>
                        </div>
                        <div className="rounded-md border border-border bg-card/60 px-3 py-2">
                          <p className="text-xs text-muted-foreground">{t("segment.summary.avg")}</p>
                          <p className="mt-0.5 text-base font-semibold text-foreground">
                            {previewName
                              ? (() => {
                                  const items = segmentPreview.items.filter(i => !i.source_file || i.source_file === previewName);
                                  return items.length > 0
                                    ? Math.round(items.reduce((acc, curr) => acc + curr.char_count, 0) / items.length)
                                    : 0;
                                })()
                              : segmentPreview.summary.avg_chars}
                          </p>
                        </div>
                        <div className="rounded-md border border-border bg-card/60 px-3 py-2">
                          <p className="text-xs text-muted-foreground">{t("segment.summary.range")}</p>
                          <p className="mt-0.5 text-sm font-medium text-foreground">
                            {previewName
                              ? (() => {
                                  const items = segmentPreview.items.filter(i => !i.source_file || i.source_file === previewName);
                                  if (items.length === 0) return "0 - 0";
                                  const chars = items.map(i => i.char_count);
                                  return `${Math.min(...chars)} - ${Math.max(...chars)}`;
                                })()
                              : `${segmentPreview.summary.min_chars} - ${segmentPreview.summary.max_chars}`}
                          </p>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="rounded-md border border-border bg-card/60 px-3 py-2 flex flex-col justify-center cursor-default">
                              <p className="text-[0.6875rem] text-muted-foreground">{t("segment.summary.strategy")}</p>
                              <p className="mt-0.5 text-xs font-medium text-foreground leading-tight">
                                {getStrategyLabel(segmentPreview.summary.primary_strategy || "paragraph_balanced")}
                              </p>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[450px]">{t("segment.summary.strategyHint")}</TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="space-y-2">
                        {segmentFilteredItems.map((item) => (
                          <div key={`${item.id}-${item.source_file}`} className="rounded-md border border-border bg-card/60 px-3 py-2.5">
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-foreground">{t("segment.itemLabel", { id: item.id })}</span>
                              <span className="text-xs text-muted-foreground">{t("segment.chars", { count: item.char_count })} · {t("segment.lines", { count: item.line_count })}</span>
                            </div>
                            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(8, Math.round((item.char_count / segmentMaxChars) * 100))}%` }} />
                            </div>
                            <p className="line-clamp-3 text-sm leading-relaxed text-foreground/80">{item.text_preview}</p>
                            {item.source_file && (
                              <p className="mt-1.5 text-xs text-muted-foreground/70">{t("segment.source", { name: item.source_file })}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {t("segment.empty")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ─── Generation stats panel (below preview card, during generation) ─── */}
          {generating && genFiles.length > 0 && (
            <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-2">
              {/* Row 1: current file name */}
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
                <span className="truncate text-xs font-medium text-foreground">
                  {genFiles[genCurrentFileIdx]?.name ?? genFiles[0]?.name}
                </span>
              </div>
              {/* Row 2: stats */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem] text-muted-foreground">
                <span>
                  {t("stats.fileIndex", { current: genCurrentFileIdx + 1, total: genFiles.length })}
                </span>
                <span className="text-border">·</span>
                <span>
                  {t("stats.generated", { success: genSuccessCount, total: genTotal })}
                </span>
                <span className="text-border">·</span>
                <span className={`font-medium ${
                  genSuccessCount + genFailCount > 0 && (genSuccessCount / (genSuccessCount + genFailCount)) < 0.5
                    ? "text-destructive"
                    : genSuccessCount + genFailCount > 0
                    ? "text-success"
                    : ""
                }`}>
                  {t("stats.successRate", {
                    rate: genSuccessCount + genFailCount > 0
                      ? Math.round((genSuccessCount / (genSuccessCount + genFailCount)) * 100)
                      : 100
                  })}
                </span>
              </div>
            </div>
          )}

          {/* ─── Generated Datasets Panel ─── */}
          {datasetVersions.length > 0 && (
            <div ref={datasetSectionRef} className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between p-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground cursor-default">
                      <CheckCircle2 size={16} className="text-success" />
                      {t("section.datasets")}
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[0.625rem] font-medium text-success">{datasetVersions.length}</span>
                      <Info size={13} className="text-muted-foreground/50" />
                    </h3>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[450px]">{t("section.datasetsHint")}</TooltipContent>
                </Tooltip>
                <button
                  onClick={() => invoke("open_dataset_folder", { projectId: currentProject?.id })}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <FolderOpen size={12} />
                  {tc("openFolder")}
                </button>
              </div>
              <div className="border-t border-border p-4 space-y-2">
                <div className="space-y-1">
                  {(() => {
                    const totalPages = Math.ceil(datasetVersions.length / DATASETS_PER_PAGE);
                    const paged = datasetVersions.slice(datasetPage * DATASETS_PER_PAGE, (datasetPage + 1) * DATASETS_PER_PAGE);
                    return (
                      <>
                        {paged.map((v) => {
                          const isNew = newVersionIds.includes(v.version);
                          const isExpanded = expandedDataset === v.version;
                          return (
                            <div key={v.version} className="rounded-md border border-border text-xs">
                              <button
                                onClick={() => setExpandedDataset(isExpanded ? null : v.version)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/30 transition-colors"
                              >
                                {isExpanded ? <ChevronDown size={12} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={12} className="shrink-0 text-muted-foreground" />}
                                <CheckCircle2 size={14} className="shrink-0 text-success" />
                                <span className="shrink-0 whitespace-nowrap font-medium text-foreground">{v.version === "legacy" ? t("dataset.legacy") : v.created}</span>
                                {isNew && <span className="rounded-sm bg-success/15 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-success">{t("dataset.new")}</span>}
                                {v.quality_scoring_enabled && v.quality_grade && (
                                  <span className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-bold leading-none ${getQualityGradeTone(v.quality_grade)}`}>{`Q-${v.quality_grade.toUpperCase()}`}</span>
                                )}
                                {v.failed_count > 0 && (
                                  <span className="rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium leading-none text-warning">{t("dataset.failedCount", { count: v.failed_count })}</span>
                                )}
                                <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground/60">{formatSize(v.train_size + v.valid_size)}</span>
                              </button>
                              {isExpanded && (
                                <div className="border-t border-border/50 bg-muted/10 px-4 py-2 space-y-1 text-[0.6875rem]">
                                  <div className="flex gap-2"><span className="shrink-0 text-muted-foreground">{t("dataset.trainSet")}:</span><span className="text-foreground">{t("dataset.samples", { count: v.train_count })}</span></div>
                                  <div className="flex gap-2"><span className="shrink-0 text-muted-foreground">{t("dataset.validSet")}:</span><span className="text-foreground">{t("dataset.samples", { count: v.valid_count })}</span></div>
                                  {v.raw_files.length > 0 && <div className="flex gap-2"><span className="shrink-0 text-muted-foreground">{t("dataset.sourceFiles")}:</span><span className="text-foreground">{v.raw_files.join(", ")}</span></div>}
                                  {v.mode && <div className="flex gap-2"><span className="shrink-0 text-muted-foreground">{t("dataset.genType")}:</span><span className="text-foreground">{MODE_LABELS[v.mode] || v.mode}</span></div>}
                                  {v.source && (
                                    <div className="flex gap-2">
                                      <span className="shrink-0 text-muted-foreground">{t("dataset.genMethod")}:</span>
                                      <span className="text-foreground">{v.source === "ollama" ? t("dataset.methodOllama", { model: v.model || "?" }) : v.source === "lmstudio" ? t("dataset.methodLmstudio", { model: v.model || "?" }) : t("dataset.methodBuiltin")}</span>
                                    </div>
                                  )}
                                  {v.quality_scoring_enabled && (
                                    <div className="flex items-center gap-2">
                                      <span className="shrink-0 text-muted-foreground">{t("dataset.quality")}:</span>
                                      <span className={`rounded-sm border px-1.5 py-0.5 text-[0.625rem] font-semibold leading-none ${getQualityGradeTone(v.quality_grade)}`}>{(v.quality_grade || "-").toUpperCase()}</span>
                                      {typeof v.quality_score === "number" && <span className="text-foreground">{t("dataset.qualityScore", { score: v.quality_score.toFixed(1) })}</span>}
                                    </div>
                                  )}
                                  {v.failed_count > 0 && (
                                    <div className="pt-1">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleRetryFailed(v.version); }}
                                        disabled={generating || cleaning || !!retryingVersion}
                                        className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[0.6875rem] font-medium text-warning transition-colors hover:bg-warning/15 disabled:opacity-50"
                                      >
                                        {retryingVersion === v.version ? t("dataset.retryingFailed") : t("dataset.retryFailed", { count: v.failed_count })}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {totalPages > 1 && (
                          <div className="flex items-center justify-between pt-1">
                            <button disabled={datasetPage === 0} onClick={() => setDatasetPage((p) => Math.max(0, p - 1))} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40">
                              <ChevronLeft size={12} />{t("dataset.prevPage")}
                            </button>
                            <span className="text-[0.6875rem] text-muted-foreground">{t("dataset.page", { current: datasetPage + 1, total: totalPages })}</span>
                            <button disabled={datasetPage >= totalPages - 1} onClick={() => setDatasetPage((p) => Math.min(totalPages - 1, p + 1))} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40">
                              {t("dataset.nextPage")}<ChevronRight size={12} />
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                <button
                  onClick={() => navigate("/training")}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2.5 text-sm font-medium text-success transition-colors hover:bg-success/20"
                >
                  {t("datasetReady")}
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== Training Queue Status (full width below main grid) ===== */}
      {trainingQueue.length > 0 && (() => {
        const queuedCount = trainingQueue.filter((j) => j.status === "queued").length;
        const hasFinished = trainingQueue.some((j) => j.status === "completed" || j.status === "failed");
        return (
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ListPlus size={15} />
                {tTrain("queue.title")}
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.625rem] font-medium text-primary">
                  {tTrain("queue.count", { count: queuedCount })}
                </span>
              </h3>
              <div className="flex items-center gap-2">
                {hasFinished && (
                  <button
                    onClick={() => clearTrainingQueue()}
                    className="text-[0.6875rem] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {tTrain("queue.clear")}
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              {trainingQueue.map((job, idx) => (
                <div
                  key={job.id}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${
                    job.status === "running"
                      ? "border-primary/30 bg-primary/5"
                      : job.status === "completed"
                      ? "border-success/30 bg-success/5"
                      : job.status === "failed"
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-border"
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="w-5 text-center text-[0.625rem] text-muted-foreground font-mono">#{idx + 1}</span>
                    <span className="font-medium text-foreground">{job.projectName}</span>
                    <span className="text-muted-foreground">
                      {(() => { try { const p = JSON.parse(job.params); return `${p.iters} iters · ${p.fine_tune_type}`; } catch { return ""; } })()}
                    </span>
                    {job.status === "running" && (
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[0.625rem] font-medium ${
                      job.status === "running" ? "bg-primary/10 text-primary" :
                      job.status === "completed" ? "bg-success/10 text-success" :
                      job.status === "failed" ? "bg-destructive/10 text-destructive" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {tTrain(`queue.status.${job.status}`)}
                    </span>
                    {job.status === "queued" && (
                      <button
                        onClick={() => removeFromQueue(job.id)}
                        className="p-0.5 text-muted-foreground hover:text-foreground"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="text-sm font-semibold text-foreground">{tc("confirmDeleteTitle")}</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              {tc("confirmDeleteMsg", { name: deleteConfirm.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={async () => {
                  try {
                    await invoke("delete_file", { path: deleteConfirm.path });
                    await loadFiles();
                    if (previewName === deleteConfirm.name) {
                      setPreview(null);
                      setPreviewName("");
                    }
                  } catch (e) {
                    console.error("Delete failed:", e);
                  }
                  setDeleteConfirm(null);
                }}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                {tc("confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Project Confirmation Dialog */}
      {showResetDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="text-sm font-semibold text-foreground">{tc("clearConfirmTitle")}</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              {tc("clearConfirmDataPrepMsg")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowResetDialog(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={handleResetProject}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                {tc("confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Confirmation Dialog */}
      {showClearAllDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="text-sm font-semibold text-foreground">{t("clearAll")}</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("clearAllConfirm", { count: rawFiles.length })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowClearAllDialog(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={handleClearAllFiles}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                {tc("confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
