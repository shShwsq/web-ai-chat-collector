// dom/deepseek.js - DeepSeek DOM提取适配器

// 注册DOM适配器
if (typeof DOM_ADAPTERS === 'undefined') window.DOM_ADAPTERS = {};

DOM_ADAPTERS.deepseek = {
  name: 'deepseek',
  
  // 获取对话ID
  getConversationId: () => {
    const match = window.location.pathname.match(/\/chat\/(.+)/);
    return match ? match[1] : 'default';
  },
  
  // 获取标题
  getTitle: () => {
    const el = document.querySelector('title, h1, [class*="chat-title"], [class*="conversation-title"]');
    return el ? el.textContent.trim() : '';
  },
  
  // 从DOM提取消息
  extractMessages: () => {
    const messages = [];
    
    const container = document.querySelector('.ds-virtual-list-visible-items');
    if (!container) {
      console.log('[DeepSeek/DOM] 未找到消息列表容器');
      return messages;
    }
    
    const msgElements = container.querySelectorAll('.ds-message');
    console.log(`[DeepSeek/DOM] 找到 ${msgElements.length} 个消息元素`);
    
    for (const el of msgElements) {
      const role = DOM_ADAPTERS.deepseek._getRole(el);
      const content = DOM_ADAPTERS.deepseek._extractText(el);
      
      if (content) {
        messages.push({
          role: role,
          content: content,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    console.log(`[DeepSeek/DOM] 共提取 ${messages.length} 条消息`);
    return messages;
  },
  
  // 提取文本
  _extractText: (el) => {
    const mainContent = el.querySelector('.ds-assistant-message-main-content');
    if (mainContent) {
      let fullText = '';
      const children = el.children;
      if (children.length >= 2) {
        const thinkingEl = children[0];
        const thinkingText = thinkingEl.textContent.trim();
        if (thinkingText.includes('已思考') || thinkingText.includes('思考')) {
          fullText = `<think>\n${thinkingText}\n</think>\n\n${mainContent.textContent.trim()}`;
        } else {
          fullText = mainContent.textContent.trim();
        }
      } else {
        fullText = mainContent.textContent.trim();
      }
      return fullText;
    }
    return el.textContent.trim();
  },
  
  // 获取角色
  _getRole: (el) => {
    if (el.querySelector('.ds-assistant-message-main-content, .ds-markdown')) return 'assistant';
    return 'user';
  }
};
