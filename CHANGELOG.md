# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.3] - 2026-04-10

### Fixed
- **macOS Environment Setup Regression**: Removed unsupported `--system-certs` CLI arguments from `uv` environment setup and dependency installation paths while preserving system certificate usage through `UV_SYSTEM_CERTS=true` environment injection.
- **Gemma 4 Local Model Detection / Training**: Improved local HuggingFace / ModelScope model scanning to recognize both standard hub-cache layouts and direct local model directories, and updated training selection to pass local model paths directly for scanned MLX models.
- **Gemma 4 Ollama Export Compatibility**: Added a `gemma4` architecture fallback (`Gemma4ForConditionalGeneration`) when exporting fused models to Ollama.

### Changed
- **Online Model Lists**: Restored Qwen to the latest locally available `Qwen 3.5` series, added the Gemma 4 series, removed Phi, and refreshed HF / Ollama model links to match currently available local model sources.
- **Training Environment Dependencies**: Upgraded environment setup to install `mlx-lm[train]>=0.31.2` so Gemma 4 training support is available in the app-managed Python environment.
- **HF GLM Recommendations**: Updated the HuggingFace MLX GLM recommendations to current public GLM-5 quantized variants while keeping Ollama on non-cloud `glm-4.7-flash`.

## [0.5.2] - 2026-03-25

### Added
- **Enterprise Network Compatibility (Cluster 11)**: Added a dedicated **Network & Proxy** section in Settings so users can configure `HTTP_PROXY`, `HTTPS_PROXY`, `SSL_CERT_FILE`, and `SSL_CERT_DIR` directly in the app.

### Fixed
- **uv TLS Certificate Handling**: Replaced the deprecated `--native-tls` flag with the officially recommended `--system-certs` flag across all `uv` subprocesses used for environment setup and dependency installation.
- **Corporate Proxy / Certificate Inheritance**: Added shared environment injection for `uv` subprocesses so proxy variables and custom certificate settings from either app config or the user's shell environment are passed through consistently, including `UV_SYSTEM_CERTS=true`.
- **Settings LM Studio Connectivity Check**: Fixed the Settings page LM Studio API check to match the backend response shape and report model count correctly.
- **uv Installer Network Compatibility**: The in-app `Install uv` flow now also receives enterprise proxy and certificate environment variables, improving first-time setup behind corporate networks.

### Changed
- Updated app version, bundled metadata, Settings version display, and release materials to `0.5.2`.

## [0.5.1] - 2026-03-23

### Added
- **Training History Workspace**: Added a dedicated history experience for completed runs, including expandable details, parameter review, note editing, and side-by-side comparison.
- **History Management Utilities**: Added batch selection and batch deletion for adapter-backed training records.

### Fixed
- **Training Result Persistence**: Training metadata and loss-series data are now written reliably from the Rust backend at the end of training, fixing missing `training_result.json` files and `N/A` metrics in history.
- **Loss Curve Rendering in History**: Fixed blank or inconsistent loss charts in training history and comparison mode, including the case where one record has only a single loss point or another compared record has no curve data.
- **Training Status Accuracy**: Active runs no longer appear in history as stopped/unknown before results are finalized, and completed/stopped runs now refresh into history more reliably.

### Changed
- Updated the app version, release metadata, and public documentation to `0.5.1`.

## [0.5.0] - 2026-03-17

### Added
- **LM Studio First-class Local Runtime Path**: M-Courtyard now treats LM Studio as a parallel local runtime for AI dataset generation instead of presenting Ollama as the only practical option.
  - Added LM Studio model discovery and scanning updates for the current LM Studio storage layout
  - Added LM Studio local server preflight checks for clearer connection / model availability feedback
  - Added in-app actions to open LM Studio and check the local server connection directly from the model selector
  - Added a simplified single-panel LM Studio model selection flow for Data Prep
- **Runtime Positioning Refresh Across Docs**: README, release notes, and in-app copy now explain Ollama, LM Studio, built-in rules, MLX export, and GGUF export as parallel supported paths rather than centering everything around Ollama

### Fixed
- **LM Studio Server Guidance**: Refined the user guidance to match the actual LM Studio flow (`Developer → Local Server → Status = Running / ⌘R`) instead of vague “start server” messaging
- **LM Studio Model Detection**: Fixed local model scanning so current LM Studio model directories are detected more reliably
- **LM Studio Connection Feedback**: The “Check Connection” action now returns an explicit visual result instead of ending with no clear success/failure state

