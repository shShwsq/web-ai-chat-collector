// bg/conversations.js - 对话 CRUD 委托（转发到 lib/db.js）

async function dbSaveConversation(data) {
  try {
    return await saveConversation(data);
  } catch (error) {
    console.error('保存对话失败:', error);
    return { success: false, error: error.message };
  }
}

async function dbGetConversations(filters) {
  return await getConversations(filters);
}

async function dbDeleteConversation(id) {
  return await deleteConversation(id);
}

async function dbGetStatus() {
  return await getStatus();
}

async function dbGetStorageInfo() {
  try {
    return await getStorageInfo();
  } catch (e) {
    console.error('[BG] 获取存储信息失败:', e);
    return { error: e.message };
  }
}

// 混合检索：关键字（倒排索引）+ 语义（向量相似度）并行
// - Embedding 未配置或向量库为空时自动降级为纯关键字检索
// - 语义命中按 convId 聚合（取最大相似度），拉取对话详情后合并
// - 排序：关键字命中优先（按命中分数降序），语义命中次之（按相似度降序）
// - 返回的对话对象附带 _keywordScore（>0 表示关键字命中）和 _similarity（0-1，仅语义命中有）
async function dbSearchConversations(query, filters) {
  if (!query || !query.trim()) {
    return await getConversations(filters);
  }

  const [keywordResults, semanticResults] = await Promise.all([
    searchConversations(query, filters),
    _semanticSearchConversations(query, filters)
  ]);

  // 关键字结果已按命中分数降序，用数组长度 - 索引反推分数（索引 0 = 最高分）
  const keywordScoreMap = new Map();
  keywordResults.forEach((conv, idx) => {
    keywordScoreMap.set(conv.id, keywordResults.length - idx);
  });

  // 合并去重：关键字结果先行，语义结果补充 _similarity 或追加新对话
  const merged = new Map();
  for (const conv of keywordResults) {
    conv._keywordScore = keywordScoreMap.get(conv.id);
    merged.set(conv.id, conv);
  }
  for (const conv of semanticResults) {
    const existing = merged.get(conv.id);
    if (existing) {
      existing._similarity = conv._similarity;
    } else {
      merged.set(conv.id, conv);
    }
  }

  // 排序：关键字命中优先（_keywordScore 降序），仅语义命中次之（_similarity 降序）
  const list = Array.from(merged.values());
  list.sort((a, b) => {
    const aK = a._keywordScore || 0;
    const bK = b._keywordScore || 0;
    if (aK > 0 && bK > 0) return bK - aK;
    if (aK > 0) return -1;
    if (bK > 0) return 1;
    return (b._similarity || 0) - (a._similarity || 0);
  });

  return list;
}

// 语义检索：embed 查询 → 向量搜索 → 聚合到对话级
// 失败时返回空数组，由调用方降级为纯关键字
async function _semanticSearchConversations(query, filters = {}) {
  try {
    const queryVector = await EmbeddingService.embed(query);
    if (!queryVector) return []; // Embedding 未配置或失败

    const searchResults = await VectorStore.retrievalSearch(queryVector);
    if (!searchResults || searchResults.length === 0) return [];

    // 按 convId 聚合，取最大相似度
    const convScores = new Map();
    for (const r of searchResults) {
      if (!r.convId) continue;
      const current = convScores.get(r.convId) || 0;
      if ((r.score || 0) > current) convScores.set(r.convId, r.score);
    }

    // 拉取对话详情
    const results = [];
    for (const [convId, similarity] of convScores) {
      const conv = await getConversation(convId);
      if (!conv) continue; // 本地对话缺失（远程命中但未同步）
      if (filters.platform && conv.platform !== filters.platform) continue;
      results.push({ ...conv, _similarity: similarity });
    }
    return results;
  } catch (e) {
    console.warn('[BG] 语义检索失败，降级到关键字:', e.message);
    return [];
  }
}
