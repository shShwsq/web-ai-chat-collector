// background.js - Service Worker
// 依赖：lib/db.js, lib/embedding.js, lib/vector-store.js, lib/llm.js

// 加载依赖（Service Worker 中 importScripts 必须在顶层同步调用）
try {
  importScripts('lib/db.js');
  importScripts('lib/embedding.js');
  importScripts('lib/vector-store.js');
  importScripts('lib/llm.js');
} catch (e) {
  console.error('[BG] 加载依赖失败:', e);
}

// 初始化
let _initPromise = null;

async function initAll() {
  try {
    await initDB();
    console.log('[BG] 数据库初始化完成');
  } catch (e) {
    console.error('[BG] 数据库初始化失败:', e);
  }
  try {
    await EmbeddingService.init();
    await VectorStore.init();
    await LLMService.init();
    console.log('[BG] AI 服务初始化完成');
  } catch (e) {
    console.error('[BG] AI 服务初始化失败:', e);
  }
}

_initPromise = initAll();

// 确保初始化完成后再处理消息
async function ensureInit() {
  if (_initPromise) {
    await _initPromise;
    _initPromise = null;
  }
}

// 消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 所有异步消息处理都等待初始化完成
  ensureInit().then(() => {
    switch (message.type) {
    // ===== 对话 CRUD =====
    case 'SAVE_CONVERSATION':
      dbSaveConversation(message.data).then(sendResponse);
      break;

    case 'GET_CONVERSATIONS':
      dbGetConversations(message.filters).then(sendResponse);
      break;

    case 'DELETE_CONVERSATION':
      dbDeleteConversation(message.id).then(sendResponse);
      break;

    case 'EXPORT_CONVERSATION':
      handleExportConversation(message.id, message.format).then(sendResponse);
      break;

    case 'EXPORT_ALL':
      handleExportAll(message.format).then(sendResponse);
      break;

    case 'GET_STATUS':
      dbGetStatus().then(sendResponse);
      break;

    case 'GET_STORAGE_INFO':
      dbGetStorageInfo().then(sendResponse);
      break;

    case 'SEARCH_CONVERSATIONS':
      dbSearchConversations(message.query, message.filters).then(sendResponse);
      break;

    // ===== AI 问答 =====
    case 'ORGANIZE_INFO':
      handleOrganizeInfo(message.query, message.stream, sender.tab).then(sendResponse);
      break;

    case 'GENERATE_QUIZ':
      handleGenerateQuiz(message.query, message.stream, sender.tab).then(sendResponse);
      break;

    case 'AI_ASK_QUESTION':
      handleAIAskQuestion(message.query, message.stream, sender.tab).then(sendResponse);
      break;

    // ===== Q&A 历史记录 =====
    case 'SAVE_QA_HISTORY':
      saveQAHistory(message.data).then(sendResponse);
      break;

    case 'GET_QA_HISTORY':
      getQAHistory(message.filters).then(sendResponse);
      break;

    case 'DELETE_QA_HISTORY':
      deleteQAHistory(message.id).then(sendResponse);
      break;

    case 'CLEAR_QA_HISTORY':
      clearQAHistory().then(sendResponse);
      break;

    // ===== 设置 =====
    case 'GET_SETTINGS':
      handleGetSettings(message.category).then(sendResponse);
      break;

    case 'SAVE_SETTINGS':
      handleSaveSettings(message.category, message.settings).then(sendResponse);
      break;

    case 'TEST_EMBEDDING':
      handleTestEmbedding(message.text).then(sendResponse);
      break;

    case 'TEST_LLM':
      handleTestLLM(message.prompt).then(sendResponse);
      break;

    case 'REBUILD_VECTOR_INDEX':
      handleRebuildIndex().then(sendResponse);
      break;

    case 'TRIGGER_EMBEDDING':
      handleTriggerEmbedding(message.convId, message.messages).then(sendResponse);
      break;

    case 'CLEAR_EMBEDDINGS':
      handleClearEmbeddings().then(sendResponse);
      break;

    case 'CLEAR_VECTOR_STORE':
      handleClearVectorStore().then(sendResponse);
      break;

    case 'GET_VECTOR_STORE_STATS':
      handleGetVectorStoreStats().then(sendResponse);
      break;

    case 'TEST_VECTOR_CONNECTION':
      handleTestVectorConnection(message.config).then(sendResponse);
      break;

    case 'CLEAR_ALL_CONVERSATIONS':
      handleClearAllConversations().then(sendResponse);
      break;

    case 'RESET_ALL_SETTINGS':
      handleResetAllSettings().then(sendResponse);
      break;

    case 'OPEN_SETTINGS':
      chrome.tabs.create({ url: chrome.runtime.getURL('popup/settings.html') });
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ error: '未知消息类型' });
    }
  }); // ensureInit().then()

  // 返回 true 表示异步发送响应
  return true;
});

