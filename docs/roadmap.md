# 上架前改进规划

本规划基于 v2.0.0 的代码审查结果，目标是把插件从「功能可用」推进到「生产级上架」。按优先级分四个阶段，P0 为上架硬门槛，P1 为强烈建议，P2 为长期打磨。

---

## P0：上架前必须完成

### 1. i18n（国际化）

**为什么做**：Chrome Web Store 商店页面会按用户浏览器语言展示描述；不做 i18n 在欧美市场会被审核降优先级。当前所有文案硬编码中文。

**改动范围**

- 新建目录结构：

  ```
  _locales/
  ├── en/
  │   └── messages.json
  └── zh_CN/
      └── messages.json
  ```

- `manifest.json` 把 `name` / `description` / `default_title` 改为 `__MSG_xxx__` 占位符
- `popup/popup.html` / `popup/settings.html` 的静态文案抽到 messages.json，JS 启动时用 `chrome.i18n.getMessage()` 注入
- `content/ui/floating-ball.js` / `content/ai-ball.js` 的按钮、提示文案同样抽离
- 错误消息（`bg/*.js` 里的 throw / return error）保留中文，但可考虑双语或单独建 `errors.json`

**messages.json 示例**

```json
{
  "extName": { "message": "AI Chat Collector" },
  "extDescription": { "message": "Capture AI platform conversations and build a searchable knowledge base" },
  "searchPlaceholder": { "message": "Search conversations..." },
  "btnExportAll": { "message": "Export All" },
  "btnSettings": { "message": "Settings" }
}
```

**验收标准**

- 切换浏览器语言为 `en-US` 后，popup / settings / 悬浮球面板文案全部显示英文
- `manifest.json` 无任何明文中文字符串（除注释外）
- Chrome Web Store Developer Dashboard 的「Store Listing」能分别填写英文/中文描述

**预计工作量**：0.5-1 天

---

### 2. 安全问题修复