### Changed
- Updated the app version and release materials to `0.5.0`
- GitHub release requirements text now lists `Ollama` and `LM Studio` side by side and explicitly mentions the built-in rules fallback

## [0.4.11] - 2026-03-11

### Added
- **Notification Center (Core Feature)**: Added a dedicated in-app notification center and channel configuration flow for long-running events across dataset generation, training, and export.
  - New notification panel accessible from the app shell, with channel management and event-level switches
  - Added persistent notification history storage in SQLite so users can review recent events even after banners disappear
  - Dashboard and workflow pages now surface unread notification state more clearly
  - Added bilingual i18n (en / zh-CN) for the new notification UI and event content
- **Multi-Channel Outbound Notifications**: Added support for 9 notification channels for external delivery:
  - Generic Webhook
  - Slack
  - Discord
  - Telegram Bot
  - Feishu
  - WeCom
  - ntfy
  - Bark
  - Pushover

### Fixed
- **macOS Native Notifications Reliability**: Fixed the regression where packaged macOS builds could end up with no visible notification at all.
  - Root cause: Finder-launched `.app` bundles may not inherit a PATH containing `/usr/bin`, so spawning `osascript` / `afplay` by bare command name could fail silently
  - Fix: switched to absolute binary paths (`/usr/bin/osascript`, `/usr/bin/afplay`) for production-safe notification and sound delivery
  - Notification sound playback is now decoupled from banner delivery so a notification failure no longer suppresses the completion sound
- **macOS Notification Permission Reporting**: Removed the hardcoded `"granted"` backend response and replaced it with real permission-state inspection for the notification path currently used on macOS
- **macOS Notification Sound Default**: Replaced the previous `Ping` sound with the built-in `Glass` sound for a cleaner completion cue
- **Notification Entry Cleanup**: Removed the temporary "test system notification" entry and related UI copy so the final user-facing flow stays focused on real task notifications and history

### Changed
- macOS notification delivery now consistently uses the verified `osascript` path for both development and packaged builds, prioritizing reliability over experimental app-icon routing
- Notification configuration is now treated as a first-class app feature rather than a development-only diagnostic path

## [0.4.10] - 2026-03-07

### Fixed
- **Training Max Sequence Length UX**: Reworked the Training page `max_seq_length` control into a clearer preset-or-custom flow. Users can now choose a preset value from the dropdown or switch the control into an editable custom input, and the latest custom value is submitted correctly when starting training or adding to queue.
- **Testing Page Config Visibility + Multi-turn Context**: The Testing page settings button now shows its configuration panel independently instead of rendering inside a collapsed adapter section. Inference now sends the full conversation history instead of only the last user message, preventing false context-loss behaviour during chat testing.
- **Testing Page Input Focus + Visual Hierarchy**: The chat input area is now visually more prominent and automatically receives focus when entering the Testing page, making the primary testing action clearer.
- **Settings Return Navigation**: Added an explicit back button to the Settings page. When Settings is opened from a project subsection, the button returns to that exact page; otherwise it falls back to the previous route.
- **Rust Inference Command Visibility**: Fixed the Tauri build error caused by `InferenceMessage` being private by making the struct public for command argument deserialization.

## [0.4.9] - 2026-03-04

### Fixed
- **Quantized Model + Full Fine-tuning Interception**: Attempting "Full" fine-tuning with a quantized model (4-bit / 8-bit) now fails early with a clear error message instead of crashing mid-training with an opaque MLX error (`[QuantizedMatmul::vjp] no gradient wrt the quantized weights`). The backend validates the combination before starting; the frontend adds a hover tooltip on the "Full" method tab and a proactive warning banner when a quantized model is selected alongside "Full". Bilingual (en / zh-CN).

### Added
- **Custom JSONL Dataset Import (D-11)**: Power users can now import their own pre-formatted JSONL datasets directly from the Training page (step 2.2), bypassing the Data Preparation stage entirely.
  - New "Import Dataset" button in the 2.2 section header — works alongside existing dataset list.
  - Click opens a format-guide dialog explaining folder structure (`train.jsonl` required, `valid.jsonl` optional) and supported line formats (Completion `{prompt, completion}` / Chat `{messages: [...]}`).
  - Backend validates format (first 5 lines, field completeness) before copying; rejects malformed files with a specific error message (e.g. "missing prompt field", "not valid JSON").
  - Imported datasets appear in the dataset list with "Imported" source/type label in the expanded detail view.
  - Bilingual i18n (en / zh-CN).
