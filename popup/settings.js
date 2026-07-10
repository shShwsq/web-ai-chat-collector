// settings.js - 设置页面逻辑

document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('backBtn');
  const saveBtn = document.getElementById('saveBtn');
  const testEmbeddingBtn = document.getElementById('testEmbeddingBtn');
  const testLlmBtn = document.getElementById('testLlmBtn');
  const testVectorConnectionBtn = document.getElementById('testVectorConnectionBtn');
  const rebuildIndexBtn = document.getElementById('rebuildIndexBtn');
  const toast = document.getElementById('toast');

  // ---- 表单元素 ----
  const platformDeepseek = document.getElementById('platformDeepseek');
  const platformQianwen = document.getElementById('platformQianwen');
  const platformFudan = document.getElementById('platformFudan');
  const platformDoubao = document.getElementById('platformDoubao');

  const embeddingModel = document.getElementById('embeddingModel');
  const dashscopeEmbeddingKey = document.getElementById('dashscopeEmbeddingKey');
  const includeThinking = document.getElementById('includeThinking');
  const includeSearch = document.getElementById('includeSearch');
  const chunkSize = document.getElementById('chunkSize');
  const chunkOverlap = document.getElementById('chunkOverlap');

  // 召回设置
  const retrievalMode = document.getElementById('retrievalMode');
  const retrievalTopK = document.getElementById('retrievalTopK');
  const retrievalThreshold = document.getElementById('retrievalThreshold');
  const topKGroup = document.getElementById('topKGroup');
  const thresholdGroup = document.getElementById('thresholdGroup');
  const retrievalModeDesc = document.getElementById('retrievalModeDesc');

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

  // ---- 未保存提示：表单快照 ----
  let formSnapshot = '';
  // 向量库保存的额外结果（清空旧后端 / 重建新后端），用于保存后的 toast 提示
  let vectorSaveExtra = null;
  function serializeForm() {
    return JSON.stringify({
      platformDeepseek: platformDeepseek.checked,
      platformQianwen: platformQianwen.checked,
      platformFudan: platformFudan.checked,
      platformDoubao: platformDoubao.checked,
      embeddingModel: embeddingModel.value,
      dashscopeEmbeddingKey: dashscopeEmbeddingKey.value,
      includeThinking: includeThinking.checked,
      includeSearch: includeSearch.checked,
      chunkSize: chunkSize.value,
      chunkOverlap: chunkOverlap.value,
      retrievalMode: retrievalMode.value,
      retrievalTopK: retrievalTopK.value,
      retrievalThreshold: retrievalThreshold.value,
      vectorStoreType: vectorStoreType.value,
      vectorUrl: vectorUrl.value,
      vectorApiKey: vectorApiKey.value,
      vectorCollection: vectorCollection.value,
      llmBackend: llmBackend.value,
      dashscopeLlmKey: dashscopeLlmKey.value,
      dashscopeModel: dashscopeModel.value,
      openaiBaseUrl: openaiBaseUrl.value,
      openaiApiKey: openaiApiKey.value,
      openaiModel: openaiModel.value,
      ollamaBaseUrl: ollamaBaseUrl.value,
      ollamaModel: ollamaModel.value
    });
  }
  function isFormDirty() {
    return formSnapshot !== '' && serializeForm() !== formSnapshot;
  }

  // ---- 加载设置 ----
  loadSettings();

  // ---- 事件绑定 ----
  backBtn.addEventListener('click', () => {
    if (isFormDirty() && !confirm('有未保存的修改，确定离开吗？')) return;
    window.location.href = 'popup.html';
  });

  vectorStoreType.addEventListener('change', () => {
    remoteVectorConfig.style.display = vectorStoreType.value !== 'local' ? 'block' : 'none';
    updateVectorHelpLink();
  });

  llmBackend.addEventListener('change', () => {
    dashscopeLlmConfig.style.display = llmBackend.value === 'dashscope' ? 'block' : 'none';
    openaiLlmConfig.style.display = llmBackend.value === 'openai' ? 'block' : 'none';
    ollamaLlmConfig.style.display = llmBackend.value === 'ollama' ? 'block' : 'none';
  });

  // 召回模式切换：按模式显示/隐藏 Top-K 和阈值输入框，并更新说明
  function updateRetrievalModeUI() {
    const mode = retrievalMode.value;
    const descs = {
      topk: '仅按 Top-K 召回前 N 条候选，不应用相似度过滤',
      threshold: '拉取大量候选（Top-K=100）后只保留相似度达标的，可能召回较多或较少',
      combined: '先按 Top-K 召回候选，再过滤掉相似度低于阈值的结果'
    };
    retrievalModeDesc.textContent = descs[mode] || descs.combined;
    topKGroup.style.display = (mode === 'topk' || mode === 'combined') ? 'block' : 'none';
    thresholdGroup.style.display = (mode === 'threshold' || mode === 'combined') ? 'block' : 'none';
  }
  retrievalMode.addEventListener('change', updateRetrievalModeUI);

  // 切片重叠必须小于切片大小：实时校验提示
  chunkSize.addEventListener('input', () => {
    const size = parseInt(chunkSize.value, 10);
    const overlap = parseInt(chunkOverlap.value, 10);
    if (!isNaN(size) && !isNaN(overlap) && overlap >= size) {
      chunkOverlap.setCustomValidity('重叠必须小于切片大小');
      chunkOverlap.reportValidity();
    } else {
      chunkOverlap.setCustomValidity('');
    }
  });
  chunkOverlap.addEventListener('input', () => {
    chunkSize.dispatchEvent(new Event('input'));
  });

  saveBtn.addEventListener('click', saveSettings);
  testEmbeddingBtn.addEventListener('click', testEmbedding);
  testLlmBtn.addEventListener('click', testLLM);
  testVectorConnectionBtn.addEventListener('click', testVectorConnection);
  rebuildIndexBtn.addEventListener('click', rebuildIndex);

  // ---- 顶部导航条 ----
  const navStorageBtn = document.getElementById('navStorageBtn');
  const navDataBtn = document.getElementById('navDataBtn');
  const storageSection = document.querySelector('.storage-info-section');
  const dataSection = document.querySelector('.danger-zone');

  // 点击跳转到对应区域（scroll-margin-top 已配置，标题不会被 sticky 遮挡）
  navStorageBtn.addEventListener('click', () => {
    storageSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  navDataBtn.addEventListener('click', () => {
    dataSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // 滚动监听：当「存储位置」或「数据管理」标题滚动到 header 下方时，隐藏「保存设置」按钮
  let storageVisible = false;
  let dataVisible = false;
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.target === storageSection) storageVisible = entry.isIntersecting;
      else if (entry.target === dataSection) dataVisible = entry.isIntersecting;
    });
    saveBtn.classList.toggle('hidden', storageVisible || dataVisible);
  }, {
    // 顶部排除 sticky header（约 36px）；底部 -100% 把 root 收缩成 header 下边缘的一条线，
    // 只有当 section 顶部真正抵达 header 下方时才触发隐藏
    rootMargin: '-36px 0px -100% 0px',
    threshold: 0
  });
  sectionObserver.observe(storageSection);
  sectionObserver.observe(dataSection);

  const clearConversationsBtn = document.getElementById('clearConversationsBtn');
  const resetSettingsBtn = document.getElementById('resetSettingsBtn');
  clearConversationsBtn.addEventListener('click', clearConversations);
  resetSettingsBtn.addEventListener('click', resetSettings);

  // ---- 帮助弹窗 ----
  const vectorHelpLink = document.getElementById('vectorHelpLink');
  const vectorHelpLinkText = document.getElementById('vectorHelpLinkText');
  const helpOverlay = document.getElementById('helpOverlay');
  const helpTitle = document.getElementById('helpTitle');
  const helpBody = document.getElementById('helpBody');
  const helpClose = document.getElementById('helpClose');

  // 各向量库对应的帮助文档映射
  const VECTOR_HELP_MAP = {
    chroma:    { title: 'ChromaDB 部署说明',                file: 'docs/chroma-setup.md' },
    milvus:    { title: 'Milvus 部署说明',                  file: 'docs/milvus-setup.md' },
    pgvector:  { title: 'PostgreSQL + pgvector 部署说明',   file: 'docs/pgvector-setup.md' },
    pinecone:  { title: 'Pinecone 部署说明',                file: 'docs/pinecone-setup.md' },
    supabase:  { title: 'Supabase 部署说明',                file: 'docs/supabase-setup.md' },
    qdrant:    { title: 'Qdrant 部署说明',                  file: 'docs/qdrant-setup.md' }
  };

  // 根据当前选中的向量库类型，显示/隐藏帮助链接
  function updateVectorHelpLink() {
    const type = vectorStoreType.value;
    const info = VECTOR_HELP_MAP[type];
    if (info) {
      vectorHelpLink.style.display = 'block';
      vectorHelpLinkText.textContent = `查看 ${info.title}`;
    } else {
      vectorHelpLink.style.display = 'none';
    }
  }

  vectorHelpLink.addEventListener('click', (e) => {
    e.preventDefault();
    openHelp(vectorStoreType.value);
  });
  helpClose.addEventListener('click', closeHelp);
  helpOverlay.addEventListener('click', (e) => {
    if (e.target === helpOverlay) closeHelp();
  });

  // ---- 存储位置信息 ----
  const copyExtensionIdBtn = document.getElementById('copyExtensionIdBtn');
  const openExtensionsBtn = document.getElementById('openExtensionsBtn');
  const refreshStorageInfoBtn = document.getElementById('refreshStorageInfoBtn');
  const dbDetailToggle = document.getElementById('dbDetailToggle');
  const dbDetailBody = document.getElementById('dbDetailBody');
  const filePathToggle = document.getElementById('filePathToggle');
  const filePathBody = document.getElementById('filePathBody');
  const devtoolsToggle = document.getElementById('devtoolsToggle');
  const devtoolsBody = document.getElementById('devtoolsBody');

  copyExtensionIdBtn.addEventListener('click', copyExtensionId);
  openExtensionsBtn.addEventListener('click', openExtensionsPage);
  refreshStorageInfoBtn.addEventListener('click', loadStorageInfo);

  // 折叠区域切换
  dbDetailToggle.addEventListener('click', () => toggleCollapse(dbDetailToggle, dbDetailBody));
  filePathToggle.addEventListener('click', () => toggleCollapse(filePathToggle, filePathBody));
  devtoolsToggle.addEventListener('click', () => toggleCollapse(devtoolsToggle, devtoolsBody));

  // 页面加载时拉取一次存储信息
  loadStorageInfo();

  // ---- 向量库数据管理 ----
  const refreshVectorStatsBtn = document.getElementById('refreshVectorStatsBtn');
  const clearVectorStoreBtn = document.getElementById('clearVectorStoreBtn');
  const remoteConfigToggle = document.getElementById('remoteConfigToggle');
  const remoteConfigBody = document.getElementById('remoteConfigBody');

  refreshVectorStatsBtn.addEventListener('click', loadVectorStoreStats);
  clearVectorStoreBtn.addEventListener('click', clearVectorStore);
  remoteConfigToggle.addEventListener('click', () => toggleCollapse(remoteConfigToggle, remoteConfigBody));

  // 页面加载时拉取一次向量库统计
  loadVectorStoreStats();

  // ---- 加载设置 ----
  async function loadSettings() {
    // 平台提取设置
    const platformResp = await sendMessage({ type: 'GET_SETTINGS', category: 'platforms' });
    if (platformResp) {
      platformDeepseek.checked = platformResp.deepseek !== false;
      platformQianwen.checked = platformResp.qianwen !== false;
      platformFudan.checked = platformResp.fudan !== false;
      platformDoubao.checked = platformResp.doubao !== false;
    }

    // Embedding 设置
    const embResp = await sendMessage({ type: 'GET_SETTINGS', category: 'embedding' });
    if (embResp) {
      embeddingModel.value = embResp.model || 'text-embedding-v4';
      dashscopeEmbeddingKey.value = embResp.dashscopeKey || '';
      includeThinking.checked = embResp.includeThinking !== false;
      includeSearch.checked = embResp.includeSearch !== false;
      chunkSize.value = embResp.chunkSize || 500;
      chunkOverlap.value = embResp.chunkOverlap ?? 50;
    }

    // 召回设置
    const retResp = await sendMessage({ type: 'GET_SETTINGS', category: 'retrieval' });
    if (retResp) {
      retrievalMode.value = retResp.mode || 'combined';
      retrievalTopK.value = retResp.topK || 20;
      retrievalThreshold.value = retResp.scoreThreshold ?? 0.3;
      updateRetrievalModeUI();
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
      updateVectorHelpLink();
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

    // 加载完成后记录表单快照，用于未保存提示
    formSnapshot = serializeForm();
  }

  // ---- 保存设置 ----
  async function saveSettings() {
    // 平台提取设置
    await sendMessage({
      type: 'SAVE_SETTINGS',
      category: 'platforms',
      settings: {
        deepseek: platformDeepseek.checked,
        qianwen: platformQianwen.checked,
        fudan: platformFudan.checked,
        doubao: platformDoubao.checked
      }
    });

    // Embedding
    // 切片重叠必须严格小于切片大小，提交前再校验一次
    const sizeVal = parseInt(chunkSize.value, 10);
    const overlapVal = parseInt(chunkOverlap.value, 10);
    if (isNaN(sizeVal) || sizeVal < 100) {
      showToast('切片大小需为不小于 100 的整数');
      return;
    }
    if (isNaN(overlapVal) || overlapVal < 0) {
      showToast('切片重叠需为不小于 0 的整数');
      return;
    }
    if (overlapVal >= sizeVal) {
      showToast('切片重叠必须小于切片大小');
      return;
    }
    await sendMessage({
      type: 'SAVE_SETTINGS',
      category: 'embedding',
      settings: {
        model: embeddingModel.value,
        dashscopeKey: dashscopeEmbeddingKey.value,
        includeThinking: includeThinking.checked,
        includeSearch: includeSearch.checked,
        chunkSize: sizeVal,
        chunkOverlap: overlapVal
      }
    });

    // 召回设置
    const retTopK = parseInt(retrievalTopK.value, 10);
    const retThreshold = parseFloat(retrievalThreshold.value);
    await sendMessage({
      type: 'SAVE_SETTINGS',
      category: 'retrieval',
      settings: {
        mode: retrievalMode.value,
        topK: (isNaN(retTopK) || retTopK < 1) ? 20 : retTopK,
        scoreThreshold: (isNaN(retThreshold) || retThreshold < 0) ? 0 : retThreshold
      }
    });

    // 向量库（含后端切换询问，测试连通性时复用此函数的静默模式）
    const vecResult = await saveVectorStoreSettings({ interactive: true });
    vectorSaveExtra = vecResult.extra;

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

    // 保存成功后更新快照，避免返回时误报未保存
    formSnapshot = serializeForm();

    // 根据向量库切换的额外结果拼接提示
    let toastMsg = '设置已保存';
    if (vectorSaveExtra) {
      if (vectorSaveExtra.cleared) {
        toastMsg += vectorSaveExtra.cleared.success === false
          ? `；旧后端清空失败: ${vectorSaveExtra.cleared.error || '未知错误'}`
          : '；旧后端已清空';
      }
      if (vectorSaveExtra.rebuilt) {
        toastMsg += vectorSaveExtra.rebuilt.success
          ? `；新后端索引已重建（${vectorSaveExtra.rebuilt.count} 条）`
          : `；索引重建失败: ${vectorSaveExtra.rebuilt.error || '未知错误'}`;
      }
    }
    showToast(toastMsg);
    vectorSaveExtra = null;

    // 保存完成后，若向量库为远程且尚未持有该域权限，则申请
    // 放在最后：权限弹窗会导致 popup 失焦关闭，但此时配置已持久化，用户重开即可继续
    const vecType2 = vectorStoreType.value;
    if (vecType2 !== 'local') {
      const origin = urlToOrigin(vectorUrl.value.trim());
      if (origin) {
        const has = await new Promise((r) => chrome.permissions.contains({ origins: [`${origin}/*`] }, r));
        if (!has) {
          // 不强制：用户拒绝也无所谓，配置已保存；下次测试/保存还会再问
          await ensureHostPermission(vectorUrl.value.trim());
        }
      }
    }
  }

  // 保存向量库设置；interactive=true 会弹后端切换询问，false（测试连通性用）静默保存
  // 返回 { extra } 供 saveSettings 拼接 toast
  async function saveVectorStoreSettings({ interactive = true } = {}) {
    const vecType = vectorStoreType.value;
    const newVecSettings = {
      backend: vecType === 'local' ? 'local' : 'remote',
      config: vecType === 'local' ? {} : {
        type: vecType,
        url: vectorUrl.value.trim(),
        apiKey: vectorApiKey.value.trim(),
        collection: vectorCollection.value.trim() || 'ai_chat_vectors'
      }
    };

    let clearOld = false;
    let rebuildNew = false;

    if (interactive) {
      // 检测向量库后端是否变化（忽略单独的 apiKey 变化，因为它不改变数据位置）
      const oldVec = await sendMessage({ type: 'GET_SETTINGS', category: 'vectorStore' });
      const oldBackend = oldVec?.backend || 'local';
      const oldConfig = oldVec?.config || {};
      const backendChanged = oldBackend !== newVecSettings.backend ||
        (oldBackend === 'remote' && newVecSettings.backend === 'remote' && (
          oldConfig.type !== newVecSettings.config.type ||
          oldConfig.url !== newVecSettings.config.url ||
          oldConfig.collection !== newVecSettings.config.collection
        ));

      // 后端切换时询问是否清空旧后端、是否为新后端重建索引
      if (backendChanged) {
        clearOld = confirm(
          '检测到向量库后端已切换。\n\n' +
          '旧后端的索引数据不会自动清理，是否清空旧后端的索引？\n\n' +
          '（确定 = 清空旧后端；取消 = 保留旧后端数据）'
        );
        rebuildNew = confirm(
          '是否立即为新后端重建索引？\n\n' +
          '（需要已配置 Embedding API Key，可能耗时较长；取消可稍后手动重建）'
        );
      }
    }

    const extra = await sendMessage({
      type: 'SAVE_SETTINGS',
      category: 'vectorStore',
      settings: {
        ...newVecSettings,
        clearOld,
        rebuildNew
      }
    });

    return { extra };
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

  // ---- 测试向量库连通性 ----
  async function testVectorConnection() {
    // 1. 先静默保存向量库配置（不弹后端切换询问），便于用户调试后直接持久化
    testVectorConnectionBtn.disabled = true;
    testVectorConnectionBtn.textContent = '保存并测试中...';
    try {
      await saveVectorStoreSettings({ interactive: false });
      // 同步更新快照，避免返回时误报未保存
      formSnapshot = serializeForm();
    } catch (e) {
      showToast(`保存配置失败: ${e.message}`, true);
      testVectorConnectionBtn.disabled = false;
      testVectorConnectionBtn.textContent = '测试连通性';
      return;
    }

    const config = {
      type: vectorStoreType.value,
      url: vectorUrl.value.trim(),
      apiKey: vectorApiKey.value.trim(),
      collection: vectorCollection.value.trim() || 'ai_chat_vectors'
    };

    // 2. 检查并申请 host 权限（若无权限则弹窗，popup 可能因此关闭，但配置已保存）
    if (config.type !== 'local') {
      const origin = urlToOrigin(config.url);
      if (!origin) {
        showToast('服务地址格式不正确', true);
        testVectorConnectionBtn.disabled = false;
        testVectorConnectionBtn.textContent = '测试连通性';
        return;
      }
      const has = await new Promise((r) => chrome.permissions.contains({ origins: [`${origin}/*`] }, r));
      if (!has) {
        // 弹窗申请：用户允许则继续测试；拒绝则提示后返回
        const granted = await ensureHostPermission(config.url);
        if (!granted) {
          showToast('未授予该域访问权限，无法测试连通性（配置已保存，可稍后再试）', true);
          testVectorConnectionBtn.disabled = false;
          testVectorConnectionBtn.textContent = '测试连通性';
          return;
        }
      }
    }

    // 3. 发起测试请求
    try {
      const resp = await sendMessage({ type: 'TEST_VECTOR_CONNECTION', config });
      if (resp && resp.success) {
        const countText = (resp.count === null || resp.count === undefined)
          ? ''
          : `，向量 ${resp.count} 条`;
        showToast(`连通性测试成功！耗时 ${resp.latency}ms${countText}`);
      } else {
        showToast(`连通性测试失败: ${resp?.error || '未知错误'}`, true);
      }
    } catch (e) {
      showToast(`测试异常: ${e.message}`, true);
    }
    testVectorConnectionBtn.disabled = false;
    testVectorConnectionBtn.textContent = '测试连通性';
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

  // ---- 清空所有对话 ----
  async function clearConversations() {
    if (!confirm('确定要清空所有对话记录吗？此操作不可撤销，关联的向量索引也会被删除。')) return;
    clearConversationsBtn.disabled = true;
    clearConversationsBtn.textContent = '清理中...';
    try {
      const resp = await sendMessage({ type: 'CLEAR_ALL_CONVERSATIONS' });
      if (resp && resp.success) {
        showToast(`已清空所有对话，共删除 ${resp.count} 条`);
        // 同步刷新向量库统计（对话连带向量已清空）
        await loadVectorStoreStats();
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

  // 从 URL 提取 origin（协议+主机+端口），如 "http://1.2.3.4:3000/rest/v1/x" → "http://1.2.3.4:3000"
  function urlToOrigin(rawUrl) {
    try {
      const u = new URL(rawUrl);
      return u.origin;
    } catch (e) {
      return null;
    }
  }

  // 确保扩展拥有目标域的 host 权限；已有则直接返回 true，否则弹窗申请
  // 必须在用户手势（如 click）上下文中调用，否则 chrome.permissions.request 会被拒绝
  async function ensureHostPermission(rawUrl) {
    const origin = urlToOrigin(rawUrl);
    if (!origin) return false;
    const pattern = `${origin}/*`;
    const already = await new Promise((resolve) => {
      chrome.permissions.contains({ origins: [pattern] }, resolve);
    });
    if (already) return true;
    return await new Promise((resolve) => {
      chrome.permissions.request({ origins: [pattern] }, (granted) => {
        resolve(!!granted);
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

  // ---- 存储位置信息相关 ----

  // 格式化字节数为人类可读
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  // 折叠/展开
  function toggleCollapse(headerEl, bodyEl) {
    headerEl.classList.toggle('collapsed');
    bodyEl.classList.toggle('collapsed');
  }

  // 加载存储信息
  async function loadStorageInfo() {
    const extIdEl = document.getElementById('storageExtensionId');
    const usageEl = document.getElementById('storageUsage');
    const dbDetailEl = document.getElementById('dbDetailContent');
    const filePathEl = document.getElementById('storageFilePath');

    extIdEl.textContent = '加载中...';
    usageEl.textContent = '加载中...';
    dbDetailEl.textContent = '加载中...';
    filePathEl.textContent = '加载中...';

    try {
      const resp = await sendMessage({ type: 'GET_STORAGE_INFO' });
      if (!resp || resp.error) {
        const msg = resp?.error || '获取失败';
        extIdEl.textContent = msg;
        usageEl.textContent = msg;
        dbDetailEl.textContent = msg;
        filePathEl.textContent = msg;
        return;
      }

      // 扩展 ID
      const extId = resp.extensionId || chrome.runtime.id || '(未知)';
      extIdEl.textContent = extId;

      // 估算占用
      if (resp.usage) {
        const used = formatBytes(resp.usage.usage);
        const quota = formatBytes(resp.usage.quota);
        const pct = resp.usage.quota > 0
          ? ((resp.usage.usage / resp.usage.quota) * 100).toFixed(1)
          : '?';
        usageEl.textContent = `已用 ${used} / 配额 ${quota}（${pct}%）`;
      } else {
        usageEl.textContent = '（当前环境不支持估算）';
      }

      // 数据库详情
      if (resp.databases && resp.databases.length > 0) {
        const rows = resp.databases.map(db => {
          const storeRows = (db.stores || [])
            .map(s => `    └─ ${s.name}: ${s.count} 条`)
            .join('\n');
          return `◆ ${db.name} (v${db.version})\n${storeRows || '    (无 store)'}`;
        });
        dbDetailEl.innerHTML = '';
        const pre = document.createElement('pre');
        pre.className = 'info-code-block';
        pre.textContent = rows.join('\n\n');
        dbDetailEl.appendChild(pre);
      } else {
        dbDetailEl.textContent = '（暂无数据库）';
      }

      // 文件路径（Windows 默认路径模板）
      const winPath = `%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\IndexedDB\\chrome-${extId}_0.indexeddb.leveldb\\`;
      filePathEl.textContent = winPath;
    } catch (e) {
      const msg = `加载失败: ${e.message}`;
      extIdEl.textContent = msg;
      usageEl.textContent = msg;
      dbDetailEl.textContent = msg;
      filePathEl.textContent = msg;
    }
  }

  // 复制扩展 ID
  async function copyExtensionId() {
    const extId = document.getElementById('storageExtensionId').textContent.trim();
    if (!extId || extId === '加载中...' || extId.startsWith('加载失败')) {
      showToast('扩展 ID 尚未加载', true);
      return;
    }
    try {
      await navigator.clipboard.writeText(extId);
      showToast(`已复制: ${extId}`);
    } catch (e) {
      // 降级方案
      const ta = document.createElement('textarea');
      ta.value = extId;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast(`已复制: ${extId}`);
      } catch (e2) {
        showToast('复制失败，请手动选择文本复制', true);
      }
      document.body.removeChild(ta);
    }
  }

  // 打开 chrome://extensions
  function openExtensionsPage() {
    chrome.tabs.create({ url: 'chrome://extensions/' });
  }

  // ---- 帮助弹窗 ----

  // 帮助文档缓存（避免重复 fetch）
  const helpCache = {};

  async function openHelp(type) {
    const info = VECTOR_HELP_MAP[type];
    if (!info) return;

    helpTitle.textContent = info.title;

    // 已缓存则直接使用
    if (helpCache[type]) {
      helpBody.innerHTML = helpCache[type];
      helpOverlay.classList.add('open');
      return;
    }

    // 加载中提示
    helpBody.innerHTML = '<p style="text-align:center;color:#6b7280;">加载中...</p>';
    helpOverlay.classList.add('open');

    try {
      const url = chrome.runtime.getURL(info.file);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const md = await resp.text();
      let html;
      if (typeof marked !== 'undefined') {
        html = marked.parse(md, { breaks: true, gfm: true });
      } else {
        // 降级：转义后用 <pre> 显示原始 markdown
        const div = document.createElement('div');
        div.textContent = md;
        html = `<pre style="white-space:pre-wrap;">${div.innerHTML}</pre>`;
      }
      helpCache[type] = html;
      helpBody.innerHTML = html;
    } catch (e) {
      helpBody.innerHTML = `<p style="color:#dc2626;">加载失败：${e.message}</p>
        <p>可直接打开 <code>${info.file}</code> 查看</p>`;
    }
  }

  function closeHelp() {
    helpOverlay.classList.remove('open');
  }

  // ---- 向量库数据管理相关 ----

  // 后端类型的中文显示
  const VENDOR_LABELS = {
    local: '本地 IndexedDB',
    chroma: 'ChromaDB',
    milvus: 'Milvus',
    pgvector: 'PostgreSQL + pgvector',
    pinecone: 'Pinecone',
    supabase: 'Supabase',
    qdrant: 'Qdrant'
  };

  // 加载向量库统计
  async function loadVectorStoreStats() {
    const backendLabelEl = document.getElementById('vectorBackendLabel');
    const countEl = document.getElementById('vectorCount');
    const remoteConfigGroup = document.getElementById('remoteConfigGroup');
    const remoteConfigContent = document.getElementById('remoteConfigContent');

    backendLabelEl.textContent = '加载中...';
    countEl.textContent = '加载中...';

    try {
      const resp = await sendMessage({ type: 'GET_VECTOR_STORE_STATS' });
      if (!resp || resp.error) {
        const msg = resp?.error || '获取失败';
        backendLabelEl.textContent = msg;
        countEl.textContent = msg;
        return;
      }

      // 后端名称
      const type = resp.backend || 'local';
      backendLabelEl.textContent = VENDOR_LABELS[type] || type;

      // Milvus 计数有分钟级延迟，显示提示
      const countHintEl = document.getElementById('vectorCountHint');
      if (countHintEl) countHintEl.style.display = (type === 'milvus') ? '' : 'none';

      // 向量条数
      if (resp.count === null || resp.count === undefined) {
        if (resp.error) {
          countEl.textContent = `无法获取（${resp.error}）`;
        } else if (!resp.configured) {
          countEl.textContent = '未配置（请在上方填写远程配置并保存）';
        } else {
          countEl.textContent = '当前后端不支持统计';
        }
      } else {
        countEl.textContent = `${resp.count} 条`;
      }

      // 远程配置详情（仅远程后端显示）
      if (type !== 'local' && resp.config) {
        remoteConfigGroup.style.display = '';
        remoteConfigContent.innerHTML = '';
        const lines = [
          `类型：${VENDOR_LABELS[resp.config.type] || resp.config.type || '-'}`
        ];
        if (resp.config.url) lines.push(`地址：${resp.config.url}`);
        if (resp.config.collection) lines.push(`集合/表名：${resp.config.collection}`);
        const pre = document.createElement('pre');
        pre.className = 'info-code-block';
        pre.textContent = lines.join('\n');
        remoteConfigContent.appendChild(pre);
      } else {
        remoteConfigGroup.style.display = 'none';
      }
    } catch (e) {
      const msg = `加载失败: ${e.message}`;
      backendLabelEl.textContent = msg;
      countEl.textContent = msg;
    }
  }

  // 清空当前向量库
  async function clearVectorStore() {
    // 先获取统计以确认当前后端和条数
    const stats = await sendMessage({ type: 'GET_VECTOR_STORE_STATS' });
    const type = stats?.backend || 'local';
    const count = stats?.count;
    const typeLabel = VENDOR_LABELS[type] || type;

    const countText = (count === null || count === undefined)
      ? ''
      : `（当前 ${count} 条）`;
    const warning = type === 'local'
      ? `确定要清空本地向量库${countText}吗？此操作不可撤销。`
      : `确定要清空远程 ${typeLabel} 向量库${countText}吗？\n\n这会删除远程服务器上该集合内的所有向量数据，操作不可撤销。`;

    if (!confirm(warning)) return;

    clearVectorStoreBtn.disabled = true;
    clearVectorStoreBtn.textContent = '清理中...';

    try {
      const resp = await sendMessage({ type: 'CLEAR_VECTOR_STORE' });
      if (resp && resp.success) {
        const text = resp.count !== null && resp.count !== undefined
          ? `已清空 ${typeLabel}，共删除 ${resp.count} 条`
          : `已清空 ${typeLabel}`;
        showToast(text);
        // 刷新统计
        await loadVectorStoreStats();
      } else {
        const errMsg = resp?.error || '未知错误';
        showToast(`清空失败: ${errMsg}`, true);
      }
    } catch (e) {
      showToast(`操作异常: ${e.message}`, true);
    }
    clearVectorStoreBtn.disabled = false;
    clearVectorStoreBtn.textContent = '清空当前向量库';
  }
});