// ===== 委托 db.js 的 CRUD =====

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

async function dbSearchConversations(query, filters) {
  return await searchConversations(query, filters);
}

// ===== 导出逻辑（仍由 background 处理，因为需要 chrome.downloads） =====

async function handleExportConversation(id, format = 'markdown') {
  const conv = await getConversation(id);
  if (!conv) return { success: false, error: '对话不存在' };

  const content = formatConversation(conv, format);
  const filename = `${sanitizeFilename(conv.title)}_${conv.platform}.${format === 'markdown' ? 'md' : format}`;
  const mimeType = format === 'json' ? 'application/json' : 'text/plain';

  await downloadFile(content, filename, mimeType);
  return { success: true };
}

async function handleExportAll(format = 'markdown') {
  const list = await getConversations();
  if (list.length === 0) return { success: false, error: '没有可导出的对话' };

  if (format === 'json') {
    const content = JSON.stringify(list, null, 2);
    await downloadFile(content, 'all_conversations.json', 'application/json');
  } else {
    const parts = list.map(conv => formatConversation(conv, format));
    const content = parts.join('\n\n---\n\n');
    await downloadFile(content, 'all_conversations.md', 'text/plain');
  }
  return { success: true };
}

// 格式化对话
function formatConversation(conv, format) {
  if (format === 'json') {
    const messages = conv.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
    return JSON.stringify(messages, null, 2);
  }

  let md = `# ${conv.title}\n\n`;
  md += `> 平台: ${conv.platform} | 创建: ${conv.createdAt} | 更新: ${conv.updatedAt}\n\n`;
  if (conv.url) md += `> 链接: ${conv.url}\n\n`;

  for (const msg of conv.messages) {
    const label = msg.role === 'user' ? '**🧑 用户**' : '**🤖 助手**';
    md += `### ${label}\n\n${jsonContentToMarkdown(msg.content)}\n\n`;
  }
  return md;
}

function jsonContentToMarkdown(content) {
  if (!content) return '';
  let result = content;
  result = result.replace(/<think>\n?([\s\S]*?)\n?<\/think>/g, (_, thinkContent) => {
    const lines = thinkContent.trim().split('\n');
    const quoted = lines.map(line => `> ${line}`).join('\n');
    return `> 💭 **思考过程**\n>\n${quoted}`;
  });
  result = result.replace(/<search_result>\n?([\s\S]*?)\n?<\/search_result>/g, (_, searchContent) => {
    return `🔍 **联网搜索结果**\n\n${searchContent.trim()}`;
  });
  return result;
}

async function downloadFile(content, filename, mimeType) {
  const dataUrl = `data:${mimeType};charset=utf-8,` + encodeURIComponent(content);
  await chrome.downloads.download({
    url: dataUrl,
    filename: `ai-chat-collector/${filename}`,
    saveAs: false
  });
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
}

// ===== AI 问答处理 =====

