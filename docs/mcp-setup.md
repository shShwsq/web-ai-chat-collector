# 远程向量库 MCP 接入说明

本扩展会把对话内容（含 `title / platform / role / content` 等元数据）写入远程向量库。本文说明如何用一个**独立的 MCP Server** 把该向量库暴露给外部智能体（如 openclaw）作为知识源消费。

## 为什么用独立 MCP？

| 方案 | 优点 | 缺点 |
|---|---|---|
| 智能体直连向量库 | 零中间层 | 每个智能体都要自己实现 embedding + 6 套后端协议，重复造轮子 |
| **独立 MCP Server（推荐）** | **一次实现，所有 MCP 客户端通用；与 Chrome 扩展生命周期解耦** | 多一个进程 |
| 走 Chrome 扩展 | 复用插件代码 | 受 MV3 service worker 生命周期限制，扩展关闭即不可用 |

**核心设计**：MCP Server 作为独立进程常驻（或由智能体以 stdio 方式拉起），自己持有 DashScope API Key 和向量库连接配置，对智能体只暴露 `search_knowledge` / `get_stats` 两个语义化 tool。智能体无需关心向量库类型、embedding 维度、相似度算法。

```
┌─────────────┐   MCP (stdio/SSE)   ┌──────────────┐   HTTP/REST   ┌──────────────┐
│  openclaw   │ ◄──────────────────► │  MCP Server  │ ◄────────────►│  远程向量库   │
│  等智能体    │                      │ (Python)     │               │ (6 种后端)    │
└─────────────┘                      └──────┬───────┘               └──────────────┘
                                            │ HTTPS
                                            ▼
                                     ┌──────────────┐
                                     │  DashScope   │
                                     │ text-emb-v4  │  (仅查询时 embed)
                                     └──────────────┘
```

## 数据契约

扩展写入向量库的每条记录结构如下（远程后端的 metadata / payload / JSONB 字段）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | chunk 唯一 ID，格式 `${convId}::msg::${msgHash}::chunk::${chunkIdx}` |
| `convId` | string | 对话 ID，格式 `${platform}::${platformConversationId}` |
| `title` | string | 对话标题 |
| `platform` | string | 来源平台（deepseek / doubao / fudan / qianwen） |
| `role` | string | 消息角色（`user` / `assistant`） |
| `content` | string | **该切片的原文**。是否包含 think / search_result 块由扩展「内容过滤」设置决定（`includeThinking` / `includeSearch`）：开启则保留，关闭则剥离——与 embedding 使用的文本完全一致，保证语义对齐 |
| `msgHash` | string | 消息哈希，同一条消息的多 chunk 共享 |
| `chunkIdx` | int | 切片序号 |
| `chunkTotal` | int | 该消息的切片总数 |

> ⚠️ `content` 是切片文本，**不是整条消息**。单条消息会被 `chunkSize`（默认 500 字符）切成多段，每段独立 embedding。智能体消费时如需完整消息，应按 `convId + msgHash` 聚合同组的所有 chunk（按 `chunkIdx` 排序拼接）。
>
> ℹ️ `content` 是否包含 think / search_result 块，由扩展设置中的「内容过滤」选项控制（`includeThinking` / `includeSearch`）。这与 embedding 使用的文本完全一致：开启选项时两者都保留这些块，关闭时两者都剥离。

> ℹ️ **插件自身读侧不使用这些字段**——插件靠 `convId` 反查本地 IndexedDB 重建上下文。`title/platform/role/content` 仅供外部智能体消费，写入对插件读侧透明。

## 支持的向量库后端

与扩展支持的 6 种一致，部署方式见各自的 setup 文档：

| 后端 | metadata 承载方式 | 部署文档 |
|---|---|---|
| ChromaDB | `metadatas` JSON | [chroma-setup.md](./chroma-setup.md) |
| Milvus | 展平成行字段 | [milvus-setup.md](./milvus-setup.md) |
| PostgreSQL + pgvector | `metadata JSONB` 列 | [pgvector-setup.md](./pgvector-setup.md) |
| Pinecone | `metadata` 基础类型 | [pinecone-setup.md](./pinecone-setup.md) |
| Supabase | `metadata JSONB` 列 | [supabase-setup.md](./supabase-setup.md) |
| Qdrant | `payload` JSON | [qdrant-setup.md](./qdrant-setup.md) |

