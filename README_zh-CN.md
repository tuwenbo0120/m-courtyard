<div align="center">
  <img src="app/public/icon.png" alt="M-Courtyard Logo" width="128">
  
  # M-Courtyard

  **在 Apple Silicon 上零代码本地微调大模型与数据处理。隐私优先，基于 MLX。**

  [![macOS 14+](https://img.shields.io/badge/macOS-14%2B-black?logo=apple)](https://www.apple.com/macos)
  [![Apple Silicon](https://img.shields.io/badge/Apple-Silicon_M1--M4-black?logo=apple)](#)
  [![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://opensource.org/licenses/AGPL-3.0)
  [![Discord](https://img.shields.io/discord/1338515093796585523?label=Discord&logo=discord&logoColor=white&color=7289da)](https://discord.gg/v9ajdTSZzA)
  [![Release](https://img.shields.io/github/v/release/Mcourtyard/m-courtyard?label=下载)](https://github.com/Mcourtyard/m-courtyard/releases/latest)

  [English](README.md) | [简体中文](README_zh-CN.md)

</div>

---

<div align="center">
  <img src="docs/screenshots/0228/training-2.gif" alt="M-Courtyard 训练演示" width="800">
</div>

<br>

## 为什么选择 M-Courtyard？

M-Courtyard 是一个**桌面端助手**，旨在简化大模型微调流程。告别编写复杂的 Python 脚本、管理 CUDA 依赖或租用昂贵的云端 GPU。只要你有一台 Apple Silicon 的 Mac，就可以在本地构建属于自己的专属 AI。

- **零代码全流程**：从原始 PDF/DOCX 文件到可运行的 Ollama 模型，只需简单的 4 步。
- **100% 本地与隐私**：所有数据均不出本机，非常适合基于企业敏感数据或个人日记进行微调。
- **专为 Apple MLX 优化**：基于 `mlx-lm`，充分压榨 M1/M2/M3/M4 芯片统一内存的潜力。
- **AI 赋能数据处理**：使用本地推理模型（如 DeepSeek-R1 或 Qwen），自动将非结构化文档转化为高质量的指令数据集。

## 核心功能

### 自动化数据准备
- **多格式导入**：支持拖拽导入 `.txt`、`.pdf`、`.docx` 文件。
- **智能分段**：自动清理和切分文档内容。
- **AI 数据集生成**：使用本地 Ollama 模型生成 *知识问答*、*风格模仿* 或 *指令训练* 数据集。

### 轻松微调 (LoRA)
- **统一模型库**：自动检测本地 Ollama/HuggingFace 模型，或在线拉取最新模型（Qwen、DeepSeek、GLM、Llama、Mistral 等）。
- **实时可视化**：提供实时的训练 Loss 曲线、预计剩余时间（ETA）和资源监控。
- **训练预设**：一键应用预设配置（快速 / 标准 / 深度），满足不同训练需求。

### 测试与导出
- **内置对话测试**：即时测试微调后的适配器效果。
- **一键导出至 Ollama**：合并权重、量化（Q4/Q8/F16），并直接导出至 Ollama，立即与你的模型对话。

## 界面预览

### 1. 数据准备
导入文档，自动清洗，并使用本地大模型生成训练数据集。
<div align="center">
  <img src="docs/screenshots/0228/data-prep-1.png" alt="数据准备 1" width="48%">
  &nbsp;
  <img src="docs/screenshots/0228/data-prep-2.gif" alt="数据准备 2" width="48%">
</div>

### 2. 模型训练
基于 Apple MLX 驱动，实时呈现 Loss 曲线、预计完成时间和训练进度。
<div align="center">
  <img src="docs/screenshots/0228/training-1.gif" alt="训练进度 1" width="48%">
  &nbsp;
  <img src="docs/screenshots/0228/training-3.png" alt="训练总结" width="48%">
</div>

### 3. 测试与导出
通过内置聊天界面即时验证微调后的适配器质量，并一键量化导出至 Ollama。
<div align="center">
  <img src="docs/screenshots/0228/test-model.png" alt="测试模型" width="48%">
  &nbsp;
  <img src="docs/screenshots/0228/export-2.gif" alt="导出至 Ollama" width="48%">
</div>

## 系统要求

- **操作系统**: macOS 14+ (Sonoma 或更高版本)
- **芯片**: Apple Silicon (M1 / M2 / M3 / M4 系列)
- **内存**: 推荐 16 GB+（适用于 7B/8B 模型）；8 GB 可运行小参数模型（1.5B/3B）
- **依赖项**: 需安装并运行 [Ollama](https://ollama.com)（用于 AI 数据生成与推理）

## 快速开始

### 下载预编译应用 (推荐)
1. 前往 [**Releases**](https://github.com/Mcourtyard/m-courtyard/releases/latest) 页面下载最新的 `.dmg` 文件。
2. 打开 `.dmg` 文件，将 **M-Courtyard.app** 拖入应用程序（Applications）文件夹。
3. 打开终端（Terminal），运行以下命令以允许应用运行（因为目前尚未进行代码签名）：
   ```bash
   sudo xattr -rd com.apple.quarantine /Applications/M-Courtyard.app
   ```
4. 从应用程序中启动 M-Courtyard！

<details>
<summary><b>从源码构建</b></summary>

**前置条件:**
- Node.js 18+ & `pnpm`
- Rust 工具链
- Xcode 命令行工具 (`xcode-select --install`)

```bash
# 1. 克隆仓库
git clone https://github.com/Mcourtyard/m-courtyard.git
cd m-courtyard/app

# 2. 安装依赖
pnpm install

# 3. 运行开发模式
pnpm tauri dev

# 或者：构建生产版本
pnpm tauri build
```
</details>

## 技术栈

- **前端**: React 19 + TypeScript + TailwindCSS v4 + Vite + Zustand
- **桌面端框架**: Tauri 2.x (Rust)
- **AI 核心**: `mlx-lm` (Apple MLX)，自动管理本地 Python `venv`
- **数据存储**: SQLite + 本地文件系统

## 社区与支持

加入我们的社区，分享你的微调模型、获取帮助或提出功能建议！

- [Discord](https://discord.gg/v9ajdTSZzA) — 实时交流与支持
- [GitHub Discussions](https://github.com/Mcourtyard/m-courtyard/discussions) — 功能建议与问答
- [GitHub Issues](https://github.com/Mcourtyard/m-courtyard/issues) — Bug 反馈

如果 M-Courtyard 帮助你构建了本地 AI，请考虑在 GitHub 上给它点个 ⭐！

## 支持项目

如果 M-Courtyard 为你节省了时间，欢迎请我喝杯咖啡 ☕ 你的支持是持续开发的最大动力！

<a href='https://ko-fi.com/M4M1IVCOTA' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi6.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

国内用户也可通过 [爱发电](https://afdian.com/a/mcourtyard) 支持（支持微信支付 / 支付宝）。

## 许可证

M-Courtyard 是一款基于 [AGPL-3.0 许可证](LICENSE) 的开源软件。
如需商业用途或其他许可条款，请联系：`tuwenbo0112@gmail.com`
