# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.4] - 2026-02-21

Delivers the **Storage Transparency** cluster: cleanable cache visibility on the dashboard, cleanup safety guard during active tasks, and dynamic version display.

### Added
- **Cache Indicator on Dashboard**: New status card on the home screen shows the current cleanable cache size in real time; color-coded green (clean) / amber (has cache); includes a shortcut button that navigates directly to the Settings → Cache Management section
- **Cleanup Safety Guard** (BUG-100): One-click cleanup button in Settings is now disabled while any training, dataset generation, or export task is actively running; an in-handler early-return guard is also added as a second line of defence

### Fixed
- **Hardcoded Version Number** (BUG-101): Settings → About now dynamically reads the version via Tauri `getVersion()` instead of the hardcoded `0.1.0 MVP` string; the displayed version always matches the actual packaged release
- **Settings Focus Routing**: Settings page now handles `?focus=cache` URL parameter, automatically scrolling to and centring the Cache Management section (mirrors existing `?focus=download-source` behaviour)

### Changed
- Dashboard status card grid expanded from 3 columns to 4 to accommodate the new cache card

## [0.4.3] - 2026-02-20

Delivers the **Batch Processing** cluster (PRD D-1 · D-2 · H-3): multi-file drag-and-drop import, merge-as-single-dataset toggle, generation queue with live per-file progress, and macOS completion notifications — enabling N files → 1 operation with background processing.

### Added
- **Multi-file Drag-and-Drop Import**: Drag files or folders directly onto the 1.1 section to batch-import; overlay shows item count on hover; duplicate detection skips already-imported files
- **Merge as Single Dataset Toggle**: Checkbox in the 1.1 toolbar controls whether final output datasets are merged into one file or kept separate per source file; defaults to off
- **Generation Queue View**: While generation is running the 1.1 file list transforms into a collapsible queue — collapsed row shows the current file name and segment progress (step/total); expanding reveals the full file list with per-file status icons (completed / in-progress / pending)
- **Generation Stats Panel**: Card below the Data Preview panel, visible during generation; row 1 shows the current file name with a live pulse indicator; row 2 shows file index N/M, generated count (success/total), and success rate % with green/red color coding
- **Per-file Progress Tracking**: `generationStore` tracks `genFiles`, `genCurrentFileIdx` (estimated from cumulative file-size ratio against segment progress), `genSuccessCount`, and `genFailCount` (parsed from `dataset:progress` event desc)
- **macOS Completion Notification**: System notification pushed via `osascript` when the full generation pipeline completes
- **Training Queue**: "Add to Queue" button alongside the training start button; queue status panel below the dataset list shows queued, in-progress, and completed training jobs
- **Clear All Files**: Trash icon button in the 1.1 toolbar triggers a modal confirmation dialog before deleting all imported raw files; supports pagination (10 files per page) with prev/next navigation

### Fixed
- **Stop Generation Ineffective** (BUG-092): `GENERATION_PID` was cleared before `child.wait().await` in `generate_dataset`, so `stop_generation` always read PID 0 and could not kill the process; moved the clear to after the wait call
- **Cloud-only / Oversized / Incorrect Models in Online List** (BUG-097/099): Verified every model against official HuggingFace and Ollama library pages. Removed: Qwen 3.5 (no lightweight local variant), GLM-5 from Ollama (`glm-5:cloud` only), entire Kimi brand from Ollama (`kimi-k2.5:cloud` only) and HuggingFace (`Kimi-K2-Thinking-4bit` is 1.24 TB not 16 GB), `mlx-community/GLM-5-4bit` from HuggingFace (355B MoE ≈ 177 GB at 4-bit, not 24 GB). Fixed incorrect model ID `DeepSeek-R1-Distill-Llama-8B-4bit-mlx` → `DeepSeek-R1-Distill-Llama-8B-4bit`. Added explicit quantization format to all HuggingFace model labels (e.g. `· 4-bit`, `· 4-bit DWQ`, `· MXFP4`, `· 8-bit`)
- **DataPrep Hint Text Styling** (BUG-095): Merged AI-generation and built-in rule descriptions into the `generate.hint` area; replaced `text-info`/`text-warning` color classes with `text-foreground/80` to eliminate inconsistent blue/yellow accent text
- **Model Selector Default State** (BUG-096): Added `defaultOpen` prop to `ModelSelector`; in DataPrep the panel is now expanded by default and automatically switches to the Online tab when `usableModels === 0`
- **Online Model Sort Order** (BUG-098): `sortOnlineGroupsByRelease` now guarantees versions within each brand group are sorted by `releasedAt` descending so the newest model always appears first

