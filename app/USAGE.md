# Courtyard 使用指南 / Usage Guide

---

## 1. 如何启动 / How to Start

### 开发模式（推荐开发调试时使用）

```bash
cd /path/to/courtyard/app
source "$HOME/.cargo/env"   # 确保 Rust 环境可用
pnpm tauri dev
```

首次启动会编译 Rust 后端（约 1-2 分钟），后续启动很快（热重载）。
启动成功后会自动弹出 Courtyard 桌面窗口。

### 直接打开已编译的 App

双击以下路径即可打开：

```
/path/to/courtyard/app/src-tauri/target/debug/bundle/macos/Courtyard.app
```

或者安装 DMG：

```
/path/to/courtyard/app/src-tauri/target/debug/bundle/dmg/Courtyard_0.1.0_aarch64.dmg
```

### 重新编译（代码改动后）

```bash
cd /path/to/courtyard/app
pnpm tauri build --debug    # debug 版本，编译较快
pnpm tauri build            # release 版本，体积小、运行快
```

---

## 2. 如何使用 / How to Use

应用打开后你会看到左侧导航栏，包含以下功能模块：

### 📊 控制台（Dashboard）
- 首页概览，显示快捷操作卡片
- 点击卡片可快速跳转到对应功能

### 📁 项目（Projects）
- **新建项目**：点击右上角「新建项目」按钮，输入项目名称
- **查看项目**：项目列表显示所有已创建的项目及其状态
- **删除项目**：点击项目右侧的删除图标
- 项目数据持久化在 SQLite 数据库中，关闭应用再打开数据不丢失

### 📂 数据准备（Data Preparation）
1. 先在项目列表中选择一个项目
2. 点击「选择文件」导入 .txt / .json / .jsonl / .md 文件
3. 导入的文件会复制到项目的 `raw` 目录
4. 点击文件名可预览内容
5. 点击「清洗数据」一键清洗（编码修复、去重、噪音移除、智能分段）
6. 清洗完成后，输入基础模型 ID，选择生成模式（QA/Style/Chat/Instruct），点击「生成问答对」
7. 生成的 train.jsonl / valid.jsonl 出现在 Dataset 文件列表中

### 🏋️ 训练（Training）
1. 选择一个项目
2. 在「基础模型」输入框填写 HuggingFace 模型 ID，例如：
   - `mlx-community/Llama-3.2-3B-Instruct-4bit`
   - `mlx-community/Qwen2.5-7B-Instruct-4bit`
   - 或本地模型路径
3. 使用快速预设一键填充参数，或手动调整：
   - **快速测试**：100 次迭代，适合验证流程
   - **标准训练**：1000 次迭代，日常使用
   - **深度训练**：2000 次迭代，追求更好效果
4. 每个参数下方都有说明文字帮助理解
5. 点击「开始训练」启动（需要 Python 环境就绪）
6. 训练日志实时显示在右侧面板

### 💬 测试（Testing）
1. 选择一个已训练的项目
2. 点击齿轮图标设置模型 ID（如 `mlx-community/Qwen2.5-3B-Instruct-4bit`）和生成参数
3. 在输入框输入消息，按回车或点击发送
4. 模型通过 `mlx-lm` 推理生成回复（需 Python 环境就绪）
5. 如有训练好的 adapter，会自动加载最新的 adapter
6. 点击垃圾桶图标清空对话

### 📤 导出（Export）
1. 选择一个已训练的项目
2. 填写 Ollama 模型名称（如 `my-custom-model`）
3. 填写基础模型 ID（用于 fuse 合并 adapter）
4. 选择量化格式：4-bit / 8-bit / 16-bit
5. 点击「导出到 Ollama」
6. 实际流程：fuse adapter → 生成 Modelfile → `ollama create`
7. 导出成功后可通过 `ollama run my-custom-model` 使用

