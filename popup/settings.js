// settings.js - 设置页面逻辑

document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('backBtn');
  const saveBtn = document.getElementById('saveBtn');
  const testEmbeddingBtn = document.getElementById('testEmbeddingBtn');
  const testLlmBtn = document.getElementById('testLlmBtn');
  const rebuildIndexBtn = document.getElementById('rebuildIndexBtn');
  const toast = document.getElementById('toast');

  // ---- 表单元素 ----
  const embeddingModel = document.getElementById('embeddingModel');
  const dashscopeEmbeddingKey = document.getElementById('dashscopeEmbeddingKey');
  const includeThinking = document.getElementById('includeThinking');
  const includeSearch = document.getElementById('includeSearch');

  const vectorStoreType = document.getElementById('vectorStoreType');
  const remoteVectorConfig = document.getElementById('remoteVectorConfig');
  const vectorUrl = document.getElementById('vectorUrl');
  const vectorApiKey = document.getElementById('vectorApiKey');
  const vectorCollection = document.getElementById('vectorCollection');

  const llmBackend = document.getElementById('llmBackend');
  const dashscopeLlmConfig = document.getElementById('dashscopeLlmConfig');
  const openaiLlmConfig = document.getElementById('openaiLlmConfig');
  const ollamaLlmConfig = document.getElementById('ollamaLlmConfig');
  const dashscopeLlmKey = document.getElementById('dashscopeLlmKey');
  const dashscopeModel = document.getElementById('dashscopeModel');
  const openaiBaseUrl = document.getElementById('openaiBaseUrl');
  const openaiApiKey = document.getElementById('openaiApiKey');
  const openaiModel = document.getElementById('openaiModel');
  const ollamaBaseUrl = document.getElementById('ollamaBaseUrl');
  const ollamaModel = document.getElementById('ollamaModel');

  // ---- 加载设置 ----
  loadSettings();

  // ---- 事件绑定 ----
  backBtn.addEventListener('click', () => {
    window.location.href = 'popup.html';
  });

  vectorStoreType.addEventListener('change', () => {
    remoteVectorConfig.style.display = vectorStoreType.value !== 'local' ? 'block' : 'none';
  });

  llmBackend.addEventListener('change', () => {
    dashscopeLlmConfig.style.display = llmBackend.value === 'dashscope' ? 'block' : 'none';
    openaiLlmConfig.style.display = llmBackend.value === 'openai' ? 'block' : 'none';
    ollamaLlmConfig.style.display = llmBackend.value === 'ollama' ? 'block' : 'none';
  });

  saveBtn.addEventListener('click', saveSettings);
  testEmbeddingBtn.addEventListener('click', testEmbedding);
  testLlmBtn.addEventListener('click', testLLM);
  rebuildIndexBtn.addEventListener('click', rebuildIndex);

  const clearEmbeddingsBtn = document.getElementById('clearEmbeddingsBtn');
  const clearConversationsBtn = document.getElementById('clearConversationsBtn');
  const resetSettingsBtn = document.getElementById('resetSettingsBtn');
  clearEmbeddingsBtn.addEventListener('click', clearEmbeddings);
  clearConversationsBtn.addEventListener('click', clearConversations);
  resetSettingsBtn.addEventListener('click', resetSettings);

  // ---- 加载设置 ----
  async function loadSettings() {
    // Embedding 设置
    const embResp = await sendMessage({ type: 'GET_SETTINGS', category: 'embedding' });
    if (embResp) {
      embeddingModel.value = embResp.model || 'text-embedding-v4';
      dashscopeEmbeddingKey.value = embResp.dashscopeKey || '';
      includeThinking.checked = embResp.includeThinking !== false;
      includeSearch.checked = embResp.includeSearch !== false;
    }

    // 向量库设置
    const vecResp = await sendMessage({ type: 'GET_SETTINGS', category: 'vectorStore' });
    if (vecResp) {
      const config = vecResp.config || {};
      vectorStoreType.value = vecResp.backend === 'local' ? 'local' : (config.type || 'local');
      vectorUrl.value = config.url || '';
      vectorApiKey.value = config.apiKey || '';
      vectorCollection.value = config.collection || '';
      remoteVectorConfig.style.display = vecResp.backend !== 'local' ? 'block' : 'none';
    }

    // LLM 设置
    const llmResp = await sendMessage({ type: 'GET_SETTINGS', category: 'llm' });
    if (llmResp) {
      const config = llmResp.config || {};
      llmBackend.value = llmResp.backend || 'dashscope';
      dashscopeLlmKey.value = config.apiKey || '';
      dashscopeModel.value = config.model || 'deepseek-v4-flash';
      openaiBaseUrl.value = config.baseUrl || '';
      openaiApiKey.value = config.apiKey || '';
      openaiModel.value = config.model || '';
      ollamaBaseUrl.value = config.baseUrl || '';
      ollamaModel.value = config.model || '';

      dashscopeLlmConfig.style.display = llmResp.backend === 'dashscope' ? 'block' : 'none';
      openaiLlmConfig.style.display = llmResp.backend === 'openai' ? 'block' : 'none';
      ollamaLlmConfig.style.display = llmResp.backend === 'ollama' ? 'block' : 'none';
    }
  }

  // ---- 保存设置 ----
  async function saveSettings() {
    // Embedding
    await sendMessage({
      type: 'SAVE_SETTINGS',
      category: 'embedding',
      settings: {
        model: embeddingModel.value,
        dashscopeKey: dashscopeEmbeddingKey.value,
        includeThinking: includeThinking.checked,
        includeSearch: includeSearch.checked
      }
    });

    // 向量库
    const vecType = vectorStoreType.value;
    await sendMessage({
      type: 'SAVE_SETTINGS',
      category: 'vectorStore',
      settings: {
        backend: vecType === 'local' ? 'local' : 'remote',
        config: vecType === 'local' ? {} : {
          type: vecType,
          url: vectorUrl.value,
          apiKey: vectorApiKey.value,
          collection: vectorCollection.value || 'ai_chat_vectors'
        }
      }
    });

    // LLM
    const llmType = llmBackend.value;
    let llmConfig = {};
    switch (llmType) {
      case 'dashscope':
        llmConfig = { apiKey: dashscopeLlmKey.value, model: dashscopeModel.value };
        break;
      case 'openai':
        llmConfig = { baseUrl: openaiBaseUrl.value, apiKey: openaiApiKey.value, model: openaiModel.value };
        break;
      case 'ollama':
        llmConfig = { baseUrl: ollamaBaseUrl.value, model: ollamaModel.value };
        break;
    }
    await sendMessage({
      type: 'SAVE_SETTINGS',
      category: 'llm',
      settings: { backend: llmType, config: llmConfig }
    });

    showToast('设置已保存');
  }

  // ---- 测试 Embedding ----
  async function testEmbedding() {
    testEmbeddingBtn.disabled = true;
    testEmbeddingBtn.textContent = '测试中...';
    try {
      const resp = await sendMessage({ type: 'TEST_EMBEDDING', text: '你好，这是一个测试' });
      if (resp && resp.success) {
        showToast(`Embedding 测试成功！向量维度: ${resp.dimension}，耗时: ${resp.time}ms`);
      } else {
        showToast(`Embedding 测试失败: ${resp?.error || '未知错误'}`, true);
      }
    } catch (e) {
      showToast(`测试异常: ${e.message}`, true);
    }
    testEmbeddingBtn.disabled = false;
    testEmbeddingBtn.textContent = '测试 Embedding';
  }

  // ---- 测试 LLM ----
  async function testLLM() {
    testLlmBtn.disabled = true;
    testLlmBtn.textContent = '测试中...';
    try {
      const resp = await sendMessage({ type: 'TEST_LLM', prompt: '你好，请用一句话介绍自己' });
      if (resp && resp.success) {
        showToast(`LLM 测试成功！回复: ${resp.content.substring(0, 50)}...`);
      } else {
        showToast(`LLM 测试失败: ${resp?.error || '未知错误'}`, true);
      }
    } catch (e) {
      showToast(`测试异常: ${e.message}`, true);
    }
    testLlmBtn.disabled = false;
    testLlmBtn.textContent = '测试 LLM';
  }

  // ---- 重建向量索引 ----
  async function rebuildIndex() {
    if (!confirm('重建向量索引将重新计算所有对话的 embedding，可能需要较长时间。确定继续？')) return;

    rebuildIndexBtn.disabled = true;
    rebuildIndexBtn.textContent = '重建中...';
    try {
      const resp = await sendMessage({ type: 'REBUILD_VECTOR_INDEX' });
      if (resp && resp.success) {
        showToast(`索引重建完成！共处理 ${resp.count} 条消息`);
      } else {
        showToast(`重建失败: ${resp?.error || '未知错误'}`, true);
      }
    } catch (e) {
      showToast(`重建异常: ${e.message}`, true);
    }
    rebuildIndexBtn.disabled = false;
    rebuildIndexBtn.textContent = '重建向量索引';
  }

  // ---- 清空向量索引 ----
  async function clearEmbeddings() {
    if (!confirm('确定要清空所有向量索引吗？此操作不可撤销。')) return;
    clearEmbeddingsBtn.disabled = true;
    clearEmbeddingsBtn.textContent = '清理中...';
    try {
      const resp = await sendMessage({ type: 'CLEAR_EMBEDDINGS' });
      if (resp && resp.success) {
        showToast(`已清空向量索引，共删除 ${resp.count} 条记录`);
      } else {
        showToast(`清空失败: ${resp?.error || '未知错误'}`, true);
      }
    } catch (e) {
      showToast(`操作异常: ${e.message}`, true);
    }
    clearEmbeddingsBtn.disabled = false;
    clearEmbeddingsBtn.textContent = '清空向量索引';
  }

  // ---- 清空所有对话 ----
  async function clearConversations() {
    if (!confirm('确定要清空所有对话记录吗？此操作不可撤销，关联的向量索引也会被删除。')) return;
    clearConversationsBtn.disabled = true;
    clearConversationsBtn.textContent = '清理中...';
    try {
      const resp = await sendMessage({ type: 'CLEAR_ALL_CONVERSATIONS' });
      if (resp && resp.success) {
        showToast(`已清空所有对话，共删除 ${resp.count} 条`);
      } else {
        showToast(`清空失败: ${resp?.error || '未知错误'}`, true);
      }
    } catch (e) {
      showToast(`操作异常: ${e.message}`, true);
    }
    clearConversationsBtn.disabled = false;
    clearConversationsBtn.textContent = '清空所有对话';
  }

  // ---- 重置全部设置 ----
  async function resetSettings() {
    if (!confirm('确定要重置所有设置为默认值吗？此操作不可撤销。')) return;
    try {
      const resp = await sendMessage({ type: 'RESET_ALL_SETTINGS' });
      if (resp && resp.success) {
        showToast('设置已重置为默认值');
        // 重新加载页面以刷新表单
        setTimeout(() => location.reload(), 500);
      } else {
        showToast(`重置失败: ${resp?.error || '未知错误'}`, true);
      }
    } catch (e) {
      showToast(`操作异常: ${e.message}`, true);
    }
  }

  // ---- 工具函数 ----
  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        resolve(response);
      });
    });
  }

  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.className = `toast show ${isError ? 'error' : 'success'}`;
    setTimeout(() => {
      toast.className = 'toast';
    }, 3000);
  }
});