## MCP Server 实现

基于官方 [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)，零业务依赖（除 `mcp` 外只用标准库）。

### 1. 安装依赖

```bash
pip install "mcp[cli]"
```

> 要求 Python 3.10+。

### 2. Server 代码

保存为 `mcp_vector_server.py`：

```python
"""
AI Chat 知识库 MCP Server
把扩展写入的远程向量库暴露为 MCP tool，供 openclaw 等智能体消费。

环境变量：
  DASHSCOPE_API_KEY        必填，用于查询时生成 embedding
  VECTOR_STORE_TYPE        必填，chroma | milvus | pgvector | pinecone | supabase | qdrant
  VECTOR_STORE_URL         必填，向量库服务地址
  VECTOR_STORE_API_KEY     视后端而定（Chroma 可空，其余通常必填）
  VECTOR_STORE_COLLECTION  必填，集合/表名
  EMBEDDING_MODEL          可选，默认 text-embedding-v4（须与扩展写入时一致）
"""
import os
import json
import urllib.request
import urllib.error
from mcp.server.fastmcp import FastMCP

# ---- 配置 ----
DASHSCOPE_API_KEY = os.environ["DASHSCOPE_API_KEY"]
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "text-embedding-v4")
VSTORE_TYPE = os.environ["VECTOR_STORE_TYPE"]
VSTORE_URL = os.environ["VECTOR_STORE_URL"].rstrip("/")
VSTORE_API_KEY = os.environ.get("VECTOR_STORE_API_KEY", "")
VSTORE_COLLECTION = os.environ["VECTOR_STORE_COLLECTION"]

EMBEDDING_DIM = 1024  # text-embedding-v4 输出维度，须与向量库 schema 一致

mcp = FastMCP("ai-chat-knowledge")


# ---- 查询 embedding ----
def embed_query(text: str) -> list[float]:
    """对用户查询生成 embedding。注意 text_type 用 'query'（非对称检索），与扩展写入时的 'document' 配对。"""
    url = "https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding"
    body = json.dumps({
        "model": EMBEDDING_MODEL,
        "input": {"texts": [text]},
        "parameters": {"text_type": "query"}
    }).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    return data["output"]["embeddings"][0]["embedding"]


def _http(url: str, headers: dict, body: dict | None = None, method: str = "POST") -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode()
        return json.loads(text) if text else {}


# ---- 各向量库后端的 search 实现 ----
def search_vector_store(query_vec: list[float], top_k: int) -> list[dict]:
    """统一返回 [{id, convId, title, platform, role, content, score}]"""
    if VSTORE_TYPE == "qdrant":
        return _search_qdrant(query_vec, top_k)
    if VSTORE_TYPE == "chroma":
        return _search_chroma(query_vec, top_k)
    if VSTORE_TYPE == "milvus":
        return _search_milvus(query_vec, top_k)
    if VSTORE_TYPE == "pgvector":
        return _search_pgvector(query_vec, top_k)
    if VSTORE_TYPE == "supabase":
        return _search_supabase(query_vec, top_k)
    if VSTORE_TYPE == "pinecone":
        return _search_pinecone(query_vec, top_k)
    raise ValueError(f"未知 VECTOR_STORE_TYPE: {VSTORE_TYPE}")


def _search_qdrant(vec, top_k):
    url = f"{VSTORE_URL}/collections/{VSTORE_COLLECTION}/points/search"
    headers = {"api-key": VSTORE_API_KEY, "Content-Type": "application/json"}
    body = {"vector": vec, "limit": top_k, "with_payload": True}
    data = _http(url, headers, body)
    out = []
    for item in data.get("result", []):
        p = item.get("payload", {})
        out.append({
            "id": str(item.get("id")),
            "convId": p.get("convId", ""),
            "title": p.get("title", ""),
            "platform": p.get("platform", ""),
            "role": p.get("role", ""),
            "content": p.get("content", ""),
            "score": item.get("score", 0),
        })
    return out


def _chroma_collections_base():
    return f"{VSTORE_URL}/api/v2/tenants/default_tenant/databases/default_database/collections"


def _chroma_get_id(collection_name):
    """ChromaDB v2 数据级操作（query/count/add/delete）路径要用 collection 的 UUID，先按名字查出来。"""
    url = f"{_chroma_collections_base()}/{collection_name}"
    data = _http(url, {}, None, "GET")
    if not data.get("id"):
        raise RuntimeError(f"collection [{collection_name}] 未找到 id 字段")
    return data["id"]


def _search_chroma(vec, top_k):
    # ChromaDB 1.0+ 用 v2 API，数据级操作路径要用 collection 的 UUID
    uuid = _chroma_get_id(VSTORE_COLLECTION)
    url = f"{_chroma_collections_base()}/{uuid}/query"
    headers = {"Content-Type": "application/json"}
    body = {"query_embeddings": [vec], "n_results": top_k}
    data = _http(url, headers, body)
    out = []
    ids = data.get("ids", [[]])[0]
    metas = data.get("metadatas", [[]])[0]
    dists = data.get("distances", [[]])[0]
    for i, _id in enumerate(ids):
        m = metas[i] if i < len(metas) else {}
        out.append({
            "id": _id,
            "convId": m.get("convId", ""),
            "title": m.get("title", ""),
            "platform": m.get("platform", ""),
            "role": m.get("role", ""),
            "content": m.get("content", ""),
            # Chroma 返回距离（越小越相似），转成相似度便于阈值判断
            "score": 1 - (dists[i] if i < len(dists) else 0),
        })
    return out


def _search_milvus(vec, top_k):
    url = f"{VSTORE_URL}/v2/vectordb/entities/search"
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {VSTORE_API_KEY}"}
    body = {"collectionName": VSTORE_COLLECTION, "data": [vec], "limit": top_k,
            "outputFields": ["id", "convId", "title", "platform", "role", "content"]}
    data = _http(url, headers, body)
    out = []
    for item in data.get("data", []):
        out.append({
            "id": str(item.get("id")),
            "convId": item.get("convId", ""),
            "title": item.get("title", ""),
            "platform": item.get("platform", ""),
            "role": item.get("role", ""),
            "content": item.get("content", ""),
            "score": item.get("score", item.get("distance", 0)),
        })
    return out


def _search_pgvector(vec, top_k):
    # 走 PostgREST RPC：match_<表名>
    url = f"{VSTORE_URL}/rpc/match_{VSTORE_COLLECTION}"
    headers = {"apikey": VSTORE_API_KEY, "Content-Type": "application/json"}
    body = {"query_embedding": vec, "match_count": top_k}
    data = _http(url, headers, body)
    out = []
    for item in data:
        m = item.get("metadata", {}) or {}
        out.append({
            "id": item.get("id"),
            "convId": item.get("conv_id", ""),
            "title": m.get("title", ""),
            "platform": m.get("platform", ""),
            "role": m.get("role", ""),
            "content": m.get("content", ""),
            "score": item.get("similarity", 0),
        })
    return out


def _search_supabase(vec, top_k):
    # 与 pgvector 同协议，仅 URL 多 /rest/v1 前缀
    url = f"{VSTORE_URL}/rest/v1/rpc/match_{VSTORE_COLLECTION}"
    headers = {"apikey": VSTORE_API_KEY, "Content-Type": "application/json"}
    body = {"query_embedding": vec, "match_count": top_k}
    data = _http(url, headers, body)
    out = []
    for item in data:
        m = item.get("metadata", {}) or {}
        out.append({
            "id": item.get("id"),
            "convId": item.get("conv_id", ""),
            "title": m.get("title", ""),
            "platform": m.get("platform", ""),
            "role": m.get("role", ""),
            "content": m.get("content", ""),
            "score": item.get("similarity", 0),
        })
    return out


def _search_pinecone(vec, top_k):
    url = f"{VSTORE_URL}/query"
    headers = {"Api-Key": VSTORE_API_KEY, "Content-Type": "application/json"}
    body = {"vector": vec, "topK": top_k, "includeMetadata": True}
    data = _http(url, headers, body)
    out = []
    for item in data.get("matches", []):
        m = item.get("metadata", {}) or {}
        out.append({
            "id": item.get("id"),
            "convId": m.get("convId", ""),
            "title": m.get("title", ""),
            "platform": m.get("platform", ""),
            "role": m.get("role", ""),
            "content": m.get("content", ""),
            "score": item.get("score", 0),
        })
    return out


# ---- MCP Tools ----
@mcp.tool()
def search_knowledge(query: str, top_k: int = 5) -> str:
    """在 AI 对话知识库中检索与查询语义相关的片段。

    Args:
        query: 用户的自然语言查询
        top_k: 返回的最相关片段数量，默认 5

    Returns:
        JSON 字符串，每条含 title/platform/role/content/score。
        content 是切片原文（非整条消息），同一条消息可能被切成多个 chunk。
    """
    vec = embed_query(query)
    results = search_vector_store(vec, top_k)
    return json.dumps(results, ensure_ascii=False, indent=2)


@mcp.tool()
def get_stats() -> str:
    """返回向量库统计信息（后端类型、集合名、近似条数）。"""
    info = {
        "backend": VSTORE_TYPE,
        "collection": VSTORE_COLLECTION,
        "embedding_model": EMBEDDING_MODEL,
        "embedding_dim": EMBEDDING_DIM,
    }
    return json.dumps(info, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    # stdio 模式：本地智能体拉起（方式 A）
    # sse 模式：常驻服务，配 nginx 反代（方式 B）
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    if transport == "sse":
        # host=127.0.0.1：只监听本地，公网必须经 nginx 鉴权才能访问
        mcp.run(transport="sse", host="127.0.0.1", port=int(os.environ.get("MCP_PORT", "8765")))
    else:
        mcp.run(transport="stdio")
```

