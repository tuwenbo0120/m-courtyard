# Contributing to M-Courtyard

Thank you for considering contributing to M-Courtyard! This guide will help you get started.

## Development Setup

### Prerequisites

| Requirement | Installation |
|-------------|-------------|
| macOS 14+ | Apple Silicon Mac required |
| Node.js 18+ | [nodejs.org](https://nodejs.org) or `brew install node` |
| pnpm | `npm install -g pnpm` |
| Rust toolchain | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Xcode CLT | `xcode-select --install` |
| Ollama | [ollama.com](https://ollama.com) |

### Getting Started

```bash
# 1. Fork and clone the repo
git clone https://github.com/<your-username>/m-courtyard.git
cd m-courtyard/app

# 2. Make sure Rust is in PATH
source "$HOME/.cargo/env"

# 3. Install dependencies
pnpm install

# 4. Start development server
pnpm tauri dev
```

## How to Contribute

### Reporting Bugs

- Use [GitHub Issues](https://github.com/tuwenbo0120/m-courtyard/issues) with the **Bug Report** template
- Include your macOS version, chip model, and RAM
- Provide steps to reproduce the issue

### Suggesting Features

- Use [GitHub Issues](https://github.com/tuwenbo0120/m-courtyard/issues) with the **Feature Request** template
- Or start a discussion in [GitHub Discussions](https://github.com/tuwenbo0120/m-courtyard/discussions)

### Submitting Code

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add new feature
   fix: resolve specific bug
   docs: update documentation
   refactor: restructure code without behavior change
   chore: tooling or config changes
   ```
5. Push to your fork: `git push origin feat/your-feature`
6. Open a Pull Request against the `main` branch

### Code Style

- **Commit messages**: English only, following Conventional Commits
- **Code comments**: English for all new code
- **Frontend**: Follow existing React/TypeScript patterns
- **Backend**: Follow existing Rust conventions
- **Python scripts**: Follow PEP 8

## Project Structure

```
m-courtyard/
├── app/
│   ├── src/              # React frontend
│   │   ├── pages/        # Page components
│   │   ├── components/   # Shared components
│   │   ├── stores/       # Zustand state stores
│   │   ├── services/     # Tauri command wrappers
│   │   └── i18n/         # Internationalization
│   └── src-tauri/
│       ├── src/          # Rust backend
│       └── scripts/      # Python ML scripts
```

## Community

- [Discord](https://discord.gg/hjkrHWrQ) — Chat and get help
- [GitHub Discussions](https://github.com/tuwenbo0120/m-courtyard/discussions) — Feature ideas and Q&A

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).
