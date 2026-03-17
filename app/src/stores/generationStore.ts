import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTaskStore } from "./taskStore";

function parseGenerationCounts(text: string, fallbackSuccess: number, fallbackFail: number) {
  let successCount = fallbackSuccess;
  let failCount = fallbackFail;

  const successPatterns = [
    /已生成\s*(\d+)\s*条/u,
    /已累计\s*(\d+)\s*条/u,
    /内置数据生成完成[:：]?\s*(\d+)\s*条样本/u,
    /Generated\s+(\d+)\s+samples?/i,
    /Total\s+(\d+)\s+samples?/i,
  ];
  const failPatterns = [
    /[（(]\s*(\d+)\s*失败/u,
    /[（(]\s*(\d+)\s*failed/i,
    /(\d+)\s+failed/i,
  ];

  for (const pattern of successPatterns) {
    const match = text.match(pattern);
    if (match) {
      successCount = parseInt(match[1], 10);
      break;
    }
  }

  for (const pattern of failPatterns) {
    const match = text.match(pattern);
    if (match) {
      failCount = parseInt(match[1], 10);
      break;
    }
  }

  return { successCount, failCount };
}

export interface GenFileEntry {
  name: string;
  sizeBytes: number;
}

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
  genFiles: GenFileEntry[];
  genCurrentFileIdx: number;
  genSuccessCount: number;
  genFailCount: number;

  // Persisted form state (survive page navigation)
  formGenMode: string;
  formGenSource: "ollama" | "lmstudio" | "builtin";
  formGenModel: string;
  formManualModelPath: string;
  formEnablePrivacyFilter: boolean;
  formEnableFuzzyDedup: boolean;
  formFuzzyDedupThreshold: number;
  formEnableQualityScoring: boolean;

  // Actions
  startGeneration: () => void;
  stopGeneration: () => void;
  resetGeneration: () => void;
  clearLogs: () => void;
  setFormField: (field: string, value: unknown) => void;
  resetForm: () => void;
  clearNewVersions: () => void;
  setGenFiles: (files: GenFileEntry[]) => void;

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
  genFiles: [],
  genCurrentFileIdx: 0,
  genSuccessCount: 0,
  genFailCount: 0,
  formGenMode: "",
  formGenSource: "ollama",
  formGenModel: "",
  formManualModelPath: "",
  formEnablePrivacyFilter: false,
  formEnableFuzzyDedup: false,
  formFuzzyDedupThreshold: 0.85,
  formEnableQualityScoring: false,
  newVersionIds: [],

  _listenersReady: false,
  _unlistens: [],
  _reloadFiles: null,
  _scrollToDatasets: null,

  setGenFiles: (files) => set({ genFiles: files, genCurrentFileIdx: 0 }),

  startGeneration: () =>
    set({ generating: true, genStopped: false, genProgress: "", genError: "", ollamaPathMismatch: false, genCurrentFileIdx: 0, genSuccessCount: 0, genFailCount: 0 }),

  stopGeneration: () =>
    set({
      generating: false,
      genStopped: true,
      genProgress: "",
      genStep: 0,
      genTotal: 0,
      genError: "",
      aiLogs: [],
      ollamaPathMismatch: false,
      genFiles: [],
      genCurrentFileIdx: 0,
      genSuccessCount: 0,
      genFailCount: 0,
    }),

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
      genFiles: [],
      genCurrentFileIdx: 0,
      genSuccessCount: 0,
      genFailCount: 0,
    }),

  clearLogs: () => set({ aiLogs: [], ollamaPathMismatch: false }),
  clearNewVersions: () => set({ newVersionIds: [] }),

  setFormField: (field, value) => set({ [field]: value } as any),

  resetForm: () => set({
    formGenMode: "",
    formGenSource: "ollama" as const,
    formGenModel: "",
    formManualModelPath: "",
    formEnablePrivacyFilter: false,
    formEnableFuzzyDedup: false,
    formFuzzyDedupThreshold: 0.85,
    formEnableQualityScoring: false,
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
        if (!get().generating) return;
        const step = e.payload.step ?? get().genStep;
        const total = e.payload.total ?? get().genTotal;
        // Estimate which file we're currently processing based on cumulative size ratio
        const files = get().genFiles;
        let fileIdx = 0;
        if (files.length > 1 && total > 0) {
          const totalSize = files.reduce((s, f) => s + f.sizeBytes, 0);
          if (totalSize > 0) {
            let cumulative = 0;
            for (let i = 0; i < files.length; i++) {
              cumulative += files[i].sizeBytes / totalSize;
              if (step / total <= cumulative) {
                fileIdx = i;
                break;
              }
              fileIdx = files.length - 1;
            }
          }
        }
        const desc = e.payload.desc ?? get().genProgress;
        const { successCount, failCount } = parseGenerationCounts(
          desc,
          get().genSuccessCount,
          get().genFailCount,
        );
        set({
          genStep: step,
          genTotal: total,
          genProgress: desc,
          genCurrentFileIdx: fileIdx,
          genSuccessCount: successCount,
          genFailCount: failCount,
        });
      }
    );
    unlistens.push(u1);

    const u2 = await listen<{ message?: string; line?: string }>(
      "dataset:log",
      (e) => {
        if (!get().generating) return;
        const msg = e.payload.message || e.payload.line || "";
        if (msg) {
          const { successCount, failCount } = parseGenerationCounts(
            msg,
            get().genSuccessCount,
            get().genFailCount,
          );
          set((s) => ({
            aiLogs: [...s.aiLogs.slice(-500), msg],
            genSuccessCount: successCount,
            genFailCount: failCount,
          }));
        }
      }
    );
    unlistens.push(u2);

    const u2v = await listen<{ version?: string }>("dataset:version", (e) => {
      if (!get().generating) return;
      const vid = e.payload.version;
      if (vid) {
        set({ newVersionIds: [vid] });
      }
    });
    unlistens.push(u2v);

    const u3 = await listen("dataset:complete", () => {
      if (!get().generating) return;
      const successCount = get().genSuccessCount;
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
      import("./notificationStore").then(({ useNotificationStore }) => {
        useNotificationStore.getState().trigger(
          "dataset_complete",
          "M-Courtyard",
          `Dataset generation completed successfully. ${successCount} samples generated.`,
        );
      });
    });
    unlistens.push(u3);

    const u4 = await listen<{ message?: string; is_path_mismatch?: boolean }>("dataset:error", (e) => {
      if (!get().generating) return;
      const errMsg = e.payload.message || "Generation failed";
      set({
        generating: false,
        genProgress: "",
        genStep: 0,
        genTotal: 0,
        genError: errMsg,
        ollamaPathMismatch: e.payload.is_path_mismatch === true,
      });
      useTaskStore.getState().releaseTask();
      // Reload file list so historical datasets reappear after a failed generation
      get()._reloadFiles?.();
      import("./notificationStore").then(({ useNotificationStore }) => {
        useNotificationStore.getState().trigger("dataset_failed", "M-Courtyard", `Dataset generation failed: ${errMsg}`);
      });
    });
    unlistens.push(u4);

    const u5 = await listen("dataset:stopped", () => {
      set({
        generating: false,
        genStopped: true,
        genProgress: "",
        genStep: 0,
        genTotal: 0,
        genError: "",
        aiLogs: [],
        ollamaPathMismatch: false,
        genFiles: [],
        genCurrentFileIdx: 0,
        genSuccessCount: 0,
        genFailCount: 0,
      });
      useTaskStore.getState().releaseTask();
      get()._reloadFiles?.();
    });
    unlistens.push(u5);

    set({ _listenersReady: true, _unlistens: unlistens });
  },
}));