### Changed
- **Generation status UI consolidated**: Removed redundant progress bar below the Stop button and the spinning status bar at the top of the Data Preview panel; all generation status is now shown in the queue row and stats panel
- **Merge as Single Dataset** semantics clarified: the toggle controls output format (merge final datasets), not pre-processing; default changed from on to off
- **Online model lists refined**: Ollama GLM brand retains only locally-runnable `glm-4.7-flash` (~5 GB) and `glm-4.7` (~9 GB); HuggingFace MLX GLM brand retains `GLM-4.7-Flash-4bit` (~5 GB) and `GLM-4.5-Air-4bit` (~8 GB); `GLM-5-4bit` removed as the 355B MoE base model results in ≈177 GB download at 4-bit quantization

## [0.4.2] - 2026-02-20

### Added
- **Training Dataset Expandable List**: Replaced dropdown selector with inline expandable list; each item shows train/valid counts in header row and expands to reveal source files, generation type, and method
- **Training Dataset Pagination**: Added 10-items-per-page pagination controls to training dataset list (same as DataPrep 1.4), with previous/next navigation and page indicator
- **Export Regression Verification**: After successful export, automatically runs `ollama run <model> "..."` smoke test (30 s timeout); shows response preview on pass or error detail + retry button on failure

### Fixed
- **Export flow stuck at "check Ollama" step**: Removed pre-export compatibility check panel which ran concurrent `ollama list` alongside the export script's own check, causing silent conflicts; all pre-conditions are already guaranteed by form inline validation and `check_ollama_status`

### Changed
- `DatasetVersionInfo` interface in `TrainingPage.tsx` extended with `raw_files`, `mode`, `source`, `model` fields (aligned with DataPrep interface)
- Added `dataset.*` i18n keys to `training` namespace (en + zh-CN): trainSet, validSet, samples, sourceFiles, genType, genMethod, methodOllama, methodBuiltin, mode labels, page navigation

### Refactored
- **Ollama Model Path Unification** (BUG-090): `scan_local_models` now scans only the single daemon-aware effective Ollama path via `resolve_ollama_models_dir()`, removing the previous dual-path scan that showed confusing "Ollama" + "Custom Ollama" groups; `open_model_cache` updated consistently; frontend `ModelSelector` removes `ollama_custom` source label/color/logic; i18n removes `sourceLabels.ollama_custom`
- **Code Cleanup** (BUG-091): Removed unused import `default_ollama_models_dir` from `training.rs`; removed dead `ollama_library_dir` function from `export.rs`; replaced hardcoded path examples in UI text with generic `/path/to/...` placeholders

## [0.4.1] - 2026-02-15

### Fixed
- **Chat Mode Generation Failure** (BUG-063): Fixed `Generation exited with code 1` for chat mode — increased `num_predict` from 2048→4096 and added truncated JSON recovery that collects inner `{role, content}` objects into conversations array
- **Dataset List Empty After Error** (BUG-064): `dataset:error` event handler now calls `_reloadFiles()` to restore historical datasets
- **Dataset List Cleared During Generation** (BUG-068): Removed `setDatasetVersions([])` from `startGenerationStep` — existing datasets stay visible during AI generation
- **Segment Preview Stale Data** (BUG-054): `preview_clean_segments` now validates against `segments_manifest.json` file signatures; only shows segments matching current raw files
- **Ollama Single-Segment Failure** (BUG-055): Added multilingual field normalization (`问题/回答` → `question/answer`), relaxed key-value extraction fallback, and small-batch language mismatch tolerance
- **AI Log Language Mismatch** (BUG-056): Switched from closure-captured `i18n.language` to global `i18nGlobal.language` for reliable language detection
- **Cleaned Data Isolation** (BUG-057): `start_cleaning` now deletes entire `cleaned/` directory before rebuilding to prevent stale data
- **Training Stop Loss Display** (BUG-046): Fixed empty loss state text after stopping training
- **Training Auto-Scroll** (BUG-047): Auto-scroll to top on training completion
- **Training Summary Save Button** (BUG-048): Removed invalid save button, kept copy and system share only