> **关键点**：
> - 查询 embedding 的 `text_type` 用 `"query"`，与扩展写入时的 `"document"` 配对（DashScope 非对称检索推荐做法）。**不要**改成 `document`，否则检索质量会下降。
> - ChromaDB 返回的是**距离**（越小越相似），代码里已转成相似度 `1 - distance`，便于智能体按 `score` 排序/阈值判断。
> - `embedding_dim = 1024` 须与向量库 schema 一致；若扩展改用了多模态模型导致维度变化，需同步修改此处和向量库 schema。

## 部署方式

### 方式 A：stdio（单机自用，由智能体拉起）

智能体配置里声明 command，智能体启动时自动拉起 MCP server 子进程，关停时一并退出。无需常驻，最省资源。**适合本地开发调试**。

### 方式 B：SSE + nginx 反代（公网部署推荐）

适合公开访问、多智能体共享。链路：

```
客户端 ──HTTPS──► nginx :443 ──鉴权──► localhost:8765 MCP server ──► 向量库
```

**为什么鉴权放 nginx 而不是 MCP 代码里**：
- 单一职责：MCP server 只管业务，鉴权逻辑与业务解耦
- 语言无关：换 Python/Node 实现都不影响鉴权配置
- 顺手解决 HTTPS：演示页是 HTTPS 时不能调 HTTP 接口（mixed content 拦截），nginx 一次性处理证书 + 鉴权 + 转发
- 维护成本低：调 token 策略只改 nginx 配置，不动业务代码

