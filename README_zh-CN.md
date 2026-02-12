<div align="center">

<!-- TODO: 替换为实际的产品 Banner 图 -->
<!-- <img src="docs/images/banner.png" alt="M-Courtyard Banner" width="100%" /> -->

# 🏡 M-Courtyard

**告别繁琐，简单创建您的AI大模型**

*从原始文档到可部署的 Ollama 模型 — 全程在你的 Mac 上完成。*

[![GitHub stars](https://img.shields.io/github/stars/tuwenbo0120/m-courtyard?style=social)](https://github.com/tuwenbo0120/m-courtyard/stargazers)
[![GitHub Downloads](https://img.shields.io/github/downloads/tuwenbo0120/m-courtyard/total)](https://github.com/tuwenbo0120/m-courtyard/releases)
[![GitHub Release](https://img.shields.io/github/v/release/tuwenbo0120/m-courtyard)](https://github.com/tuwenbo0120/m-courtyard/releases/latest)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/tuwenbo0120/m-courtyard)](https://github.com/tuwenbo0120/m-courtyard/commits/main)
[![Discord](https://img.shields.io/discord/1471348538909790260?color=5865F2&label=Discord&logo=discord&logoColor=white)](https://discord.gg/hjkrHWrQ)

**[English](./README.md)** | 中文

</div>

---

## 为什么选择 M-Courtyard？

大多数微调工具依赖命令行、需要云端支持，或者需要手动拼接多个脚本。M-Courtyard 将**完整流程**封装为一个引导式桌面应用 — 基于 [Ollama](https://ollama.com) + [mlx-lm](https://github.com/ml-explore/mlx-examples/tree/main/llms/mlx_lm)：

| 步骤 | 功能说明 |
|------|---------|
| **1. 数据准备** | 导入文档（txt/docx/pdf）→ 自动清洗 → AI 生成训练数据集（知识问答/风格模仿/多轮对话/指令训练） |
| **2. 训练模型** | 选择基础模型 → 选择数据集 → 配置 LoRA 参数 → 实时 Loss 曲线 + 进度条 |
| **3. 测试模型** | 与微调后的适配器对话，验证效果 |
| **4. 导出模型** | 一键导出为 Ollama 可用模型（Q4/Q8/F16 量化） |

> **100% 本地运行。无需云服务。无需 API Key。数据不出本机。**

<!-- TODO: 添加产品截图或演示 GIF -->
<!-- <div align="center">
  <img src="docs/images/screenshot-overview.png" alt="M-Courtyard 截图" width="80%" />
</div> -->

## 下载安装

> **大多数用户直接下载预构建应用即可。** 从源码构建仅用于开发。

| 平台 | 芯片 | 下载 |
|------|------|------|
| macOS 14+ | Apple Silicon (M1/M2/M3/M4) | [📦 下载 .dmg](https://github.com/tuwenbo0120/m-courtyard/releases/latest) |

> **⚠️ macOS 安全提示**
> 由于应用未使用 Apple 开发者证书签名，macOS 可能提示"已损坏"。安装后在终端运行以下命令即可正常使用：
> ```bash
> sudo xattr -rd com.apple.quarantine /Applications/M-Courtyard.app
> ```

<!-- TODO: 支持更多平台后在此添加 -->

## 核心特性

### 数据处理与生成
- **AI 数据集生成** — 利用本地大模型自动将文档转换为高质量训练数据
- **多种生成类型** — 知识问答 / 风格模仿 / 多轮对话 / 指令训练
- **内置规则生成** — 无需 AI 也可基于规则模板生成基础训练数据
- **增量保存 & 断点恢复** — 每条数据即时保存，中断后可从断点恢复

### 模型训练
- **mlx-lm LoRA 训练** — 基于 Apple MLX 框架，充分利用 Apple Silicon 统一内存
- **实时训练可视化** — Loss 曲线图、迭代进度条、实时日志
- **多来源模型** — 自动检测 Ollama 模型，扫描本地 HuggingFace/ModelScope 缓存，在线自动下载
- **可配置下载源** — 在设置中切换 HuggingFace / HF 镜像源（国内加速）/ ModelScope
- **训练预设** — 快速 / 标准 / 深度 三种配置满足不同需求

### 导出与部署
- **一键导出到 Ollama** — 支持 Q4/Q8/F16 量化格式
- **通用模型支持** — Llama、Qwen、DeepSeek、Phi、Mistral、Gemma 等
- **适配器管理** — 管理和测试多个微调后的适配器

### 用户体验
- **四步引导式流程** — 统一进度条 + 子步骤时间轴
- **全流程本地运行** — 数据不出本机，隐私安全
- **防睡眠** — 长时间任务自动阻止系统进入睡眠
- **国际化** — 支持中文和英文界面，可在设置页面切换

## 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | macOS 14+ (Sonoma 或更高) |
| 芯片 | Apple Silicon (M1/M2/M3/M4 系列) |
| 内存 | 建议 16GB+（7B 模型微调），8GB 可运行 3B 模型 |
| 依赖 | [Ollama](https://ollama.com)（AI 生成用）· uv（Python 环境管理，自动检测） |

## 快速开始

### 方式一：下载安装包（推荐）

1. 前往 [**Releases**](https://github.com/tuwenbo0120/m-courtyard/releases/latest) 下载最新 `.dmg` 文件
2. 打开 `.dmg` 文件，将 **M-Courtyard.app** 拖入应用程序文件夹
3. 启动 M-Courtyard — 开始使用！

### 方式二：从源码构建

<details>
<summary>点击展开构建步骤</summary>

**前置条件：**

| 工具 | 安装方式 |
|------|---------|
| Node.js 18+ | [nodejs.org](https://nodejs.org) 或 `brew install node` |
| pnpm | `npm install -g pnpm` |
| Rust 工具链 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Xcode 命令行工具 | `xcode-select --install` |
| Ollama | [ollama.com](https://ollama.com) |

**构建步骤：**

```bash
# 1. 克隆仓库
git clone https://github.com/tuwenbo0120/m-courtyard.git
cd m-courtyard/app

# 2. 确保 Rust 已加入 PATH（首次安装后需要）
source "$HOME/.cargo/env"

# 3. 安装前端依赖
pnpm install

# 4a. 开发模式（热更新，快速迭代）
pnpm tauri dev

# 4b. 或者：构建发布版本（生成 .app / .dmg）
pnpm tauri build
```

**构建产物：**

| 产物 | 位置 |
|------|------|
| `.app` 应用 | `src-tauri/target/release/bundle/macos/M-Courtyard.app` |
| `.dmg` 安装包 | `src-tauri/target/release/bundle/dmg/M-Courtyard_<version>_aarch64.dmg` |

> **注意：** `pnpm tauri dev` 开发模式下，macOS Dock 图标会显示为 Tauri 默认图标。自定义应用图标仅在生产构建（`pnpm tauri build`）后生效。

</details>

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + TailwindCSS v4 + Vite |
| 桌面框架 | Tauri 2.x (Rust) |
| 状态管理 | Zustand |
| AI 推理 | Ollama（本地 HTTP API） |
| 模型训练 | mlx-lm (Apple MLX Framework, LoRA) |
| Python 环境 | uv + venv（自动管理） |
| 数据存储 | SQLite + 本地文件系统 |
| 国际化 | 中文 & 英文 |

## 项目结构

```
m-courtyard/
├── app/
│   ├── src/                      # React 前端
│   │   ├── pages/                # 页面组件（数据准备、训练、测试、导出）
│   │   ├── components/           # 共享组件（StepProgress、ModelSelector 等）
│   │   ├── stores/               # Zustand 状态管理
│   │   ├── services/             # 服务层（项目、训练）
│   │   └── i18n/                 # 国际化 (en / zh-CN)
│   ├── src-tauri/                # Rust 后端
│   │   ├── src/commands/         # Tauri IPC 命令
│   │   ├── src/python/           # Python 子进程管理
│   │   ├── scripts/              # Python 脚本（清洗/生成/导出/推理）
│   │   └── icons/                # 应用图标
│   └── package.json
├── LICENSE                       # AGPL-3.0 许可证
├── README.md                     # English
└── README_zh-CN.md               # 本文件
```

## 使用流程

1. **创建项目** — 为你的微调任务创建一个独立项目空间
2. **数据准备** (1.1~1.5)
   - 导入原始文件（txt / docx / pdf）
   - 自动清洗（去噪、修复编码、智能分段）
   - 选择生成方式（AI 生成 / 内置规则）和生成类型
   - 一键生成训练数据集
3. **训练模型** (2.1~2.4) — 选择基础模型 → 选择数据集 → 配置 LoRA 参数 → 开始训练
4. **测试模型** (3.1~3.2) — 选择训练好的适配器，与微调后的模型对话测试
5. **导出模型** (4.1~4.3) — 选择适配器 → 命名 → 选择量化格式 → 一键导出为 Ollama 模型

## 许可证

本项目采用 [GNU Affero General Public License v3.0](LICENSE) 许可。

如需以其他条款使用 M-Courtyard（如商业许可），请联系：**tuwenbo0112@gmail.com**

## 贡献

欢迎参与贡献！以下是参与方式：

1. **Fork** 本仓库
2. 创建功能分支：`git checkout -b feat/your-feature`
3. 使用 [Conventional Commits](https://www.conventionalcommits.org/) 提交：`git commit -m "feat: add new feature"`
4. 推送到你的 Fork：`git push origin feat/your-feature`
5. 向 `main` 分支发起 **Pull Request**

请注意：
- Commit message 请使用**英文**
- 遵循现有代码风格
- 新功能请附带测试

## 社区

- [Discord](https://discord.gg/hjkrHWrQ) — 聊天、求助、分享你的微调模型
- [GitHub Discussions](https://github.com/tuwenbo0120/m-courtyard/discussions) — 功能建议、问答、公告
- [GitHub Issues](https://github.com/tuwenbo0120/m-courtyard/issues) — Bug 报告和功能请求

## 支持项目

如果觉得 M-Courtyard 对你有帮助：
- 给个 ⭐ — 让更多人发现这个项目！
- [在 Open Collective 赞助](https://opencollective.com/m-courtyard) — 支持持续开发

## Star History

<!-- TODO: 有一定 Star 后取消注释 -->
<!-- [![Star History Chart](https://api.star-history.com/svg?repos=tuwenbo0120/m-courtyard&type=Date)](https://star-history.com/#tuwenbo0120/m-courtyard&Date) -->