### Added
- **Smart Segmentation Preview**: Content-aware segmentation with `segments_manifest.json` validation for data consistency
- **Expandable Dataset Details** (BUG-059): Click to expand dataset items showing source files, generation type, method, train/valid counts with i18n labels
- **NEW Badge for Latest Dataset** (BUG-060): Theme-consistent text-only badge marking the most recently generated dataset
- **Dataset List Pagination** (BUG-061): 10 items per page with navigation controls
- **Inference Request ID**: Added `request_id` parameter to `start_inference` for concurrent request disambiguation

### Changed
- **Right Panel Redesign** (BUG-062): Renamed to "Data Preview" with consistent card styling matching left panel
- **Train/Valid Labels** (BUG-065, BUG-066): Moved from collapsed row to expanded details with descriptive i18n labels ("训练集 (train)" / "验证集 (valid)")
- **NEW Badge Style** (BUG-067): Removed Sparkles icon, uses `success` color token for theme consistency
- **Testing Page UX** (BUG-049~053): A/B mode moved to advanced collapsible, taller input, adapter collapsed by default, timeline removed, mode explanation text added
- **Auto-Scroll to Datasets** (BUG-058): Generation completion triggers smooth scroll to 1.4 section

## [0.4.0] - 2026-02-14

### Added
- **Content-Based Mode Detection**: Backend `sample_raw_files` command reads first 2000 bytes of each raw file; frontend `analyzeContentForModes()` combines file extension and content heuristics (prose/dialogue/headings/structured data) to recommend generation modes
- **Smart Mode Tab Badges**: Mode tabs show recommendation status icons — green checkmark for recommended, warning icon for cautious, no icon for available
- **Intelligent Default Mode Selection**: After file import, auto-selects the first recommended mode (priority: qa > instruct > style > chat) instead of always defaulting to first tab
- **Mode Detection Hint Text**: Context-aware hint below 1.3 section title describing detected content type (prose, dialogue, structured, general)

### Fixed
- **Generation Code 2 Root Cause** (BUG-042): Fixed stale closure bug where `startGenerationStep` captured initial empty `genMode=""` from `useEffect([], ...)` listener; now reads current values from `useGenerationStore.getState()`
- **Hardcoded Error String**: Replaced hardcoded "No generation mode selected" with i18n key `generate.noModeSelected`

### Changed
- Mode compatibility detection upgraded from extension-only heuristic to content-sampling analysis
- Old flat detection panel replaced with compact badge icons on mode tabs
- Removed `useMemo` and `Star` unused imports

## [0.3.0] - 2026-02-13

### Added
- **Python Script i18n System**: Full internationalization for all Python backend scripts (data generation, training, export, inference, cleaning) with `i18n.py` module and locale files (`en.json`, `zh-CN.json`)
- **Model Catalog Overhaul**: Expanded online model presets with brand grouping — added GLM (GLM 5, 4.5 Air, 4.7 Flash), GPT-OSS (20B), Kimi (K2.5, K2 Thinking, K2 Instruct), updated Qwen to Qwen 3, and organized by brand with expandable version lists
- **Ollama Online Model Groups**: Matching brand-grouped online model catalog for Ollama source (Qwen 3, DeepSeek R1, GLM 5, Llama 3, GPT-OSS, Kimi, Mistral, Phi)
- **Batch Size Auto-Clamping**: Automatically clamps batch_size to not exceed the smallest dataset split, preventing training crashes
- **Settings Deep Link**: Navigate directly to download source settings via `?focus=download-source` URL parameter with smooth scroll
- **README Screenshots**: Added 6 product screenshots covering the full workflow (Dashboard → Data Prep → Training → Test → Export)