把 `mcp.run(transport="stdio")` 改为：

```python
if __name__ == "__main__":
    mcp.run(transport="sse", host="127.0.0.1", port=8765)
```

> `host="127.0.0.1"` 让 MCP server 只监听本地回环，公网无法直连，**必须**经 nginx 才能访问。

用进程管理器常驻（推荐 systemd，见下文配置示例）。

## 环境变量配置

按你实际使用的向量库后端填写。示例（Qdrant）：

```bash
export DASHSCOPE_API_KEY="sk-xxxxxxxx"
export VECTOR_STORE_TYPE="qdrant"
export VECTOR_STORE_URL="http://localhost:6333"
export VECTOR_STORE_API_KEY=""
export VECTOR_STORE_COLLECTION="ai_chat_vectors"
export EMBEDDING_MODEL="text-embedding-v4"
```

> 各后端的 URL 格式与扩展配置完全一致，参考对应 setup 文档的「在本扩展配置中填写」表格。

## nginx 反代 + Token 鉴权（公网部署必备）

公网部署时，nginx 负责：HTTPS 证书 + Token 鉴权 + 反向代理到 MCP server。

### 1. 申请 HTTPS 证书（Let's Encrypt 免费）

```bash
# Debian/Ubuntu
apt install certbot python3-certbot-nginx

# 申请证书（自动改 nginx 配置启用 HTTPS）
certbot --nginx -d mcp.your-domain.com
```

证书 90 天到期，certbot 默认装好 systemd timer 自动续期。**不用手动管**。

### 2. 生成 Token

```bash
# 生成一个 32 字节随机 token
openssl rand -hex 32
# 输出示例：a3f5b8e1c2d4...
```

