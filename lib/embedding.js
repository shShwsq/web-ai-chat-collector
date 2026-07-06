// lib/embedding.js - Embedding 服务
// 使用 DashScope API，支持两种模型：
//   1. text-embedding-v4（纯文本，推荐）
//   2. tongyi-embedding-vision-plus-2026-03-06（多模态，支持文本+图片+视频）

const EMBEDDING_STORE = 'embeddings';

// 多模态模型列表（使用不同的 API 端点）
const MULTIMODAL_MODELS = ['tongyi-embedding-vision-plus-2026-03-06', 'tongyi-embedding-vision-flash-2026-03-06'];

function isMultimodalModel(model) {
  return MULTIMODAL_MODELS.includes(model);
}

// ============================================================
// Embedding 服务管理器
// ============================================================

const EmbeddingService = {
  _dashscopeKey: null,
  _dashscopeModel: 'text-embedding-v4',
  // 向量库内容过滤：是否包含深度思考 / 联网搜索结果
  _includeThinking: true,
  _includeSearch: true,
  _initialized: false,

  // 初始化：读取设置
  async init() {
    const settings = await getEmbeddingSettings();
    this._dashscopeKey = settings.dashscopeKey || '';
    this._dashscopeModel = settings.model || 'text-embedding-v4';
    this._includeThinking = settings.includeThinking !== false;
    this._includeSearch = settings.includeSearch !== false;
    this._initialized = true;
    console.log(`[Embedding] 初始化完成，模型: ${this._dashscopeModel}，API Key: ${this._dashscopeKey ? '已配置' : '未配置'}，内容过滤: think=${this._includeThinking} search=${this._includeSearch}`);
  },

  // 检查是否已配置
  isConfigured() {
    return !!this._dashscopeKey;
  },

  // 获取当前模型
  getModel() {
    return this._dashscopeModel;
  },

  // 更新配置
  async setConfig(options = {}) {
    if (options.dashscopeKey !== undefined) this._dashscopeKey = options.dashscopeKey;
    if (options.model !== undefined) this._dashscopeModel = options.model;
    if (options.includeThinking !== undefined) this._includeThinking = options.includeThinking;
    if (options.includeSearch !== undefined) this._includeSearch = options.includeSearch;
    await saveEmbeddingSettings({
      dashscopeKey: this._dashscopeKey,
      model: this._dashscopeModel,
      includeThinking: this._includeThinking,
      includeSearch: this._includeSearch
    });
  },

  // 根据设置过滤待 embed 的对话内容：剥离 <think>/<search_result> 块
  filterContentForEmbedding(text) {
    if (!text) return text;
    let result = text;
    if (!this._includeThinking) {
      result = result.replace(/<think>\n?[\s\S]*?\n?<\/think>\n*/g, '');
    }
    if (!this._includeSearch) {
      result = result.replace(/<search_result>\n?[\s\S]*?\n?<\/search_result>\n*/g, '');
    }
    return result.trim();
  },

  // 生成单条文本的 embedding
  async embed(text) {
    if (!text || !text.trim()) return null;
    if (isMultimodalModel(this._dashscopeModel)) {
      return await this._embedMultimodal(text);
    }
    return await this._embedText(text);
  },

  // 批量生成 embedding
  async embedBatch(texts) {
    const results = [];
    for (const text of texts) {
      const vec = await this.embed(text);
      results.push(vec);
    }
    return results;
  },

  // ---- 纯文本 Embedding（text-embedding-v4） ----
  async _embedText(text) {
    if (!this._dashscopeKey) {
      console.error('[Embedding] 未配置 API Key');
      return null;
    }
    try {
      const resp = await fetch('https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this._dashscopeKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this._dashscopeModel,
          input: { texts: [text] },
          parameters: { text_type: 'document' }
        })
      });
      const data = await resp.json();
      if (data.output && data.output.embeddings && data.output.embeddings[0]) {
        return data.output.embeddings[0].embedding;
      }
      console.error('[Embedding/Text] 返回异常:', data);
      return null;
    } catch (e) {
      console.error('[Embedding/Text] 请求失败:', e);
      return null;
    }
  },

  // ---- 多模态 Embedding（tongyi-embedding-vision-plus） ----
  async _embedMultimodal(text) {
    if (!this._dashscopeKey) {
      console.error('[Embedding] 未配置 API Key');
      return null;
    }
    try {
      const resp = await fetch('https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this._dashscopeKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this._dashscopeModel,
          input: {
            contents: [{ text }]
          }
        })
      });
      const data = await resp.json();
      if (data.output && data.output.embeddings && data.output.embeddings[0]) {
        return data.output.embeddings[0].embedding;
      }
      console.error('[Embedding/Multimodal] 返回异常:', data);
      return null;
    } catch (e) {
      console.error('[Embedding/Multimodal] 请求失败:', e);
      return null;
    }
  }
};

// ============================================================
// Embedding 存储（IndexedDB）
// ============================================================

async function openEmbeddingDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AIChatEmbeddings', 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(EMBEDDING_STORE)) {
        const store = db.createObjectStore(EMBEDDING_STORE, { keyPath: 'id' });
        store.createIndex('convId', 'convId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 保存消息的 embedding
async function saveEmbedding(id, convId, vector) {
  const db = await openEmbeddingDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EMBEDDING_STORE, 'readwrite');
    const store = tx.objectStore(EMBEDDING_STORE);
    store.put({ id, convId, vector, createdAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// 获取某对话所有 embedding
async function getEmbeddingsByConvId(convId) {
  const db = await openEmbeddingDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EMBEDDING_STORE, 'readonly');
    const store = tx.objectStore(EMBEDDING_STORE);
    const index = store.index('convId');
    const req = index.getAll(convId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// 获取所有 embedding
async function getAllEmbeddings() {
  const db = await openEmbeddingDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EMBEDDING_STORE, 'readonly');
    const store = tx.objectStore(EMBEDDING_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// 删除某对话的所有 embedding
async function deleteEmbeddingsByConvId(convId) {
  const db = await openEmbeddingDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EMBEDDING_STORE, 'readwrite');
    const store = tx.objectStore(EMBEDDING_STORE);
    const index = store.index('convId');
    const cursorReq = index.openCursor(convId);
    cursorReq.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================
// 向量相似度搜索（内置模式，暴力 cosine similarity）
// ============================================================

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// 内置向量搜索：返回 topK 最相似的 embedding 记录
async function localVectorSearch(queryVector, topK = 10) {
  const all = await getAllEmbeddings();
  const scored = all.map(item => ({
    ...item,
    score: cosineSimilarity(queryVector, item.vector)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ============================================================
// 设置持久化
// ============================================================

async function getEmbeddingSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('embeddingSettings', (result) => {
      resolve(result.embeddingSettings || {
        dashscopeKey: '',
        model: 'text-embedding-v4',
        includeThinking: true,
        includeSearch: true
      });
    });
  });
}

async function saveEmbeddingSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ embeddingSettings: settings }, resolve);
  });
}
