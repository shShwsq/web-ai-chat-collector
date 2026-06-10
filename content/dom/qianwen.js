// dom/qianwen.js - 通义千问 DOM提取适配器

// 注册DOM适配器
if (typeof DOM_ADAPTERS === 'undefined') window.DOM_ADAPTERS = {};

DOM_ADAPTERS.qianwen = {
  name: 'qianwen',
  
  // 获取对话ID
  getConversationId: () => {
    const match = window.location.pathname.match(/\/chat\/(.+)/);
    if (match) return match[1];
    return 'default';
  },
  
  // 获取标题
  getTitle: () => {
    const activeItems = document.querySelectorAll('[class*="!bg-option"]');
    for (const item of activeItems) {
      const titleEl = item.querySelector('.text-ellipsis.whitespace-nowrap.overflow-hidden');
      if (titleEl && titleEl.textContent.trim()) {
        return titleEl.textContent.trim();
      }
    }
    const el = document.querySelector('title');
    if (el) {
      return el.textContent.replace(' - 千问', '').replace(' - 阿里AI助手', '').trim();
    }
    return '';
  },
  
  // 从DOM提取消息
  extractMessages: () => {
    const messages = [];
    
    const messageList = document.querySelector('#message-list-scroller');
    if (!messageList) {
      console.log('[Qianwen/DOM] 未找到消息列表容器');
      return messages;
    }
    
    // 查找所有对话轮次
    const chatRounds = messageList.querySelectorAll('.chat-round');
    
    if (chatRounds.length === 0) {
      // 备选：直接查找消息卡片
      const questionCards = messageList.querySelectorAll('.chat-question-card-wrap');
      const answerCards = messageList.querySelectorAll('.chat-answers-card-wrap');
      
      questionCards.forEach(card => {
        const text = DOM_ADAPTERS.qianwen._extractUserMessage(card);
        if (text) {
          messages.push({ role: 'user', content: text, timestamp: new Date().toISOString() });
        }
      });
      
      answerCards.forEach(card => {
        const msg = DOM_ADAPTERS.qianwen._extractAssistantMessage(card);
        if (msg) messages.push(msg);
      });
      
      return messages;
    }
    
    // 按轮次提取
    for (const round of chatRounds) {
      const questionCard = round.querySelector('.chat-question-card-wrap');
      if (questionCard) {
        const text = DOM_ADAPTERS.qianwen._extractUserMessage(questionCard);
        if (text) {
          messages.push({ role: 'user', content: text, timestamp: new Date().toISOString() });
        }
      }
      
      const answerCard = round.querySelector('.chat-answers-card-wrap');
      if (answerCard) {
        const msg = DOM_ADAPTERS.qianwen._extractAssistantMessage(answerCard);
        if (msg) messages.push(msg);
      }
    }
    
    console.log(`[Qianwen/DOM] 共提取 ${messages.length} 条消息`);
    return messages;
  },
  
  // 提取用户消息
  _extractUserMessage: (el) => {
    const clone = el.cloneNode(true);
    const bottomArea = clone.querySelector('.qs-bottom, [class*="bottom"]');
    if (bottomArea) bottomArea.remove();
    let text = clone.innerText || clone.textContent || '';
    return text.replace(/\s+/g, ' ').trim();
  },
  
  // 提取助手消息（包含思考、搜索、回答）
  _extractAssistantMessage: (el) => {
    let content = '';
    let thinking = null;
    let search = null;
    
    // 1. 提取深度思考内容
    const deepThinkCard = el.querySelector('[data-card_name="deep_think"]');
    if (deepThinkCard) {
      const thinkingMarkdown = deepThinkCard.querySelector('.qk-markdown');
      if (thinkingMarkdown) {
        thinking = thinkingMarkdown.innerText.trim();
      }
    }
    
    // 2. 提取联网搜索内容
    const searchCard = el.querySelector('[data-card_name="search"], [class*="search-result"]');
    if (searchCard) {
      const searchMarkdown = searchCard.querySelector('.qk-markdown');
      if (searchMarkdown) {
        search = searchMarkdown.innerText.trim();
      }
    }
    
    // 3. 提取正式回答内容
    const allMarkdowns = el.querySelectorAll('.qk-markdown');
    const answerParts = [];
    
    for (const markdown of allMarkdowns) {
      if (deepThinkCard && deepThinkCard.contains(markdown)) continue;
      if (searchCard && searchCard.contains(markdown)) continue;
      const text = markdown.innerText.trim();
      if (text) answerParts.push(text);
    }
    
    content = answerParts.join('\n\n');
    
    // 备选
    if (!content) {
      const markdownSpecial = el.querySelector('.markdown-pc-special-class');
      if (markdownSpecial) {
        if (deepThinkCard && deepThinkCard.contains(markdownSpecial)) { /* skip */ }
        else if (searchCard && searchCard.contains(markdownSpecial)) { /* skip */ }
        else { content = markdownSpecial.innerText.trim(); }
      }
    }
    
    // 最后备选
    if (!content && !thinking && !search) {
      const clone = el.cloneNode(true);
      const bottomIcons = clone.querySelectorAll('[class*="bottom"], [class*="action"], [class*="toolbar"]');
      bottomIcons.forEach(icon => icon.remove());
      content = clone.innerText.trim();
    }
    
    // 构建完整内容
    let fullContent = '';
    if (thinking) {
      fullContent += `<think>\n${thinking}\n</think>\n\n`;
    }
    if (search) {
      fullContent += `<search_result>\n${search}\n</search_result>\n\n`;
    }
    if (content) {
      fullContent += content;
    }
    
    if (!fullContent.trim()) return null;
    
    return {
      role: 'assistant',
      content: fullContent.trim(),
      timestamp: new Date().toISOString()
    };
  }
};
