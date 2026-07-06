# PostgreSQL + pgvector 部署说明

## 为什么需要 PostgREST？

Chrome 扩展无法直接通过 TCP 连接 PostgreSQL，必须通过 HTTP 网关访问。**PostgREST** 是一个开源的 PostgreSQL → REST API 服务，可将 PG 表自动暴露为 REST 接口。

## 部署步骤

### 1. 在 PostgreSQL 中启用 pgvector 扩展

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 2. 创建存储向量的表

表名即配置中的"集合/表名"。

```sql
CREATE TABLE ai_chat_vectors (
  id TEXT PRIMARY KEY,
  embedding vector(1024),
  conv_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 按 conv_id 删除加速
CREATE INDEX ON ai_chat_vectors (conv_id);
```

### 3. 创建相似度搜索函数

PostgREST 通过 RPC 调用此函数。

```sql
CREATE OR REPLACE FUNCTION match_ai_chat_vectors(
  query_embedding vector(1024),
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id TEXT,
  conv_id TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT id, conv_id, metadata,
         1 - (embedding <=> query_embedding) AS similarity
  FROM ai_chat_vectors
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

> **注意**：函数名格式为 `match_<表名>`，表名改了函数名也要改。

### 4. 部署 PostgREST

Docker 一行命令：

```bash
docker run -d -p 3000:3000 \
  -e PGRST_DB_URI="postgres://user:pass@host:5432/dbname" \
  -e PGRST_DB_SCHEMAS="public" \
  -e PGRST_DB_ANON_ROLE="anon" \
  postgrest/postgrest
```

需要在 PG 中创建 `anon` 角色并授予表/函数的 SELECT/INSERT/DELETE 权限：

```sql
CREATE ROLE anon NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_chat_vectors TO anon;
GRANT EXECUTE ON FUNCTION match_ai_chat_vectors TO anon;
```

### 5. 在本扩展配置中填写

| 字段 | 填写内容 |
|---|---|
| **服务地址** | PostgREST 地址，如 `http://localhost:3000` |
| **API Key** | PostgREST 的 JWT token（若启用了认证），未启用认证可留空 |
| **集合/表名** | PG 表名，如 `ai_chat_vectors` |

## 阿里云 RDS PostgreSQL 用户

阿里云 RDS PG 支持 pgvector。建议在阿里云 ECS 上部署 PostgREST，通过内网访问 RDS（延迟低、免流量费）。

## 参考

- [PostgREST 官方文档](https://postgrest.org/en/stable/)
- [pgvector 项目](https://github.com/pgvector/pgvector)
