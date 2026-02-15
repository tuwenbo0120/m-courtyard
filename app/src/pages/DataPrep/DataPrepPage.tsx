import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { Upload, Trash2, Eye, ArrowRight, FolderOpen, Square, Wand2, ChevronDown, ChevronRight, CheckCircle2, Circle, AlertTriangle, Settings, Check, AlertCircle, ChevronLeft } from "lucide-react";
import i18nGlobal from "@/i18n";
import { useNavigate } from "react-router-dom";
import { useProjectStore } from "@/stores/projectStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useTaskStore } from "@/stores/taskStore";
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
    if (/^\s*[\[{]/.test(text) && /[\]}]\s*$/.test(text.trim())) structuredScore += 3;
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
  const {
    generating, genProgress, genStep, genTotal, genError, aiLogs,
    initListeners, setReloadFiles, clearLogs, newVersionIds, setScrollToDatasets,
  } = useGenerationStore();
  const {
    formGenMode: genMode, formGenSource: genSource, formGenModel: genModel,
    setFormField,
  } = useGenerationStore();
  const setGenMode = (v: string) => setFormField("formGenMode", v);
  const setGenSource = (v: "ollama" | "builtin") => setFormField("formGenSource", v);
  const setGenModel = (v: string) => setFormField("formGenModel", v);
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
  const datasetSectionRef = useRef<HTMLDivElement>(null);
  const [datasetPage, setDatasetPage] = useState(0);
  const DATASETS_PER_PAGE = 10;
  const [expandedDataset, setExpandedDataset] = useState<string | null>(null);

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

  useEffect(() => {
    if (currentProject) {
      loadFiles();
    }
  }, [currentProject]);

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

  const loadFiles = async () => {
    if (!currentProject) return;
    try {
      const raw: FileInfo[] = await invoke("list_project_files", {
        projectId: currentProject.id,
        subdir: "raw",
      });
      const cleaned: FileInfo[] = await invoke("list_project_files", {
        projectId: currentProject.id,
        subdir: "cleaned",
      });
      const versions: DatasetVersionInfo[] = await invoke("list_dataset_versions", {
        projectId: currentProject.id,
      });
      setRawFiles(raw);
      setCleanedFiles(cleaned);
      setDatasetVersions(versions);
      setDatasetPage(0);
      setExpandedDataset(null);
      await loadSegmentPreview(currentProject.id);

      // Sample file content for mode detection
      if (raw.length > 0) {
        try {
          const samples: RawFileSample[] = await invoke("sample_raw_files", {
            projectId: currentProject.id,
          });
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
      setSegmentPreview(payload);
    } catch (e) {
      console.error("Failed to preview cleaned segments:", e);
      setSegmentPreview(null);
    } finally {
      setSegmentPreviewLoading(false);
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
    if (genSource === "ollama" && !genModel.trim()) {
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
    if (genSource === "ollama" && !genModel.trim()) return;
    // Check global task lock
    const check = taskCanStart(currentProject.id, "generating");
    if (!check.allowed) return;
    if (!acquireTask(currentProject.id, currentProject.name, "generating")) return;
    const store = useGenerationStore.getState();
    store.clearLogs();
    scrollToPreviewTop();
    // Stage 1: always clean first so generated dataset strictly matches current raw files
    setPipelineStage("cleaning");
    setCleaning(true);
    setCleanProgress(t("generate.cleaningStatus"));
    autoGenAfterClean.current = true;
    try {
      await invoke("start_cleaning", { projectId: currentProject.id, lang: i18nGlobal.language });
    } catch (e) {
      setCleaning(false);
      setPipelineStage("idle");
      setCleanProgress(String(e));
      autoGenAfterClean.current = false;
    }
  };

  const startGenerationStep = async () => {
    if (!currentProject) return;
    // Read form values from store to avoid stale closure (this fn is called from useEffect listener)
    const { formGenMode, formGenSource, formGenModel } = useGenerationStore.getState();
    if (!formGenMode) {
      useGenerationStore.setState({ genError: t("generate.noModeSelected") });
      setPipelineStage("idle");
      return;
    }
    setPipelineStage("generating");
    setDatasetPage(0);
    setExpandedDataset(null);
    const store = useGenerationStore.getState();
    store.startGeneration();
    try {
      await invoke("generate_dataset", {
        projectId: currentProject.id,
        model: formGenSource === "ollama" ? formGenModel : "",
        mode: formGenMode,
        source: formGenSource,
        resume: false,
        lang: i18nGlobal.language,
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
    setPipelineStage("idle");
  };


  // Reload files using the store's currentProject to avoid stale closures
  const reloadFiles = async () => {
    const proj = useProjectStore.getState().currentProject;
    if (!proj) return;
    try {
      const raw: FileInfo[] = await invoke("list_project_files", { projectId: proj.id, subdir: "raw" });
      const cleaned: FileInfo[] = await invoke("list_project_files", { projectId: proj.id, subdir: "cleaned" });
      const versions: DatasetVersionInfo[] = await invoke("list_dataset_versions", { projectId: proj.id });
      setRawFiles(raw);
      setCleanedFiles(cleaned);
      setDatasetVersions(versions);
      setDatasetPage(0);
      setExpandedDataset(null);
      await loadSegmentPreview(proj.id);
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
      setPreview(content.slice(0, 5000));
      setPreviewName(file.name);
    } catch (e) {
      console.error("Preview failed:", e);
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

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [step2Open, setStep2Open] = useState(true);
  const [step3Open, setStep3Open] = useState(true);

  const methodDone = genSource === "builtin" || (genSource === "ollama" && !!genModel);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {currentProject.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setRawFiles([]);
              setCleanedFiles([]);
              setDatasetVersions([]);
              setDatasetPage(0);
              setExpandedDataset(null);
              setPreview(null);
              setPreviewName("");
              setGenModel("");
              setGenMode("");
              useGenerationStore.getState().resetForm();
              useGenerationStore.getState().resetGeneration();
            }}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            <Trash2 size={14} />
            {tc("clearAll")}
          </button>
          <button
            onClick={() => invoke("open_project_folder", { projectId: currentProject.id })}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent"
            title={tc("openFinderTitle")}
          >
            <FolderOpen size={14} />
            {tc("openFolder")}
          </button>
        </div>
      </div>

      {/* Unified Step Progress */}
      <StepProgress subSteps={dataPrepSubSteps} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* File Lists */}
        <div className="space-y-4">
          {/* 1.1 Select raw data files - collapsible card */}
          <div ref={sectionStep1Ref} className="rounded-lg border border-border bg-card">
            <button
              onClick={() => setStep1Open(!step1Open)}
              className="flex w-full items-center justify-between p-4"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {step1Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="flex items-center gap-1.5">
                  {rawFiles.length > 0 ? <CheckCircle2 size={18} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
                  1.1 {t("section.selectFiles")} ({rawFiles.length})
                  {validationHint === "validation.needFiles" && (
                    <span className="ml-2 animate-pulse rounded bg-destructive/90 px-2 py-0.5 text-[11px] font-medium text-destructive-foreground">{t(validationHint)}</span>
                  )}
                </span>
              </h3>
            </button>
            {step1Open && (
              <div className="border-t border-border p-4 space-y-3">
                {rawFiles.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border py-6 text-center">
                    <p className="mb-3 text-xs text-muted-foreground">{t("files.empty")}</p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={handleImport}
                        disabled={importing}
                        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        <Upload size={14} />
                        {t("import.button")}
                      </button>
                      <button
                        onClick={handleImportFolder}
                        disabled={importing}
                        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        <FolderOpen size={14} />
                        {t("selectFolder")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {rawFiles.map((f) => (
                      <div
                        key={f.path}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                      >
                        <button
                          onClick={() => handlePreview(f)}
                          className="flex items-center gap-2 text-left text-sm text-foreground hover:text-primary"
                        >
                          <Eye size={14} className="text-muted-foreground" />
                          <span className="truncate max-w-48">{f.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatSize(f.size_bytes)}
                          </span>
                        </button>
                        <button
                          onClick={() => handleDeleteFile(f)}
                          className="p-1 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={handleImport}
                        disabled={importing}
                        className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        <Upload size={12} />
                        {t("addFile")}
                      </button>
                      <button
                        onClick={handleImportFolder}
                        disabled={importing}
                        className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        <FolderOpen size={12} />
                        {t("addFolder")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 1.2 Generation method + 1.3 Generation type + Generate - collapsible card */}
            <div ref={sectionStep2Ref} className="rounded-lg border border-border bg-card">
              <button
                onClick={() => setStep2Open(!step2Open)}
                className="flex w-full items-center justify-between p-4"
              >
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {step2Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="flex items-center gap-1.5">
                    {methodDone ? <CheckCircle2 size={18} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
                    1.2 {t("section.genMethod")}
                    {(validationHint === "validation.needModel" || validationHint === "validation.needMode") && (
                      <span className="ml-2 animate-pulse rounded bg-destructive/90 px-2 py-0.5 text-[11px] font-medium text-destructive-foreground">{t(validationHint)}</span>
                    )}
                  </span>
                </h3>
                {!step2Open && (
                  <span className="text-xs text-muted-foreground">
                    {genSource === "ollama" ? t("generate.source_ollama") : t("generate.source_builtin")}
                  </span>
                )}
              </button>
              {step2Open && (
                <div className="border-t border-border p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">{t("generate.hint")}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setGenSource("ollama")}
                      disabled={generating}
                      className={`flex-1 rounded-md border px-2 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                        genSource === "ollama"
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {t("generate.source_ollama")}
                    </button>
                    <button
                      onClick={() => setGenSource("builtin")}
                      disabled={generating}
                      className={`flex-1 rounded-md border px-2 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                        genSource === "builtin"
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {t("generate.source_builtin")}
                    </button>
                  </div>

                  {genSource === "ollama" && (
                    <div className="space-y-2">
                      {ollamaReady === false ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
                            <AlertTriangle size={14} className="shrink-0" />
                            <span>{t("generate.noOllama")}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{t("generate.installOllamaHint")}</p>
                          <button
                            onClick={() => navigate("/settings")}
                            className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-accent/50 px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                          >
                            <Settings size={14} />
                            {t("generate.envCheck")}
                          </button>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-blue-400">{t("generate.ollamaHint")}</p>
                          {genModel && (
                            <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                              <span className="font-medium text-foreground">{genModel}</span>
                            </div>
                          )}
                          <ModelSelector
                            mode="dataprep"
                            selectedModel={genModel}
                            onSelect={(modelId) => setGenModel(modelId)}
                            disabled={generating}
                            projectId={currentProject?.id}
                          />
                        </>
                      )}
                    </div>
                  )}
                  {genSource === "builtin" && (
                    <p className="text-xs text-warning">{t("generate.builtinHint")}</p>
                  )}

                  {/* 1.3 Generation type */}
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground pt-1">
                    <span className="flex items-center gap-1.5">
                      {typeDone ? <CheckCircle2 size={18} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
                      1.3 {t("section.genType")}
                    </span>
                  </h3>
                  {/* Content-based mode detection hint */}
                  {rawFiles.length > 0 && modeCapabilityReady.current && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{t(modeCapability.hintKey)}</p>
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

                  <div className="rounded-md border border-border/80 bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">{t("segment.title")}</p>
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-foreground">
                        {t("segment.strategyLabel", {
                          strategy: getStrategyLabel(segmentPreview?.summary.primary_strategy || "paragraph_balanced"),
                        })}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{t("segment.hint")}</p>

                    {segmentPreviewLoading ? (
                      <p className="text-xs text-muted-foreground">{t("segment.loading")}</p>
                    ) : !segmentPreview || segmentPreview.summary.total_segments === 0 ? (
                      <p className="text-xs text-muted-foreground">{t("segment.empty")}</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div className="rounded-md border border-border bg-card/60 px-2 py-1.5">
                            <p className="text-muted-foreground">{t("segment.summary.total")}</p>
                            <p className="font-medium text-foreground">{segmentPreview.summary.total_segments}</p>
                          </div>
                          <div className="rounded-md border border-border bg-card/60 px-2 py-1.5">
                            <p className="text-muted-foreground">{t("segment.summary.avg")}</p>
                            <p className="font-medium text-foreground">{segmentPreview.summary.avg_chars}</p>
                          </div>
                          <div className="rounded-md border border-border bg-card/60 px-2 py-1.5">
                            <p className="text-muted-foreground">{t("segment.summary.range")}</p>
                            <p className="font-medium text-foreground">{segmentPreview.summary.min_chars} - {segmentPreview.summary.max_chars}</p>
                          </div>
                          <div className="rounded-md border border-border bg-card/60 px-2 py-1.5">
                            <p className="text-muted-foreground">{t("segment.summary.tooShort")} / {t("segment.summary.tooLong")}</p>
                            <p className="font-medium text-foreground">{segmentPreview.summary.short_segments} / {segmentPreview.summary.long_segments}</p>
                          </div>
                        </div>

                        <div className="max-h-44 space-y-1.5 overflow-auto pr-1">
                          {segmentPreview.items.map((item) => (
                            <div key={`${item.id}-${item.source_file}`} className="rounded-md border border-border bg-card/60 px-2 py-1.5 text-[11px]">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="font-medium text-foreground">
                                  {t("segment.itemLabel", { id: item.id })}
                                </span>
                                <span className="text-muted-foreground">
                                  {t("segment.chars", { count: item.char_count })} · {t("segment.lines", { count: item.line_count })}
                                </span>
                              </div>
                              <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-primary/70"
                                  style={{ width: `${Math.max(8, Math.round((item.char_count / segmentMaxChars) * 100))}%` }}
                                />
                              </div>
                              <p className="line-clamp-2 text-muted-foreground">{item.text_preview}</p>
                              {item.source_file && (
                                <p className="mt-1 text-[10px] text-muted-foreground/90">
                                  {t("segment.source", { name: item.source_file })}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
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
                          !genMode || (genSource === "ollama" && !genModel.trim()) || rawFiles.length === 0 || !taskCheck.allowed
                            ? "bg-primary/50 text-primary-foreground/70 cursor-not-allowed"
                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                        }`}
                      >
                        <Wand2 size={14} />
                        {t("generate.button")}
                      </button>
                      {!taskCheck.allowed && (
                        <p className="text-xs text-warning">{getTaskLockHint(taskCheck.reason)}</p>
                      )}
                    </>
                  )}

                  {/* Progress Bar */}
                  {generating && genTotal > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{genProgress}</span>
                        <span>{Math.round((genStep / genTotal) * 100)}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${Math.round((genStep / genTotal) * 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("generate.progressLabel", { step: genStep, total: genTotal, percent: Math.round((genStep / genTotal) * 100) })}
                      </p>
                    </div>
                  )}
                  {generating && genTotal === 0 && genProgress && (
                    <p className="text-xs text-muted-foreground">{genProgress}</p>
                  )}
                  {genError && (
                    <p className="text-xs text-red-400">{genError}</p>
                  )}
                </div>
              )}
            </div>

          {/* 1.4 Generated datasets - collapsible card */}
          <div ref={datasetSectionRef} className="rounded-lg border border-border bg-card">
            <button
              onClick={() => setStep3Open(!step3Open)}
              className="flex w-full items-center justify-between p-4"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {step3Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="flex items-center gap-1.5">
                  {datasetVersions.length > 0 ? <CheckCircle2 size={18} className="text-success drop-shadow-[0_0_3px_var(--success-glow)]" /> : <Circle size={18} className="text-muted-foreground/30" />}
                  1.4 {t("section.datasets")} ({datasetVersions.length})
                </span>
              </h3>
              <button
                onClick={(e) => { e.stopPropagation(); invoke("open_dataset_folder", { projectId: currentProject?.id }); }}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
              >
                <FolderOpen size={12} />
                {tc("openFolder")}
              </button>
            </button>
            {step3Open && (
              <div className="border-t border-border p-4">
                {datasetVersions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border py-6 text-center">
                    <p className="text-xs text-muted-foreground">{t("dataset.noVersions")}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
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
                                    {isNew && (
                                      <span className="rounded-sm bg-success/15 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-success">
                                        {t("dataset.new")}
                                      </span>
                                    )}
                                    <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground/60">{formatSize(v.train_size + v.valid_size)}</span>
                                  </button>
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
                                      {v.raw_files.length > 0 && (
                                        <div className="flex gap-2">
                                          <span className="shrink-0 text-muted-foreground">{t("dataset.sourceFiles")}:</span>
                                          <span className="text-foreground">{v.raw_files.join(", ")}</span>
                                        </div>
                                      )}
                                      {v.mode && (
                                        <div className="flex gap-2">
                                          <span className="shrink-0 text-muted-foreground">{t("dataset.genType")}:</span>
                                          <span className="text-foreground">{MODE_LABELS[v.mode] || v.mode}</span>
                                        </div>
                                      )}
                                      {v.source && (
                                        <div className="flex gap-2">
                                          <span className="shrink-0 text-muted-foreground">{t("dataset.genMethod")}:</span>
                                          <span className="text-foreground">
                                            {v.source === "ollama" ? t("dataset.methodOllama", { model: v.model || "?" }) : t("dataset.methodBuiltin")}
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
                                <span className="text-[11px] text-muted-foreground">
                                  {t("dataset.page", { current: datasetPage + 1, total: totalPages })}
                                </span>
                                <button
                                  disabled={datasetPage >= totalPages - 1}
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
                    {/* Next Step: Go to Training */}
                    <button
                      onClick={() => navigate("/training")}
                      className="flex w-full items-center justify-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2.5 text-sm font-medium text-success transition-colors hover:bg-success/20"
                    >
                      {t("datasetReady")}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Preview Panel / AI Log Panel — outer border aligned with left 1.1 card */}
        <div ref={previewPanelRef} className="sticky top-4 rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {t("aiLog")}
              {generating && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-success" />}
              {!generating && previewName && !(aiLogs.length > 0) && (
                <span className="font-normal text-muted-foreground">
                  — {previewName}
                </span>
              )}
            </h3>
            {!generating && aiLogs.length > 0 && (
              <button
                onClick={() => clearLogs()}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {tc("clearLogs")}
              </button>
            )}
          </div>
          <div className="border-t border-border px-4 pb-4 pt-0">
            <div ref={logScrollRef} className="log-scroll-container min-h-[560px] max-h-[calc(100vh-240px)] overflow-auto rounded-md border border-border/60 bg-muted/10 p-3 mt-3">
              {(generating || aiLogs.length > 0) ? (
                <div className="space-y-0.5 font-mono text-xs leading-relaxed">
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
                        log.includes("🤖") ? "text-blue-400" :
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
                <p className="py-8 text-center text-xs text-muted-foreground">
                  {t("preview.noContent")}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

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
                    reloadFiles();
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
    </div>
  );
}
