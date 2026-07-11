#!/usr/bin/env python3
"""
AI 对话知识库检索脚本（SKILL 配套工具）

用法：
  python3 query_knowledge.py search "查询内容" [--top-k 5]
  python3 query_knowledge.py stats

配置：
  通过环境变量或同目录下的 .env 文件提供以下配置：
    KB_VSTORE_TYPE     向量库类型（chroma/qdrant/pgvector/supabase/milvus）
    KB_VSTORE_URL      向量库地址
    KB_VSTORE_COLLECTION  集合/表名（默认 ai_chat_vectors）
    KB_VSTORE_API_KEY  向量库 API Key（Supabase/Milvus Zilliz 需要，ChromaDB 本地部署不需要）
    KB_DASHSCOPE_KEY   DashScope API Key（用于生成查询 embedding）

  可选：
    KB_VSTORE_VERIFY_TLS  true/false（默认 false，自签证书时跳过校验）
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
import urllib.parse


# ============================================================
# 配置加载
# ============================================================

def load_config():
    """从环境变量或 .env 文件加载配置（.env 在脚本同目录或父目录）"""
    # 查找 .env：先脚本同目录，再父目录（兼容 scripts/ 子目录结构）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    for env_path in [os.path.join(script_dir, ".env"),
                     os.path.join(os.path.dirname(script_dir), ".env")]:
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        key, _, val = line.partition("=")
                        os.environ.setdefault(key.strip(), val.strip())
            break

    required = ["KB_VSTORE_TYPE", "KB_VSTORE_URL", "KB_DASHSCOPE_KEY"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        print(f"错误：缺少环境变量 {missing}", file=sys.stderr)
        print(f"请在 SKILL 目录下创建 .env 文件，配置见 SKILL.md", file=sys.stderr)
        sys.exit(1)

    return {
        "vstore_type": os.environ["KB_VSTORE_TYPE"],
        "vstore_url": os.environ["KB_VSTORE_URL"].rstrip("/"),
        "vstore_collection": os.environ.get("KB_VSTORE_COLLECTION", "ai_chat_vectors"),
        "vstore_api_key": os.environ.get("KB_VSTORE_API_KEY", ""),
        "dashscope_key": os.environ["KB_DASHSCOPE_KEY"],
        "verify_tls": os.environ.get("KB_VSTORE_VERIFY_TLS", "false").lower() == "true",
        "embedding_model": os.environ.get("KB_EMBEDDING_MODEL", "text-embedding-v4"),
        "embedding_dim": int(os.environ.get("KB_EMBEDDING_DIM", "1024")),
    }


# ============================================================
# Embedding 生成
# ============================================================

def embed_query(query: str, cfg: dict) -> list:
    """调 DashScope 生成查询向量（text_type='query'，与写入时的 'document' 配对）"""
    url = "https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding"
    body = json.dumps({
        "model": cfg["embedding_model"],
        "input": {"texts": [query]},
        "parameters": {"text_type": "query"}
    }).encode()

    req = urllib.request.Request(url, data=body, headers={
        "Authorization": f"Bearer {cfg['dashscope_key']}",
        "Content-Type": "application/json"
    })

    try:
        import ssl
        ctx = ssl.create_default_context()
        if not cfg["verify_tls"]:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        resp = urllib.request.urlopen(req, context=ctx)
        result = json.loads(resp.read())
        return result["output"]["embeddings"][0]["embedding"]
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        print(f"错误：DashScope API 调用失败 HTTP {e.code}: {err_body}", file=sys.stderr)
        sys.exit(1)


# ============================================================
# 向量库检索（各后端）
# ============================================================

def _http_get(url, headers=None, cfg=None):
    import ssl
    ctx = ssl.create_default_context()
    if cfg and not cfg["verify_tls"]:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers=headers or {})
    return json.loads(urllib.request.urlopen(req, context=ctx).read())


def _http_post(url, body, headers=None, cfg=None):
    import ssl
    ctx = ssl.create_default_context()
    if cfg and not cfg["verify_tls"]:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        **(headers or {})
    })
    resp = urllib.request.urlopen(req, context=ctx)
    # 204 或空响应
    body = resp.read()
    return json.loads(body) if body else {}


def _chroma_get_space(info):
    """从 collection 详情中提取 hnsw:space（distance function）。
    ChromaDB 默认为 l2（平方欧氏距离）。不同版本/部署返回结构略有差异，
    依次尝试 metadata、configuration 字段，均缺失时回退到 'l2'。
    """
    # 常见结构 1：info.metadata["hnsw:space"]（创建时通过 metadata 指定）
    meta = info.get("metadata") or {}
    if isinstance(meta, dict) and meta.get("hnsw:space"):
        return meta["hnsw:space"]
    # 常见结构 2：info.configuration.fields["hnsw:space"]
    cfg = info.get("configuration") or {}
    fields = cfg.get("fields") if isinstance(cfg, dict) else None
    if isinstance(fields, dict) and fields.get("hnsw:space"):
        return fields["hnsw:space"]
    # 常见结构 3：info.configuration.hnsw.space（嵌套对象形式）
    hnsw = cfg.get("hnsw") if isinstance(cfg, dict) else None
    if isinstance(hnsw, dict) and hnsw.get("space"):
        return hnsw["space"]
    return "l2"  # ChromaDB 默认


def _chroma_distance_to_score(space, d):
    """按 distance function 将 ChromaDB distance 转成 score（越大越相似）。
    - l2（平方欧氏）：d ∈ [0, +∞)，score = 1/(1+d)，单调递减到 0
    - cosine：d ∈ [0, 2]，score = 1-d，还原成 cosine similarity ∈ [-1, 1]
    - ip（负内积）：d = -⟨a,b⟩，score = -d，还原成内积
    """
    if space == "cosine":
        return 1 - d
    if space == "ip":
        return -d
    # l2 或未知：用 1/(1+d) 归一化，避免高维 L2 距离 >1 时被线性压成 0
    return 1 / (1 + d) if d >= 0 else 1.0


def search_chroma(query_vec, top_k, cfg):
    """ChromaDB v2 检索：先按名字查 UUID 和 distance function，再用 UUID 查询。
    score 转换公式根据 collection 创建时指定的 hnsw:space 动态选择，
    避免对 L2 距离套用 cosine 公式导致区分度丢失。
    """
    base = f"{cfg['vstore_url']}/api/v2/tenants/default_tenant/databases/default_database/collections"

    # 1. 查 UUID 和 distance function（同一次 GET 拿到）
    info = _http_get(f"{base}/{cfg['vstore_collection']}", cfg=cfg)
    uuid = info["id"]
    space = _chroma_get_space(info)

    # 2. 查询（必须显式 include distances，否则默认不返回）
    result = _http_post(f"{base}/{uuid}/query", {
        "query_embeddings": [query_vec],
        "n_results": top_k,
        "include": ["metadatas", "distances"]
    }, cfg=cfg)

    # 3. 整理结果
    out = []
    ids = result.get("ids", [[]])
    metas = result.get("metadatas", [[]])
    dists = result.get("distances", [[]])
    for i in range(len(ids[0]) if ids and ids[0] else 0):
        m = metas[0][i] if metas and metas[0] else {}
        d = dists[0][i] if dists and dists[0] else 0
        score = round(_chroma_distance_to_score(space, d), 4)
        out.append({
            "id": ids[0][i],
            "convId": m.get("convId", ""),
            "title": m.get("title", ""),
            "platform": m.get("platform", ""),
            "role": m.get("role", ""),
            "content": m.get("content", ""),
            "score": score
        })
    return out


def search_qdrant(query_vec, top_k, cfg):
    """Qdrant 检索"""
    url = f"{cfg['vstore_url']}/collections/{cfg['vstore_collection']}/points/search"
    headers = {}
    if cfg["vstore_api_key"]:
        headers["api-key"] = cfg["vstore_api_key"]

    result = _http_post(url, {
        "vector": query_vec,
        "limit": top_k,
        "with_payload": True
    }, headers=headers, cfg=cfg)

    out = []
    for hit in result.get("result", []):
        p = hit.get("payload", {})
        out.append({
            "id": hit.get("id", ""),
            "convId": p.get("convId", ""),
            "title": p.get("title", ""),
            "platform": p.get("platform", ""),
            "role": p.get("role", ""),
            "content": p.get("content", ""),
            "score": round(hit.get("score", 0), 4)
        })
    return out


def search_pgvector(query_vec, top_k, cfg):
    """PostgreSQL + pgvector + PostgREST 检索
    match_<table> 函数返回字段：id, conv_id, metadata(JSONB), similarity
    其中 title/platform/role/content 等业务字段封装在 metadata JSONB 内，
    不是顶层字段，必须从 metadata 中解析。
    """
    url = f"{cfg['vstore_url']}/rpc/match_{cfg['vstore_collection']}"
    headers = {}
    if cfg["vstore_api_key"]:
        headers["apikey"] = cfg["vstore_api_key"]
        headers["Authorization"] = f"Bearer {cfg['vstore_api_key']}"

    result = _http_post(url, {
        "query_embedding": query_vec,
        "match_count": top_k
    }, headers=headers, cfg=cfg)

    out = []
    for row in result if isinstance(result, list) else []:
        meta = row.get("metadata") or {}
        out.append({
            "id": row.get("id", ""),
            "convId": row.get("conv_id", "") or meta.get("convId", ""),
            "title": meta.get("title", ""),
            "platform": meta.get("platform", ""),
            "role": meta.get("role", ""),
            "content": meta.get("content", ""),
            "score": round(row.get("similarity", 0), 4)
        })
    return out


def _normalize_supabase_url(url):
    """归一化 Supabase URL：剥掉末尾斜杠和 /rest/v1 后缀。
    用户可能按 Supabase 官方文档填入带 /rest/v1 的地址，
    统一剥掉后再由各方法重新拼接，避免 /rest/v1/rest/v1/ 双前缀 404。
    与插件 vector-store.js 的 _normalizeSupabaseUrl 行为保持一致。
    """
    return url.rstrip("/").replace("/rest/v1", "", 1) if url.rstrip("/").endswith("/rest/v1") else url.rstrip("/")


def search_supabase(query_vec, top_k, cfg):
    """Supabase（PostgREST + /rest/v1 前缀）检索
    match_<table> 函数返回字段：id, conv_id, metadata(JSONB), similarity
    与 pgvector 共用相同的 match 函数签名，字段解析逻辑一致。
    """
    base = _normalize_supabase_url(cfg["vstore_url"])
    url = f"{base}/rest/v1/rpc/match_{cfg['vstore_collection']}"
    headers = {}
    if cfg["vstore_api_key"]:
        headers["apikey"] = cfg["vstore_api_key"]
        headers["Authorization"] = f"Bearer {cfg['vstore_api_key']}"

    result = _http_post(url, {
        "query_embedding": query_vec,
        "match_count": top_k
    }, headers=headers, cfg=cfg)

    out = []
    for row in result if isinstance(result, list) else []:
        meta = row.get("metadata") or {}
        out.append({
            "id": row.get("id", ""),
            "convId": row.get("conv_id", "") or meta.get("convId", ""),
            "title": meta.get("title", ""),
            "platform": meta.get("platform", ""),
            "role": meta.get("role", ""),
            "content": meta.get("content", ""),
            "score": round(row.get("similarity", 0), 4)
        })
    return out


def search_milvus(query_vec, top_k, cfg):
    """Milvus v2 REST API 检索
    与 pgvector/supabase 不同，Milvus 的字段是平铺存储的（非 metadata JSONB），
    查询时需通过 outputFields 显式指定要返回的字段，否则只返回 id + distance。
    metricType=COSINE 时 score 越大越相似，无需像 ChromaDB 那样做 1-d 转换。
    """
    url = f"{cfg['vstore_url']}/v2/vectordb/entities/search"
    headers = {"Content-Type": "application/json"}
    if cfg["vstore_api_key"]:
        headers["Authorization"] = f"Bearer {cfg['vstore_api_key']}"

    result = _http_post(url, {
        "collectionName": cfg["vstore_collection"],
        "data": [query_vec],
        "limit": top_k,
        "outputFields": ["id", "convId", "title", "platform", "role", "content", "msgHash", "chunkIdx", "chunkTotal"]
    }, headers=headers, cfg=cfg)

    out = []
    for item in result.get("data", []):
        out.append({
            "id": str(item.get("id", "")),
            "convId": item.get("convId", ""),
            "title": item.get("title", ""),
            "platform": item.get("platform", ""),
            "role": item.get("role", ""),
            "content": item.get("content", ""),
            # Milvus COSINE metric: score 越大越相似；兼容 distance 字段
            "score": round(item.get("score", item.get("distance", 0)), 4)
        })
    return out


def search_vector_store(query_vec, top_k, cfg):
    """统一检索入口"""
    t = cfg["vstore_type"].lower()
    if t == "chroma":
        return search_chroma(query_vec, top_k, cfg)
    elif t == "qdrant":
        return search_qdrant(query_vec, top_k, cfg)
    elif t == "pgvector":
        return search_pgvector(query_vec, top_k, cfg)
    elif t == "supabase":
        return search_supabase(query_vec, top_k, cfg)
    elif t == "milvus":
        return search_milvus(query_vec, top_k, cfg)
    else:
        print(f"错误：暂不支持后端类型 {t}，支持 chroma/qdrant/pgvector/supabase/milvus", file=sys.stderr)
        sys.exit(1)


# ============================================================
# 统计信息
# ============================================================

def get_stats(cfg):
    """获取向量库统计信息"""
    t = cfg["vstore_type"].lower()
    count = 0

    if t == "chroma":
        base = f"{cfg['vstore_url']}/api/v2/tenants/default_tenant/databases/default_database/collections"
        info = _http_get(f"{base}/{cfg['vstore_collection']}", cfg=cfg)
        uuid = info["id"]
        count = _http_get(f"{base}/{uuid}/count", cfg=cfg)

    elif t == "qdrant":
        url = f"{cfg['vstore_url']}/collections/{cfg['vstore_collection']}"
        headers = {}
        if cfg["vstore_api_key"]:
            headers["api-key"] = cfg["vstore_api_key"]
        info = _http_get(url, headers=headers, cfg=cfg)
        count = info.get("result", {}).get("points_count", 0)

    elif t == "milvus":
        # Milvus 必须用 get_stats 接口取 rowCount，query 接口不支持 count
        url = f"{cfg['vstore_url']}/v2/vectordb/collections/get_stats"
        headers = {"Content-Type": "application/json"}
        if cfg["vstore_api_key"]:
            headers["Authorization"] = f"Bearer {cfg['vstore_api_key']}"
        info = _http_post(url, {"collectionName": cfg["vstore_collection"]}, headers=headers, cfg=cfg)
        count = info.get("data", {}).get("rowCount", 0)

    elif t in ("pgvector", "supabase"):
        # supabase 需归一化 URL（剥掉可能存在的 /rest/v1 后缀再重新拼接）
        base = _normalize_supabase_url(cfg["vstore_url"]) if t == "supabase" else cfg["vstore_url"].rstrip("/")
        prefix = "/rest/v1" if t == "supabase" else ""
        url = f"{base}{prefix}/{cfg['vstore_collection']}?select=id&limit=0"
        headers = {}
        if cfg["vstore_api_key"]:
            headers["apikey"] = cfg["vstore_api_key"]
            headers["Authorization"] = f"Bearer {cfg['vstore_api_key']}"
        headers["Prefer"] = "count=exact"
        headers["Range"] = "0-0"
        import ssl
        ctx = ssl.create_default_context()
        if not cfg["verify_tls"]:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(url, headers=headers)
        resp = urllib.request.urlopen(req, context=ctx)
        range_header = resp.headers.get("Content-Range", "*/0")
        count = int(range_header.split("/")[-1]) if "/" in range_header else 0

    return {
        "backend": cfg["vstore_type"],
        "collection": cfg["vstore_collection"],
        "embedding_model": cfg["embedding_model"],
        "embedding_dim": cfg["embedding_dim"],
        "count": count
    }


# ============================================================
# 主入口
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="AI 对话知识库检索工具")
    sub = parser.add_subparsers(dest="command")

    search_p = sub.add_parser("search", help="语义检索对话历史")
    search_p.add_argument("query", help="查询内容")
    search_p.add_argument("--top-k", type=int, default=5, help="返回条数（默认 5）")

    sub.add_parser("stats", help="查看知识库统计信息")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    cfg = load_config()

    if args.command == "search":
        vec = embed_query(args.query, cfg)
        results = search_vector_store(vec, args.top_k, cfg)
        print(json.dumps(results, ensure_ascii=False, indent=2))

    elif args.command == "stats":
        info = get_stats(cfg)
        print(json.dumps(info, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
