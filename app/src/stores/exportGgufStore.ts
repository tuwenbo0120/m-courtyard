import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface GgufEvent {
  project_id?: string;
  [key: string]: unknown;
}

interface ExportGgufState {
  isExporting: boolean;
  result: string | null;          // "__success__:<filename>|<outputDir>" or "Error: ..."
  logs: string[];
  currentStep: string;
  progress: string;
  outputDir: string;
  filename: string;
  activeProjectId: string;
  // Path warning: configured path was unavailable, fell back to local dir
  pathWarning: { configuredPath: string; fallbackPath: string } | null;

  startExport: (projectId: string) => void;
  setResult: (r: string | null) => void;
  addLog: (line: string) => void;
  setProgress: (desc: string) => void;
  setCurrentStep: (step: string) => void;
  setOutputDir: (dir: string) => void;
  setFilename: (name: string) => void;
  setPathWarning: (w: { configuredPath: string; fallbackPath: string } | null) => void;
  clearAll: () => void;

  _listenersReady: boolean;
  _initPromise: Promise<void> | null;
  _unlistens: UnlistenFn[];
  initListeners: () => Promise<void>;
}

export const useExportGgufStore = create<ExportGgufState>((set, get) => ({
  isExporting: false,
  result: null,
  logs: [],
  currentStep: "",
  progress: "",
  outputDir: "",
  filename: "",
  activeProjectId: "",
  pathWarning: null,

  startExport: (projectId) => set({
    isExporting: true, result: null, logs: [], currentStep: "",
    progress: "", outputDir: "", filename: "", activeProjectId: projectId,
    pathWarning: null,
  }),

  setResult: (r) => set({ result: r }),
  addLog: (line) => set((s) => ({ logs: [...s.logs, line] })),
  setProgress: (desc) => set({ progress: desc }),
  setCurrentStep: (step) => set({ currentStep: step }),
  setOutputDir: (dir) => set({ outputDir: dir }),
  setFilename: (name) => set({ filename: name }),
  setPathWarning: (w) => set({ pathWarning: w }),

  clearAll: () => set({
    isExporting: false, result: null, logs: [], currentStep: "",
    progress: "", outputDir: "", filename: "", activeProjectId: "",
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

      const isMyProject = (payload: GgufEvent) => {
        const active = get().activeProjectId;
        if (!active) return true;
        return payload.project_id === active;
      };

      const u1 = await listen<GgufEvent & { step?: string; desc?: string }>("gguf:progress", (e) => {
        if (!isMyProject(e.payload)) return;
        const desc = (e.payload.desc as string) || "";
        const step = (e.payload.step as string) || "";
        if (desc) get().setProgress(desc);
        if (step) get().setCurrentStep(step);
        if (desc) {
          const ts = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
          get().addLog(`[${ts}] ${desc}`);
        }
      });
      unsubs.push(u1);

      const u2 = await listen<GgufEvent & { filename?: string; output_dir?: string }>("gguf:complete", (e) => {
        if (!isMyProject(e.payload)) return;
        const filename = (e.payload.filename as string) || "";
        const dir = (e.payload.output_dir as string) || "";
        if (filename) get().setFilename(filename);
        if (dir) get().setOutputDir(dir);
        set({ isExporting: false, currentStep: "done", progress: "" });
        set({ result: `__success__:${filename}|${dir}` });
        get().addLog(`--- GGUF exported: ${filename}`);
      });
      unsubs.push(u2);

      const u3 = await listen<GgufEvent & { message?: string }>("gguf:error", (e) => {
        if (!isMyProject(e.payload)) return;
        const msg = (e.payload.message as string) || "GGUF export failed";
        set({ isExporting: false, currentStep: "", progress: "" });
        set({ result: `Error: ${msg}` });
        get().addLog(`!!! Error: ${msg}`);
      });
      unsubs.push(u3);

      const u4 = await listen<GgufEvent & { configured_path?: string; fallback_path?: string }>("gguf:path_warning", (e) => {
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
