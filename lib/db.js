// lib/db.js - IndexedDB 存储层（CRUD + 全文搜索 + 数据迁移）

const DB_NAME = 'AIChatCollector';
const DB_VERSION = 2;
const STORE_CONVERSATIONS = 'conversations';
const STORE_INDEX = 'searchIndex';
const STORE_QA_HISTORY = 'qaHistory';

// ============================================================
// 数据库初始化
// ============================================================

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 对话存储
      if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
        const convStore = db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' });
        convStore.createIndex('platform', 'platform', { unique: false });
        convStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // 搜索索引（倒排索引）
      if (!db.objectStoreNames.contains(STORE_INDEX)) {
        const indexStore = db.createObjectStore(STORE_INDEX, { keyPath: 'term' });
        indexStore.createIndex('term', 'term', { unique: true });
      }

      // Q&A 历史记录
      if (!db.objectStoreNames.contains(STORE_QA_HISTORY)) {
        const qaStore = db.createObjectStore(STORE_QA_HISTORY, { keyPath: 'id' });
        qaStore.createIndex('tab', 'tab', { unique: false });
        qaStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ============================================================
// CRUD 操作
// ============================================================

// 保存对话（支持追加和覆盖）
async function saveConversation(data) {
  const db = await openDB();
  const { platform, platformConversationId, title, url, messages, mode } = data;
  const convId = `${platform}::${platformConversationId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONVERSATIONS, STORE_INDEX], 'readwrite');
    const convStore = tx.objectStore(STORE_CONVERSATIONS);
    const indexStore = tx.objectStore(STORE_INDEX);

    const getReq = convStore.get(convId);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      let result;
      let newMessages = [];

      // 只更新标题（来自会话信息 API，不携带消息）
      if (mode === 'updateTitle') {
        if (existing) {
          if (title && title !== existing.title) {
            existing.title = title;
            existing.updatedAt = new Date().toISOString();
            convStore.put(existing);
          }
          result = { success: true, action: 'titleUpdated', messageCount: existing.messages.length };
        } else {
          // 对话尚未保存（流式响应可能还在路上），跳过；后续保存会带上标题
          result = { success: true, action: 'no-op', messageCount: 0 };
        }
      } else if (existing && mode !== 'overwrite') {
        // 增量追加
        const existingHashes = new Set(existing.messages.map(m => m.hash));
        let newCount = 0;

        for (const msg of messages) {
          if (!existingHashes.has(msg.hash)) {
            existing.messages.push(msg);
            newMessages.push(msg);
            newCount++;
          }
        }

        if (newCount > 0) {
          existing.updatedAt = new Date().toISOString();
          if (title) existing.title = title;
          // 只索引新消息
          updateSearchIndex(indexStore, convId, newMessages);
        } else if (title && title !== existing.title) {
          // 没有新消息但标题更新了
          existing.title = title;
          existing.updatedAt = new Date().toISOString();
        }

        convStore.put(existing);
        result = { success: true, action: 'appended', newMessages: newCount };
      } else if (existing && mode === 'overwrite') {
        // 覆盖模式
        const updated = {
          ...existing,
          title: title || existing.title,
          url: url || existing.url,
          messages,
          updatedAt: new Date().toISOString()
        };
        // 重建该对话的搜索索引
        rebuildConvIndex(indexStore, convId, messages);
        convStore.put(updated);
        result = { success: true, action: 'overwritten', messageCount: messages.length };
      } else {
        // 新对话
        const conv = {
          id: convId,
          platform,
          platformConversationId,
          title: title || '未命名对话',
          url: url || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages
        };
        updateSearchIndex(indexStore, convId, messages);
        convStore.put(conv);
        result = { success: true, action: 'created', messageCount: messages.length };
      }

      tx.oncomplete = () => {
        // 后台触发 embedding（不阻塞保存）
        triggerEmbedding(convId, result.action === 'appended' ? newMessages : messages);
        resolve(result);
      };
      tx.onerror = () => reject(tx.error);
    };

    getReq.onerror = () => reject(getReq.error);
  });
}

// 获取对话列表
async function getConversations(filters = {}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONVERSATIONS, 'readonly');
    const store = tx.objectStore(STORE_CONVERSATIONS);
    const request = store.getAll();

    request.onsuccess = () => {
      let list = request.result || [];
      if (filters.platform) {
        list = list.filter(c => c.platform === filters.platform);
      }
      list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      resolve(list);
    };
    request.onerror = () => reject(request.error);
  });
}

// 获取单条对话
async function getConversation(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONVERSATIONS, 'readonly');
    const store = tx.objectStore(STORE_CONVERSATIONS);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 删除对话
async function deleteConversation(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONVERSATIONS, STORE_INDEX], 'readwrite');
    const convStore = tx.objectStore(STORE_CONVERSATIONS);
    const indexStore = tx.objectStore(STORE_INDEX);

    // 先删除对话
    convStore.delete(id);

    // 清理搜索索引中该对话的引用
    clearConvFromIndex(indexStore, id);

    tx.oncomplete = () => resolve({ success: true });
    tx.onerror = () => reject(tx.error);
  });
}

// 获取状态
async function getStatus() {
  const list = await getConversations();
  return {
    totalConversations: list.length,
    totalMessages: list.reduce((sum, c) => sum + c.messages.length, 0),
    platforms: [...new Set(list.map(c => c.platform))]
  };
}

// ============================================================
// 全文搜索
// ============================================================

// 中文分词：字符 bigram + 单字符
function tokenize(text) {
  if (!text) return [];
  const normalized = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, ' ');
  const tokens = new Set();

  // 按空白分割
  const words = normalized.split(/\s+/).filter(w => w.length > 0);
  for (const word of words) {
    tokens.add(word);
    // 对中文做 bigram
    for (let i = 0; i < word.length - 1; i++) {
      if (/[\u4e00-\u9fff]/.test(word[i]) || /[\u4e00-\u9fff]/.test(word[i + 1])) {
        tokens.add(word.substring(i, i + 2));
      }
    }
  }

  return [...tokens];
}

// 更新搜索索引（增量，仅索引新消息）
function updateSearchIndex(indexStore, convId, messages) {
  for (const msg of messages) {
    const text = `${msg.role === 'user' ? '' : ''}${msg.content || ''}`;
    const terms = tokenize(text);
    for (const term of terms) {
      // 读取已有索引项并追加
      const getReq = indexStore.get(term);
      getReq.onsuccess = () => {
        const entry = getReq.result || { term, convIds: {} };
        if (!entry.convIds[convId]) {
          entry.convIds[convId] = 0;
        }
        entry.convIds[convId]++;
        indexStore.put(entry);
      };
    }
  }
}

// 重建某对话的搜索索引
function rebuildConvIndex(indexStore, convId, messages) {
  // 先清理旧索引
  clearConvFromIndex(indexStore, convId);
  // 再添加新索引
  updateSearchIndex(indexStore, convId, messages);
}

// 清理搜索索引中某对话的引用
function clearConvFromIndex(indexStore, convId) {
  const cursorReq = indexStore.openCursor();
  cursorReq.onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      const entry = cursor.value;
      if (entry.convIds && entry.convIds[convId] !== undefined) {
        delete entry.convIds[convId];
        if (Object.keys(entry.convIds).length === 0) {
          indexStore.delete(entry.term);
        } else {
          indexStore.put(entry);
        }
      }
      cursor.continue();
    }
  };
}

// 全文搜索：返回匹配的对话列表
async function searchConversations(query, filters = {}) {
  if (!query || !query.trim()) {
    return getConversations(filters);
  }

  const db = await openDB();
  const terms = tokenize(query);

  if (terms.length === 0) {
    return getConversations(filters);
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONVERSATIONS, STORE_INDEX], 'readonly');
    const indexStore = tx.objectStore(STORE_INDEX);

    // 收集每个 term 对应的 convId 及其匹配次数
    const convScores = {};
    let pending = terms.length;

    if (pending === 0) {
      resolve([]);
      return;
    }

    for (const term of terms) {
      const req = indexStore.get(term);
      req.onsuccess = () => {
        const entry = req.result;
        if (entry && entry.convIds) {
          for (const [convId, count] of Object.entries(entry.convIds)) {
            convScores[convId] = (convScores[convId] || 0) + count;
          }
        }
        pending--;
        if (pending === 0) {
          // 按匹配分数排序，获取对话详情
          const sortedIds = Object.entries(convScores)
            .sort((a, b) => b[1] - a[1])
            .map(([id]) => id);

          // 获取对话详情
          const convStore = tx.objectStore(STORE_CONVERSATIONS);
          const results = [];
          let fetched = 0;

          if (sortedIds.length === 0) {
            resolve([]);
            return;
          }

          for (const convId of sortedIds) {
            const getReq = convStore.get(convId);
            getReq.onsuccess = () => {
              const conv = getReq.result;
              if (conv) {
                // 应用平台过滤
                if (!filters.platform || conv.platform === filters.platform) {
                  results.push({ ...conv, _score: convScores[convId] });
                }
              }
              fetched++;
              if (fetched === sortedIds.length) {
                // 按分数排序
                results.sort((a, b) => b._score - a._score);
                // 移除内部字段
                resolve(results.map(({ _score, ...rest }) => rest));
              }
            };
            getReq.onerror = () => {
              fetched++;
              if (fetched === sortedIds.length) {
                results.sort((a, b) => b._score - a._score);
                resolve(results.map(({ _score, ...rest }) => rest));
              }
            };
          }
        }
      };
      req.onerror = () => {
        pending--;
        if (pending === 0) {
          resolve([]);
        }
      };
    }
  });
}

// 高亮搜索结果：返回消息列表，匹配片段被 <mark> 标记
function highlightSearchResult(messages, query) {
  if (!query || !query.trim()) return messages;

  const terms = tokenize(query);
  if (terms.length === 0) return messages;

  // 构建正则（按长度降序，优先匹配长词）
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  const pattern = sorted.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(pattern, 'gi');

  return messages.map(msg => ({
    ...msg,
    highlighted: (msg.content || '').replace(regex, '<mark>$&</mark>')
  }));
}

// 初始化：打开数据库
async function initDB() {
  await openDB();
}

// ============================================================
// 后台 Embedding 触发（保存对话时自动调用）
// ============================================================

function triggerEmbedding(convId, messages) {
  // db.js 只在 background.js 中通过 importScripts 加载，
  // 所以这里直接调用 EmbeddingService，不需要发消息
  (async () => {
    try {
      if (typeof EmbeddingService === 'undefined' || typeof VectorStore === 'undefined') return;
      if (!EmbeddingService.isConfigured()) return;

      for (const msg of messages) {
        if (!msg.content || !msg.content.trim()) continue;
        // 根据设置剥离 <think>/<search_result> 块后再 embedding
        const embedContent = EmbeddingService.filterContentForEmbedding(msg.content);
        if (!embedContent) continue;
        const vector = await EmbeddingService.embed(embedContent);
        if (vector) {
          const embId = `${convId}::msg::${msg.hash || Date.now()}`;
          await VectorStore.addVector(embId, vector, { convId });
        }
      }
      console.log(`[DB/Embedding] 对话 ${convId} 的 ${messages.length} 条消息 embedding 完成`);
    } catch (e) {
      console.error('[DB/Embedding] 后台 embedding 失败:', e);
    }
  })();
}

// ============================================================
// Q&A 历史记录 CRUD
// ============================================================

// 保存一条 Q&A 记录
async function saveQAHistory(data) {
  const db = await openDB();
  const { id, tab, query, answer } = data;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QA_HISTORY, 'readwrite');
    const store = tx.objectStore(STORE_QA_HISTORY);

    const record = {
      id: id || `qa_${Date.now()}`,
      tab: tab || 'chat',
      query: query || '',
      answer: answer || '',
      createdAt: new Date().toISOString()
    };

    store.put(record);

    tx.oncomplete = () => resolve({ success: true, id: record.id });
    tx.onerror = () => reject(tx.error);
  });
}

// 获取 Q&A 历史列表（按时间倒序）
async function getQAHistory(filters = {}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QA_HISTORY, 'readonly');
    const store = tx.objectStore(STORE_QA_HISTORY);
    const request = store.getAll();

    request.onsuccess = () => {
      let list = request.result || [];
      if (filters.tab) {
        list = list.filter(r => r.tab === filters.tab);
      }
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      resolve(list);
    };
    request.onerror = () => reject(request.error);
  });
}

// 获取单条 Q&A 记录
async function getQAHistoryItem(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QA_HISTORY, 'readonly');
    const store = tx.objectStore(STORE_QA_HISTORY);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 删除一条 Q&A 记录
async function deleteQAHistory(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QA_HISTORY, 'readwrite');
    const store = tx.objectStore(STORE_QA_HISTORY);
    store.delete(id);
    tx.oncomplete = () => resolve({ success: true });
    tx.onerror = () => reject(tx.error);
  });
}

// 清空所有 Q&A 历史
async function clearQAHistory() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QA_HISTORY, 'readwrite');
    const store = tx.objectStore(STORE_QA_HISTORY);
    store.clear();
    tx.oncomplete = () => resolve({ success: true });
    tx.onerror = () => reject(tx.error);
  });
}
