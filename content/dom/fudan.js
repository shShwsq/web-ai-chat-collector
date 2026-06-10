// dom/fudan.js - 复旦 AI Agent DOM提取适配器

// 注册DOM适配器
if (typeof DOM_ADAPTERS === 'undefined') window.DOM_ADAPTERS = {};

DOM_ADAPTERS.fudan = {
  name: 'fudan',

  // 获取对话ID
  getConversationId: () => {
    const urlParams = new URLSearchParams(window.location.search);
    const sessId = urlParams.get('sess_id');
    if (sessId) return sessId;
    return 'default';
  },

  // 获取标题
  getTitle: () => {
    const activeSession = document.querySelector('.session.active_session');
    console.log('[Fudan/DOM] getTitle: .session.active_session=', activeSession ? `text="${activeSession.textContent.trim().substring(0,50)}"` : 'null');
    if (activeSession) {
      const text = activeSession.textContent.trim();
      if (text) return text;
    }
    const el = document.querySelector('title');
    console.log('[Fudan/DOM] getTitle: fallback title=', el ? `"${el.textContent.trim().substring(0,50)}"` : 'null');
    if (el) return el.textContent.trim();
    return '';
  },

  // 从DOM提取消息
  extractMessages: () => {
    const messages = [];

    const messageList = document.querySelector('.message_list');
    if (!messageList) {
      return messages;
    }

    const items = messageList.querySelectorAll('.message_item');
    if (items.length === 0) {
      return messages;
    }

    for (const item of items) {
      const userText = item.querySelector('.text.myQuestion, .text.q');
      const assistantText = item.querySelector('.text.a');

      if (userText) {
        const content = DOM_ADAPTERS.fudan._extractTextContent(userText);
        if (content) {
          messages.push({ role: 'user', content, timestamp: new Date().toISOString() });
        }
      } else if (assistantText) {
        const msg = DOM_ADAPTERS.fudan._extractAssistantMessage(assistantText);
        if (msg) messages.push(msg);
      }
    }

    return messages;
  },

  // 提取文本内容（用户消息）
  _extractTextContent: (el) => {
    const contentEl = el.querySelector('.content');
    if (contentEl) return contentEl.innerText.trim();
    return el.innerText.trim();
  },

  // 提取助手消息（包含思考、搜索来源、回答）
  _extractAssistantMessage: (textEl) => {
    let thinking = '';
    let search = '';
    let answer = '';

    // 1. 提取思考内容: .md-editor.think .md-editor-preview
    const thinkPreview = textEl.querySelector('.md-editor.think .md-editor-preview');
    if (thinkPreview) {
      thinking = thinkPreview.innerText.trim();
    }

    // 2. 提取搜索来源: .md-editor.siteSearch .md-editor-preview
    const searchPreview = textEl.querySelector('.md-editor.siteSearch .md-editor-preview');
    if (searchPreview) {
      search = searchPreview.innerText.trim();
    }

    // 3. 提取正式回答: .md-editor.answer .md-editor-preview
    const answerPreview = textEl.querySelector('.md-editor.answer .md-editor-preview');
    if (answerPreview) {
      answer = answerPreview.innerText.trim();
    } else {
      // 备选：从 .content 提取（无思考/搜索的简单回答）
      const contentEl = textEl.querySelector('.content');
      if (contentEl) {
        answer = contentEl.innerText.trim();
      }
    }

    // 构建完整内容
    let fullContent = '';
    if (thinking) {
      fullContent += `<think\n${thinking}\n</think\n\n\n`;
    }
    if (search) {
      fullContent += `<search_result>\n${search}\n</search_result>\n\n`;
    }
    if (answer) {
      fullContent += answer;
    }

    if (!fullContent.trim()) return null;

    return {
      role: 'assistant',
      content: fullContent.trim(),
      timestamp: new Date().toISOString()
    };
  }
};
