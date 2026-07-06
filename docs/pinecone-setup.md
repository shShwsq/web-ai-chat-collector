# Pinecone 部署说明

Pinecone 是一个全托管的云向量数据库服务，无需自部署。Chrome 扩展通过 Pinecone REST API 访问。

## 配置步骤

### 1. 注册 Pinecone 账号

访问 [Pinecone 官网](https://www.pinecone.io/) 注册账号（有免费额度）。

### 2. 创建 Index

1. 登录 Pinecone 控制台
2. 点击 "Create Index"
3. 配置：
   - **Name**：`ai-chat-vectors`（自定义）
   - **Dimensions**：`1024`（必须与 embedding 模型一致，text-embedding-v4 为 1024 维）
   - **Metric**：`cosine`
   - **Pod Type**：选 Starter（免费）或更大规格
4. 等待 index 就绪（约 1-2 分钟）

### 3. 获取 API Key

1. 在 Pinecone 控制台点击右上角 "API Keys"
2. 复制默认 project 的 API Key

### 4. 在本扩展配置中填写

| 字段 | 填写内容 |
|---|---|
| **服务地址** | Pinecone index 的 endpoint，如 `https://ai-chat-vectors-xxx.svc.us-east1-aws.pinecone.io`（在 index 详情页 "Endpoint" 字段复制） |
| **API Key** | Pinecone 控制台获取的 API Key |
| **集合/表名** | Pinecone 的 namespace（可留空使用默认 namespace，或填 `ai-chat-vectors`） |

## 注意事项

### 关于 Namespace

Pinecone 的 namespace 是逻辑分组，不是 collection。扩展代码中所有向量都会写入指定的 namespace。如果你想让不同来源的向量隔离，可使用不同 namespace。

### 关于 Dimensions

**Index 的 dimensions 必须与 embedding 模型输出维度完全一致**，否则插入会失败。

| Embedding 模型 | 维度 |
|---|---|
| text-embedding-v4（推荐） | 1024 |
| tongyi-embedding-vision-plus | 1024 |

### 关于 Region

Pinecone 控制台创建的 index 会得到一个特定 AWS region 的 endpoint。从中国大陆访问可能延迟较高（约 200-500ms），生产环境建议：
- 选择离用户近的 region（us-east1 通常国际带宽最好）
- 或考虑 Zilliz Cloud / Milvus 等支持国内节点的方案

## 免费额度

Pinecone Starter（免费）计划限制：
- 1 个 project
- 1 个 Starter pod（约 100K 向量，1024 维）
- 每月 100 万 read units / 2M write units

对于个人 AI 对话采集场景足够使用。

## 常见问题

**Q: 插入向量报 400 "dimension mismatch"？**
A: 检查 Pinecone index 的 dimensions 设置是否与 embedding 模型一致（应为 1024）。

**Q: 搜索延迟很高？**
A: Pinecone 服务器在海外。如对延迟敏感，建议换用国内可访问的方案（如 Milvus 自部署）。

**Q: API Key 失效？**
A: 在 Pinecone 控制台 "API Keys" 页面重新生成。注意旧 Key 会立即失效。

## 参考

- [Pinecone 官方文档](https://docs.pinecone.io/)
- [Pinecone REST API](https://docs.pinecone.io/reference/api/overview)