function _createStreamChunkSender(tab, requestId) {
  // 向 content script 推送流式 chunk
  return (delta, fullContent) => {
    try {
      chrome.tabs.sendMessage(tab.id, {
        type: 'AI_STREAM_CHUNK',
        requestId,
        delta,
        fullContent
      });
    } catch (e) {
      console.error('[BG] 推送流式 chunk 失败:', e);
    }
  };
}

async function handleOrganizeInfo(query, stream, tab) {
  try {
    if (stream && tab) {
      const requestId = `organize_${Date.now()}`;
      // 先返回 requestId，让前端开始监听
      // 异步执行流式调用
      const onChunk = _createStreamChunkSender(tab, requestId);
      AIAssistant.organizeInfo(query, onChunk).then((content) => {
        try {
          chrome.tabs.sendMessage(tab.id, {
            type: 'AI_STREAM_DONE',
            requestId,
            fullContent: content
          });
        } catch (e) { /* ignore */ }
      }).catch((e) => {
        try {
          chrome.tabs.sendMessage(tab.id, {
            type: 'AI_STREAM_ERROR',
            requestId,
            error: e.message
          });
        } catch (e2) { /* ignore */ }
      });
      return { success: true, requestId };
    }
    const content = await AIAssistant.organizeInfo(query);
    return { success: true, content };
  } catch (e) {
    console.error('[BG] 整理信息失败:', e);
    return { success: false, error: e.message };
  }
}

async function handleGenerateQuiz(query, stream, tab) {
  try {
    if (stream && tab) {
      const requestId = `quiz_${Date.now()}`;
      const onChunk = _createStreamChunkSender(tab, requestId);
      AIAssistant.generateQuiz(query, onChunk).then((content) => {
        try {
          chrome.tabs.sendMessage(tab.id, {
            type: 'AI_STREAM_DONE',
            requestId,
            fullContent: content
          });
        } catch (e) { /* ignore */ }
      }).catch((e) => {
        try {
          chrome.tabs.sendMessage(tab.id, {
            type: 'AI_STREAM_ERROR',
            requestId,
            error: e.message
          });
        } catch (e2) { /* ignore */ }
      });
      return { success: true, requestId };
    }
    const content = await AIAssistant.generateQuiz(query);
    return { success: true, content };
  } catch (e) {
    console.error('[BG] 生成测验失败:', e);
    return { success: false, error: e.message };
  }
}

async function handleAIAskQuestion(query, stream, tab) {
  try {
    if (stream && tab) {
      const requestId = `chat_${Date.now()}`;
      const onChunk = _createStreamChunkSender(tab, requestId);
      AIAssistant.askQuestion(query, onChunk).then((content) => {
        try {
          chrome.tabs.sendMessage(tab.id, {
            type: 'AI_STREAM_DONE',
            requestId,
            fullContent: content
          });
        } catch (e) { /* ignore */ }
      }).catch((e) => {
        try {
          chrome.tabs.sendMessage(tab.id, {
            type: 'AI_STREAM_ERROR',
            requestId,
            error: e.message
          });
        } catch (e2) { /* ignore */ }
      });
      return { success: true, requestId };
    }
    const content = await AIAssistant.askQuestion(query);
    return { success: true, content };
  } catch (e) {
    console.error('[BG] AI 问答失败:', e);
    return { success: false, error: e.message };
  }
}

// ===== 设置处理 =====

async function handleGetSettings(category) {
  try {
    switch (category) {
      case 'embedding':
        return await getEmbeddingSettings();
      case 'vectorStore':
        return await getVectorStoreSettings();
      case 'retrieval':
        return await getRetrievalSettings();
      case 'llm':
        return await getLLMSettings();
      case 'platforms':
        return await getPlatformSettings();
      default:
        return { error: '未知设置类别' };
    }
  } catch (e) {
    return { error: e.message };
  }
}

