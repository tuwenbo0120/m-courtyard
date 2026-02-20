import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTaskStore } from "./taskStore";

interface GenerationState {
  generating: boolean;
  genProgress: string;
  genStep: number;
  genTotal: number;
  genError: string;
  genStopped: boolean;
  aiLogs: string[];
  newVersionIds: string[];
  ollamaPathMismatch: boolean;

  // Persisted form state (survive page navigation)
  formGenMode: string;
  formGenSource: "ollama" | "builtin";
  formGenModel: string;
  formManualModelPath: string;

  // Actions
  startGeneration: () => void;
  stopGeneration: () => void;
  resetGeneration: () => void;
  clearLogs: () => void;
  setFormField: (field: string, value: string) => void;
  resetForm: () => void;
  clearNewVersions: () => void;

  // Internal: event listener management
  _listenersReady: boolean;
  _unlistens: UnlistenFn[];
  initListeners: (reloadFilesFn?: () => void) => void;
  setReloadFiles: (fn: () => void) => void;
  _reloadFiles: (() => void) | null;
  _scrollToDatasets: (() => void) | null;
  setScrollToDatasets: (fn: () => void) => void;
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
  generating: false,
  genProgress: "",
  genStep: 0,
  genTotal: 0,
  genError: "",
  genStopped: false,
  aiLogs: [],
  ollamaPathMismatch: false,
  formGenMode: "",
  formGenSource: "ollama",
  formGenModel: "",
  formManualModelPath: "",
  newVersionIds: [],

  _listenersReady: false,
  _unlistens: [],
  _reloadFiles: null,
  _scrollToDatasets: null,

  startGeneration: () =>
    set({ generating: true, genStopped: false, genProgress: "", genError: "", ollamaPathMismatch: false }),

  stopGeneration: () => set({ generating: false }),

  resetGeneration: () =>
    set({
      generating: false,
      genProgress: "",
      genStep: 0,
      genTotal: 0,
      genError: "",
      genStopped: false,
      aiLogs: [],
      newVersionIds: [],
      ollamaPathMismatch: false,
    }),

  clearLogs: () => set({ aiLogs: [], ollamaPathMismatch: false }),
  clearNewVersions: () => set({ newVersionIds: [] }),

  setFormField: (field, value) => set({ [field]: value } as any),

  resetForm: () => set({
    formGenMode: "",
    formGenSource: "ollama" as const,
    formGenModel: "",
    formManualModelPath: "",
  }),

  setReloadFiles: (fn) => set({ _reloadFiles: fn }),
  setScrollToDatasets: (fn) => set({ _scrollToDatasets: fn }),

  initListeners: async () => {
    if (get()._listenersReady) return;
    // Set flag synchronously BEFORE any await to prevent duplicate registration
    set({ _listenersReady: true });

    const unlistens: UnlistenFn[] = [];

    const u1 = await listen<{ step?: number; total?: number; desc?: string }>(
      "dataset:progress",
      (e) => {
        set({
          genStep: e.payload.step ?? get().genStep,
          genTotal: e.payload.total ?? get().genTotal,
          genProgress: e.payload.desc ?? get().genProgress,
        });
      }
    );
    unlistens.push(u1);

    const u2 = await listen<{ message?: string; line?: string }>(
      "dataset:log",
      (e) => {
        const msg = e.payload.message || e.payload.line || "";
        if (msg) {
          set((s) => ({ aiLogs: [...s.aiLogs.slice(-500), msg] }));
        }
      }
    );
    unlistens.push(u2);

    const u2v = await listen<{ version?: string }>("dataset:version", (e) => {
      const vid = e.payload.version;
      if (vid) {
        set({ newVersionIds: [vid] });
      }
    });
    unlistens.push(u2v);

    const u3 = await listen("dataset:complete", () => {
      set({
        generating: false,
        genProgress: "",
        genError: "",
        genStep: 0,
        genTotal: 0,
      });
      useTaskStore.getState().releaseTask();
      get()._reloadFiles?.();
      // Scroll to 1.4 datasets section after generation completes
      setTimeout(() => get()._scrollToDatasets?.(), 400);
    });
    unlistens.push(u3);

    const u4 = await listen<{ message?: string; is_path_mismatch?: boolean }>("dataset:error", (e) => {
      set({
        generating: false,
        genProgress: "",
        genStep: 0,
        genTotal: 0,
        genError: e.payload.message || "Generation failed",
        ollamaPathMismatch: e.payload.is_path_mismatch === true,
      });
      useTaskStore.getState().releaseTask();
      // Reload file list so historical datasets reappear after a failed generation
      get()._reloadFiles?.();
    });
    unlistens.push(u4);

    const u5 = await listen<{ message?: string }>("dataset:stopped", (e) => {
      set((s) => ({
        generating: false,
        genStopped: true,
        aiLogs: [
          ...s.aiLogs,
          `\n⏹ ${e.payload.message || "Generation stopped. Incomplete data has been cleaned up."}`,
        ],
      }));
      useTaskStore.getState().releaseTask();
      get()._reloadFiles?.();
    });
    unlistens.push(u5);

    set({ _listenersReady: true, _unlistens: unlistens });
  },
}));
