import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface ExportEvent {
  project_id?: string;
  [key: string]: unknown;
}

interface ExportState {
  // Export process state (persists across page navigation)
  isExporting: boolean;
  result: string | null;
  exportLogs: string[];
  currentStep: string;
  exportProgress: string;
  modelName: string;
  outputDir: string;
  ollamaDir: string;
  manifestDir: string;
  // Project isolation
  activeProjectId: string;
  // Path warning: configured Ollama models path is invalid, fell back to default Ollama dir
  pathWarning: { configuredPath: string; fallbackPath: string } | null;

  // Actions
  startExport: (projectId: string) => void;
  setResult: (r: string | null) => void;
  addLog: (line: string) => void;
  setCurrentStep: (step: string) => void;
  setExportProgress: (desc: string) => void;
  setModelName: (name: string) => void;
  setOutputDir: (dir: string) => void;
  setOllamaDir: (dir: string) => void;
  setManifestDir: (dir: string) => void;
  setPathWarning: (w: { configuredPath: string; fallbackPath: string } | null) => void;
  clearAll: () => void;

  // Listener management
  _listenersReady: boolean;
  _initPromise: Promise<void> | null;
  _unlistens: UnlistenFn[];
  initListeners: () => Promise<void>;
}

export const useExportStore = create<ExportState>((set, get) => ({
  isExporting: false,
  result: null,
  exportLogs: [],
  currentStep: "",
  exportProgress: "",
  modelName: "",
  outputDir: "",
  ollamaDir: "",
  manifestDir: "",
  activeProjectId: "",
  pathWarning: null,

  startExport: (projectId: string) => set({
    isExporting: true, result: null, exportLogs: [], currentStep: "", exportProgress: "",
    ollamaDir: "", manifestDir: "",
    activeProjectId: projectId, pathWarning: null,
  }),

  setResult: (r) => set({ result: r }),
  addLog: (line) => set((s) => ({ exportLogs: [...s.exportLogs, line] })),
  setCurrentStep: (step) => set({ currentStep: step }),
  setExportProgress: (desc) => set({ exportProgress: desc }),
  setModelName: (name) => set({ modelName: name }),
  setOutputDir: (dir) => set({ outputDir: dir }),
  setOllamaDir: (dir) => set({ ollamaDir: dir }),
  setManifestDir: (dir) => set({ manifestDir: dir }),
  setPathWarning: (w) => set({ pathWarning: w }),

  clearAll: () => set({
    isExporting: false,
    result: null,
    exportLogs: [],
    currentStep: "",
    exportProgress: "",
    modelName: "",
    outputDir: "",
    ollamaDir: "",
    manifestDir: "",
    activeProjectId: "",
    pathWarning: null,
  }),

  _listenersReady: false,
  _initPromise: null,
  _unlistens: [],

  initListeners: async () => {
    if (get()._listenersReady) return;
    if (get()._initPromise) return get()._initPromise as Promise<void>;

    const setupPromise = (async () => {
      const unsubs: UnlistenFn[] = [];

      // Helper: only process events belonging to the active project
      const isMyProject = (payload: ExportEvent) => {
        const active = get().activeProjectId;
        if (!active) return true; // no active project yet, accept all
        return payload.project_id === active;
      };

      const u1 = await listen<ExportEvent & { step?: string; desc?: string }>("export:progress", (e) => {
        if (!isMyProject(e.payload)) return;
        const desc = e.payload.desc || "";
        const step = e.payload.step || "";
        if (desc) get().setExportProgress(desc as string);
        if (step) get().setCurrentStep(step as string);
        if (desc) {
          const ts = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
          get().addLog(`[${ts}] ${desc}`);
        }
      });
      unsubs.push(u1);

      const u2 = await listen<ExportEvent & { model_name?: string; output_dir?: string; ollama_dir?: string; manifest_dir?: string }>("export:complete", (e) => {
        if (!isMyProject(e.payload)) return;
        const name = (e.payload.model_name as string) || "";
        const dir = (e.payload.output_dir as string) || "";
        const ollamaDir = (e.payload.ollama_dir as string) || "";
        const manifestDir = (e.payload.manifest_dir as string) || "";
        if (name) get().setModelName(name);
        if (dir) get().setOutputDir(dir);
        if (ollamaDir) get().setOllamaDir(ollamaDir);
        if (manifestDir) get().setManifestDir(manifestDir);
        set({ isExporting: false, currentStep: "done", exportProgress: "" });
        set({ result: `__success__:${name}` });
        get().addLog(`--- Model '${name}' created`);
      });
      unsubs.push(u2);

      const u3 = await listen<ExportEvent & { message?: string }>("export:error", (e) => {
        if (!isMyProject(e.payload)) return;
        const msg = (e.payload.message as string) || "Export failed";
        set({ isExporting: false, currentStep: "", exportProgress: "" });
        set({ result: `Error: ${msg}` });
        get().addLog(`!!! Error: ${msg}`);
      });
      unsubs.push(u3);

      const u4 = await listen<ExportEvent & { configured_path?: string; fallback_path?: string }>("export:path_warning", (e) => {
        if (!isMyProject(e.payload)) return;
        get().setPathWarning({
          configuredPath: (e.payload.configured_path as string) || "",
          fallbackPath: (e.payload.fallback_path as string) || "",
        });
      });
      unsubs.push(u4);

      set({ _unlistens: unsubs, _listenersReady: true });
    })();

    set({ _initPromise: setupPromise });

    try {
      await setupPromise;
    } finally {
      set({ _initPromise: null });
    }
  },
}));
