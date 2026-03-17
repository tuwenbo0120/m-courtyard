# M-Courtyard – Say Goodbye to Complexity, Easily Create Your AI Model

From raw text to fine-tuned local models. Zero code, zero cloud, zero hassle.

M-Courtyard is an open-source desktop application that lets non-technical users fine-tune LLMs on Apple Silicon Macs using the MLX framework. Drag in your text files, generate training data with `Ollama`, `LM Studio`, or built-in rules, configure parameters with plain-language descriptions, train with one click, and export to Ollama, GGUF, or MLX-based local runtimes.

## Features (MVP)

- **Data → Dataset**: Drag-and-drop text import → one-click cleaning → AI-assisted or built-in dataset generation
- **Smart Training**: All mlx-lm parameters with plain-language descriptions + intelligent presets
- **Configurable Download Source**: HuggingFace / HF Mirror / ModelScope, switchable in Settings
- **Real-time Monitoring**: Live loss curves, progress tracking, memory usage
- **Parallel Local Runtimes**: AI data generation supports both `Ollama` and `LM Studio`; built-in rules remain available without any runtime
- **One-click Export**: Export fine-tuned model to Ollama, export GGUF for compatible runtimes, or export fused MLX output for LM Studio / `mlx-lm.server`
- **i18n**: English and Simplified Chinese out of the box

## Runtime Positioning

- **Core engine**: `mlx-lm` powers training and built-in inference
- **Optional runtime**: `Ollama` is used for Ollama-based dataset generation and Ollama export
- **Optional runtime**: `LM Studio` is used for LM Studio-based dataset generation through its local OpenAI-compatible server and for loading exported MLX models
- **Fallback mode**: built-in rules work without Ollama or LM Studio

## Tech Stack

| Layer | Technology |
|-------|-----------|
| App Framework | Tauri 2.x (Rust + WebView) |
| Frontend | React 19 + TypeScript + TailwindCSS v4 + Vite |
| State | Zustand |
| i18n | react-i18next |
| Database | SQLite (embedded, via tauri-plugin-sql) |
| Training Engine | MLX / mlx-lm (Apple Silicon) |
| Icons | Lucide React |

## Requirements

- macOS 14.0+ with Apple Silicon (M1 or later)
- 8GB RAM minimum (16GB+ recommended)
- ~5GB disk space
- Ollama only if you need Ollama-based dataset generation or Ollama export
- LM Studio only if you need LM Studio-based dataset generation or want to load exported MLX models there
- No extra runtime if you only use the built-in rules path

## Development

```bash
# Install dependencies
pnpm install

# Start development
pnpm tauri dev

# Build for production
pnpm tauri build
```

## Project Structure

```
src/                    # React frontend
├── components/         # Reusable UI components
├── pages/              # Page components (one per route)
├── hooks/              # Custom React hooks
├── stores/             # Zustand state management
├── services/           # Tauri IPC call wrappers
├── i18n/               # Internationalization
├── types/              # TypeScript type definitions
└── utils/              # Pure utility functions

src-tauri/src/          # Rust backend
├── commands/           # IPC command handlers
├── db/                 # Database migrations
├── fs/                 # File system operations
└── python/             # Python subprocess management
```

## License

[AGPL-3.0](../LICENSE). For commercial licensing, contact: tuwenbo0112@gmail.com
