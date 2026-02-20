import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown, ChevronRight, CheckCircle2, RefreshCw,
  FolderOpen, Globe, Download, HardDrive, Settings,
} from "lucide-react";

export interface LocalModelInfo {
  name: string;
  path: string;
  size_mb: number;
  is_mlx: boolean;
  source: string;
}

interface OnlineModelOption {
  id: string;
  label: string;
  size: string;
  descKey: string;
  releasedAt: string;
}

interface OnlineModelBrandGroup {
  brand: string;
  labelKey: string;
  versions: OnlineModelOption[];
  moreUrl?: string;
}

function sortOnlineGroupsByRelease(groups: OnlineModelBrandGroup[]): OnlineModelBrandGroup[] {
  return groups.map((group) => ({
    ...group,
    versions: [...group.versions].sort((a, b) => {
      const ta = Date.parse(a.releasedAt || "1970-01-01");
      const tb = Date.parse(b.releasedAt || "1970-01-01");
      return tb - ta;
    }),
  }));
}

export interface AdapterInfo {
  name: string;
  path: string;
  created: string;
  has_weights: boolean;
  base_model: string;
}

export type ModelSelectorMode = "training" | "dataprep" | "export";

interface Props {
  mode: ModelSelectorMode;
  selectedModel: string;
  onSelect: (modelId: string, isLocalPath?: boolean) => void;
  disabled?: boolean;
  projectId?: string;
  onSelectAdapter?: (adapter: AdapterInfo) => void;
}

