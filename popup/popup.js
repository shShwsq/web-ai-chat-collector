// popup.js

document.addEventListener('DOMContentLoaded', () => {
  const conversationList = document.getElementById('conversationList');
  const platformFilter = document.getElementById('platformFilter');
  const exportAllBtn = document.getElementById('exportAllBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const statusEl = document.getElementById('status');
  const viewerOverlay = document.getElementById('viewerOverlay');
  const viewerTitle = document.getElementById('viewerTitle');
  const viewerBody = document.getElementById('viewerBody');
  const viewerClose = document.getElementById('viewerClose');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const settingsBtn = document.getElementById('settingsBtn');

  // 当前搜索关键词
  let currentSearchQuery = '';

  // 加载状态
  loadStatus();
  // 加载对话列表
  loadConversations();

  // 事件绑定
  platformFilter.addEventListener('change', loadConversations);
  exportAllBtn.addEventListener('click', handleExportAll);
  refreshBtn.addEventListener('click', () => {
    loadConversations();
    loadStatus();
  });

  settingsBtn.addEventListener('click', () => {
    window.location.href = 'settings.html';
  });

  // 搜索
  searchBtn.addEventListener('click', handleSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearch();
  });
  // 清空搜索时恢复列表
  searchInput.addEventListener('input', () => {
    if (!searchInput.value.trim() && currentSearchQuery) {
      currentSearchQuery = '';
      loadConversations();
    }
  });

  // 查看器关闭
  viewerClose.addEventListener('click', closeViewer);
  viewerOverlay.addEventListener('click', (e) => {
    if (e.target === viewerOverlay) closeViewer();
  });

  async function loadStatus() {
    const response = await sendMessage({ type: 'GET_STATUS' });
    if (response) {
      statusEl.textContent = `${response.totalConversations} 条对话 · ${response.totalMessages} 条消息`;
      updatePlatformFilter(response.platforms);
    }
  }

  function updatePlatformFilter(platforms) {
    const current = platformFilter.value;
    const options = ['<option value="">全部平台</option>'];
    const platformNames = {
      deepseek: 'DeepSeek',
      chatgpt: 'ChatGPT',
      claude: 'Claude',
      kimi: 'Kimi',
      qianwen: '千问',
      yiyan: '文心一言'
    };

    for (const p of platforms) {
      const label = platformNames[p] || p;
      options.push(`<option value="${p}">${label}</option>`);
    }
    platformFilter.innerHTML = options.join('');
    platformFilter.value = current;
  }

  async function loadConversations() {
    const platform = platformFilter.value;
    
    let response;
    if (currentSearchQuery) {
      response = await sendMessage({
        type: 'SEARCH_CONVERSATIONS',
        query: currentSearchQuery,
        filters: platform ? { platform } : {}
      });
    } else {
      response = await sendMessage({
        type: 'GET_CONVERSATIONS',
        filters: platform ? { platform } : {}
      });
    }

    if (!response || response.length === 0) {
      conversationList.innerHTML = '<div class="empty-state">暂无对话记录<br><small>打开 AI 平台开始对话，数据将自动采集</small></div>';
      return;
    }

    conversationList.innerHTML = '';
    for (const conv of response) {
      conversationList.appendChild(createConvItem(conv));
    }
  }

  function createConvItem(conv) {
    const div = document.createElement('div');
    div.className = 'conv-item';
    div.dataset.id = conv.id;

    const platformNames = {
      deepseek: 'DeepSeek',
      chatgpt: 'ChatGPT',
      claude: 'Claude',
      kimi: 'Kimi',
      qianwen: '千问',
      yiyan: '文心一言'
    };

    const date = new Date(conv.updatedAt).toLocaleDateString('zh-CN');
    const platformLabel = platformNames[conv.platform] || conv.platform;

    div.innerHTML = `
      <div class="conv-header">
        <div class="conv-title" title="${conv.title}">${conv.title}</div>
        <span class="conv-platform">${platformLabel}</span>
      </div>
      <div class="conv-meta">
        <span class="conv-messages-count">${conv.messages.length} 条消息</span>
        <span>${date}</span>
      </div>
      <div class="conv-messages-preview">
        ${conv.messages.slice(0, 6).map(m => `
          <div class="msg-preview ${m.role}">
            <div class="msg-role">${m.role === 'user' ? '用户' : '助手'}</div>
            <div class="msg-text">${escapeHtml(m.content)}</div>
          </div>
        `).join('')}
        ${conv.messages.length > 6 ? `<div style="text-align:center;color:#9ca3af;font-size:11px;">还有 ${conv.messages.length - 6} 条消息...</div>` : ''}
      </div>
      <div class="conv-actions">
        <button class="btn btn-view" data-id="${conv.id}">查看</button>
        <button class="btn btn-primary export-btn" data-id="${conv.id}">导出 Markdown</button>
        <button class="btn export-json-btn" data-id="${conv.id}">导出 JSON</button>
        <button class="btn btn-danger delete-btn" data-id="${conv.id}">删除</button>
      </div>
    `;

    // 点击展开/收起
    div.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      div.classList.toggle('expanded');
    });

    // 查看完整对话
    div.querySelector('.btn-view').addEventListener('click', async (e) => {
      e.stopPropagation();
      openViewer(conv);
    });

    // 导出 Markdown
    div.querySelector('.export-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      await sendMessage({ type: 'EXPORT_CONVERSATION', id: conv.id, format: 'markdown' });
    });

    // 导出 JSON
    div.querySelector('.export-json-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      await sendMessage({ type: 'EXPORT_CONVERSATION', id: conv.id, format: 'json' });
    });

    // 删除
    div.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`确定删除「${conv.title}」？`)) {
        await sendMessage({ type: 'DELETE_CONVERSATION', id: conv.id });
        loadConversations();
        loadStatus();
      }
    });

    return div;
  }

  async function handleExportAll() {
    const format = confirm('点击"确定"导出为 Markdown，点击"取消"导出为 JSON') ? 'markdown' : 'json';
    await sendMessage({ type: 'EXPORT_ALL', format });
  }

  async function handleSearch() {
    const query = searchInput.value.trim();
    currentSearchQuery = query;
    await loadConversations();
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        resolve(response);
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== 完整对话查看器 =====
  function openViewer(conv) {
    viewerTitle.textContent = conv.title || '未命名对话';
    viewerBody.innerHTML = conv.messages.map(m => {
      const contentHtml = renderViewerContent(m.content);
      return `<div class="v-msg ${m.role}">
        <div class="v-role">${m.role === 'user' ? '用户' : '助手'}</div>
        <div class="v-content">${contentHtml}</div>
      </div>`;
    }).join('');
    viewerOverlay.classList.add('open');
  }

  function closeViewer() {
    viewerOverlay.classList.remove('open');
  }

  function renderViewerContent(content) {
    if (!content) return '';

    // 先提取 <think> 和 <search_result> 块，用占位符替换
    const blocks = [];
    let processed = content;

    // 提取 <think>...</think>
    processed = processed.replace(/<think>\n?([\s\S]*?)\n?<\/think>/g, (_, text) => {
      const idx = blocks.length;
      blocks.push({ type: 'think', content: text.trim() });
      return `\n%%BLOCK_${idx}%%\n`;
    });

    // 提取 <search_result>...</search_result>
    processed = processed.replace(/<search_result>\n?([\s\S]*?)\n?<\/search_result>/g, (_, text) => {
      const idx = blocks.length;
      blocks.push({ type: 'search', content: text.trim() });
      return `\n%%BLOCK_${idx}%%\n`;
    });

    // 提取数学公式（在 marked 之前处理，避免 marked 破坏公式）
    // 行间公式 $$...$$
    processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
      const idx = blocks.length;
      blocks.push({ type: 'math_display', content: math.trim() });
      return `\n%%BLOCK_${idx}%%\n`;
    });
    // 行内公式 $...$（不匹配 $$）
    processed = processed.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
      const idx = blocks.length;
      blocks.push({ type: 'math_inline', content: math.trim() });
      return `%%BLOCK_${idx}%%`;
    });

    // 用 marked 渲染 Markdown
    let html = '';
    if (typeof marked !== 'undefined') {
      html = marked.parse(processed, { breaks: true, gfm: true });
    } else {
      html = escapeHtml(processed).replace(/\n/g, '<br>');
    }

    // 还原占位符
    html = html.replace(/%%BLOCK_(\d+)%%/g, (_, idx) => {
      const block = blocks[parseInt(idx)];
      if (!block) return '';

      if (block.type === 'math_display') {
        return renderMath(block.content, true);
      }
      if (block.type === 'math_inline') {
        return renderMath(block.content, false);
      }

      // think / search 块内内容也用 marked 渲染
      let inner = '';
      if (typeof marked !== 'undefined') {
        inner = marked.parse(block.content, { breaks: true, gfm: true });
      } else {
        inner = escapeHtml(block.content).replace(/\n/g, '<br>');
      }
      if (block.type === 'think') {
        return `<div class="think-block"><div class="collapsible-header collapsed" onclick="this.classList.toggle('collapsed');this.nextElementSibling.classList.toggle('collapsed')"><span class="arrow">▼</span>思考过程</div><div class="collapsible-body collapsed">${inner}</div></div>`;
      } else if (block.type === 'search') {
        return `<div class="search-block"><div class="collapsible-header collapsed" onclick="this.classList.toggle('collapsed');this.nextElementSibling.classList.toggle('collapsed')"><span class="arrow">▼</span>搜索来源</div><div class="collapsible-body collapsed">${inner}</div></div>`;
      }
      return inner;
    });

    return html;
  }

  function renderMath(tex, displayMode) {
    if (typeof katex !== 'undefined') {
      try {
        return katex.renderToString(tex, { displayMode, throwOnError: false });
      } catch (e) {
        // KaTeX 渲染失败，显示原始公式
      }
    }
    // 降级：显示原始 LaTeX
    const escaped = escapeHtml(tex);
    if (displayMode) {
      return `<div class="math-block">$$${escaped}$$</div>`;
    }
    return `<span class="math-inline">$${escaped}$</span>`;
  }
});