### Changed
- All Python script log/error messages now use i18n translation keys instead of hardcoded Chinese strings
- Language parameter (`--lang`) passed from frontend through Rust backend to all Python scripts
- ModelSelector component fully restructured with sorted brand groups and "More" links to HuggingFace/Ollama search
- Updated default model placeholder to Qwen 3 series
- Removed Gemma from online model presets

### Fixed
- Training could crash when batch_size exceeded dataset line count — now auto-clamped

## [0.2.0] - 2026-02-12

### Added
- **Training Method Selection**: Choose between LoRA, DoRA, and Full fine-tuning methods with descriptive hints
- **Advanced Training Parameters**: lora_scale, lora_dropout, max_seq_length, gradient checkpointing, gradient accumulation, save interval, mask prompt loss, validation batches, steps per eval/report
- **Optimizer Selection**: Adam, AdamW, SGD, Adafactor
- **Training Summary Panel**: Post-training dashboard showing duration, final train/val loss, loss improvement percentage, key parameters, and adapter path
- **Training Duration Tracking**: Automatic timing from start to completion
- **Extreme Preset**: New 5000-iteration training preset for intensive fine-tuning
- **Theme System**: 5 built-in themes — Midnight, Ocean, Sunset, Nebula, Light — with persistent selection
- **Semantic Color Tokens**: Unified `success`, `warning`, `tag-hf`, `tag-ms`, `tag-mlx`, `tag-trained` color variables across all themes
- **Model Download Script**: New `download_model.py` with real-time progress reporting (JSON event stream)
- **Model Download Command**: Rust backend support for downloading HuggingFace models with progress tracking
- **Ollama Path Detection**: `find_ollama()` in executor for reliable Ollama binary discovery in .app bundles
- **One-click uv Installation**: Install uv package manager directly from Settings when not detected, using the official installer
- **Expanded uv Detection**: Added `~/.cargo/bin/uv`, `~/.local/bin/uv`, `~/.uv/bin/uv`, and Conda/Miniconda/Miniforge/Mambaforge paths

### Refactored
- Unified binary discovery logic into shared `find_binary()` helper (uv, ollama)

### Changed
- Updated slogan to "Say Goodbye to Complexity, Easily Create Your AI Model"
- Training step progress now shows Method and Params steps instead of single Training step
- Parameter summary format updated to show training method type
- Replaced hardcoded Tailwind color classes with semantic design tokens throughout UI
- Conditional LoRA config and `--num-layers` args — only passed for LoRA/DoRA, not Full fine-tuning
- Conditional `--grad-checkpoint` and `--mask-prompt` flags

### Improved
- Training page UX with collapsible advanced parameters section
- Settings page with theme picker and cleaner semantic styling

## [0.1.0] - 2026-02-12

### Added
- Initial public release of M-Courtyard
- **Data Processing**: Import documents (TXT, PDF, Markdown) and generate AI training datasets using local Ollama models
- **Multiple Generation Types**: Knowledge Q&A, Style Imitation, Multi-turn Dialogue, Instruction Training
- **Rule-based Generation**: Generate basic training data without any AI model
- **Incremental Save & Crash Recovery**: Every generated sample is saved immediately; resume after interruption
- **Model Fine-tuning**: LoRA/QLoRA fine-tuning via mlx-lm with real-time loss chart
- **Model Testing**: Interactive chat interface to test fine-tuned models before export
- **One-click Ollama Export**: Package and register fine-tuned models directly into Ollama
- **Multi-project Management**: Organize datasets, configs, and models per project with SQLite tracking
- **Internationalization**: Full English and Chinese UI support
- **GitHub Actions CI**: Automated .dmg build and release on tag push
- **Discord Integration**: Automated release notifications via webhook

[0.4.2]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.2
[0.4.1]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.1
[0.4.0]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.0
[0.3.0]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.3.0
[0.2.0]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.2.0
[0.1.0]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.1.0