### ⚙️ 设置（Settings）
- **运行环境**：显示芯片/内存/系统/Python/mlx-lm/uv/Ollama 状态
- **环境配置**：如果 Python 未配置，点击「配置 Python 环境」自动通过 uv 安装
- **语言切换**：点击 English / 简体中文 切换界面语言
- **存储**：数据存储在 `~/Courtyard` 目录
- **关于**：版本信息

---

## 3. 如何测试 / How to Test

### 基本功能测试清单

| # | 测试项 | 操作 | 预期结果 |
|---|--------|------|----------|
| 1 | 应用启动 | `pnpm tauri dev` | 窗口正常弹出，显示 Dashboard |
| 2 | 语言切换 | 左下角点击「English/中文」 | UI 文字全部切换语言 |
| 3 | 新建项目 | Projects → 新建项目 → 输入名称 → 创建 | 项目出现在列表中 |
| 4 | 项目持久化 | 创建项目后关闭应用，重新打开 | 项目仍在列表中 |
| 5 | 删除项目 | 点击项目右侧删除图标 | 项目从列表消失 |
| 6 | 导航切换 | 依次点击左侧所有菜单项 | 每个页面正常加载，无白屏 |
| 7 | 设置页环境检测 | Settings 页面 | 显示芯片、内存、系统版本 |
| 8 | 数据准备 | Data Prep → 选择项目 → 导入文件 | 文件出现在列表，可预览 |
| 9 | 训练配置 | Training → 选择项目 → 应用预设 | 参数自动填充 |
| 10 | 对话测试 | Testing → 选择项目 → 发送消息 | 收到占位回复 |
| 11 | 导出 | Export → 填写名称 → 导出 | 显示成功提示 |

### 数据存储位置

```
~/Courtyard/
├── projects/          # 项目文件（raw/cleaned/dataset/adapters/logs）
├── models/            # 下载的基础模型
└── python/            # Python 虚拟环境（后续版本）
```

SQLite 数据库文件由 Tauri 插件管理，位于应用数据目录。

---

## 4. 每次怎么打开 / Daily Workflow

**最简单的方式：**

```bash
cd /path/to/courtyard/app && pnpm tauri dev
```

**或者创建一个快捷命令（可选）：**

在 `~/.zshrc` 中添加：

```bash
alias courtyard="cd /path/to/courtyard/app && source \$HOME/.cargo/env && pnpm tauri dev"
```

然后在终端输入 `courtyard` 即可启动。

**或者直接双击 App：**

打开 Finder，导航到：
```
/path/to/courtyard/app/src-tauri/target/debug/bundle/macos/Courtyard.app
```

---

## 5. 当前 MVP 状态说明

### ✅ 已完成（Phase 1-3）
- 完整的 7 页面 UI（Dashboard/Projects/DataPrep/Training/Testing/Export/Settings）
- 项目 CRUD（创建/列表/删除）+ SQLite 持久化
- 文件导入/预览/删除（通过系统文件对话框）
- 训练参数配置 UI + 3 档智能预设 + 实时日志面板
- 模型测试对话界面（Chat UI）+ 真实 mlx-lm 推理
- Ollama 导出（fuse adapter + Modelfile + `ollama create`）
- 环境检测（芯片/内存/系统/Python/mlx-lm/uv/Ollama 状态）
- Python 环境自动配置（uv 创建 venv + 安装 mlx-lm）
- 数据清洗 Python 脚本（编码修复/去重/噪音移除/智能分段）
- AI 数据集生成（4 种模式：QA/Style/Chat/Instruct）
- 真实训练 subprocess（mlx_lm.lora + 实时日志流）
- Dashboard 增强（环境状态卡片 + 项目统计 + 硬件信息 + 快捷操作）
- 中英文双语 i18n（8 个命名空间 × 2 语言）
- 暗色主题

### 🔜 后续待完成（Phase 4+）
- 训练实时 loss 曲线图表（可视化）
- HuggingFace 模型浏览器和下载管理
- DoRA/QLoRA 支持
- 4 档智能预设 + 硬件感知
- GGUF 格式导出
- 资源监控（GPU/内存实时占用）
- 首次启动引导流程
- 更多语言翻译
