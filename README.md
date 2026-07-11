# ai-chat-collector

A browser extension that captures AI platform conversations and turns them into a searchable, queryable knowledge base. Built on RAG (Retrieval-Augmented Generation): conversations are embedded into vectors, recalled via semantic search, and fed to an LLM to answer questions, organize notes, or generate quizzes.

## Features

- **Multi-platform conversation capture** — intercepts AI platform API responses (network mode) with DOM-mode fallback, extracting user questions, AI answers, deep-thinking traces, and search citations.
- **Semantic search** — conversations are chunked and embedded (DashScope `text-embedding-v4` / multimodal) so you can search by meaning, not just keywords.
- **AI Q&A (RAG)** — a floating Q&A ball on supported pages offers three modes, all streaming: organize information, generate quiz, and ask question. Answers are grounded in your saved conversations.
- **Multi-backend vector store** — local IndexedDB out of the box; optionally switch to a remote vector database for cross-device / agent consumption.
- **Multi-backend LLM** — Qwen/DashScope, OpenAI-compatible APIs, or local Ollama.
- **MCP integration** — an independent MCP Server exposes the vector store to external agents (e.g. openclaw) as a knowledge source.
- **Export** — Markdown / JSON, single conversation or all at once.

## Supported Platforms

| Platform | Network Interception | DOM Mode |
|----------|:-------------------:|:--------:|
| DeepSeek (chat.deepseek.com) | ✅ | ✅ |
| Qianwen (www.qianwen.com) | ✅ | ✅ |
| Fudan AI Agent (aiagent.fudan.edu.cn) | ✅ | ✅ |
| Doubao (www.doubao.com) | ✅ | ✅ |

## Mode Descriptions

### Network Interception Mode (Recommended)

Intercepts browser network requests and parses conversation data directly from API responses. Data is complete and accurate, capable of extracting:

- Conversation content (user questions + AI responses)
- Deep thinking / reasoning process
- Search sources and citations
- Conversation titles

### DOM Mode

Extracts conversation content by parsing the page DOM structure. Serves as a fallback when network interception is not available.

**Known Limitations:**

- DOM mode may not accurately identify search sources and thinking content, as the page DOM structure can change dynamically and thinking/search blocks are rendered alongside the main response.
- Network interception mode is recommended for the best data completeness.

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
                          │  LLM (RAG)  │         │  MCP Server     │
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

### MCP Integration

An independent MCP Server (Python) exposes the remote vector store to external agents via the `search_knowledge` / `get_stats` tools. See [docs/mcp-setup.md](docs/mcp-setup.md) for the data contract, and [docs/mcp-deploy/](docs/mcp-deploy/) for deployment scripts.

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
├── manifest.json
├── background.js              # Service Worker (message routing, RAG orchestration)
├── content/                   # Content scripts
│   ├── network-interceptor.js # Shared network hook (MAIN world)
│   ├── network/               # Per-platform network adapters
│   ├── dom/                   # Per-platform DOM adapters
│   ├── adapter-registry.js
│   ├── exporter-base.js
│   ├── ai-ball.js             # AI Q&A floating ball + panel
│   └── ui/                    # floating-ball, viewer, styles
├── lib/                       # Shared services
│   ├── db.js                  # IndexedDB conversation store
│   ├── embedding.js           # DashScope embedding + chunking
│   ├── vector-store.js        # Vector store abstraction (6 backends)
│   └── llm.js                 # LLM abstraction (3 backends)
├── popup/                     # Popup + settings page
├── docs/                      # Setup guides + MCP deployment
└── .github/workflows/         # Build & release pipeline
```

## License

MIT — see [LICENSE](LICENSE).