- **rsLoRA Scaling Strategy (T-3 / 集群八)**: Advanced LoRA training option for power users who train at high rank.
  - New collapsible "Advanced" section in step 2.3 (Training Method), visible only when LoRA or DoRA is selected.
  - Two options: **Standard** (alpha / r, default) and **rsLoRA** (alpha / √r) — keeps the effective learning signal stable at rank ≥ 32.
  - When rsLoRA is active, the collapsed header shows a blue "rsLoRA" badge as a visual reminder.
  - Backend injects `use_rslora: true` into `lora_config.yaml` passed to `mlx_lm lora`.
  - Bilingual i18n (en / zh-CN).

## [0.4.8] - 2026-02-28

### Fixed / 修复
- Removed redundant preview text ("Select a file on the left to preview its content") in Data Prep page. / 移除了数据准备页面多余的预览提示硬编码中文及冗余文本。
- Redesigned the chat input field and send button in the Testing page to match mainstream AI chat interfaces with auto-resizing capability. / 重构了测试模型页面的聊天输入框与发送按钮，采用包裹式设计和自动高度调整，使其交互体验更符合主流大模型应用。
- Added two-step confirmation dialog before executing "Clean Up Cache" to prevent accidental deletion. / 一键清理缓存操作前新增二次确认弹窗，防止误操作删除文件。

### Added
- **Online Models Update (FEAT-013)**: Upgraded default online model lists to the latest series and locally deployable versions:
  - Qwen updated to Qwen 3.5 series (35B/27B/122B) across HuggingFace and Ollama.
  - GLM updated to 4.7-Flash-4/8bit (HuggingFace) and 4.7-Flash (Ollama), removing the un-deployable 400GB GLM-5-4bit.
  - DeepSeek added R1-0528 (8B) to the top of the list for both platforms.
  - Updated "More Models" external links to point directly to the latest series pages.
  - Fixed syntax bug in `llama4:scout` entry.
- **Global Hover Tooltip System (FEAT-001 → FEAT-012)**: Deployed a unified Tooltip architecture across the entire application:
  - DataPrep: 1.1/1.2/1.3 section headers, Data Preview tab, Smart Segmentation tab, generated dataset titles, segmentation strategy cards — all support full-area hover tooltips with bilingual i18n (FEAT-005/010)
  - Training: 2.1/2.2/2.3 section headers, 3 progress metric cards (ETA/Health/Trend), 4 summary metric cards (Duration/TrainLoss/ValLoss/Improvement) — all upgraded to full-area hover tooltips; removed legacy static hint text from 2.3 (FEAT-012)
  - Export: 4.1/4.2/4.3 section headers upgraded from Info-icon trigger to full-area h3 hover; GGUF/MLX/Inference Server cards converted description text to title hover tooltips; removed inline subtitles from expanded sections (FEAT-006/011)
  - Advanced Settings: 5 tooltip trigger zones expanded from Info icon to entire label row (FEAT-003)
- **UI Scale Customization (FEAT-002)**: Added "UI Scale" setting (Small/Normal/Large/Extra Large) in Settings; fixed hardcoded pixel font sizes (`text-[10px]`/`text-[11px]`) across Training/DataPrep/Export pages to `rem`-based values for proper scaling
- **Removed Redundant Checkboxes (FEAT-004)**: Removed duplicate "Smart Segmentation" and "Merge Datasets" checkboxes from 1.1 file list footer (already in Advanced Settings)