const SOURCE_LABELS_STATIC: Record<string, string> = {
  huggingface: "HuggingFace",
  modelscope: "ModelScope",
  ollama: "Ollama",
};
const SOURCE_COLORS: Record<string, string> = {
  huggingface: "text-tag-hf bg-tag-hf/15",
  modelscope: "text-tag-ms bg-tag-ms/15",
  ollama: "text-success bg-success/15",
  trained: "text-tag-trained bg-tag-trained/15",
};
const HF_ONLINE_GROUPS: OnlineModelBrandGroup[] = sortOnlineGroupsByRelease([
  {
    brand: "qwen",
    labelKey: "onlineBrands.qwen",
    versions: [
      { id: "mlx-community/Qwen3.5-397B-A17B-4bit", label: "Qwen 3.5 397B MoE", size: "~250GB", descKey: "topRated", releasedAt: "2026-02-17" },
      { id: "mlx-community/Qwen3-Coder-Next-4bit", label: "Qwen3 Coder Next", size: "~6GB", descKey: "codeStrong", releasedAt: "2026-02-03" },
      { id: "mlx-community/Qwen3-4B-Instruct-2507-4bit", label: "Qwen 3 4B", size: "~2.6GB", descKey: "versatile", releasedAt: "2025-08-06" },
      { id: "mlx-community/Qwen3-14B-4bit-DWQ-053125", label: "Qwen 3 14B", size: "~9GB", descKey: "topRated", releasedAt: "2025-06-02" },
      { id: "mlx-community/Qwen3-0.6B-4bit", label: "Qwen 3 0.6B", size: "~0.6GB", descKey: "lightweight", releasedAt: "2025-04-28" },
    ],
    moreUrl: "https://huggingface.co/models?search=mlx-community%2FQwen3",
  },
  {
    brand: "deepseek",
    labelKey: "onlineBrands.deepseek",
    versions: [
      { id: "mlx-community/DeepSeek-R1-Distill-Qwen-14B-4bit", label: "DeepSeek R1 14B", size: "~9GB", descKey: "topRated", releasedAt: "2025-01-20" },
      { id: "mlx-community/DeepSeek-R1-Distill-Llama-8B-4bit-mlx", label: "DeepSeek R1 8B", size: "~5GB", descKey: "reasoningGeneral", releasedAt: "2025-01-20" },
      { id: "mlx-community/DeepSeek-R1-Distill-Qwen-7B-4bit", label: "DeepSeek R1 7B", size: "~4.7GB", descKey: "reasoning", releasedAt: "2025-01-20" },
      { id: "mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit", label: "DeepSeek R1 1.5B", size: "~1GB", descKey: "reasoningLight", releasedAt: "2025-01-20" },
    ],
    moreUrl: "https://huggingface.co/models?search=mlx-community%2FDeepSeek",
  },
  {
    brand: "glm",
    labelKey: "onlineBrands.glm",
    versions: [
      { id: "mlx-community/GLM-5-4bit", label: "GLM 5", size: "~24GB", descKey: "topRated", releasedAt: "2026-02-12" },
      { id: "mlx-community/GLM-4.5-Air-4bit", label: "GLM 4.5 Air", size: "~8GB", descKey: "higherQuality", releasedAt: "2025-07-28" },
      { id: "mlx-community/GLM-4.7-Flash-4bit", label: "GLM 4.7 Flash", size: "~5GB", descKey: "lightweight", releasedAt: "2026-01-19" },
    ],
    moreUrl: "https://huggingface.co/models?search=mlx-community%2FGLM",
  },
  {
    brand: "llama",
    labelKey: "onlineBrands.llama",
    versions: [
      { id: "mlx-community/Llama-3.2-1B-Instruct-4bit", label: "Llama 3.2 1B", size: "~0.8GB", descKey: "lightweight", releasedAt: "2024-09-25" },
      { id: "mlx-community/Llama-3.2-3B-Instruct-4bit", label: "Llama 3.2 3B", size: "~2GB", descKey: "balanced", releasedAt: "2024-09-25" },
      { id: "mlx-community/Llama-3.1-8B-Instruct-4bit", label: "Llama 3.1 8B", size: "~5GB", descKey: "popularGeneral", releasedAt: "2024-07-23" },
    ],
    moreUrl: "https://huggingface.co/models?search=mlx-community%2FLlama",
  },
  {
    brand: "gptoss",
    labelKey: "onlineBrands.gptoss",
    versions: [
      { id: "mlx-community/gpt-oss-20b-MXFP4-Q8", label: "gpt-oss 20B Q8", size: "~22GB", descKey: "topRated", releasedAt: "2025-08-10" },
      { id: "mlx-community/gpt-oss-20b-MXFP4-Q4", label: "gpt-oss 20B Q4", size: "~13GB", descKey: "openaiFamily", releasedAt: "2025-08-10" },
    ],
    moreUrl: "https://huggingface.co/models?search=mlx-community%2Fgpt-oss",
  },
  {
    brand: "kimi",
    labelKey: "onlineBrands.kimi",
    versions: [
      { id: "mlx-community/Kimi-K2.5", label: "Kimi K2.5", size: "~16GB", descKey: "topRated", releasedAt: "2026-01-27" },
      { id: "mlx-community/Kimi-K2-Thinking", label: "Kimi K2 Thinking", size: "~16GB", descKey: "reasoning", releasedAt: "2025-11-07" },
      { id: "mlx-community/Kimi-K2-Instruct-4bit", label: "Kimi K2 Instruct", size: "~16GB", descKey: "popularGeneral", releasedAt: "2025-07-11" },
    ],
    moreUrl: "https://huggingface.co/models?search=mlx-community%2FKimi",
  },
  {
    brand: "mistral",
    labelKey: "onlineBrands.mistral",
    versions: [
      { id: "mlx-community/mistralai_Ministral-3-14B-Instruct-2512-MLX-MXFP4", label: "Ministral 3 14B", size: "~8GB", descKey: "higherQuality", releasedAt: "2025-12-30" },
      { id: "mlx-community/mistralai_Devstral-Small-2-24B-Instruct-2512-MLX-8Bit", label: "Devstral Small 24B", size: "~24GB", descKey: "codeStrong", releasedAt: "2025-12-14" },
      { id: "mlx-community/Mistral-7B-Instruct-v0.2-4-bit", label: "Mistral 7B Instruct", size: "~4.1GB", descKey: "popularGeneral", releasedAt: "2023-12-22" },
    ],
    moreUrl: "https://huggingface.co/models?search=mlx-community%2FMistral",
  },
  {
    brand: "phi",
    labelKey: "onlineBrands.phi",
    versions: [
      { id: "mlx-community/Phi-3.5-mini-instruct-4bit", label: "Phi 3.5 Mini", size: "~2.6GB", descKey: "lightweight", releasedAt: "2024-08-20" },
      { id: "mlx-community/Phi-3-medium-128k-instruct-4bit", label: "Phi 3 Medium 128K", size: "~7.8GB", descKey: "higherQuality", releasedAt: "2024-05-21" },
      { id: "mlx-community/Phi-3-mini-4k-instruct-4bit", label: "Phi 3 Mini 4K", size: "~2.2GB", descKey: "lightweight", releasedAt: "2024-04-23" },
    ],
    moreUrl: "https://huggingface.co/models?search=mlx-community%2FPhi-3",
  },
]);

