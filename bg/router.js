// bg/router.js - 消息路由（onMessage 监听 + case 分发）
// 依赖：bg/init.js (ensureInit), bg/conversations.js, bg/export.js,
//       bg/ai-handlers.js, bg/settings-handlers.js, bg/vector-handlers.js, bg/data-handlers.js

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
      handleOrganizeInfo(message.query, message.stream, sender.tab, message.options).then(sendResponse);
      break;

    case 'GENERATE_QUIZ':
      handleGenerateQuiz(message.query, message.stream, sender.tab, message.options).then(sendResponse);
      break;

    case 'AI_ASK_QUESTION':
      handleAIAskQuestion(message.query, message.stream, sender.tab, message.options).then(sendResponse);
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

    case 'OPEN_SETTINGS':
      chrome.tabs.create({ url: chrome.runtime.getURL('popup/settings.html') });
      sendResponse({ success: true });
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

    default:
      sendResponse({ error: '未知消息类型' });
    }
  }); // ensureInit().then()

  // 返回 true 表示异步发送响应
  return true;
});
