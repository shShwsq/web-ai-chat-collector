# ai-chat-collector

A browser extension that captures AI platform conversations and turns them into a searchable, queryable knowledge base. Built on RAG (Retrieval-Augmented Generation): conversations are embedded into vectors, recalled via semantic search, and fed to an LLM to answer questions, organize notes, or generate quizzes.

## Features

- **Multi-platform conversation capture** — extracts user questions, AI answers, deep-thinking traces, and search citations. DOM mode is the recommended default (network interception available as an opt-in alternative).
- **Semantic search** — conversations are chunked and embedded (DashScope `text-embedding-v4` / multimodal) so you can search by meaning, not just keywords.
- **AI Q&A (RAG)** — a floating Q&A ball on supported pages offers three modes, all streaming: organize information, generate quiz, and ask question. Answers are grounded in your saved conversations.
- **Multi-backend vector store** — local IndexedDB out of the box; optionally switch to a remote vector database for cross-device / agent consumption.
- **Multi-backend LLM** — Qwen/DashScope, OpenAI-compatible APIs, or local Ollama.
- **Skill integration** — a ready-made SKILL lets external agents (TRAE, OpenClaw, Cursor) semantically search the collected knowledge base.
- **Export** — Markdown / JSON, single conversation or all at once.

## Supported Platforms

| Platform | DOM Mode | Network Interception |
|----------|:--------:|:--------------------:|
| DeepSeek (chat.deepseek.com) | ✅ | ✅ |
| Qianwen (www.qianwen.com) | ✅ | ✅ |
| Fudan AI Agent (aiagent.fudan.edu.cn) | ✅ | ✅ |
| Doubao (www.doubao.com) | ✅ | ✅ |
| Kimi (www.kimi.com) | ✅ | — (WebSocket + protobuf, DOM only) |

## Mode Descriptions

### DOM Mode (Recommended)

Parses the rendered page DOM to extract conversations. Universal compatibility, resilient to API changes, and preserves full Markdown formatting (via `turndown.js` + `turndown-plugin-gfm`) including headings, lists, tables, code blocks, and math (KaTeX).

- All five supported platforms work out of the box
- Markdown formatting is preserved from rendered HTML — headings, lists, **GFM tables**, strikethrough, task lists, fenced code, and KaTeX math (inline `$...$` / block `$$...$$`)
- Deep-thinking traces and search citations are extracted per platform (Kimi/DeepSeek/Qianwen/Doubao/Fudan)
- Independent of platform API protocol (REST / WebSocket / protobuf)
- Actively under optimization — further improvements to thinking-block and search-citation extraction are in progress

### Network Interception Mode

Intercepts browser network requests and parses conversation data directly from API responses. Can capture the raw stream including thinking traces and search citations. Opt-in per platform from the settings page.

**Trade-offs:**

- Tightly coupled to each platform's API contract; breaks when the platform updates its API
- Cannot be used on Kimi (WebSocket + protobuf transport)
- Use this only if you need raw streaming data not yet exposed via DOM

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Browser Extension (MV3)                     │
│                                                                  │
│  Content Scripts           Service Worker (background.js)        │
│  ├─ network-interceptor    ├─ db.js        (conversation store) │
│  ├─ platform adapters      ├─ embedding.js (DashScope embed)    │
│  ├─ floating-ball          ├─ vector-store.js (6 backends)      │
│  └─ ai-ball (Q&A UI)       └─ llm.js       (3 backends)         │
│                                                                  │
│  Popup / Settings Page                                           │
└──────────────┬───────────────────────────────┬───────────────────┘
               │                               │
               ▼                               ▼
        ┌─────────────┐               ┌─────────────────┐
        │  DashScope  │               │  Vector Store   │
        │  Embedding  │               │  local | remote │
        └─────────────┘               └────────┬────────┘
                                               │
                                  ┌────────────┴────────────┐
                                  ▼                         ▼
                          ┌─────────────┐         ┌─────────────────┐
                          │  LLM (RAG)  │         │  SKILL          │
                          │  dashscope/ │         │  (external      │
                          │  openai/    │         │   agents)       │
                          │  ollama     │         └─────────────────┘
                          └─────────────┘