const OLLAMA_ONLINE_GROUPS: OnlineModelBrandGroup[] = sortOnlineGroupsByRelease([
  {
    brand: "qwen",
    labelKey: "onlineBrands.qwen",
    versions: [
      { id: "qwen3:14b", label: "Qwen 3 14B", size: "~9GB", descKey: "topRated", releasedAt: "2025-04-29" },
      { id: "qwen3:8b", label: "Qwen 3 8B", size: "~4.7GB", descKey: "higherQuality", releasedAt: "2025-04-29" },
      { id: "qwen3:4b", label: "Qwen 3 4B", size: "~2.6GB", descKey: "versatile", releasedAt: "2025-04-29" },
      { id: "qwen3:0.6b", label: "Qwen 3 0.6B", size: "~0.6GB", descKey: "lightweight", releasedAt: "2025-04-29" },
    ],
    moreUrl: "https://ollama.com/search?q=qwen3",
  },
  {
    brand: "deepseek",
    labelKey: "onlineBrands.deepseek",
    versions: [
      { id: "deepseek-r1:14b", label: "DeepSeek R1 14B", size: "~9GB", descKey: "topRated", releasedAt: "2025-01-20" },
      { id: "deepseek-r1:8b", label: "DeepSeek R1 8B", size: "~5GB", descKey: "reasoningGeneral", releasedAt: "2025-01-20" },
      { id: "deepseek-r1:7b", label: "DeepSeek R1 7B", size: "~4.7GB", descKey: "reasoning", releasedAt: "2025-01-20" },
      { id: "deepseek-r1:1.5b", label: "DeepSeek R1 1.5B", size: "~1.1GB", descKey: "reasoningLight", releasedAt: "2025-01-20" },
    ],
    moreUrl: "https://ollama.com/search?q=deepseek",
  },
  {
    brand: "glm",
    labelKey: "onlineBrands.glm",
    versions: [
      { id: "glm-5:latest", label: "GLM 5", size: "~24GB", descKey: "topRated", releasedAt: "2026-02-12" },
      { id: "glm-4.7-flash", label: "GLM 4.7 Flash", size: "~5GB", descKey: "lightweight", releasedAt: "2026-01-19" },
      { id: "glm-4.7", label: "GLM 4.7", size: "~9GB", descKey: "higherQuality", releasedAt: "2025-07-28" },
    ],
    moreUrl: "https://ollama.com/search?q=glm5",
  },
  {
    brand: "llama",
    labelKey: "onlineBrands.llama",
    versions: [
      { id: "llama3.2:1b", label: "Llama 3.2 1B", size: "~1.3GB", descKey: "lightweight", releasedAt: "2024-09-25" },
      { id: "llama3.2:3b", label: "Llama 3.2 3B", size: "~2GB", descKey: "balanced", releasedAt: "2024-09-25" },
      { id: "llama3.1:8b", label: "Llama 3.1 8B", size: "~4.9GB", descKey: "popularGeneral", releasedAt: "2024-07-23" },
    ],
    moreUrl: "https://ollama.com/search?q=llama",
  },
  {
    brand: "gptoss",
    labelKey: "onlineBrands.gptoss",
    versions: [
      { id: "gpt-oss:latest", label: "gpt-oss Latest", size: "~14GB", descKey: "topRated", releasedAt: "2025-10-01" },
      { id: "gpt-oss:20b", label: "gpt-oss 20B", size: "~14GB", descKey: "openaiFamily", releasedAt: "2025-10-01" },
    ],
    moreUrl: "https://ollama.com/library/gpt-oss",
  },
  {
    brand: "kimi",
    labelKey: "onlineBrands.kimi",
    versions: [
      { id: "kimi-k2.5:latest", label: "Kimi K2.5", size: "~16GB", descKey: "topRated", releasedAt: "2026-01-27" },
    ],
    moreUrl: "https://ollama.com/search?q=kimi",
  },
  {
    brand: "mistral",
    labelKey: "onlineBrands.mistral",
    versions: [
      { id: "mistral-small3.2:latest", label: "Mistral Small 3.2", size: "~24GB", descKey: "higherQuality", releasedAt: "2025-07-10" },
      { id: "mistral-nemo:latest", label: "Mistral Nemo 12B", size: "~7GB", descKey: "balanced", releasedAt: "2024-07-18" },
      { id: "mistral:latest", label: "Mistral 7B", size: "~4.1GB", descKey: "popularGeneral", releasedAt: "2023-12-10" },
    ],
    moreUrl: "https://ollama.com/search?q=mistral",
  },
  {
    brand: "phi",
    labelKey: "onlineBrands.phi",
    versions: [
      { id: "phi4-reasoning:14b", label: "Phi-4 Reasoning 14B", size: "~9GB", descKey: "reasoning", releasedAt: "2025-05-01" },
      { id: "phi4:14b", label: "Phi-4 14B", size: "~9GB", descKey: "higherQuality", releasedAt: "2024-12-01" },
      { id: "phi4-mini:3.8b", label: "Phi-4 Mini 3.8B", size: "~2.4GB", descKey: "lightweight", releasedAt: "2024-12-01" },
    ],
    moreUrl: "https://ollama.com/search?q=phi",
  },
]);

