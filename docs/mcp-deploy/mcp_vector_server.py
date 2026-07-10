"""
AI Chat 知识库 MCP Server
把扩展写入的远程向量库暴露为 MCP tool，供 openclaw 等智能体消费。

环境变量（通过 .env 或 systemd EnvironmentFile 注入）：
  DASHSCOPE_API_KEY        必填，用于查询时生成 embedding
  VECTOR_STORE_TYPE        必填，chroma | milvus | pgvector | pinecone | supabase | qdrant
  VECTOR_STORE_URL         必填，向量库服务地址
  VECTOR_STORE_API_KEY     视后端而定（Chroma 可空，其余通常必填）
  VECTOR_STORE_COLLECTION  必填，集合/表名
  EMBEDDING_MODEL          可选，默认 text-embedding-v4（须与扩展写入时一致）
  MCP_TRANSPORT            可选，stdio | sse，默认 stdio
  MCP_PORT                 可选，sse 模式监听端口，默认 8765
  MCP_HOST                 可选，sse 模式监听地址，默认 127.0.0.1（仅本地，公网须经 nginx）
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
    # stdio 模式：本地智能体拉起
    # sse 模式：常驻服务，配 nginx 反代（生产部署用）
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    if transport == "sse":
        # host=127.0.0.1：只监听本地，公网必须经 nginx 才能访问
        host = os.environ.get("MCP_HOST", "127.0.0.1")
        port = int(os.environ.get("MCP_PORT", "8765"))
        mcp.run(transport="sse", host=host, port=port)
    else:
        mcp.run(transport="stdio")
