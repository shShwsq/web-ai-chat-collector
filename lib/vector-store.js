// lib/vector-store.js - 向量库抽象层
// 支持三种后端：
//   1. 内置 IndexedDB（暴力 cosine similarity）
//   2. 本地向量库（ChromaDB / Milvus / PostgreSQL+pgvector）
//   3. 云向量库（Pinecone / Supabase / Qdrant Cloud / PostgreSQL Cloud）

const VectorStore = {
  _backend: 'local', // 'local' | 'remote'
  _config: {},
  _initialized: false,

  async init() {
    const settings = await getVectorStoreSettings();
    this._backend = settings.backend || 'local';
    this._config = settings.config || {};
    this._initialized = true;
    console.log(`[VectorStore] 初始化完成，后端: ${this._backend}`);
  },

  getBackend() {
    return this._backend;
  },

  async setBackend(backend, config = {}) {
    this._backend = backend;
    this._config = config;
    await saveVectorStoreSettings({ backend, config });
  },

  // 添加向量（单条）
  async addVector(id, vector, metadata = {}) {
    if (this._backend === 'local') {
      return await saveEmbedding(id, metadata.convId, vector);
    }
    return await this._addRemote(id, vector, metadata);
  },

  // 批量添加向量
  async addVectors(items) {
    const results = [];
    for (const item of items) {
      const r = await this.addVector(item.id, item.vector, item.metadata);
      results.push(r);
    }
    return results;
  },

  // 相似度搜索
  async similaritySearch(queryVector, topK = 10, filters = {}) {
    if (this._backend === 'local') {
      return await localVectorSearch(queryVector, topK);
    }
    return await this._searchRemote(queryVector, topK, filters);
  },

  // 删除某对话的向量
  async deleteByConvId(convId) {
    if (this._backend === 'local') {
      return await deleteEmbeddingsByConvId(convId);
    }
    return await this._deleteRemote(convId);
  },

  // ---- 远程向量库操作 ----

  async _addRemote(id, vector, metadata) {
    const { type, url, apiKey, collection } = this._config;
    try {
      switch (type) {
        case 'chroma':
          return await this._addChroma(url, apiKey, collection, id, vector, metadata);
        case 'milvus':
          return await this._addMilvus(url, apiKey, collection, id, vector, metadata);
        case 'pgvector':
          return await this._addPgvector(url, apiKey, collection, id, vector, metadata);
        case 'pinecone':
          return await this._addPinecone(url, apiKey, collection, id, vector, metadata);
        case 'supabase':
          return await this._addSupabase(url, apiKey, collection, id, vector, metadata);
        case 'qdrant':
          return await this._addQdrant(url, apiKey, collection, id, vector, metadata);
        default:
          console.error('[VectorStore] 未知远程类型:', type);
      }
    } catch (e) {
      console.error('[VectorStore] 远程添加失败:', e);
    }
  },

  async _searchRemote(queryVector, topK, filters) {
    const { type, url, apiKey, collection } = this._config;
    try {
      switch (type) {
        case 'chroma':
          return await this._searchChroma(url, apiKey, collection, queryVector, topK);
        case 'milvus':
          return await this._searchMilvus(url, apiKey, collection, queryVector, topK);
        case 'pgvector':
          return await this._searchPgvector(url, apiKey, collection, queryVector, topK);
        case 'pinecone':
          return await this._searchPinecone(url, apiKey, collection, queryVector, topK);
        case 'supabase':
          return await this._searchSupabase(url, apiKey, collection, queryVector, topK);
        case 'qdrant':
          return await this._searchQdrant(url, apiKey, collection, queryVector, topK);
        default:
          console.error('[VectorStore] 未知远程类型:', type);
          return [];
      }
    } catch (e) {
      console.error('[VectorStore] 远程搜索失败:', e);
      return [];
    }
  },

  async _deleteRemote(convId) {
    // 通用删除：各后端按 convId metadata 过滤删除
    const { type, url, apiKey, collection } = this._config;
    // 各后端实现不同，这里只做基础支持
    console.log('[VectorStore] 远程删除 convId:', convId);
  },

  // ---- ChromaDB ----
  async _addChroma(url, apiKey, collection, id, vector, metadata) {
    const resp = await fetch(`${url}/api/v1/collections/${collection}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], embeddings: [vector], metadatas: [metadata] })
    });
    return await resp.json();
  },
  async _searchChroma(url, apiKey, collection, queryVector, topK) {
    const resp = await fetch(`${url}/api/v1/collections/${collection}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query_embeddings: [queryVector], n_results: topK })
    });
    const data = await resp.json();
    return this._formatChromaResults(data);
  },
  _formatChromaResults(data) {
    if (!data.ids || !data.ids[0]) return [];
    return data.ids[0].map((id, i) => ({
      id,
      convId: data.metadatas?.[0]?.[i]?.convId || '',
      score: data.distances?.[0]?.[i] || 0,
      vector: data.embeddings?.[0]?.[i] || null
    }));
  },

  // ---- Milvus ----
  async _addMilvus(url, apiKey, collection, id, vector, metadata) {
    const resp = await fetch(`${url}/v2/vectordb/entities/insert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ collectionName: collection, data: [{ id, vector, ...metadata }] })
    });
    return await resp.json();
  },
  async _searchMilvus(url, apiKey, collection, queryVector, topK) {
    const resp = await fetch(`${url}/v2/vectordb/entities/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ collectionName: collection, data: [queryVector], limit: topK })
    });
    const data = await resp.json();
    return (data.data || []).map(item => ({
      id: String(item.id),
      convId: item.convId || '',
      score: item.score || item.distance || 0,
      vector: item.vector || null
    }));
  },

  // ---- PostgreSQL+pgvector ----
  async _addPgvector(url, apiKey, collection, id, vector, metadata) {
    const resp = await fetch(`${url}/api/vectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ collection, id, vector, metadata })
    });
    return await resp.json();
  },
  async _searchPgvector(url, apiKey, collection, queryVector, topK) {
    const resp = await fetch(`${url}/api/vectors/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ collection, vector: queryVector, limit: topK })
    });
    const data = await resp.json();
    return (data.results || []).map(item => ({
      id: item.id,
      convId: item.metadata?.convId || '',
      score: item.score || 0,
      vector: null
    }));
  },

  // ---- Pinecone ----
  async _addPinecone(url, apiKey, collection, id, vector, metadata) {
    const resp = await fetch(`${url}/vectors/upsert`, {
      method: 'POST',
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectors: [{ id, values: vector, metadata }] })
    });
    return await resp.json();
  },
  async _searchPinecone(url, apiKey, collection, queryVector, topK) {
    const resp = await fetch(`${url}/query`, {
      method: 'POST',
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vector: queryVector, topK, includeMetadata: true })
    });
    const data = await resp.json();
    return (data.matches || []).map(item => ({
      id: item.id,
      convId: item.metadata?.convId || '',
      score: item.score || 0,
      vector: null
    }));
  },

  // ---- Supabase ----
  async _addSupabase(url, apiKey, collection, id, vector, metadata) {
    const resp = await fetch(`${url}/rest/v1/${collection}`, {
      method: 'POST',
      headers: { 'apikey': apiKey, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ id, embedding: vector, conv_id: metadata.convId, metadata })
    });
    return await resp.json();
  },
  async _searchSupabase(url, apiKey, collection, queryVector, topK) {
    const resp = await fetch(`${url}/rest/v1/rpc/match_${collection}`, {
      method: 'POST',
      headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query_embedding: queryVector, match_count: topK })
    });
    const data = await resp.json();
    return (data || []).map(item => ({
      id: item.id,
      convId: item.conv_id || '',
      score: item.similarity || 0,
      vector: null
    }));
  },

  // ---- Qdrant ----
  async _addQdrant(url, apiKey, collection, id, vector, metadata) {
    const resp = await fetch(`${url}/collections/${collection}/points`, {
      method: 'PUT',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: [{ id, vector, payload: metadata }] })
    });
    return await resp.json();
  },
  async _searchQdrant(url, apiKey, collection, queryVector, topK) {
    const resp = await fetch(`${url}/collections/${collection}/points/search`, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vector: queryVector, limit: topK, with_payload: true })
    });
    const data = await resp.json();
    return (data.result || []).map(item => ({
      id: String(item.id),
      convId: item.payload?.convId || '',
      score: item.score || 0,
      vector: null
    }));
  }
};

// ============================================================
// 设置持久化
// ============================================================

async function getVectorStoreSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('vectorStoreSettings', (result) => {
      resolve(result.vectorStoreSettings || { backend: 'local', config: {} });
    });
  });
}

async function saveVectorStoreSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ vectorStoreSettings: settings }, resolve);
  });
}