把这个值同时记下来，下面 nginx 配置和客户端配置都要用。

### 3. nginx 配置

保存为 `/etc/nginx/conf.d/mcp.conf`：

```nginx
# Token 校验：把合法 token 映射为 "ok"，其余都是空字符串
map $arg_token $token_valid {
    default "";
    "a3f5b8e1c2d4_这里替换成你的_token" "ok";
}

server {
    listen 443 ssl http2;
    server_name mcp.your-domain.com;

    # Let's Encrypt 证书（certbot --nginx 会自动填好）
    ssl_certificate     /etc/letsencrypt/live/mcp.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.your-domain.com/privkey.pem;

    # MCP SSE 端点
    location /mcp {
        # Token 校验：URL 没带 ?token=xxx 或 token 不匹配 → 403
        if ($token_valid = "") {
            return 403 '{"error":"invalid or missing token"}';
        }

        # 反向代理到本地 MCP server
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;

        # SSE 必需：禁用缓冲，让流式事件实时推给客户端
        proxy_buffering off;
        proxy_cache off;

        # SSE 必需：保持长连接，不主动断开
        proxy_set_header Connection "";
        proxy_read_timeout 86400s;

        # 透传客户端信息
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTP → HTTPS 强制跳转
server {
    listen 80;
    server_name mcp.your-domain.com;
    return 301 https://$host$request_uri;
}
```

> **SSE 三个关键配置**：`proxy_buffering off`（禁缓冲）、`proxy_cache off`（禁缓存）、`proxy_read_timeout 86400s`（长连接超时拉到一天）。少一个都会导致 SSE 事件积压或连接被提前断开。

### 4. 重载 nginx

```bash
nginx -t          # 测试配置语法
systemctl reload nginx
```

### 5. 验证

```bash
# 不带 token → 应返回 403
curl -i https://mcp.your-domain.com/mcp

# 带正确 token → 应返回 MCP SSE 响应（非 403）
curl -i "https://mcp.your-domain.com/mcp?token=a3f5b8e1c2d4_你的token"
```

## 用 systemd 常驻 MCP server

保存为 `/etc/systemd/system/mcp-server.service`：

```ini
[Unit]
Description=AI Chat Knowledge MCP Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/mcp
ExecStart=/usr/bin/python3 /opt/mcp/mcp_vector_server.py
Restart=on-failure
RestartSec=5

# 环境变量（按你的向量库后端填写，这里是 pgvector 示例）
Environment="MCP_TRANSPORT=sse"
Environment="MCP_PORT=8765"
Environment="DASHSCOPE_API_KEY=sk-xxxxxxxx"
Environment="VECTOR_STORE_TYPE=pgvector"
Environment="VECTOR_STORE_URL=http://localhost:3000"
Environment="VECTOR_STORE_API_KEY="
Environment="VECTOR_STORE_COLLECTION=ai_chat_vectors"
Environment="EMBEDDING_MODEL=text-embedding-v4"

# 安全加固：限制权限
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/mcp

[Install]
WantedBy=multi-user.target
```

启用：

```bash
systemctl daemon-reload
systemctl enable --now mcp-server
systemctl status mcp-server    # 看是否 active (running)
journalctl -u mcp-server -f    # 实时看日志
```

> 配合 PostgREST 同机部署时，`VECTOR_STORE_URL=http://localhost:3000` 走内网回环，PostgREST 无需暴露公网端口。

## 在智能体中接入

### 方式 A：stdio（本地自用）

在智能体的 MCP 配置文件中加入（智能体自动拉起 server 子进程）：

```json
{
  "mcpServers": {
    "ai-chat-knowledge": {
      "command": "python",
      "args": ["/abs/path/to/mcp_vector_server.py"],
      "env": {
        "DASHSCOPE_API_KEY": "sk-xxxxxxxx",
        "VECTOR_STORE_TYPE": "qdrant",
        "VECTOR_STORE_URL": "http://localhost:6333",
        "VECTOR_STORE_API_KEY": "",
        "VECTOR_STORE_COLLECTION": "ai_chat_vectors",
        "EMBEDDING_MODEL": "text-embedding-v4"
      }
    }
  }
}
```

### 方式 B：SSE（连公网部署的 MCP，带 token）

智能体配置指向 nginx 暴露的 HTTPS 端点，token 拼在 URL 里：