**为什么做**：当前 [content/network-interceptor.js](file:///workspace/content/network-interceptor.js) 存在两个会被 Chrome Web Store 自动化扫描标记的安全模式。

#### 2.1 `postMessage` targetOrigin 修复

**问题位置**：[content/network-interceptor.js#L76](file:///workspace/content/network-interceptor.js) 和 #L123

```js
window.postMessage(msg, '*');   // 广播给页面上所有脚本
```

拦截到的内容包括用户完整对话 + `Authorization` / `Token` / `Cookie` 头，页面上任意第三方脚本（统计 SDK、被注入代码、其他扩展的 content script）都能监听到。

**修复方案**

```js
// 发送端
window.postMessage(msg, location.origin);

// 接收端（content/exporter-base.js 等）
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.origin !== location.origin) return;   // 新增
  if (event.data?.type !== '__AI_CHAT_INTERCEPTED__') return;
  // ...
});
```

#### 2.2 auxiliary request 机制

**问题位置**：[content/network-interceptor.js#L132-L154](file:///workspace/content/network-interceptor.js)

页面脚本可伪造 `__AI_CHAT_FETCH_REQUEST__` 消息，让扩展用用户凭证代为发请求，绕过用户主动操作。

**修复方案（二选一）**

- **方案 A（推荐）：直接砍掉**

  DOM 模式已能拿到完整对话，auxiliary request 主要服务于 DeepSeek 网络模式缓存未命中场景，收益有限。删除以下内容：
  - [content/network-interceptor.js](file:///workspace/content/network-interceptor.js) 第 132-154 行的 `__AI_CHAT_FETCH_REQUEST__` 监听器
  - [content/network/deepseek.js](file:///workspace/content/network/deepseek.js) 中 `fetchFullHistory` / `fetchConversation` 的调用入口
  - [content/network/common.js](file:///workspace/content/network/common.js) 中 `fetchViaInterceptor` 工具函数

- **方案 B：默认关闭 + 用户显式开启**

  设置页加开关「允许辅助请求补全历史（不推荐）」，默认关。content script 读取该设置后才注册监听器。

**验收标准**

- 全局搜索 `postMessage` 不再有 `'*'` 作为 targetOrigin
- auxiliary request 机制要么不存在，要么默认关闭且设置页有明确风险提示
- 手动验证：DOM 模式下 DeepSeek/千问/复旦/豆包的完整对话仍能正常采集

**预计工作量**：0.5 天

---

### 3. 隐私政策

**为什么做**：Chrome Web Store 上架**强制要求** Privacy Policy URL。

**改动范围**

- 起草 `PRIVACY.md`，要点：
  - 采集范围：仅当前登录用户在支持平台上的对话
  - 默认存储位置：浏览器本地 IndexedDB，不上传任何第三方服务器
  - 远程向量库为可选功能，由用户主动配置自有凭证与服务
  - API Key 明文存储于 `chrome.storage.local`，共享浏览器环境时存在风险
  - 不模拟登录 / 点击 / 滚动等用户行为
  - 不访问、不爬取他人数据
- 在 `manifest.json` 的 `name` 同级（非必须字段，但建议）或在 Store Listing 填写 `privacy_policy_url`，URL 指向托管版本（GitHub Pages 或自建站点）
- README 的「合规与隐私」章节链接到该政策

**预计工作量**：0.5 天

---

## P1：强烈建议（上架后短期内完成）

### 4. 测试覆盖

**当前状态**：手动测试已覆盖全部 6 家 LLM 模型 + 5 家 Embedding + 6 种向量库后端，功能层面无问题。

**为什么仍要写测试**：手动测试覆盖主路径，但**边界条件**和**回归效率**是关键差距：
- 平台 API 改版后，手动回归 5 个平台 × 2 模式需要 1-2 天
- [lib/db.js](file:///workspace/lib/db.js) 的 `saveConversation` 有 4 种模式 + 增量补充替换逻辑，分支组合多，手动难以全覆盖
- 远程向量库 5 个后端共享接口，改公共方法可能让某个后端静默失败

**测试范围（务实优先，不追求覆盖率）**

只覆盖以下 3 个高价值模块：

| 模块 | 测试文件 | 测什么 |
|---|---|---|
| [lib/db.js](file:///workspace/lib/db.js) | `tests/db.test.js` | `saveConversation` 的 created / appended / overwritten / titleUpdated 四种模式；增量补充替换（思考块后到）；`searchConversations` 倒排索引；`deleteConversation` 触发向量清理 |
| [lib/llm.js](file:///workspace/lib/llm.js) | `tests/llm.test.js` | `_parseSSE` 正常 chunk / 异常 chunk / `[DONE]` / 空 choices；`_buildThinkingExtras` 各厂商分支（DashScope enable_thinking / 智谱 thinking 对象 / MiniMax adaptive + reasoning_split） |
| [lib/vector-store.js](file:///workspace/lib/vector-store.js) | `tests/vector-store.test.js` | 5 个远程后端的 `addVectors` / `similaritySearch` / `deleteByConvId` / `clearCollection`，全部用 `fetch` mock；本地 IndexedDB 走 fake-indexeddb |

**技术栈**

- 测试框架：Jest（Node 环境跑，不需要浏览器）
- `chrome.*` API：用 `jest-chrome` 或手写 mock
- IndexedDB：`fake-indexeddb`
- `fetch`：`jest-fetch-mock`

**CI 集成**

在 [.github/workflows/release.yml](file:///workspace/.github/workflows/release.yml) 的 `Check JS syntax` 之后加一步：

```yaml
- name: Run unit tests
  run: |
    npm install
    npm test
```

**验收标准**

- 三个测试文件共 30-50 个用例，覆盖关键分支
- CI 在打包前自动跑测试，失败则阻止发版
- 后续每次改 [lib/](file:///workspace/lib) 目录代码，先跑 `npm test`

**预计工作量**：1 天

---

### 5. 模型清单校验

**为什么做**：[models.json](file:///workspace/models.json) 中部分模型 ID（`qwen3.7-max`、`glm-5.2`、`deepseek-v4-pro`、`doubao-seed-2-1-pro-260628`、`MiniMax-M3` 等）需用真实 API endpoint 逐个验证连通性，避免上架后被「模型不存在 / 404」差评淹没。

**操作步骤**

- 对每个 LLM 模型：在设置页填入对应厂商 API Key，点「测试 LLM」，确认返回正常回答
- 对每个 Embedding 模型：点「测试 Embedding」，确认返回向量维度为 1024
- 对每个远程向量库后端：按 [docs/](file:///workspace/docs) 各 setup 指南本地起一个实例，点「测试连通性」
- 把通过验证的模型 ID 列表归档到 `docs/verified-models.md`，标注验证日期
- 删除或修正所有验证失败的模型 ID

**验收标准**

- `models.json` 中所有模型都能通过设置页连通性测试
- `docs/verified-models.md` 存在并标注最近一次验证日期

**预计工作量**：0.5 天

---

### 6. host_permissions 收敛

**为什么做**：当前 [manifest.json](file:///workspace/manifest.json) 把 14 个域名都列为 `host_permissions`，Chrome Web Store 审核会在「权限理由」字段逐个追问，且用户安装时看到一长串权限提示会降低转化率。

**改动方案**

- `host_permissions`：只保留 5 个目标平台域名（deepseek / qianwen / fudan / doubao / kimi）
- LLM / Embedding API 域名（dashscope.aliyuncs.com / api.deepseek.com / open.bigmodel.cn 等）挪到 `optional_host_permissions`，用户在设置页配置对应厂商时运行时申请

```json
{
  "host_permissions": [
    "https://chat.deepseek.com/*",
    "https://www.qianwen.com/*",
    "https://aiagent.fudan.edu.cn/*",
    "https://www.doubao.com/*",
    "https://kimi.com/*",
    "https://www.kimi.com/*",
    "https://kimi.moonshot.cn/*"
  ],
  "optional_host_permissions": [
    "https://dashscope.aliyuncs.com/*",
    "https://api.deepseek.com/*",
    "https://open.bigmodel.cn/*",
    "https://api.moonshot.cn/*",
    "https://ark.cn-beijing.volces.com/*",
    "https://api.minimaxi.com/*",
    "https://qianfan.baidubce.com/*",
    "https://api.jina.ai/*"
  ]
}
```

- [bg/settings-handlers.js](file:///workspace/bg/settings-handlers.js) 保存 LLM/Embedding 设置时，根据 provider 自动调用 `chrome.permissions.request()` 申请对应域名

**验收标准**

- 安装时只提示 5 个目标平台权限
- 配置 LLM/Embedding 时自动弹出对应 API 域名权限申请
- 配置远程向量库时按 URL 申请（`optional_host_permissions` 已包含 `http://*/*` / `https://*/*`，无需额外处理）

**预计工作量**：0.5 天

---

## P2：长期打磨

### 7. 长文件拆分

**为什么做**：当前 [lib/vector-store.js](file:///workspace/lib/vector-store.js) 单文件实现 5 个远程后端的 CRUD + 搜索 + 统计，已超过 1000 行，可读性下降，后续扩展第 6 个后端成本会越来越高。

**拆分方案**

```
lib/
├── vector-store/
│   ├── index.js          # 统一入口 + VectorStore 单例 + 公共方法（addVectors / similaritySearch / retrievalSearch）
│   ├── local.js          # 本地 IndexedDB 实现
│   ├── chroma.js         # ChromaDB 后端
│   ├── milvus.js         # Milvus 后端
│   ├── pgvector.js       # PostgreSQL + pgvector 后端
│   ├── supabase.js       # Supabase 后端
│   ├── qdrant.js         # Qdrant 后端
│   └── utils.js          # _trimTrailingSlash / _strToQdrantUUID 等公共工具
```

- 每个后端文件导出 `{ add, addBatch, search, delete, clear, stats }` 接口
- `index.js` 根据配置 `type` 分派到对应后端
- [background.js](file:///workspace/background.js) 的 `importScripts` 改为加载 `lib/vector-store/index.js`，由其内部再 `importScripts` 各子文件

**同样适用于 [lib/db.js](file:///workspace/lib/db.js)**（673 行）：

```
lib/
├── db/
│   ├── index.js          # initDB + ensureInit
│   ├── conversations.js  # saveConversation / getConversations / getConversation / deleteConversation
│   ├── search-index.js   # tokenize / updateSearchIndex / searchConversations / highlightSearchResult
│   ├── qa-history.js     # saveQAHistory / getQAHistory / deleteQAHistory / clearQAHistory
│   ├── storage-info.js   # getStorageInfo / _getMainDBStoreCounts / _getEmbeddingDBStoreCounts
│   └── embedding-trigger.js  # triggerEmbedding
```

**注意事项**

- MV3 Service Worker 中 `importScripts` 必须在顶层同步调用，子模块要按依赖顺序加载
- 拆分后必须手动回归一遍：保存对话 → 触发 embedding → 向量检索 → AI 问答

**验收标准**

- 没有单文件超过 500 行
- 所有原功能回归通过

**预计工作量**：1 天

---

### 8. 其他打磨项

| 项 | 说明 |
|---|---|
| 清理死代码 | [popup/popup.js#L79-L86](file:///workspace/popup/popup.js) 残留 `chatgpt` / `claude` / `yiyan` 平台名，实际只支持 5 家，删除 |
| ESLint + Prettier | 加 `.eslintrc.json` + `.prettierrc`，CI 加 lint 检查 |
| CHANGELOG.md | 追踪版本变更，方便审核员和用户了解更新 |
| 错误上报 | 集成 Sentry（用户授权后开启），方便收集线上 bug |
| 版本号自动同步 | git tag 触发时自动更新 manifest.json 的 version，避免人工漏改 |

---

## 阶段总结

| 阶段 | 任务 | 预计工作量 | 门槛性质 |
|---|---|---|---|
| **P0** | i18n + 安全修复 + 隐私政策 | 1.5-2 天 | 上架硬门槛 |
| **P1** | 测试覆盖 + 模型校验 + host_permissions 收敛 | 2 天 | 强烈建议 |
| **P2** | 长文件拆分 + 死代码清理 + 工程化 | 1-2 天 | 长期打磨 |

**P0 完成 = 可上架；P1 完成 = 生产级；P2 完成 = 可维护。**
