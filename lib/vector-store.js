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
  // options.scoreThreshold: 若提供（0-1），低于此值的候选会在客户端过滤掉
  async similaritySearch(queryVector, topK = 10, filters = {}, options = {}) {
    let results;
    if (this._backend === 'local') {
      results = await localVectorSearch(queryVector, topK);
    } else {
      results = await this._searchRemote(queryVector, topK, filters);
    }
    // 客户端阈值过滤（统一在客户端做，避免每个远程后端都要改 SQL/RPC）
    if (typeof options.scoreThreshold === 'number' && options.scoreThreshold > 0) {
      results = results.filter(r => (r.score || 0) >= options.scoreThreshold);
    }
    return results;
  },

  // 按召回设置（retrievalSettings）执行一次完整的检索
  // mode: 'topk'（仅 Top-K）| 'threshold'（仅阈值，Top-K 放大到 100 拉候选）
  //       | 'combined'（先 Top-K，再阈值过滤）
  // 这是 llm.js / organizeInfo / askQuestion 等业务调用统一入口
  async retrievalSearch(queryVector) {
    const rs = await getRetrievalSettings();
    const mode = rs.mode || 'combined';
    const threshold = typeof rs.scoreThreshold === 'number' ? rs.scoreThreshold : 0;
    let topK, opts = {};
    if (mode === 'topk') {
      topK = Math.max(1, rs.topK || 20);
      // 不过滤阈值
    } else if (mode === 'threshold') {
      // 只用阈值：把 topK 放大，让阈值来主导筛选
      topK = 100;
      opts.scoreThreshold = threshold;
    } else {
      // combined
      topK = Math.max(1, rs.topK || 20);
      opts.scoreThreshold = threshold;
    }
    return await this.similaritySearch(queryVector, topK, {}, opts);
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

  async _statsRemote(configOverride) {
    const cfg = configOverride || this._config;
    const { type, url, apiKey, collection } = cfg;
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

  // 测试远程向量库连通性（不修改已保存状态，直接用传入的 config 测试）
  // 用于保存前自检，帮助用户定位 URL / API Key / 集合名是否正确
  async testConnection(config) {
    if (!config || !config.type) {
      return { success: false, error: '配置不完整（缺少向量库类型）' };
    }
    if (!config.url) {
      return { success: false, error: '请填写服务地址' };
    }
    if (!config.collection) {
      return { success: false, error: '请填写集合/表名' };
    }
    const start = Date.now();
    try {
      const stats = await this._statsRemote(config);
      const latency = Date.now() - start;
      if (stats.error) {
        // "Failed to fetch" 通常是网络/CORS/URL 问题，给出更友好的提示
        const friendly = stats.error === 'Failed to fetch'
          ? '无法连接（Failed to fetch）。请检查地址是否可达、CORS 是否放行本扩展，以及服务是否在线'
          : stats.error;
        return { success: false, error: friendly, latency };
      }
      return {
        success: true,
        latency,
        count: stats.count ?? null
      };
    } catch (e) {
      const latency = Date.now() - start;
      const friendly = e.message === 'Failed to fetch'
        ? '无法连接（Failed to fetch）。请检查地址是否可达、CORS 是否放行本扩展，以及服务是否在线'
        : e.message;
      return { success: false, error: friendly, latency };
    }
  },

  // ---- ChromaDB ----
  // ChromaDB 1.0+ 用 v2 API。
  // 规律：集合级操作（create/delete collection）用 collection 名字；
  //       数据级操作（add/query/delete/count）路径要用 collection 的 UUID（不是名字）。
  _chromaCollectionsBase(url) {
    return `${url}/api/v2/tenants/default_tenant/databases/default_database/collections`;
  },
  _chromaBase(url, collection) {
    // 用名字查详情（GET 支持 collection 名字）
    return `${this._chromaCollectionsBase(url)}/${encodeURIComponent(collection)}`;
  },
  // 按名字查 collection 的 UUID（数据级操作需要）
  async _chromaGetId(url, collection) {
    const resp = await fetch(this._chromaBase(url, collection), { method: 'GET' });
    if (!resp.ok) throw new Error(`获取 collection UUID 失败: HTTP ${resp.status}`);
    const detail = await resp.json();
    if (!detail.id) throw new Error('collection 详情中未找到 id 字段');
    return detail.id;
  },
  async _addChroma(url, apiKey, collection, id, vector, metadata) {
    const uuid = await this._chromaGetId(url, collection);
    const resp = await fetch(`${this._chromaCollectionsBase(url)}/${uuid}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], embeddings: [vector], metadatas: [metadata] })
    });
    return await resp.json();
  },
  async _searchChroma(url, apiKey, collection, queryVector, topK) {
    const uuid = await this._chromaGetId(url, collection);
    const resp = await fetch(`${this._chromaCollectionsBase(url)}/${uuid}/query`, {
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
    const uuid = await this._chromaGetId(url, collection);
    const resp = await fetch(`${this._chromaCollectionsBase(url)}/${uuid}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: { convId } })
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _clearChroma(url, apiKey, collection) {
    // ChromaDB 删除 collection 后重建一个同名空 collection。
    // delete collection 用名字（不用 UUID）；create 用名字。
    await fetch(this._chromaBase(url, collection), { method: 'DELETE' });
    await fetch(this._chromaCollectionsBase(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: collection })
    });
    return { success: true, count: null };
  },
  async _statsChroma(url, apiKey, collection) {
    // count 是数据级操作，路径要用 UUID
    const uuid = await this._chromaGetId(url, collection);
    const resp = await fetch(`${this._chromaCollectionsBase(url)}/${uuid}/count`, { method: 'GET' });
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
    const data = await resp.json();
    // Milvus v2 REST API 成功码是 200（与 HTTP 状态码一致），不是 0
    // 失败时 HTTP 仍是 200，但 code != 200 或 message 非空
    if (!resp.ok || (data?.code !== 200 && data?.code !== 0)) {
      const errMsg = `Milvus insert 失败: HTTP ${resp.status}, code=${data?.code}, message=${data?.message || ''}, id=${id}`;
      console.error('[VectorStore]', errMsg);
      throw new Error(errMsg);
    }
    console.log('[VectorStore] Milvus insert 成功:', { id, insertCnt: data?.data?.insertCnt, deleteCnt: data?.data?.deleteCnt, upsertCnt: data?.data?.upsertCnt });
    return data;
  },
  async _searchMilvus(url, apiKey, collection, queryVector, topK) {
    // 必须指定 outputFields，否则 Milvus 只返回 id + distance，convId 等字段拿不到
    const resp = await fetch(`${url}/v2/vectordb/entities/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        collectionName: collection,
        data: [queryVector],
        limit: topK,
        outputFields: ['id', 'convId', 'title', 'platform', 'role', 'content', 'msgHash', 'chunkIdx', 'chunkTotal']
      })
    });
    const data = await resp.json();
    return (data.data || []).map(item => ({
      id: String(item.id),
      convId: item.convId || '',
      title: item.title || '',
      platform: item.platform || '',
      role: item.role || '',
      content: item.content || '',
      score: item.score ?? item.distance ?? 0,
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
    // Milvus v2.4 提供 get_stats 接口直接返回 rowCount
    // 不用 query 接口：query 不支持 count 模式，返回的 data 是数组，没有 count 字段
    const resp = await fetch(`${url}/v2/vectordb/collections/get_stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ collectionName: collection })
    });
    if (!resp.ok) return { count: null, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return { count: data?.data?.rowCount ?? null };
  },

  // ---- PostgreSQL+pgvector（通过 PostgREST 访问） ----
  // pgvector 不能直连 PG（Chrome 扩展无 TCP 能力），统一走 PostgREST 协议。
  // 用户需自部署 PostgREST（https://postgrest.org）作为 PG 的 HTTP 网关。
  // 注意：vanilla PostgREST 的 REST 路径为 /<表名> 和 /rpc/<函数名>，
  // 与 Supabase 的 /rest/v1/<表名> 不同（Supabase 通过反向代理加了 /rest/v1 前缀）。
  async _addPgvector(url, apiKey, collection, id, vector, metadata) {
    const resp = await fetch(`${url}/${collection}`, {
      method: 'POST',
      headers: { 'apikey': apiKey, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ id, embedding: vector, conv_id: metadata.convId, metadata })
    });
    // PostgREST 默认返回 204 No Content（空 body），不能强转 json
    return await parsePostgrestResponse(resp);
  },
  async _searchPgvector(url, apiKey, collection, queryVector, topK) {
    // 需要在 PG 中创建 match_<table> 函数，参考 PostgREST 文档
    const resp = await fetch(`${url}/rpc/match_${collection}`, {
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
    const resp = await fetch(`${url}/${collection}?conv_id=eq.${encodeURIComponent(convId)}`, {
      method: 'DELETE',
      headers: { 'apikey': apiKey, 'Prefer': 'return=minimal' }
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _clearPgvector(url, apiKey, collection) {
    const resp = await fetch(`${url}/${collection}`, {
      method: 'DELETE',
      headers: { 'apikey': apiKey, 'Prefer': 'return=minimal' }
    });
    return { success: resp.ok, error: resp.ok ? null : `HTTP ${resp.status}` };
  },
  async _statsPgvector(url, apiKey, collection) {
    // PostgREST：HEAD 请求 + Prefer: count=exact 走 SELECT count(*)，准确但稍慢
    // 不用 count=planned：它读 pg_class.reltuples 估算值，TRUNCATE/DELETE 后会陈旧
    const resp = await fetch(`${url}/${collection}?select=id`, {
      method: 'HEAD',
      headers: { 'apikey': apiKey, 'Prefer': 'count=exact' }
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
    return await parsePostgrestResponse(resp);
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
    // PostgREST：HEAD 请求 + Prefer: count=exact 走 SELECT count(*)，准确但稍慢
    const resp = await fetch(`${url}/rest/v1/${collection}?select=id`, {
      method: 'HEAD',
      headers: { 'apikey': apiKey, 'Prefer': 'count=exact' }
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
  // Qdrant 的 point ID 只接受 unsigned integer 或 UUID，不接受任意字符串。
  // 项目其它后端（ChromaDB/Milvus 等）使用 `${convId}::msg::${hash}::chunk::${idx}` 字符串 ID，
  // 因此在 Qdrant 入口做确定性字符串→UUID 转换，保证同一 embId 每次映射到同一 UUID。
  _strToQdrantUUID(str) {
    let h1 = 0x811c9dc5 >>> 0;
    let h2 = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x05031813) >>> 0;
    }
    const s = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).padEnd(32, '0');
    return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20,32)}`;
  },
  async _addQdrant(url, apiKey, collection, id, vector, metadata) {
    const uuid = this._strToQdrantUUID(id);
    const resp = await fetch(`${url}/collections/${collection}/points`, {
      method: 'PUT',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: [{ id: uuid, vector, payload: { ...metadata, _origId: id } }] })
    });
    const data = await resp.json();
    // Qdrant 失败时 status 字段为 error，但 HTTP 状态可能是 200/400/422
    if (!resp.ok || data?.status?.error) {
      throw new Error(`Qdrant 插入失败: ${data?.status?.error || `HTTP ${resp.status}`}`);
    }
    return data;
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
// PostgREST 响应解析（pgvector / Supabase 通用）
// ============================================================

// PostgREST 行为：
//   - POST 成功，Prefer 不含 return=representation：返回 204 No Content（空 body）
//   - POST 成功，Prefer: return=representation：返回 201 + 创建的资源 JSON
//   - 失败：返回 4xx/5xx + JSON 错误体（如 {"code":"...","message":"..."}）
// 直接 resp.json() 会在 204 空响应上抛 "Unexpected end of JSON input"，故统一走本函数。
async function parsePostgrestResponse(resp) {
  if (!resp.ok) {
    // 失败：尝试解析错误体（也可能为空，如 404/500 无 body）
    let error = `HTTP ${resp.status}`;
    try {
      const text = await resp.text();
      if (text) {
        try {
          const j = JSON.parse(text);
          error = j.message || j.code || text;
        } catch (_) {
          error = text;
        }
      }
    } catch (_) { /* ignore */ }
    return { success: false, status: resp.status, error };
  }
  // 成功：204 或 201。204 一定无 body；201 也可能无 body（取决于 Prefer）
  const text = await resp.text();
  if (!text) return { success: true, status: resp.status };
  try {
    return { success: true, status: resp.status, data: JSON.parse(text) };
  } catch (_) {
    return { success: true, status: resp.status, raw: text };
  }
}

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

// ============================================================
// 召回（Retrieval）设置持久化
// ============================================================
// mode: 'topk'（仅 Top-K）| 'threshold'（仅相似度阈值）| 'combined'（Top-K + 阈值过滤，默认）
// topK: 召回候选条数上限（远程传给后端作 limit；threshold 模式下放大到 100 保证候选足够）
// scoreThreshold: 相似度下界（0-1），低于此值的候选在客户端过滤掉；阈值模式必填

const RETRIEVAL_DEFAULTS = {
  mode: 'combined',
  topK: 20,
  scoreThreshold: 0.3
};

async function getRetrievalSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('retrievalSettings', (result) => {
      resolve(Object.assign({}, RETRIEVAL_DEFAULTS, result.retrievalSettings || {}));
    });
  });
}

async function saveRetrievalSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ retrievalSettings: settings }, resolve);
  });
}