interface OllamaModelInfo {
  name: string;
  size: string;
}

function normalizeOllamaModelName(name: string): string {
  return name.endsWith(":latest") ? name.slice(0, -":latest".length) : name;
}

function isOllamaModelVisibleToDaemon(modelName: string, daemonModels: OllamaModelInfo[]): boolean {
  const target = normalizeOllamaModelName(modelName);
  return daemonModels.some((m) => normalizeOllamaModelName(m.name) === target);
}

const HF_DOWNLOAD_LINKS = [
  { labelKey: "hfLinks.official", url: "https://huggingface.co/mlx-community" },
  { labelKey: "hfLinks.mirror", url: "https://hf-mirror.com/mlx-community" },
  { labelKey: "hfLinks.modelscope", url: "https://modelscope.cn/models?nameContains=mlx" },
  { labelKey: "hfLinks.allModels", url: "https://huggingface.co/mlx-community/models" },
];

const OLLAMA_LINKS = [
  { labelKey: "ollamaLinks.website", url: "https://ollama.com" },
  { labelKey: "ollamaLinks.library", url: "https://ollama.com/library" },
];

function isModelUsable(
  source: string,
  mode: ModelSelectorMode,
  modelName: string,
  daemonModels: OllamaModelInfo[]
): boolean {
  if (mode === "training") return source !== "ollama" && source !== "trained";
  if (mode === "dataprep") {
    if (source !== "ollama") return false;
    return isOllamaModelVisibleToDaemon(modelName, daemonModels);
  }
  if (mode === "export") return source === "trained";
  return true;
}

function getDisabledReasonKey(source: string, mode: ModelSelectorMode, daemonVisible: boolean): string {
  if (mode === "training") {
    if (source === "ollama") return "modelSelector.disabledReason.ollamaNoLora";
    if (source === "trained") return "modelSelector.disabledReason.trainedNotBase";
  }
  if (mode === "dataprep") {
    if (source === "trained") return "modelSelector.disabledReason.adapterNoGen";
    if (source !== "ollama") return "modelSelector.disabledReason.ollamaOnly";
    if (!daemonVisible) return "modelSelector.disabledReason.notInDaemon";
  }
  if (mode === "export") {
    if (source !== "trained") return "modelSelector.disabledReason.selectAdapter";
  }
  return "";
}

