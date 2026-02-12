# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/tuwenbo0120/m-courtyard/releases/tag/v0.1.0
