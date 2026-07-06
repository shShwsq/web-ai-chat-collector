// dom/doubao.js - 豆包 DOM提取适配器
//
// 限制说明：
// 1. 豆包使用虚拟滚动列表（v_list），DOM 中只保留当前可见的消息行。
//    长对话中滚出视图的消息会从 DOM 中移除，因此 DOM 模式可能无法提取完整对话。
// 2. 搜索来源（标题/URL/摘要）在 DOM 中不渲染，DOM 模式无法提取具体来源信息。
//    如需搜索来源，请使用网络模式。
// 3. 思考块默认折叠，仅展开时才能提取完整思考内容；折叠时只能拿到标题文本。
// 4. 标题依赖侧边栏已加载（#conversation_<id> 元素）。切换对话后若侧边栏未更新，标题可能短暂取错。

// 注册DOM适配器
if (typeof DOM_ADAPTERS === 'undefined') window.DOM_ADAPTERS = {};

DOM_ADAPTERS.doubao = {
  name: 'doubao',

  // 获取对话ID（从URL中提取）
  getConversationId: () => {
    const match = window.location.pathname.match(/\/chat\/(\d+)/);
    return match ? match[1] : 'default';
  },

  // 获取标题
  // 侧边栏每个对话项的 <a> 标签 id 形如 "conversation_<convId>"，与 URL 中的对话 ID 一致。
  // 当前激活对话还会带 aria-current="page"。优先用 ID 精确匹配，避免取到其他对话的标题。
  getTitle: () => {
    const convId = DOM_ADAPTERS.doubao.getConversationId();
    if (convId && convId !== 'default') {
      const item = document.getElementById(`conversation_${convId}`);
      if (item) {
        const titleEl = item.querySelector('[class*="overallTitle"]');
        if (titleEl) return titleEl.textContent.trim();
      }
    }
    // fallback 1: 激活状态匹配
    const activeItem = document.querySelector('a[aria-current="page"] [class*="overallTitle"], [class*="active-link"] [class*="overallTitle"]');
    if (activeItem) return activeItem.textContent.trim();
    // fallback 2: <title> 标签（格式通常为 "对话标题 - 豆包"）
    const titleEl = document.querySelector('title');
    if (titleEl) {
      const raw = titleEl.textContent.trim();
      return raw.replace(/\s*[-—]\s*豆包\s*$/, '');
    }
    return '';
  },

  // 从DOM提取消息
  extractMessages: () => {
    const messages = [];

    // 消息列表容器（无 hash 后缀，稳定）
    const container = document.querySelector('.list_items');
    if (!container) {
      console.log('[Doubao/DOM] 未找到 .list_items 容器');
      return messages;
    }

    // 真实消息行：带 data-observe-row 属性的元素（首尾的指示器行无此属性）
    const rows = container.querySelectorAll('[data-observe-row]');
    console.log(`[Doubao/DOM] 找到 ${rows.length} 个消息行`);

    for (const row of rows) {
      const role = DOM_ADAPTERS.doubao._getRole(row);
      const content = DOM_ADAPTERS.doubao._extractContent(row, role);
      if (content) {
        messages.push({
          role: role,
          content: content,
          timestamp: new Date().toISOString()
        });
      }
    }

    console.log(`[Doubao/DOM] 共提取 ${messages.length} 条消息`);
    return messages;
  },

  // 获取角色
  // 判断依据（按可靠性排序）：
  // 1. 含 thinking-box-root → 助手（启用了深度思考）
  // 2. 含 iconContainer 类（豆包头像容器，仅助手消息渲染）→ 助手
  // 3. 否则 → 用户
  _getRole: (el) => {
    if (el.querySelector('[class*="thinking-box-root"], [data-thinking-box]')) {
      return 'assistant';
    }
    if (el.querySelector('[class*="iconContainer"]')) {
      return 'assistant';
    }
    return 'user';
  },

  // 提取消息内容
  _extractContent: (el, role) => {
    if (role === 'assistant') {
      return DOM_ADAPTERS.doubao._extractAssistantContent(el);
    }
    return DOM_ADAPTERS.doubao._extractUserContent(el);
  },

  // 提取用户消息内容
  _extractUserContent: (el) => {
    // 用户消息从 md-box-root 提取文本
    const mdBox = el.querySelector('.md-box-root');
    if (mdBox) return mdBox.textContent.trim();
    return el.textContent.trim();
  },

  // 提取助手消息内容（思考 + 回答）
  _extractAssistantContent: (el) => {
    let thinking = '';
    let answer = '';

    // 1. 提取思考内容
    const thinkingRoot = el.querySelector('[class*="thinking-box-root"]');
    if (thinkingRoot) {
      let thinkText = thinkingRoot.textContent.trim();
      // 去掉开头的标题 "已完成思考，参考 X 篇资料"（折叠状态下只有这个标题）
      thinkText = thinkText.replace(/^已完成思考[，,]\s*参考\s*\d+\s*篇资料\s*/, '');
      // 去掉结尾的 "已完成" 标记
      thinkText = thinkText.replace(/\s*已完成\s*$/, '');
      thinking = thinkText.trim();
    }

    // 2. 提取回答正文：找到不在 thinking-box-root 内的 md-box-root
    const allMdBoxes = el.querySelectorAll('.md-box-root');
    for (const md of allMdBoxes) {
      if (md.closest('[class*="thinking-box-root"]')) continue;
      answer = md.textContent.trim();
      break;
    }

    // 3. 拼接为标准格式（与网络适配器一致）
    let fullContent = '';
    if (thinking) fullContent += `<think>\n${thinking}\n</think>\n\n`;
    fullContent += answer;
    return fullContent.trim();
  }
};
