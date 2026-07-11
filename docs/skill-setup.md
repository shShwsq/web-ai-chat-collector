# Skill：AI 对话知识库检索

让智能体（TRAE、OpenClaw、Cursor 等）通过 SKILL 检索 Chrome 扩展采集的 AI 对话历史。

## 工作方式

SKILL 是一份指令文件 + 一个检索脚本。智能体在对话中识别到"需要检索历史对话"时，自动执行脚本：

```
用户提问
  ↓
智能体识别"需要检索历史对话"
  ↓
执行: python3 query_knowledge.py search "用户查询"
  ↓
脚本内部流程：
  1. 调 DashScope API 生成查询向量（text-embedding-v4, 1024 维）
  2. 用查询向量检索向量库（ChromaDB/Qdrant/pgvector/Supabase/Milvus）
  3. 返回匹配的对话片段（含 title/platform/role/content/score）
  ↓
智能体收到 JSON 结果
  ↓
整理成易读格式回复用户
```

整个流程在本地运行，无需 HTTPS、无需证书、无需对外暴露端口。脚本只用 Python 标准库（urllib/json/ssl），不需要装额外包。

## 文件说明

```
docs/
├── skill-setup.md                 本文档
└── skills/
    ├── SKILL.md                   SKILL 指令文件（TRAE 标准格式，含配置说明）
    └── scripts/
        └── query_knowledge.py     检索脚本（实际执行检索）
```

## TRAE SKILL 标准格式

TRAE 要求 SKILL 文件必须：
1. **文件名**：`SKILL.md`（不是任意名字）
2. **frontmatter**：开头必须有 YAML 格式的 `name` 和 `description` 字段
3. **description**：必须包含「做什么」+「什么时候触发」，帮助模型判断何时调用
4. **目录结构**：可选子目录 `scripts/`（脚本）、`references/`（参考资料）、`assets/`（模板）
5. **配置**：不使用 `.env.example`，配置模板直接写在 SKILL.md 正文里（代码块形式）

```markdown
---
name: "search-knowledge"
description: "Searches the user's AI chat history knowledge base via semantic retrieval. Invoke when user asks about previously discussed topics, wants to recall past AI conversations, or queries knowledge base statistics."
---

# 标题

## 首次使用：配置

（这里放 .env 配置模板的代码块，用户复制后修改）

## 用法
...
```

## 部署到 TRAE

TRAE 的 SKILL 目录是 `.trae/skills/<skill-name>/`。把本 SKILL 复制过去：

```bash
# 在项目根目录执行
mkdir -p .trae/skills/search-knowledge/scripts
cp docs/skills/SKILL.md .trae/skills/search-knowledge/
cp docs/skills/scripts/query_knowledge.py .trae/skills/search-knowledge/scripts/

# 创建并配置 .env（内容见 SKILL.md 的「首次使用：配置」部分）
vim .trae/skills/search-knowledge/.env
```

部署后目录结构：
```
.trae/skills/search-knowledge/
├── SKILL.md
├── scripts/
│   └── query_knowledge.py
└── .env                         （用户自己创建，不纳入版本控制）
```

TRAE 会自动加载 `.trae/skills/*/SKILL.md`，智能体在对话中遇到检索需求时会自动调用。

## 快速开始

### 1. 配置

在 SKILL 目录下创建 `.env` 文件，内容参考 `SKILL.md` 的「首次使用：配置」部分：

```bash
# 在部署目录下创建 .env
cd .trae/skills/search-knowledge   # 或 docs/skills 测试时
vim .env
```

关键字段：
```bash
KB_VSTORE_TYPE=chroma                              # 向量库类型
KB_VSTORE_URL=http://120.55.168.185:8000           # 向量库地址
KB_VSTORE_COLLECTION=ai_chat_vectors               # 集合名
KB_DASHSCOPE_KEY=sk-你的dashscope-api-key          # DashScope API Key
KB_VSTORE_VERIFY_TLS=false                         # 自签证书设 false
```

> DashScope API Key 和 Chrome 扩展里配的是同一个，在 [阿里云控制台](https://dashscope.console.aliyun.com/) 获取。

### 2. 测试脚本

```bash
# 在 SKILL 目录下执行
cd docs/skills
python3 scripts/query_knowledge.py stats
python3 scripts/query_knowledge.py search "Docker 安全配置" --top-k 5
```

如果返回 JSON 结果，说明配置正确。

### 3. 配置智能体

#### TRAE

```bash
mkdir -p .trae/skills/search-knowledge/scripts
cp docs/skills/SKILL.md .trae/skills/search-knowledge/
cp docs/skills/scripts/query_knowledge.py .trae/skills/search-knowledge/scripts/
cp docs/skills/.env .trae/skills/search-knowledge/   # 测试通过后复制
```

复制后重启 TRAE 或重新加载窗口，智能体就能在对话中自动调用。

#### OpenClaw

OpenClaw 的 SKILL 格式和 TRAE 类似，放到 skills 目录：

```bash
mkdir -p ~/.openclaw/skills/search-knowledge/scripts
cp docs/skills/SKILL.md ~/.openclaw/skills/search-knowledge/
cp docs/skills/scripts/query_knowledge.py ~/.openclaw/skills/search-knowledge/scripts/
cp docs/skills/.env ~/.openclaw/skills/search-knowledge/
```

#### Cursor / Cline / 其他

把 `SKILL.md` 内容作为项目规则（`.cursorrules` 或 `.clinerules`）的一部分，或粘贴到系统提示词中。

### 4. 验证

在智能体里问：
> "我之前和 AI 聊过 XXX 吗？帮我找找"

智能体应该会执行 `python3 query_knowledge.py search "XXX"`，然后基于返回结果回答。

## 支持的向量库后端

| 后端 | KB_VSTORE_TYPE | 地址格式 | 需要 API Key |
|---|---|---|---|
| ChromaDB | `chroma` | `http://IP:8000` | 否 |
| Qdrant | `qdrant` | `http://IP:6333` | 可选 |
| pgvector + PostgREST | `pgvector` | `http://IP:3000` | 可选 |
| Supabase | `supabase` | `https://xxx.supabase.co` | 是 |
| Milvus | `milvus` | `http://IP:19530` | Zilliz Cloud 需要 |

> 各后端的部署说明见 `docs/` 下对应的 `*-setup.md`。

## 安全注意事项

1. **.env 文件含 API Key**：不要提交到 git（已在 .gitignore 排除 `docs/skills/.env`）
2. **向量库公网暴露**：ChromaDB/Qdrant 默认无认证，建议用安全组限制访问 IP
3. **DashScope Key**：和 Chrome 扩展用同一个 Key，注意用量控制

## 故障排查

### `ModuleNotFoundError` / `ImportError`

脚本只用 Python 标准库（urllib/json/ssl），不需要装额外包。确认 Python 版本 ≥ 3.10。

### 连接超时

```bash
# 测试向量库连通性
curl -s http://你的向量库地址/api/v2/tenants/default_tenant/databases/default_database/collections

# 如果超时，检查安全组是否放行对应端口
```

### DashScope API 调用失败

```bash
# 验证 API Key
curl https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding \
  -H "Authorization: Bearer 你的KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"text-embedding-v4","input":["test"],"parameters":{"dimension":1024}}'
```

### 检索结果为空

1. 确认 Chrome 扩展已写入数据：`python3 query_knowledge.py stats`
2. 确认 collection 名字和扩展配置一致
3. 换个查询词试试（语义匹配，换个说法可能就匹配上了）
