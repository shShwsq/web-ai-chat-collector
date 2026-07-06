// lib/vector-store.js - 向量库抽象层
// 支持两种模式：
//   1. 内置 IndexedDB（零配置，暴力 cosine similarity）
//   2. 远程向量库（通过 URL 配置，支持 ChromaDB / Milvus / PostgreSQL+pgvector / Pinecone / Supabase / Qdrant）

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

  // 清空整个 collection（本地=清空 IndexedDB；远程=清空 collection 内所有向量）
  async clearCollection() {
    if (this._backend === 'local') {
      const before = (await getAllEmbeddings()).length;
      await clearAllEmbeddings();
      return { success: true, count: before };
    }
    return await this._clearRemote();
  },

  // 获取统计信息（条数、后端类型、配置概要）
  async getStats() {
    const backend = this._backend;
    if (backend === 'local') {
      const all = await getAllEmbeddings();
      return { backend: 'local', count: all.length, configured: true };
    }
    const stats = await this._statsRemote();
    return {
      backend: this._config.type || 'remote',
      count: stats?.count ?? null,
      configured: !!(this._config.url && this._config.collection),
      config: {
        type: this._config.type,
        url: this._config.url,
        collection: this._config.collection
      },
      error: stats?.error || null
    };
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
    const { type, url, apiKey, collection } = this._config;
    try {
      switch (type) {
        case 'chroma':
          return await this._deleteChroma(url, apiKey, collection, convId);
        case 'milvus':
          return await this._deleteMilvus(url, apiKey, collection, convId);
        case 'pgvector':
          return await this._deletePgvector(url, apiKey, collection, convId);
        case 'pinecone':
          return await this._deletePinecone(url, apiKey, collection, convId);
        case 'supabase':
          return await this._deleteSupabase(url, apiKey, collection, convId);
        case 'qdrant':
          return await this._deleteQdrant(url, apiKey, collection, convId);
        default:
          console.error('[VectorStore] 未知远程类型:', type);
          return { success: false, error: `未知远程类型: ${type}` };
      }
    } catch (e) {
      console.error('[VectorStore] 远程删除失败:', e);
      return { success: false, error: e.message };
    }
  },

  async _clearRemote() {
    const { type, url, apiKey, collection } = this._config;
    try {
      switch (type) {
        case 'chroma':
          return await this._clearChroma(url, apiKey, collection);
        case 'milvus':
          return await this._clearMilvus(url, apiKey, collection);
        case 'pgvector':
          return await this._clearPgvector(url, apiKey, collection);
        case 'pinecone':
          return await this._clearPinecone(url, apiKey, collection);
        case 'supabase':
          return await this._clearSupabase(url, apiKey, collection);
        case 'qdrant':
          return await this._clearQdrant(url, apiKey, collection);
        default:
          return { success: false, error: `未知远程类型: ${type}` };
      }
    } catch (e) {
      console.error('[VectorStore] 远程清空失败:', e);
      return { success: false, error: e.message };
    }
  },

  async _statsRemote() {
    const { type, url, apiKey, collection } = this._config;
    try {
      switch (type) {
        case 'chroma':
          return await this._statsChroma(url, apiKey, collection);
        case 'milvus':
          return await this._statsMilvus(url, apiKey, collection);
        case 'pgvector':
          return await this._statsPgvector(url, apiKey, collection);
        case 'pinecone':
          return await this._statsPinecone(url, apiKey, collection);
        case 'supabase':
          return await this._statsSupabase(url, apiKey, collection);
        case 'qdrant':
          return await this._statsQdrant(url, apiKey, collection);
        default:
          return { count: null, error: `未知远程类型: ${type}` };
      }
    } catch (e) {
      console.error('[VectorStore] 远程统计失败:', e);
      return { count: null, error: e.message };
    }
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
  async _deleteChroma(url, apiKey, collection, convId) {
    const resp = await fetch(`${url}/api/v1/collections/${collection}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: { convId } })
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _clearChroma(url, apiKey, collection) {
    // ChromaDB 删除 collection 后重建一个同名空 collection
    await fetch(`${url}/api/v1/collections/${encodeURIComponent(collection)}`, { method: 'DELETE' });
    await fetch(`${url}/api/v1/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: collection })
    });
    return { success: true, count: null };
  },
  async _statsChroma(url, apiKey, collection) {
    const resp = await fetch(`${url}/api/v1/collections/${encodeURIComponent(collection)}/count`, { method: 'GET' });
    if (!resp.ok) return { count: null, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    // ChromaDB count 返回数字
    const count = typeof data === 'number' ? data : (data?.count ?? 0);
    return { count };
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
  async _deleteMilvus(url, apiKey, collection, convId) {
    const resp = await fetch(`${url}/v2/vectordb/entities/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ collectionName: collection, filter: `convId == "${convId}"` })
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _clearMilvus(url, apiKey, collection) {
    // Milvus 按 id 过滤删除全部：用 always-true filter
    const resp = await fetch(`${url}/v2/vectordb/entities/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ collectionName: collection, filter: 'id != ""' })
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _statsMilvus(url, apiKey, collection) {
    const resp = await fetch(`${url}/v2/vectordb/entities/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ collectionName: collection, filter: 'id != ""', outputFields: ['id'], limit: 0, count: true })
    });
    if (!resp.ok) return { count: null, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return { count: data?.count ?? null };
  },

  // ---- PostgreSQL+pgvector（通过 PostgREST 访问） ----
  // pgvector 不能直连 PG（Chrome 扩展无 TCP 能力），统一走 PostgREST 协议。
  // 用户需自部署 PostgREST（https://postgrest.org）作为 PG 的 HTTP 网关。
  // 协议与 Supabase 一致，配置字段：URL（PostgREST 地址）+ API Key + 表名。
  async _addPgvector(url, apiKey, collection, id, vector, metadata) {
    const resp = await fetch(`${url}/rest/v1/${collection}`, {
      method: 'POST',
      headers: { 'apikey': apiKey, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ id, embedding: vector, conv_id: metadata.convId, metadata })
    });
    return await resp.json();
  },
  async _searchPgvector(url, apiKey, collection, queryVector, topK) {
    // 需要在 PG 中创建 match_<table> 函数，参考 PostgREST 文档
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
  async _deletePgvector(url, apiKey, collection, convId) {
    const resp = await fetch(`${url}/rest/v1/${collection}?conv_id=eq.${encodeURIComponent(convId)}`, {
      method: 'DELETE',
      headers: { 'apikey': apiKey, 'Prefer': 'return=minimal' }
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _clearPgvector(url, apiKey, collection) {
    const resp = await fetch(`${url}/rest/v1/${collection}`, {
      method: 'DELETE',
      headers: { 'apikey': apiKey, 'Prefer': 'return=minimal' }
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _statsPgvector(url, apiKey, collection) {
    // PostgREST：HEAD 请求 + Prefer: count=planned 返回总数
    const resp = await fetch(`${url}/rest/v1/${collection}?select=id`, {
      method: 'HEAD',
      headers: { 'apikey': apiKey, 'Prefer': 'count=planned' }
    });
    if (!resp.ok) return { count: null, error: `HTTP ${resp.status}` };
    const range = resp.headers.get('content-range');
    if (range && range.includes('/')) {
      const total = range.split('/')[1];
      const n = parseInt(total, 10);
      return { count: isNaN(n) ? null : n };
    }
    return { count: null };
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
  async _deletePinecone(url, apiKey, collection, convId) {
    const resp = await fetch(`${url}/vectors/delete`, {
      method: 'POST',
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace: '', filter: { convId } })
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _clearPinecone(url, apiKey, collection) {
    const resp = await fetch(`${url}/vectors/delete`, {
      method: 'POST',
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace: '', deleteAll: true })
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _statsPinecone(url, apiKey, collection) {
    const resp = await fetch(`${url}/describe_index_stats`, {
      method: 'POST',
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!resp.ok) return { count: null, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    // 累加所有 namespace 的 vectorCount
    const namespaces = data?.namespaces || {};
    let count = 0;
    for (const ns of Object.values(namespaces)) {
      count += ns?.vectorCount || 0;
    }
    return { count };
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
  async _deleteSupabase(url, apiKey, collection, convId) {
    const resp = await fetch(`${url}/rest/v1/${collection}?conv_id=eq.${encodeURIComponent(convId)}`, {
      method: 'DELETE',
      headers: { 'apikey': apiKey, 'Prefer': 'return=minimal' }
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _clearSupabase(url, apiKey, collection) {
    const resp = await fetch(`${url}/rest/v1/${collection}`, {
      method: 'DELETE',
      headers: { 'apikey': apiKey, 'Prefer': 'return=minimal' }
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _statsSupabase(url, apiKey, collection) {
    // PostgREST：HEAD 请求 + Prefer: count=planned 返回总数
    const resp = await fetch(`${url}/rest/v1/${collection}?select=id`, {
      method: 'HEAD',
      headers: { 'apikey': apiKey, 'Prefer': 'count=planned' }
    });
    if (!resp.ok) return { count: null, error: `HTTP ${resp.status}` };
    const range = resp.headers.get('content-range');
    if (range && range.includes('/')) {
      const total = range.split('/')[1];
      const n = parseInt(total, 10);
      return { count: isNaN(n) ? null : n };
    }
    return { count: null };
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
  },
  async _deleteQdrant(url, apiKey, collection, convId) {
    const resp = await fetch(`${url}/collections/${collection}/points/delete`, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: { must: [{ key: 'convId', match: { value: convId } }] } })
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _clearQdrant(url, apiKey, collection) {
    // Qdrant：用空 filter 删除所有 points（filter: {} 等价于匹配全部）
    const resp = await fetch(`${url}/collections/${collection}/points/delete`, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: {} })
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _statsQdrant(url, apiKey, collection) {
    const resp = await fetch(`${url}/collections/${encodeURIComponent(collection)}`, {
      method: 'GET',
      headers: { 'api-key': apiKey }
    });
    if (!resp.ok) return { count: null, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    const count = data?.result?.points_count ?? data?.result?.vectors_count ?? null;
    return { count };
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
