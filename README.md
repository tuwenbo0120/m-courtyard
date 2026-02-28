<div align="center">
  <img src="app/public/icon.png" alt="M-Courtyard Logo" width="128">
  
  # M-Courtyard

  **Zero-code local LLM fine-tuning & data prep on Apple Silicon. Privacy-first, powered by MLX.**

  [![macOS 14+](https://img.shields.io/badge/macOS-14%2B-black?logo=apple)](https://www.apple.com/macos)
  [![Apple Silicon](https://img.shields.io/badge/Apple-Silicon_M1--M4-black?logo=apple)](#)
  [![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://opensource.org/licenses/AGPL-3.0)
  [![Discord](https://img.shields.io/discord/1338515093796585523?label=Discord&logo=discord&logoColor=white&color=7289da)](https://discord.gg/v9ajdTSZzA)
  [![Release](https://img.shields.io/github/v/release/Mcourtyard/m-courtyard?label=Download)](https://github.com/Mcourtyard/m-courtyard/releases/latest)

  [English](README.md) | [简体中文](README_zh-CN.md)

</div>

---

<!-- TODO: GIF 压缩与录制建议
  建议使用工具（如 CleanShot X, Kap，或免费的 Gifski）录制一个 5~10 秒的快速展示（包括拖入文件->点击生成->开始训练）。
  录制后如文件过大，可以使用 https://ezgif.com 压缩，尽量保持在 5MB 以下。
  上传后，将下面的图片链接替换为你的 GIF 链接。
-->
<div align="center">
  <img src="docs/screenshots/dashboard.png" alt="M-Courtyard Showcase" width="800">
  <br>
  <em>(TODO: Replace the static image above with an engaging 10s GIF showcasing the workflow)</em>
</div>

<br>

## 🌟 Why M-Courtyard?

M-Courtyard is a **desktop assistant** designed to demystify LLM fine-tuning. Forget about writing Python scripts, managing CUDA dependencies, or renting expensive cloud GPUs. If you have an Apple Silicon Mac, you can build your own custom AI locally.

- **Zero-Code Pipeline**: From raw PDF/DOCX files to a playable Ollama model in 4 easy steps.
- **100% Local & Private**: No data leaves your machine. Perfect for fine-tuning on sensitive enterprise data or personal journals.
- **Optimized for Apple MLX**: Powered by `mlx-lm`, maximizing the potential of unified memory on M1/M2/M3/M4 chips.
- **AI-Powered Data Prep**: Automatically turn unstructured documents into high-quality instruction datasets using local reasoning models (like DeepSeek-R1 or Qwen).

## ✨ Features

### 🛠 Automated Data Preparation
- **Multi-format Import**: Drag & drop `.txt`, `.pdf`, `.docx`.
- **Smart Segmentation**: Automatically clean and chunk documents.
- **AI Dataset Generation**: Use local Ollama models to generate *Knowledge Q&A*, *Style Imitation*, or *Instruction Training* datasets.

### 🧠 Effortless Fine-tuning (LoRA)
- **Unified Model Hub**: Auto-detect local Ollama/HuggingFace models, or pull the latest models online (Qwen, DeepSeek, GLM, Llama, Mistral, etc.).
- **Live Visuals**: Real-time training loss charts, ETA, and resource monitoring.
- **Presets**: 1-click configurations (Quick / Standard / Thorough) for different needs.

### 🚀 Test & Export
- **Built-in Chat**: Test your fine-tuned adapter instantly.
- **One-Click Ollama Export**: Merge, quantize (Q4/Q8/F16), and export straight to Ollama. Play with your model immediately.

## 📸 Interface Tour

<details open>
<summary><b>Click to preview the workflow</b></summary>
<br>

| Data Preparation | Training Progress |
| :---: | :---: |
| <img src="docs/screenshots/data-preparation.png" alt="Data Prep" width="400"> | <img src="docs/screenshots/training-progress.png" alt="Training" width="400"> |
| **Test Model** | **Export to Ollama** |
| <img src="docs/screenshots/test-model.png" alt="Testing" width="400"> | <img src="docs/screenshots/export-ollama.png" alt="Export" width="400"> |

</details>

## ⚙️ Requirements

- **OS**: macOS 14+ (Sonoma or later)
- **Chip**: Apple Silicon (M1 / M2 / M3 / M4 series)
- **RAM**: 16 GB+ recommended (for 7B/8B models); 8 GB works for small models (1.5B/3B)
- **Dependencies**: [Ollama](https://ollama.com) installed and running (for AI data generation and inference)

## ⚡️ Quick Start

### Download the Pre-built App (Recommended)
1. Go to [**Releases**](https://github.com/Mcourtyard/m-courtyard/releases/latest) and download the latest `.dmg`.
2. Open the `.dmg` and drag **M-Courtyard.app** to your Applications folder.
3. Open Terminal and run this command to allow the app to run (since it's not code-signed yet):
   ```bash
   sudo xattr -rd com.apple.quarantine /Applications/M-Courtyard.app
   ```
4. Launch M-Courtyard from Applications!

<details>
<summary><b>Build from Source</b></summary>

**Prerequisites:**
- Node.js 18+ & `pnpm`
- Rust toolchain
- Xcode Command Line Tools (`xcode-select --install`)

```bash
# 1. Clone the repo
git clone https://github.com/Mcourtyard/m-courtyard.git
cd m-courtyard/app

# 2. Install dependencies
pnpm install

# 3. Development mode
pnpm tauri dev

# OR: Production build
pnpm tauri build
```
</details>

## 🛠 Tech Stack

- **Frontend**: React 19 + TypeScript + TailwindCSS v4 + Vite + Zustand
- **Desktop Framework**: Tauri 2.x (Rust)
- **AI Core**: `mlx-lm` (Apple MLX), local Python `venv` managed automatically
- **Storage**: SQLite + local filesystem

## 🤝 Community & Support

Join our community to share your fine-tuned models, get help, or suggest features!

- [Discord](https://discord.gg/v9ajdTSZzA) — Live chat & support
- [GitHub Discussions](https://github.com/Mcourtyard/m-courtyard/discussions) — Feature ideas and Q&A
- [GitHub Issues](https://github.com/Mcourtyard/m-courtyard/issues) — Bug reports

If M-Courtyard helps you build your local AI, please consider giving it a ⭐!

## 📄 License

M-Courtyard is open-source software licensed under the [AGPL-3.0 License](LICENSE).
For commercial use or different licensing terms, please contact: `tuwenbo0112@gmail.com`