export function ModelSelector({ mode, selectedModel, onSelect, disabled, projectId, onSelectAdapter }: Props) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const sourceLabel = (s: string) => {
    const key = `modelSelector.sourceLabels.${s}`;
    const translated = t(key);
    return translated === key ? (SOURCE_LABELS_STATIC[s] || s) : translated;
  };
  const [allModels, setAllModels] = useState<LocalModelInfo[]>([]);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);
  const [hfSource, setHfSource] = useState<string>("huggingface");
  const [loading, setLoading] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [expandedHfBrands, setExpandedHfBrands] = useState<Set<string>>(new Set());
  const [expandedOllamaBrands, setExpandedOllamaBrands] = useState<Set<string>>(new Set());
  const [showOnline, setShowOnline] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<LocalModelInfo[]>("scan_local_models");
      setAllModels(list);
    } catch {
      setAllModels([]);
    }
    setLoading(false);
  }, []);

  const loadOllamaModels = useCallback(async () => {
    try {
      const list = await invoke<OllamaModelInfo[]>("list_ollama_models");
      setOllamaModels(list);
    } catch {
      setOllamaModels([]);
    }
  }, []);

  const loadHfSource = useCallback(async () => {
    try {
      const cfg = await invoke<{ hf_source: string }>("get_app_config");
      const src = cfg.hf_source;
      const valid = src === "huggingface" || src === "hf-mirror" || src === "modelscope";
      setHfSource(valid ? src : "huggingface");
    } catch { /* ignore */ }
  }, []);

  const loadAdapters = useCallback(async () => {
    if (!projectId) { setAdapters([]); return; }
    try {
      const list = await invoke<AdapterInfo[]>("list_adapters", { projectId });
      setAdapters(list.filter((a) => a.has_weights));
    } catch {
      setAdapters([]);
    }
  }, [projectId]);

  useEffect(() => {
    loadModels();
    loadOllamaModels();
    if (mode === "training") loadHfSource();
  }, [loadModels, loadOllamaModels, loadHfSource, mode]);
  useEffect(() => { if (mode === "export") loadAdapters(); }, [loadAdapters, mode]);

  // Auto-refresh local/Ollama model lists after an export completes.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    const setup = async () => {
      unlisten = await listen<{ project_id?: string }>("export:complete", (e) => {
        const pid = e.payload?.project_id;
        if (projectId && pid && pid !== projectId) return;
        loadModels();
        loadOllamaModels();
      });
    };
    setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, [projectId, loadModels, loadOllamaModels]);

  // Scroll-hide refs for model list
  const listRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-source header element refs — used to auto-scroll on expand
  const sourceHeaderRefs = useRef<Map<string, HTMLElement>>(new Map());
  const handleListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.classList.add("is-scrolling");
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      el.classList.remove("is-scrolling");
    }, 3000);
  }, []);

  // Adapters only appear in the local model list when mode is "export".
  // In training/dataprep they cannot be used directly and would confuse users.
  const combinedModels: LocalModelInfo[] = [
    ...allModels,
    ...(mode === "export" ? adapters.map((a) => ({
      name: `${a.base_model || a.name} \u2192 ${a.created}`,
      path: a.path,
      size_mb: 0,
      is_mlx: true,
      source: "trained",
    })) : []),
  ];

  // Group by source
  const grouped = combinedModels.reduce<Record<string, LocalModelInfo[]>>((acc, m) => {
    if (!acc[m.source]) acc[m.source] = [];
    acc[m.source].push(m);
    return acc;
  }, {});

  // Sort sources: most usable models first
  const sortedSources = Object.keys(grouped).sort((a, b) => {
    const usableA = grouped[a].filter((m) => isModelUsable(m.source, mode, m.name, ollamaModels)).length;
    const usableB = grouped[b].filter((m) => isModelUsable(m.source, mode, m.name, ollamaModels)).length;
    return usableB - usableA;
  });

  // Check if an online model is already downloaded locally
  const isDownloaded = (modelId: string) =>
    allModels.some((m) => m.name === modelId);

  // Check if an Ollama model is installed (match by prefix, e.g. "llama3.2:3b" matches "llama3.2:3b-instruct-...")
  const isOllamaInstalled = (modelId: string) =>
    ollamaModels.some((m) => m.name === modelId || m.name.startsWith(modelId.split(":")[0] + ":" + modelId.split(":")[1]));

  const toggleSource = (source: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      const expanding = !next.has(source);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      if (expanding) {
        // After React re-renders the expanded content, scroll so the header is visible
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const header = sourceHeaderRefs.current.get(source);
            const container = listRef.current;
            if (!header || !container) return;
            const containerRect = container.getBoundingClientRect();
            const headerRect = header.getBoundingClientRect();
            const relativeTop = headerRect.top - containerRect.top + container.scrollTop;
            container.scrollTo({ top: relativeTop - 4, behavior: "smooth" });
          });
        });
      }
      return next;
    });
  };

  const toggleHfBrand = (brand: string) => {
    setExpandedHfBrands((prev) => {
      const next = new Set(prev);
      if (next.has(brand)) next.delete(brand);
      else next.add(brand);
      return next;
    });
  };

  const toggleOllamaBrand = (brand: string) => {
    setExpandedOllamaBrands((prev) => {
      const next = new Set(prev);
      if (next.has(brand)) next.delete(brand);
      else next.add(brand);
      return next;
    });
  };

  // Auto-expand the source with most usable models on first load
  useEffect(() => {
    if (combinedModels.length > 0 && expandedSources.size === 0) {
      const best = sortedSources[0];
      if (best) setExpandedSources(new Set([best]));
    }
  }, [combinedModels.length]);

  const navigateToSettings = () => {
    navigate("/settings?focus=download-source");
  };

  const openUrl = (url: string) => {
    invoke("plugin:opener|open_url", { url });
  };

  const openSourceFolder = (source: string) => {
    if (source === "trained" && projectId) {
      invoke("open_project_folder", { projectId });
    } else {
      invoke("open_model_cache", { source });
    }
  };

  // Handle model selection - scanned models don't need isLocalPath
  const handleSelectModel = (m: LocalModelInfo) => {
    if (m.source === "trained") {
      const adapter = adapters.find((a) => a.path === m.path);
      if (adapter && onSelectAdapter) onSelectAdapter(adapter);
      onSelect(m.path);
    } else {
      onSelect(m.name);  // No isLocalPath - scanned models are already validated
    }
  };

  const totalModels = combinedModels.length;
  const usableModels = combinedModels.filter((m) => isModelUsable(m.source, mode, m.name, ollamaModels)).length;

  return (
    <div className="space-y-2">
      {/* Toggle Panel Button */}
      <div className="flex gap-2">
        <button
          onClick={() => { if (showPanel && !showOnline) { setShowPanel(false); } else { setShowPanel(true); setShowOnline(false); } }}
          disabled={disabled}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            showPanel && !showOnline
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          {showPanel && !showOnline ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t("modelSelector.selectExisting")}
        </button>
        <button
          onClick={() => { if (showPanel && showOnline) { setShowPanel(false); } else { setShowPanel(true); setShowOnline(true); } }}
          disabled={disabled}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            showPanel && showOnline
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          <Download size={12} />
          {t("modelSelector.onlineModels")}
        </button>
        {mode === "training" && (
          <button
            onClick={navigateToSettings}
            disabled={disabled}
            className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Settings size={12} />
            {t("modelSelector.adjustSource")}
          </button>
        )}
      </div>

      {/* Panel */}
      {showPanel && (
        <div className="rounded-lg border border-border bg-background">
          {/* Tab Bar */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setShowOnline(false)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors ${
                !showOnline ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <HardDrive size={12} />
              {t("modelSelector.localModels")}
            </button>
            <button
              onClick={() => setShowOnline(true)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors ${
                showOnline ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Download size={12} />
              {t("modelSelector.onlineTab")}
            </button>
          </div>

          <div className="p-3">
            {!showOnline ? (
              /* ======== Local Models Tab ======== */
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {t("modelSelector.scanStatus", { total: totalModels, usable: usableModels })}
                  </p>
                  <button
                    onClick={() => { loadModels(); loadAdapters(); loadOllamaModels(); }}
                    disabled={loading}
                    className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
                    {loading ? t("modelSelector.scanning") : t("modelSelector.refresh")}
                  </button>
                </div>

                {totalModels === 0 ? (
                  <div className="py-6 text-center">
                    <p className="text-xs text-muted-foreground/70">
                      {loading ? t("modelSelector.scanningModels") : t("modelSelector.noModelsFound")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/50">
                      {t("modelSelector.noModelsHint")}
                    </p>
                  </div>
                ) : (
                  <div ref={listRef} onScroll={handleListScroll} className="max-h-64 space-y-1 overflow-y-auto overflow-x-hidden log-scroll-container">
                    {sortedSources.map((source) => {
                      const models = grouped[source];
                      const expanded = expandedSources.has(source);
                      const usableCount = models.filter((m) => isModelUsable(m.source, mode, m.name, ollamaModels)).length;
                      return (
                        <div key={source}>
                          {/* Source Header */}
                          <div
                            ref={(el) => { if (el) sourceHeaderRefs.current.set(source, el); }}
                            className="flex items-center justify-between rounded-md px-2 py-1.5"
                          >
                            <button
                              onClick={() => toggleSource(source)}
                              className="flex items-center gap-2 text-xs font-medium text-foreground transition-colors hover:bg-accent rounded-md px-1 py-0.5"
                            >
                              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              <span className={`rounded px-1.5 py-0.5 text-[10px] ${SOURCE_COLORS[source] || "bg-muted text-muted-foreground"}`}>
                                {sourceLabel(source)}
                              </span>
                              <span className="text-muted-foreground">
                                {usableCount > 0 ? t("modelSelector.usableCount", { count: usableCount }) : t("modelSelector.notUsable")}
                                {usableCount < models.length && t("modelSelector.totalCount", { count: models.length })}
                              </span>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); openSourceFolder(source); }}
                              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                              title={t("modelSelector.openFolderTitle", { source: sourceLabel(source) })}
                            >
                              <FolderOpen size={10} />
                              {t("modelSelector.openFolder")}
                            </button>
                          </div>

                          {/* Models List */}
                          {expanded && (
                            <div className="space-y-0.5 overflow-x-hidden">
                              {models.map((m) => {
                                const daemonVisible = isOllamaModelVisibleToDaemon(m.name, ollamaModels);
                                const usable = isModelUsable(m.source, mode, m.name, ollamaModels);
                                const isSelected = selectedModel === m.name || selectedModel === m.path;
                                const reasonKey = getDisabledReasonKey(m.source, mode, daemonVisible);
                                const reason = reasonKey ? t(reasonKey) : "";
                                return (
                                  <button
                                    key={m.path + m.name}
                                    onClick={() => usable && handleSelectModel(m)}
                                    disabled={!usable || disabled}
                                    className={`flex w-full min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                                      isSelected
                                        ? "border-primary bg-primary/10 text-foreground"
                                        : usable
                                        ? "border-border text-muted-foreground hover:bg-accent"
                                        : "border-border/50 text-muted-foreground/40 cursor-not-allowed"
                                    }`}
                                    title={reason || m.name}
                                  >
                                    {/* Radio indicator */}
                                    {isSelected ? (
                                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span>
                                    ) : (
                                      <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${usable ? "border-muted-foreground/30" : "border-muted-foreground/15"}`} />
                                    )}
                                    <div className="min-w-0 flex-1 overflow-hidden">
                                      {m.source === "trained" ? (() => {
                                        const parts = m.name.split(" \u2192 ");
                                        return (
                                          <>
                                            <div className={`text-xs font-medium leading-snug ${usable ? "text-foreground" : "text-muted-foreground/40"}`}>{parts[0]}</div>
                                            {parts[1] && <div className={`text-[10px] leading-snug mt-0.5 ${usable ? "text-muted-foreground/60" : "text-muted-foreground/30"}`}>{parts[1]}</div>}
                                          </>
                                        );
                                      })() : (
                                        <span className={`font-medium ${usable ? "text-foreground" : "text-muted-foreground/40"}`}>{m.name}</span>
                                      )}
                                      {m.is_mlx && m.source !== "trained" && (
                                        <span className="ml-1.5 rounded bg-tag-mlx/15 px-1 py-0.5 text-[10px] text-tag-mlx">MLX</span>
                                      )}
                                      {!usable && reason && (
                                        <span className="ml-1.5 text-[10px] text-muted-foreground/40">({reason})</span>
                                      )}
                                    </div>
                                    <span className={`ml-2 shrink-0 ${usable ? "text-muted-foreground/70" : "text-muted-foreground/30"}`}>
                                      {m.size_mb > 1024 ? `${(m.size_mb / 1024).toFixed(1)} GB` : m.size_mb > 0 ? `${m.size_mb} MB` : ""}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Model source links */}
                <div className="space-y-2 border-t border-border pt-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">{t("modelSelector.downloadSources")}</p>
                    <button
                      onClick={() => invoke("open_model_cache")}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <FolderOpen size={10} />
                      {t("modelSelector.manageDownloaded")}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(mode === "dataprep" ? OLLAMA_LINKS : HF_DOWNLOAD_LINKS).map((link) => (
                      <button
                        key={link.url}
                        onClick={() => openUrl(link.url)}
                        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Globe size={10} />
                        {t(`modelSelector.${link.labelKey}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* ======== Online Models Tab ======== */
              <div className="space-y-2">
                {mode === "dataprep" ? (
                  /* --- DataPrep: Ollama models --- */
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {t("modelSelector.downloadFrom", { source: "Ollama" })}
                      </p>
                    </div>
                    <div className="space-y-1">
                      {OLLAMA_ONLINE_GROUPS.map((group) => {
                        const expanded = expandedOllamaBrands.has(group.brand);
                        return (
                          <div key={group.brand} className="rounded-md border border-border/60">
                            <div
                              onClick={() => toggleOllamaBrand(group.brand)}
                              className="flex cursor-pointer items-center justify-between px-2 py-1.5 transition-colors hover:bg-accent/50 rounded-t-md"
                            >
                              <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                <span>{t(`modelSelector.${group.labelKey}`)}</span>
                                <span className="text-[10px] text-muted-foreground">{group.versions.length}</span>
                              </div>
                              {group.moreUrl && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); openUrl(group.moreUrl!); }}
                                  className="text-[10px] text-primary hover:underline"
                                >
                                  {t("modelSelector.more")}
                                </button>
                              )}
                            </div>

                            {expanded && (
                              <div className="space-y-1 border-t border-border/50 p-2">
                                {group.versions.map((m) => {
                                  const downloaded = isOllamaInstalled(m.id);
                                  const isSelected = selectedModel === m.id;
                                  return (
                                    <button
                                      key={m.id}
                                      onClick={() => onSelect(m.id)}
                                      disabled={disabled}
                                      className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors disabled:opacity-50 ${
                                        isSelected
                                          ? "border-primary bg-primary/10 text-foreground"
                                          : "border-border text-muted-foreground hover:bg-accent"
                                      }`}
                                    >
                                      {isSelected ? (
                                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span>
                                      ) : (
                                        <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <span className="font-medium text-foreground">{m.label}</span>
                                        <span className="ml-1.5 text-muted-foreground/50">{t(`modelSelector.modelDesc.${m.descKey}`)}</span>
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {downloaded && (
                                          <span className="flex items-center gap-0.5 rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                                            <CheckCircle2 size={10} />
                                            {t("modelSelector.downloaded")}
                                          </span>
                                        )}
                                        <span className="font-mono text-muted-foreground/70">{m.size}</span>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="space-y-2 border-t border-border pt-2">
                      <p className="text-xs text-muted-foreground/60">
                        <span className="font-mono text-foreground/70">ollama pull qwen3:4b</span>
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {OLLAMA_LINKS.map((link) => (
                          <button
                            key={link.url}
                            onClick={() => openUrl(link.url)}
                            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Globe size={10} />
                            {t(`modelSelector.${link.labelKey}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  /* --- Training: HuggingFace MLX models --- */
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {t("modelSelector.downloadFrom", { source: t(`modelSelector.source${hfSource === "hf-mirror" ? "HfMirror" : hfSource === "modelscope" ? "Modelscope" : "Huggingface"}`) })}
                      </p>
                      <button
                        onClick={() => invoke("open_model_cache")}
                        className="flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
                        title={t("modelSelector.openModelCache")}
                      >
                        <FolderOpen size={10} />
                        {t("modelSelector.modelCacheDir")}
                      </button>
                    </div>
                    {hfSource === "modelscope" && (
                      <p className="text-xs text-tag-hf/80 rounded-md bg-tag-hf/10 border border-tag-hf/20 px-3 py-2">
                        ⚠ {t("modelSelector.modelscopeWarnInline")}
                        <button onClick={navigateToSettings} className="underline mx-0.5">{t("modelSelector.settingsLink")}</button>
                        {t("modelSelector.modelscopeWarnSuffix")}
                      </p>
                    )}

                    <div className="space-y-1">
                      {HF_ONLINE_GROUPS.map((group) => {
                        const expanded = expandedHfBrands.has(group.brand);
                        const unavailable = hfSource === "modelscope";
                        return (
                          <div key={group.brand} className="rounded-md border border-border/60">
                            <div
                              onClick={() => toggleHfBrand(group.brand)}
                              className="flex cursor-pointer items-center justify-between px-2 py-1.5 transition-colors hover:bg-accent/50 rounded-t-md"
                            >
                              <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                <span>{t(`modelSelector.${group.labelKey}`)}</span>
                                <span className="text-[10px] text-muted-foreground">{group.versions.length}</span>
                              </div>
                              {group.moreUrl && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); openUrl(group.moreUrl!); }}
                                  className="text-[10px] text-primary hover:underline"
                                >
                                  {t("modelSelector.more")}
                                </button>
                              )}
                            </div>

                            {expanded && (
                              <div className="space-y-1 border-t border-border/50 p-2">
                                {group.versions.map((m) => {
                                  const downloaded = isDownloaded(m.id);
                                  const isSelected = selectedModel === m.id;
                                  return (
                                    <button
                                      key={m.id}
                                      onClick={() => !unavailable && onSelect(m.id)}
                                      disabled={disabled || unavailable}
                                      className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors disabled:opacity-50 ${
                                        unavailable
                                          ? "border-border/50 text-muted-foreground/40 cursor-not-allowed"
                                          : isSelected
                                          ? "border-primary bg-primary/10 text-foreground"
                                          : "border-border text-muted-foreground hover:bg-accent"
                                      }`}
                                    >
                                      {isSelected && !unavailable ? (
                                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"><span className="h-2 w-2 rounded-full bg-primary" /></span>
                                      ) : (
                                        <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${unavailable ? "border-muted-foreground/15" : "border-muted-foreground/30"}`} />
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <span className={`font-medium ${unavailable ? "text-muted-foreground/40" : "text-foreground"}`}>{m.label}</span>
                                        <span className={`ml-1.5 rounded px-1 py-0.5 text-[10px] ${unavailable ? "bg-tag-mlx/5 text-tag-mlx/40" : "bg-tag-mlx/15 text-tag-mlx"}`}>MLX</span>
                                        <span className="ml-1 text-muted-foreground/50">{t(`modelSelector.modelDesc.${m.descKey}`)}</span>
                                        {unavailable && <span className="ml-1 text-[10px] text-muted-foreground/40">{t("modelSelector.unavailableSource")}</span>}
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {downloaded && (
                                          <span className="flex items-center gap-0.5 rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                                            <CheckCircle2 size={10} />
                                            {t("modelSelector.downloaded")}
                                          </span>
                                        )}
                                        <span className="font-mono text-muted-foreground/70">{m.size}</span>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="space-y-2 border-t border-border pt-2">
                      <p className="text-xs text-muted-foreground/60">
                        {t("modelSelector.mlxHint")}
                        <button onClick={navigateToSettings} className="underline mx-0.5 text-primary/70">{t("modelSelector.settingsLink")}</button>
                        {t("modelSelector.mlxHintSuffix")}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {HF_DOWNLOAD_LINKS.map((link) => (
                          <button
                            key={link.url}
                            onClick={() => openUrl(link.url)}
                            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Globe size={10} />
                            {t(`modelSelector.${link.labelKey}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
