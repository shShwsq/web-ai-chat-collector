# Milvus 部署说明

Milvus 是一个开源的高性能向量数据库，Chrome 扩展通过 Milvus v2 REST API 访问。

## 部署步骤（Docker Compose 推荐）

### 1. 下载 docker-compose 配置

```bash
wget https://github.com/milvus-io/milvus/releases/download/v2.4.0/milvus-standalone-docker-compose.yml -O docker-compose.yml
```

### 2. 启动 Milvus

```bash
docker-compose up -d
```

默认 REST API 端口为 `9091`（gRPC 端口 19530，不需要在扩展里配置）。

### 3. 创建 Collection + Index

通过 REST API 创建 collection（需先创建 schema）：

```bash
curl -X POST http://localhost:9091/v2/vectordb/collections/create \
  -H "Content-Type: application/json" \
  -d '{
    "collectionName": "ai_chat_vectors",
    "schema": {
      "autoId": false,
      "fields": [
        {"fieldName": "id", "dataType": "VarChar", "elementTypeParams": {"max_length": "256"}},
        {"fieldName": "vector", "dataType": "FloatVector", "elementTypeParams": {"dim": "1024"}},
        {"fieldName": "convId", "dataType": "VarChar", "elementTypeParams": {"max_length": "256"}},
        {"fieldName": "title", "dataType": "VarChar", "elementTypeParams": {"max_length": "512"}},
        {"fieldName": "platform", "dataType": "VarChar", "elementTypeParams": {"max_length": "64"}},
        {"fieldName": "role", "dataType": "VarChar", "elementTypeParams": {"max_length": "32"}},
        {"fieldName": "content", "dataType": "VarChar", "elementTypeParams": {"max_length": "4096"}},
        {"fieldName": "msgHash", "dataType": "VarChar", "elementTypeParams": {"max_length": "256"}},
        {"fieldName": "chunkIdx", "dataType": "Int64"},
        {"fieldName": "chunkTotal", "dataType": "Int64"}
      ]
    },
    "indexParams": [
      {"fieldName": "vector", "metricType": "COSINE", "indexType": "AUTOINDEX"}
    ]
  }'
```

> **字段说明**：扩展会把每条向量的元数据展平成行字段写入。`convId` 用于按对话删除；`title/platform/role/content` 让远程向量库成为自包含数据，可被外部智能体（如 openclaw）作为知识源直接检索消费。
>
> **content 的 max_length**：应不小于扩展设置中的 `chunkSize`（默认 500）。上面取 4096 已留足余量；若你调大了 `chunkSize`，请同步调大此值，否则超长切片写入会失败。

### 4. 在本扩展配置中填写

| 字段 | 填写内容 |
|---|---|
| **服务地址** | Milvus REST API 地址，如 `http://localhost:9091` |
| **API Key** | Milvus 默认无认证，留空。Zilliz Cloud 或启用 RBAC 时填写 root:Milvus 或 token |
| **集合/表名** | collection 名称，如 `ai_chat_vectors` |

## 云端方案：Zilliz Cloud

Zilliz Cloud 是 Milvus 的官方托管服务：

1. 注册 [Zilliz Cloud](https://zilliz.com/)，创建 cluster
2. 在 cluster 详情页获取 Public Endpoint，如 `https://in03-xxx.aws.zillizcloud.com`
3. 创建 API Key（Token）
4. 在扩展中填写：
   - **服务地址**：Zilliz Cloud Public Endpoint
   - **API Key**：Zilliz Cloud Token
   - **集合/表名**：在 Zilliz Cloud 控制台创建的 collection 名

## 常见问题

**Q: 启动后连接失败？**
A: 确认 REST API 端口 9091 可访问。注意 Milvus 有 gRPC（19530）和 REST（9091）两套端口，扩展只用 REST。

**Q: 创建 collection 报错 "dimension mismatch"？**
A: collection 的向量维度必须与 embedding 模型输出维度一致。text-embedding-v4 为 1024 维。

## 参考

- [Milvus 官方文档](https://milvus.io/docs)
- [Milvus REST API 参考](https://milvus.io/api-reference/rest/v2.x/About.md)
- [Zilliz Cloud](https://zilliz.com/)