async function handleSaveSettings(category, settings) {
  try {
    let extraResult = {};
    switch (category) {
      case 'embedding':
        await saveEmbeddingSettings(settings);
        await EmbeddingService.setConfig({
          dashscopeKey: settings.dashscopeKey,
          model: settings.model,
          includeThinking: settings.includeThinking,
          includeSearch: settings.includeSearch,
          chunkSize: settings.chunkSize,
          chunkOverlap: settings.chunkOverlap
        });
        break;
      case 'retrieval':
        await saveRetrievalSettings(settings);
        break;
      case 'vectorStore': {
        // 读取当前（旧）设置，用于判断后端是否变化
        const oldSettings = await getVectorStoreSettings();
        const oldBackend = oldSettings.backend;
        const oldConfig = oldSettings.config || {};
        const newBackend = settings.backend;
        const newConfig = settings.config || {};

        // 后端变化判定：backend 字段变化，或 remote 模式下 type/url/collection 变化
        // apiKey 单独变化不视为数据位置变化（不触发清理/重建）
        const backendChanged = oldBackend !== newBackend ||
          (oldBackend === 'remote' && newBackend === 'remote' && (
            oldConfig.type !== newConfig.type ||
            oldConfig.url !== newConfig.url ||
            oldConfig.collection !== newConfig.collection
          ));

        // 切换前清空旧后端（此时 VectorStore 单例仍指向旧后端）
        let cleared = null;
        if (settings.clearOld && backendChanged) {
          try {
            cleared = await VectorStore.clearCollection();
            console.log(`[BG] 已清空旧后端向量库 (${oldBackend}):`, cleared);
          } catch (e) {
            console.error('[BG] 清空旧后端失败:', e);
            cleared = { success: false, error: e.message };
          }
        }

        // 保存新设置并切换后端（剥离 clearOld/rebuildNew 临时标志，不持久化）
        await saveVectorStoreSettings({ backend: newBackend, config: newConfig });
        await VectorStore.setBackend(newBackend, newConfig);

        // 切换后重建新后端索引
        let rebuilt = null;
        if (settings.rebuildNew && backendChanged) {
          try {
            console.log('[BG] 开始为新后端重建索引...');
            rebuilt = await handleRebuildIndex();
          } catch (e) {
            console.error('[BG] 新后端索引重建失败:', e);
            rebuilt = { success: false, error: e.message };
          }
        }

        extraResult = { cleared, rebuilt };
        break;
      }
      case 'llm':
        await saveLLMSettings(settings);
        await LLMService.setBackend(settings.backend, settings.config || {});
        break;
      case 'platforms':
        await savePlatformSettings(settings);
        break;
    }
    return { success: true, ...extraResult };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 平台提取设置（按网站启用/禁用对话提取）
async function getPlatformSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('platformSettings', (result) => {
      resolve(result.platformSettings || {});
    });
  });
}

async function savePlatformSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ platformSettings: settings }, resolve);
  });
}

