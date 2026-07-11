# ai-chat-collector

浏览器扩展，采集 AI 平台的对话记录，并将其转化为可搜索、可问答的知识库。基于 RAG（检索增强生成）：对话被切片嵌入为向量，通过语义搜索召回，再交给 LLM 回答问题、整理笔记或生成测验。

## 功能特性

- **多平台对话采集** — 拦截 AI 平台 API 响应（网络拦截模式），并以 DOM 模式作为兜底，完整提取用户提问、AI 回答、深度思考过程和联网搜索引用。
- **语义搜索** — 对话被切片并嵌入（DashScope `text-embedding-v4` / 多模态），支持按语义检索而非仅靠关键词。
- **AI 问答（RAG）** — 在支持的页面提供悬浮问答球，三种模式均支持流式输出：整理信息、生成测验、AI 问答。回答基于你已保存的对话历史。
- **多后端向量库** — 默认本地 IndexedDB（零配置）；可切换到远程向量库，支持跨设备 / 智能体消费。
- **多后端 LLM** — Qwen/DashScope、OpenAI 兼容 API、本地 Ollama。
- **SKILL 集成** — 配套 SKILL 让外部智能体（TRAE、OpenClaw、Cursor）语义检索采集到的知识库。
- **导出** — Markdown / JSON，支持单条或全部导出。

## 支持平台

| 平台 | 网络拦截模式 | DOM 模式 |
|------|:----------:|:-------:|
| DeepSeek (chat.deepseek.com) | ✅ | ✅ |
| 千问 (www.qianwen.com) | ✅ | ✅ |
| 复旦智汇岛 (aiagent.fudan.edu.cn) | ✅ | ✅ |
| 豆包 (www.doubao.com) | ✅ | ✅ |

## 模式说明

### 网络拦截模式（推荐）

通过拦截浏览器网络请求，从 API 响应中直接解析对话数据。数据完整、准确，能完整提取：

- 对话内容（用户提问 + AI 回答）
- 深度思考 / 推理过程
- 搜索来源和引用
- 对话标题

### DOM 模式

通过解析页面 DOM 结构提取对话内容。作为网络拦截模式的补充，适用于网络拦截未生效的场景。

**已知限制：**

- DOM 模式可能无法准确识别搜索来源和思考内容，因为页面 DOM 结构可能动态变化，且思考 / 搜索区块的渲染方式与正式回答混合在一起。
- 建议优先使用网络拦截模式以获得最佳数据完整性。

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      浏览器扩展 (MV3)                            │
│                                                                  │
│  Content Scripts           Service Worker (background.js)        │
│  ├─ network-interceptor    ├─ db.js        (对话存储)            │
│  ├─ 平台适配器             ├─ embedding.js (DashScope 嵌入)      │
│  ├─ floating-ball          ├─ vector-store.js (6 种后端)         │
│  └─ ai-ball (问答 UI)      └─ llm.js       (3 种后端)            │
│                                                                  │
│  Popup / 设置页                                                  │
└──────────────┬───────────────────────────────┬───────────────────┘
               │                               │
               ▼                               ▼
        ┌─────────────┐               ┌─────────────────┐
        │  DashScope  │               │   向量库        │
        │  Embedding  │               │  local | remote │
        └─────────────┘               └────────┬────────┘
                                               │
                                  ┌────────────┴────────────┐
                                  ▼                         ▼
                          ┌─────────────┐         ┌─────────────────┐
                          │  LLM (RAG)  │         │  SKILL          │
                          │  dashscope/ │         │  (外部智能体)    │
                          │  openai/    │         │                 │
                          │  ollama     │         └─────────────────┘
                          └─────────────┘
```

## 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本项目根目录

## 配置

从扩展弹窗打开设置页，主要配置项：

- **对话提取** — 按平台启用 / 禁用对话采集。
- **Embedding 服务** — DashScope API Key、模型（推荐 `text-embedding-v4`）、内容过滤（是否包含思考 / 搜索块）、切片大小与重叠。
- **向量库** — 选择后端；保存前请先用「测试连通性」验证。
- **检索设置** — 模式（`combined` / `topk` / `threshold`）、Top-K、相似度阈值。
- **LLM 服务** — 选择后端并配置凭证。

### 向量库后端

| 后端 | 类型 | 部署指南 |
|------|------|----------|
| 本地 IndexedDB | 内置（零配置） | — |
| ChromaDB | 远程 | [docs/chroma-setup.md](docs/chroma-setup.md) |
| Milvus | 远程 | [docs/milvus-setup.md](docs/milvus-setup.md) |
| PostgreSQL + pgvector | 远程 | [docs/pgvector-setup.md](docs/pgvector-setup.md) |
| Supabase | 远程 | [docs/supabase-setup.md](docs/supabase-setup.md) |
| Qdrant | 远程 | [docs/qdrant-setup.md](docs/qdrant-setup.md) |

> 向量维度固定为 1024（与 DashScope `text-embedding-v4` 对齐）。配置远程后端前请先用「测试连通性」按钮验证。

### LLM 后端

| 后端 | 适用场景 |
|------|----------|
| Qwen / DashScope（阿里云百炼） | 默认；与 DashScope 嵌入服务配套 |
| OpenAI 兼容 API | DeepSeek / OpenAI / 任意兼容接口 |
| Ollama | 本地离线推理 |

### SKILL 集成

配套 SKILL（`docs/skills/`）让外部智能体（TRAE、OpenClaw、Cursor）通过 Python 脚本语义检索采集到的知识库。部署与使用见 [docs/skill-setup.md](docs/skill-setup.md)。

## 使用

1. 访问支持的 AI 平台并正常对话 — 采集会自动进行。
2. 点击浮动球可查看、搜索和导出已保存的对话。
3. 点击 AI 问答悬浮球，可基于历史对话提问、整理笔记或生成测验。

## 导出格式

- Markdown
- JSON

## 项目结构

```
ai-plugin/
├── manifest.json
├── background.js              # Service Worker（消息路由 + RAG 编排）
├── content/                   # Content Scripts
│   ├── network-interceptor.js # 共享网络钩子（MAIN world）
│   ├── network/               # 各平台网络适配器
│   ├── dom/                   # 各平台 DOM 适配器
│   ├── adapter-registry.js
│   ├── exporter-base.js
│   ├── ai-ball.js             # AI 问答悬浮球 + 面板
│   └── ui/                    # floating-ball / viewer / styles
├── lib/                       # 共享服务
│   ├── db.js                  # IndexedDB 对话存储
│   ├── embedding.js           # DashScope 嵌入 + 切片
│   ├── vector-store.js        # 向量库抽象层（6 种后端）
│   └── llm.js                 # LLM 抽象层（3 种后端）
├── popup/                     # 弹窗 + 设置页
├── docs/                      # 部署指南 + SKILL 集成
└── .github/workflows/         # 构建与发布流水线
```

## License

MIT — 见 [LICENSE](LICENSE)。
