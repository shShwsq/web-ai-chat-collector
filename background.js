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
      case 'llm':
        return await getLLMSettings();
      default:
        return { error: '未知设置类别' };
    }
  } catch (e) {
    return { error: e.message };
  }
}

async function handleSaveSettings(category, settings) {
  try {
    switch (category) {
      case 'embedding':
        await saveEmbeddingSettings(settings);
        await EmbeddingService.setConfig({ dashscopeKey: settings.dashscopeKey, model: settings.model });
        break;
      case 'vectorStore':
        await saveVectorStoreSettings(settings);
        await VectorStore.setBackend(settings.backend, settings.config || {});
        break;
      case 'llm':
        await saveLLMSettings(settings);
        await LLMService.setBackend(settings.backend, settings.config || {});
        break;
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
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
        const vector = await EmbeddingService.embed(msg.content);
        if (vector) {
          const embId = `${conv.id}::msg::${msg.hash || count}`;
          await VectorStore.addVector(embId, vector, { convId: conv.id });
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
      const vector = await EmbeddingService.embed(msg.content);
      if (vector) {
        const embId = `${convId}::msg::${msg.hash || Date.now()}`;
        await VectorStore.addVector(embId, vector, { convId });
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

async function handleClearEmbeddings() {
  try {
    const all = await getAllEmbeddings();
    const db = await openEmbeddingDB();
    return new Promise((resolve) => {
      const tx = db.transaction(EMBEDDING_STORE, 'readwrite');
      const store = tx.objectStore(EMBEDDING_STORE);
      store.clear();
      tx.oncomplete = () => {
        console.log(`[BG] 已清空向量索引，共 ${all.length} 条`);
        resolve({ success: true, count: all.length });
      };
      tx.onerror = () => resolve({ success: false, error: tx.error?.message });
    });
  } catch (e) {
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
    // 同时清空向量索引
    const embAll = await getAllEmbeddings();
    const embDb = await openEmbeddingDB();
    await new Promise((resolve) => {
      const tx = embDb.transaction(EMBEDDING_STORE, 'readwrite');
      tx.objectStore(EMBEDDING_STORE).clear();
      tx.oncomplete = resolve;
    });
    console.log(`[BG] 已清空所有对话（${count} 条）和向量索引（${embAll.length} 条）`);
    return { success: true, count };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleResetAllSettings() {
  try {
    await chrome.storage.local.clear();
    // 重新初始化服务
    await EmbeddingService.setConfig({ dashscopeKey: '', model: 'text-embedding-v4' });
    await VectorStore.setBackend('local', {});
    await LLMService.setBackend('dashscope', {});
    console.log('[BG] 已重置所有设置');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