async function handleTestEmbedding(text) {
  try {
    const start = Date.now();
    const vector = await EmbeddingService.embed(text);
    const time = Date.now() - start;
    if (vector) {
      return { success: true, dimension: vector.length, time };
    }
    return { success: false, error: '生成向量失败' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleTestLLM(prompt) {
  try {
    const content = await LLMService.chat([
      { role: 'user', content: prompt }
    ]);
    return { success: true, content };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleRebuildIndex() {
  try {
    const list = await getConversations();
    let count = 0;

    for (const conv of list) {
      for (const msg of conv.messages) {
        if (!msg.content || !msg.content.trim()) continue;
        // 根据设置剥离 <think>/<search_result> 块后再 embedding
        const embedContent = EmbeddingService.filterContentForEmbedding(msg.content);
        if (!embedContent) continue;
        // 按当前切片设置切成多段，逐段 embedding 入库
        const chunks = await EmbeddingService.embedMessageChunks(embedContent);
        const msgKey = msg.hash || count;
        for (const c of chunks) {
          const embId = `${conv.id}::msg::${msgKey}::chunk::${c.chunkIdx}`;
          await VectorStore.addVector(embId, c.vector, {
            convId: conv.id,
            msgHash: String(msgKey),
            chunkIdx: c.chunkIdx,
            chunkTotal: c.total
          });
          count++;
        }
      }
    }

    return { success: true, count };
  } catch (e) {
    console.error('[BG] 重建索引失败:', e);
    return { success: false, error: e.message };
  }
}

// 后台 Embedding：保存对话时由 content script 触发
async function handleTriggerEmbedding(convId, messages) {
  try {
    if (!EmbeddingService.isConfigured()) {
      console.log('[BG/Embedding] DashScope API Key 未配置，跳过 embedding');
      return { success: false, error: '未配置 API Key' };
    }

    for (const msg of messages) {
      if (!msg.content || !msg.content.trim()) continue;
      // 根据设置剥离 <think>/<search_result> 块后再 embedding
      const embedContent = EmbeddingService.filterContentForEmbedding(msg.content);
      if (!embedContent) continue;
      // 按当前切片设置切成多段，逐段 embedding 入库
      const chunks = await EmbeddingService.embedMessageChunks(embedContent);
      const msgKey = msg.hash || Date.now();
      for (const c of chunks) {
        const embId = `${convId}::msg::${msgKey}::chunk::${c.chunkIdx}`;
        await VectorStore.addVector(embId, c.vector, {
          convId,
          msgHash: String(msgKey),
          chunkIdx: c.chunkIdx,
          chunkTotal: c.total
        });
      }
    }
    console.log(`[BG/Embedding] 对话 ${convId} 的 ${messages.length} 条消息 embedding 完成`);
    return { success: true };
  } catch (e) {
    console.error('[BG/Embedding] 后台 embedding 失败:', e);
    return { success: false, error: e.message };
  }
}

// ===== 数据管理 =====

// 清空向量索引（兼容旧消息，根据当前后端分别处理）
async function handleClearEmbeddings() {
  return await handleClearVectorStore();
}

// 清空向量库（本地=IndexedDB；远程=远程 collection）
async function handleClearVectorStore() {
  try {
    const result = await VectorStore.clearCollection();
    console.log(`[BG] 已清空向量库（后端: ${VectorStore.getBackend()}），结果:`, result);
    return result;
  } catch (e) {
    console.error('[BG] 清空向量库失败:', e);
    return { success: false, error: e.message };
  }
}

// 获取向量库统计
async function handleGetVectorStoreStats() {
  try {
    return await VectorStore.getStats();
  } catch (e) {
    console.error('[BG] 获取向量库统计失败:', e);
    return { error: e.message };
  }
}

// 测试远程向量库连通性（用表单当前值，不依赖已保存设置）
async function handleTestVectorConnection(config) {
  try {
    return await VectorStore.testConnection(config);
  } catch (e) {
    console.error('[BG] 测试向量库连通性失败:', e);
    return { success: false, error: e.message };
  }
}

async function handleClearAllConversations() {
  try {
    const list = await getConversations();
    let count = 0;
    for (const conv of list) {
      await deleteConversation(conv.id);
      count++;
    }
    // 同时清空向量库（本地或远程，根据当前后端）
    await VectorStore.clearCollection();
    console.log(`[BG] 已清空所有对话（${count} 条）和向量库（后端: ${VectorStore.getBackend()}）`);
    return { success: true, count };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleResetAllSettings() {
  try {
    await chrome.storage.local.clear();
    // 重新初始化服务
    await EmbeddingService.setConfig({ dashscopeKey: '', model: 'text-embedding-v4', includeThinking: true, includeSearch: true });
    await VectorStore.setBackend('local', {});
    await LLMService.setBackend('dashscope', {});
    console.log('[BG] 已重置所有设置');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