```

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the project root directory

## Configuration

Open the settings page from the extension popup. Key sections:

- **对话提取 (Capture)** — enable/disable capture per platform.
- **Embedding 服务** — DashScope API Key, model (`text-embedding-v4` recommended), content filtering (include thinking / search blocks), chunk size & overlap.
- **向量库 (Vector Store)** — choose backend; test connectivity before saving.
- **检索设置 (Retrieval)** — mode (`combined` / `topk` / `threshold`), Top-K, score threshold.
- **LLM 服务** — choose backend and configure credentials.

### Vector Store Backends

| Backend | Type | Setup Guide |
|---------|------|-------------|
| Local IndexedDB | Built-in (zero config) | — |
| ChromaDB | Remote | [docs/chroma-setup.md](docs/chroma-setup.md) |
| Milvus | Remote | [docs/milvus-setup.md](docs/milvus-setup.md) |
| PostgreSQL + pgvector | Remote | [docs/pgvector-setup.md](docs/pgvector-setup.md) |
| Supabase | Remote | [docs/supabase-setup.md](docs/supabase-setup.md) |
| Qdrant | Remote | [docs/qdrant-setup.md](docs/qdrant-setup.md) |

> Vector dimension is fixed at 1024 (matches DashScope `text-embedding-v4`). Use the "测试连通性" button before saving a remote configuration.

### LLM Backends

| Backend | Use Case |
|---------|----------|
| Qwen / DashScope (阿里云百炼) | Default; pairs with DashScope embedding |
| OpenAI-compatible API | DeepSeek / OpenAI / any compatible endpoint |
| Ollama | Local, offline inference |

### Skill Integration

A ready-made SKILL (`docs/skills/`) lets external agents (TRAE, OpenClaw, Cursor) semantically search the collected knowledge base via a Python script. See [docs/skill-setup.md](docs/skill-setup.md) for setup and deployment.

## Usage

1. Visit a supported AI platform and have a conversation — capture happens automatically.
2. Click the floating ball to view, search, and export saved conversations.
3. Click the AI Q&A ball to ask questions grounded in your history, organize notes, or generate quizzes.

## Export Formats

- Markdown
- JSON

## Project Structure

```
ai-plugin/
├── manifest.json              # MV3 manifest (host permissions, content scripts)
├── background.js              # Service Worker entry (loads lib + bg modules)
├── models.json                # LLM / Embedding provider catalog (presets & model lists)
├── bg/                        # Service Worker business modules
│   ├── router.js              # Message routing + ensureInit guard
│   ├── init.js                # Startup initialization
│   ├── settings-handlers.js   # Settings R/W + connectivity tests
│   ├── conversations.js       # Conversation CRUD
│   ├── ai-handlers.js         # RAG orchestration (Q&A / organize / quiz)
│   ├── vector-handlers.js     # Vector index build / rebuild / stats
│   ├── export.js              # Markdown / JSON export
│   └── data-handlers.js       # Storage info / clear / reset
├── content/                   # Content scripts
│   ├── adapter-registry.js    # EXTRACTION_MODE + getPlatformMode + adapter registry
│   ├── exporter-base.js       # ChatExporterBase (network / DOM dispatch)
│   ├── network-interceptor.js # Shared network hook (MAIN world)
│   ├── ai-ball.js             # AI Q&A floating ball + panel
│   ├── kimi.js                # Kimi entry (DOM-only, no network adapter)
│   ├── deepseek.js / qianwen.js / fudan.js / doubao.js  # Per-platform entries
│   ├── network/               # Per-platform network adapters (REST parsing)
│   │   ├── common.js
│   │   ├── deepseek.js / qianwen.js / fudan.js / doubao.js
│   ├── dom/                   # Per-platform DOM adapters
│   │   ├── html-to-markdown.js  # Unified HTML→Markdown wrapper (turndown.js + GFM)
│   │   ├── katex-html-to-latex.js # KaTeX HTML→LaTeX reverse parser (Kimi fallback)
│   │   ├── kimi.js / deepseek.js / qianwen.js / fudan.js / doubao.js
│   └── ui/                    # floating-ball, viewer, styles
│       ├── floating-ball.js / viewer.js / styles.js
├── lib/                       # Shared services (loaded by both SW and content)
│   ├── db.js                  # IndexedDB conversation store
│   ├── embedding.js           # Embedding abstraction (DashScope / multimodal)
│   ├── vector-store.js        # Vector store abstraction (6 backends)
│   ├── llm.js                 # LLM abstraction (3 backends, streaming)
│   ├── marked.min.js          # Markdown → HTML renderer
│   ├── katex.min.js + .css    # Math rendering
│   ├── turndown.min.js        # HTML → Markdown converter (DOM mode)
│   └── turndown-plugin-gfm.js # GFM plugin: tables / strikethrough / task lists
├── popup/                     # Popup + settings page
│   ├── popup.html / popup.js / popup.css
│   └── settings.html / settings.js / settings.css
├── docs/                      # Setup guides + SKILL integration
│   ├── chroma-setup.md / milvus-setup.md / pgvector-setup.md
│   ├── supabase-setup.md / qdrant-setup.md / skill-setup.md
│   └── skills/                # SKILL for external agents
└── .github/workflows/         # Build & release pipeline
```

## Third-Party Libraries

| Library | Version | Purpose | Used By |
|---------|---------|---------|---------|
| [turndown](https://github.com/mixmark-io/turndown) | 7.2.4 | HTML → Markdown converter | DOM mode extraction (`content/dom/html-to-markdown.js`) |
| [turndown-plugin-gfm](https://github.com/mixmark-io/turndown-plugin-gfm) | 1.0.2 | GitHub Flavored Markdown plugin for turndown — tables, strikethrough, task lists, highlighted code blocks | DOM mode extraction |
| [marked](https://github.com/markedjs/marked) | — | Markdown → HTML renderer | Viewer & AI Q&A panel (`content/ui/viewer.js`) |
| [KaTeX](https://github.com/KaTeX/KaTeX) | — | Math formula rendering | Viewer & AI Q&A panel |

> KaTeX reverse parsing: most platforms preserve the `<annotation encoding="application/x-tex">` source layer, so turndown extracts LaTeX directly. Kimi removes this layer, so `content/dom/katex-html-to-latex.js` recursively parses the `.katex-html` DOM to reconstruct the LaTeX source (integrals, fractions, superscripts/subscripts, derivatives, etc.).

## License

MIT — see [LICENSE](LICENSE).