```json
{
  "mcpServers": {
    "ai-chat-knowledge": {
      "url": "https://mcp.your-domain.com/mcp?token=a3f5b8e1c2d4_你的token"
    }
  }
}
```

> 这也是**演示页前端**调用 MCP 的方式：`fetch("https://mcp.your-domain.com/mcp?token=xxx", ...)`。

### 两个 tool

接入后智能体会获得：
- `search_knowledge(query, top_k=5)` — 语义检索对话片段
- `get_stats()` — 查看知识库元信息

智能体可自行决定何时调用（通常在用户提问时由 LLM 自主判断是否需要检索知识库）。

## 安全注意事项

1. **API Key 不硬编码**：`DASHSCOPE_API_KEY` 和 `VECTOR_STORE_API_KEY` 一律走环境变量，不要写进代码或提交到 git。
2. **向量库网络暴露范围**：生产环境不要把向量库端口直接暴露到公网。MCP server 与向量库同机或同内网部署，仅 MCP server 的 SSE 端口（若用方式 B）对外。
3. **DashScope Key 最小权限**：MCP server 只需要 embedding 接口权限，不需要 chat/completion 权限。若 DashScope 支持按接口授权，给 MCP server 用的 key 应只授予 embedding 权限。
4. **stdio 优先**：单智能体场景优先用 stdio（方式 A），避免常驻进程的网络暴露面。
5. **日志脱敏**：若开启 MCP server 日志，注意不要打印完整查询向量或 content（可能含敏感对话内容）。

## 排查清单

| 现象 | 排查方向 |
|---|---|
| 智能体看不到 tool | 确认 `mcp.run(transport="stdio")` 且智能体配置的 `command` 路径正确；手动跑 `python mcp_vector_server.py` 看是否报错（缺依赖、缺环境变量） |
| `search_knowledge` 报 KeyError | 环境变量未设置，检查 `DASHSCOPE_API_KEY` / `VECTOR_STORE_TYPE` 等是否注入 |
| 检索结果全是空 content | 向量库里的记录是扩展**旧版本**写入的（没有 content 字段）。需在扩展里点「重建索引」用新代码重新 embedding 入库 |
| 检索质量差 | 确认 MCP server 的 `text_type` 是 `"query"` 而非 `"document"`；确认 `EMBEDDING_MODEL` 与扩展写入时一致 |
| Milvus 报字段不存在 | Milvus 把 metadata 展平成行字段，collection schema 必须包含 `title/platform/role/content` 等字段。参考 [milvus-setup.md](./milvus-setup.md) 的 schema 定义 |
| pgvector / Supabase 报 404 | `match_<表名>` 函数未创建或函数名与表名不匹配。参考 [pgvector-setup.md](./pgvector-setup.md) 第 3 步 |
| pgvector 报 401 | PostgREST 版本问题或 anon 角色未授权。须用 v12+，参考 [pgvector-setup.md](./pgvector-setup.md) 第 4 步 |
| DashScope embed 报 401 | API Key 无效或无 embedding 接口权限 |
| 调用返回 403 | nginx token 校验失败。检查 URL 是否带 `?token=xxx`，token 是否与 nginx `map` 块里配置的一致 |
| SSE 事件延迟到达或卡住 | nginx 漏配 SSE 三件套：`proxy_buffering off` / `proxy_cache off` / `proxy_read_timeout 86400s`。少一个就会积压或断连 |
| 演示页 fetch 报 mixed content | 演示页是 HTTPS 但 MCP 是 HTTP。nginx 必须配 HTTPS（Let's Encrypt），客户端用 `https://` 调用 |
| 公网能直连 8765 端口 | MCP server 的 `host` 写成了 `0.0.0.0`。必须用 `host="127.0.0.1"`，让公网只能经 nginx 访问 |
| 智能体连不上 SSE 端点 | 阿里云 ECS 安全组未放行 443。控制台 → ECS → 安全组 → 入方向加 TCP 443 |

## 参考

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [DashScope Text Embedding 文档](https://help.aliyun.com/zh/dashscope/developer-reference/text-embedding-synchronous-api)
- 各向量库部署文档：[chroma](./chroma-setup.md) / [milvus](./milvus-setup.md) / [pgvector](./pgvector-setup.md) / [pinecone](./pinecone-setup.md) / [supabase](./supabase-setup.md) / [qdrant](./qdrant-setup.md)