### Fixed
- **Export "Open Folder" Path Correctness (BUG-133/134)**: Ollama export main button now opens the actual Ollama models directory (`ollamaDir`) instead of the intermediate working directory (`outputDir`) which may be empty after cleanup; fused model button now opens `fusedDir` directly where the MLX/LM Studio files actually reside
- **Unified "Open Folder" Button Style (BUG-135)**: Standardized all "Open Folder" buttons across Export, Training, Testing, and DataPrep pages to a consistent capsule style (`inline-flex items-center gap-1.5 rounded-md border ...`)
- **Export 4.4 i18n Key Leak**: Fixed `exportOllama.title` → `ollama.title`, added missing i18n keys `section.exportModelHint` and `step.run` in both locales
- **Export 4.4 Redesign**: Rewritten as a collapsible card consistent with 4.1/4.2/4.3; moved `keepFused` checkbox below export button; progress panel stays visible when section is collapsed
- **Training Tooltips Restored**: Restored missing tooltips on Training 2.1 (Select Model), 2.2 (Select Dataset), 2.3 (Training Method) with Info icons and bilingual content
- **Tooltip Styling Unified**: Global `TooltipContent` upgraded to `text-sm`, `leading-relaxed`, `px-3.5`, `py-2` with `max-w-[450px]` for consistent readability
- **DataPrep Smart Segmentation Preview (BUG-128–132)**: Fixed stats not refreshing per file; fixed partial file deletion clearing all previews; removed redundant filename display; fixed English truncation of strategy names
- **DataPrep Clear Data (BUG-124–127)**: Added `clear_project_data` Rust command for true disk deletion; added confirmation dialogs on all four pages; fixed segmentPreview not clearing
- **DataPrep Layout (BUG-118–123)**: Refactored 1.2/1.3/Advanced Settings into independent collapsible cards; fixed 1.3 invisible when step2Open=false; fixed auto-expand timing; fixed clear-all button style
- **ModelSelector UX (BUG-117/121/122)**: Dynamic source tag colors; auto-expand to Ollama on file upload; hide unusable sources per mode

### Changed
- Export success card "Open Folder" priority: `ollamaDir` → `manifestDir` → `outputDir` → parent of `fusedDir` (was `outputDir` first)
- Removed redundant base model info line from Export 4.1 section

## [0.4.7] - 2026-02-25

Feature release delivering the **Multi-Target Export** cluster (E-5 · E-6 · E-7) and a GGUF error experience improvement.

### Added
- **Keep MLX Fused Model (E-5)**: New "Keep fused model" checkbox (default on) during Ollama export preserves the intermediate MLX safetensors directory so it can be loaded directly into LM Studio without re-exporting
- **Export as MLX Model**: Dedicated standalone MLX export section — fuses LoRA adapter into a full MLX safetensors model, saved to `export/mlx/`, ready to drag into LM Studio or use with `mlx-lm.server`
- **Local Inference Server (E-6)**: One-click start/stop for `mlx-lm.server` after MLX export; displays live OpenAI-compatible API endpoint; supports OpenWebUI, AnythingLLM, Chatbox, and any OpenAI-compatible client
- **Post-Export Connection Guide (E-7)**: Collapsible "How to connect" panel in the Export page covering all four deployment paths: Ollama / LM Studio MLX / mlx-lm server / GGUF
- **GGUF Architecture Error — Friendly Message**: When `mlx_lm` reports that a model architecture is not supported for GGUF conversion (e.g. `mistral3`), the error is now translated into a clear, actionable message explaining it is an upstream third-party limitation, not an M-Courtyard bug, and suggests MLX export as an alternative

### Fixed
- **Export Success Card Path** (BUG-114): Top "Open Folder" button in the export success card now prioritises the retained MLX fused directory (`fusedDir`) when available, rather than always opening the Ollama models directory
- **Export Success Card UI** (BUG-115): Redesigned the result card — removed `text-[10px]`/`text-[11px]` micro-font sizes, promoted to `text-xs`/`text-sm`, added section dividers and a cleaner dark code block style for model paths

### Changed
- `keepFused` defaults to `true` so the fused model is preserved unless the user explicitly opts out

## [0.4.6] - 2026-02-24

Critical bug-fix release addressing PDF/DOCX processing failures reported by the community and a UI regression in the data preview panel.

### Added
- **PDF & DOCX Training Support**: Import and train directly from `.pdf` and `.docx` files — no conversion to `.txt` required; dependencies (`PyPDF2`, `python-docx`) are auto-installed on first use via `uv`
- **Auto-install Document Dependencies**: `ensure_doc_deps()` runs once per session at the start of cleaning and file preview; silently installs missing libraries so users never see a manual `pip install` instruction
- **Content Language Auto-Detection**: Generation scripts now detect the dominant language of source content (CJK, Latin, Cyrillic, Arabic, Hangul, Kana) and automatically select matching prompt templates — Chinese UI + English PDF now produces English training data without language-mismatch rejections
- **Dual i18n Context**: `t()` for UI/log messages (follows `--lang` flag), `pt()` for LLM prompt templates (follows detected content language); easily extensible by adding a new `locales/<lang>.json` file

### Fixed
- **PDF/DOCX Generation Code 1** (BUG-108/109): All builds over the past week exited with `code 1` when source files included PDFs; root cause was missing `PyPDF2`/`python-docx` and no extraction path in the cleaning pipeline; now fully resolved
- **Data Preview Panel Collapse** (BUG-110): The right-hand log panel collapsed to a blank card immediately after clicking "Start Generation" if the user was on the Smart Segmentation tab; removing a redundant `&& previewTab !== "segment"` gate and adding explicit `setPreviewTab("data")` in all three generation entry points (`handleStartPipeline`, `startGenerationStep`, `handleRetryFailed`) fixes this permanently
- **Language Mismatch Rejection** (BUG-111): With Chinese UI language, English PDF content was being rejected mid-generation due to a mismatch between UI-language prompts and English-language content; prompts now follow content language, not UI language

### Changed
- Prompt templates in `generate_dataset_ollama.py` and `generate_dataset_builtin.py` now use `pt()` instead of `t()`; log/error messages retain `t()` as before

## [0.4.5] - 2026-02-23

Delivers the **Data Quality Improvement** cluster (PRD D-3 · D-4 · D-5 · D-6) plus a critical cross-project isolation fix, a reworked Smart Segmentation preview UX, and readability improvements.

### Added
- **Cleaning Quality Controls (1.2)**: Added Privacy Filter, Fuzzy Deduplication, and Quality Scoring toggles in Data Preparation; fuzzy dedup supports a configurable similarity threshold slider
- **Failed Sample Batch Retry**: Dataset items now show failed sample count and provide a one-click retry action that regenerates only failed segments from a selected historical version
- **Quality Badge and Score**: Dataset list and expanded details now display quality grade (A/B/C) and score when quality scoring is enabled
- **Smart Segmentation Preview Tab**: The right-hand preview panel now has two tabs — "Data Preview" and "Smart Segmentation"; the segment tab is only shown when not generating/cleaning; the tab header displays the total segment count and auto-detected strategy label
- **Auto-Segmentation on File Upload**: New "Smart Segmentation" checkbox in the 1.1 toolbar (default on, next to "Merge as Single Dataset"); when enabled, uploading files via Add Files, Add Folder, or drag-and-drop automatically triggers text cleaning and segmentation so results are immediately viewable in the Segment tab
- **Auto-Switch to Segment Tab**: After auto-segmentation completes the preview panel automatically switches to the Smart Segmentation tab

### Changed
- **Generation Parameter Pipeline**: Frontend store, Tauri command parameters, and Python scripts are now aligned to pass `privacy_filter`, `fuzzy_dedup`, `fuzzy_dedup_threshold`, `quality_scoring`, `retry_failed_only`, and `input_segments`
- **Retry Flow Guard**: `generate_dataset` now validates cleaned segments only for normal generation; retry mode no longer incorrectly blocks on missing `cleaned/segments.jsonl`
- **Preview Area Font Sizes**: Data preview text increased from `text-xs` to `text-sm` with `leading-loose` for improved readability; Smart Segmentation item titles use `text-sm font-semibold`, stat values use `text-base font-semibold`, body previews use `text-sm leading-relaxed text-foreground/80`

### Fixed
- **Cross-Project Data Persistence — Root Cause** (BUG-106/107): The previous fix placed `key` on `<Route element>` which React Router v6 does not propagate through `<Outlet>`; fixed by adding `key={projectId}` directly on the `<Outlet>` in `AppLayout`, forcing a complete re-mount of all child routes on project switch; removed now-redundant `key` props from individual `<Route>` elements in `App.tsx`
- **Legacy Script Compatibility**: Added parser support for new generation flags in fallback scripts to prevent argument parsing errors (`exit code 2`) when quality/retry options are passed

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

[0.5.2]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.5.2
[0.5.1]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.5.1
[0.5.0]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.5.0
[0.4.11]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.11
[0.4.10]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.10
[0.4.9]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.9
[0.4.8]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.8
[0.4.7]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.7
[0.4.6]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.6
[0.4.5]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.5
[0.4.4]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.4
[0.4.3]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.3
[0.4.2]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.2
[0.4.1]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.1
[0.4.0]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.4.0
[0.3.0]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.3.0
[0.2.0]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.2.0
[0.1.0]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.1.0
