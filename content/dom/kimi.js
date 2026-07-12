// dom/kimi.js - Kimi DOM 提取适配器
// 依赖：adapter-registry.js（DOM_ADAPTERS）
//
// Kimi 对话流走 WebSocket + protobuf，网络拦截不可行，采用 DOM 提取模式。
//
// DOM 结构（基于实际抓包确认）:
//   .chat-detail-content
//     .chat-content-item.chat-content-item-user        用户消息
//       .segment.segment-user > .segment-content > .segment-content-box
//         .markdown-container > .markdown > .paragraph
//     .chat-content-item.chat-content-item-assistant   助手消息
//       .segment.segment-assistant > .segment-content
//         .segment-assistant-actions                   操作按钮（含"思考已完成"，需跳过）
//         .toolcall-container > .toolcall-content       思考内容
//           .markdown-container > .markdown > .paragraph
//         .segment-content-box                         正式回答
//           .markdown-container > .markdown > .paragraph

if (typeof DOM_ADAPTERS === 'undefined') window.DOM_ADAPTERS = {};

// 助手消息内容拼接（与 network/common.js 中的 buildAssistantContent 一致）
// Kimi 不加载 network/common.js，所以这里内联一份（无搜索结果，只有思考+回答）
function _buildKimiAssistantContent(thinking, answer) {
  let fullContent = '';
  if (thinking) fullContent += `<think>\n${thinking.trim()}\n</think>\n\n`;
  if (answer) fullContent += answer;
  return fullContent.trim();
}

DOM_ADAPTERS.kimi = {
  name: 'kimi',

  // 从 URL 提取对话 ID
  // URL 格式: https://www.kimi.com/chat/{uuid}?chat_enter_method=history
  //   也可能仅出现 uuid 段（无 /chat/ 前缀）: https://www.kimi.com/{uuid}?...
  getConversationId: () => {
    const path = window.location.pathname;
    let match = path.match(/\/chat\/([a-f0-9\-]+)/i);
    if (!match) match = path.match(/\/([a-f0-9]{8,}\-[a-f0-9\-]+)/i);
    const id = match ? match[1] : 'default';
    console.log('[Kimi/DOM] getConversationId: path=%s → %s', path, id);
    return id;
  },

  // 获取标题（document.title 格式为 "对话标题 - Kimi"）
  getTitle: () => {
    const raw = document.title || '';
    return raw.replace(/\s*[-–—]\s*Kimi\s*$/i, '').trim() || '未命名对话';
  },

  // 从 DOM 提取消息
  extractMessages: () => {
    const messages = [];

    const container = document.querySelector('.chat-detail-content');
    if (!container) {
      // 兜底：尝试更宽泛的容器
      const fallback = document.querySelector('.chat-detail-main') || document.querySelector('[class*="chat-content"]');
      console.log('[Kimi/DOM] 未找到 .chat-detail-content；fallback=%o', fallback);
      return messages;
    }

    // 注意：Kimi 的 .chat-content-item 不一定是 .chat-detail-content 的直接子元素
    // 中间可能有 wrapper（如 .chat-content-list），所以不用 :scope >
    const msgElements = container.querySelectorAll('.chat-content-item');
    console.log('[Kimi/DOM] 容器=%s, 找到 %d 个 .chat-content-item', container.className, msgElements.length);

    if (msgElements.length === 0) {
      // 打印第一个直接子元素完整信息，帮助定位结构
      const firstChild = container.firstElementChild;
      if (firstChild) {
        console.log('[Kimi/DOM] 容器第1个子元素: <%s class="%s"> children=%d textLen=%d',
          firstChild.tagName.toLowerCase(), firstChild.className,
          firstChild.children.length, (firstChild.textContent || '').length);
        console.log('[Kimi/DOM]   outerHTML预览: %s', firstChild.outerHTML.substring(0, 300));
        // 再往下一层看看
        const grandChild = firstChild.firstElementChild;
        if (grandChild) {
          console.log('[Kimi/DOM]   孙元素: <%s class="%s"> children=%d',
            grandChild.tagName.toLowerCase(), grandChild.className, grandChild.children.length);
        }
      }
      // 全局搜索一次，看 .chat-content-item 在不在别处
      const global = document.querySelectorAll('.chat-content-item');
      console.log('[Kimi/DOM] 全局搜索 .chat-content-item: %d 个', global.length);
    }

    for (const el of msgElements) {
      const isUser = el.classList.contains('chat-content-item-user');
      const isAssistant = el.classList.contains('chat-content-item-assistant');
      if (!isUser && !isAssistant) {
        console.log('[Kimi/DOM] 跳过非消息项: class=%s', el.className);
        continue;
      }

      const role = isUser ? 'user' : 'assistant';
      console.log('[Kimi/DOM] 处理 %s 消息: class=%s', role, el.className);
      const content = isUser
        ? DOM_ADAPTERS.kimi._extractUserContent(el)
        : DOM_ADAPTERS.kimi._extractAssistantContent(el);

      console.log('[Kimi/DOM]   提取内容长度=%d, 预览=%s', (content||'').length, (content||'').substring(0, 100));

      if (content && content.trim()) {
        messages.push({
          role: role,
          content: content.trim(),
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('[Kimi/DOM]   ⚠️ 内容为空');
      }
    }

    console.log('[Kimi/DOM] 共提取 %d 条消息', messages.length);
    return messages;
  },

  // 提取用户消息内容
  // 用户消息结构: .segment.segment-user > .segment-content > .segment-content-box > .markdown-container > .markdown
  _extractUserContent: (el) => {
    const markdownEl = el.querySelector('.markdown-container .markdown') ||
                       el.querySelector('.markdown');
    console.log('[Kimi/DOM] _extractUserContent: markdownEl=%o', markdownEl);
    if (markdownEl) {
      return DOM_ADAPTERS.kimi._extractMarkdownText(markdownEl);
    }
    // 兜底:从 segment-content 取文本，但移除操作按钮（编辑/复制/分享等）
    const segContent = el.querySelector('.segment-content');
    console.log('[Kimi/DOM] _extractUserContent fallback: segContent=%o', segContent);
    if (segContent) {
      const clone = segContent.cloneNode(true);
      // 移除已知的操作按钮容器和带 action 性质的元素
      clone.querySelectorAll('[class*="action"], [class*="toolbar"], [class*="button"], button, .segment-assistant-actions').forEach(n => n.remove());
      const text = clone.textContent.trim();
      console.log('[Kimi/DOM] _extractUserContent fallback 文本(清理后): "%s"', text);
      return text;
    }
    return el.textContent.trim();
  },

  // 提取助手消息内容（分离思考与回答）
  // 助手消息结构:
  //   .segment.segment-assistant > .segment-content
  //     .segment-assistant-actions (跳过)
  //     .toolcall-container > .toolcall-content (思考)
  //     .segment-content-box (回答)
  _extractAssistantContent: (el) => {
    let thinking = '';
    let answer = '';

    // 思考内容: .toolcall-container 下的 markdown
    const toolcallMarkdowns = el.querySelectorAll('.toolcall-container .markdown-container .markdown');
    console.log('[Kimi/DOM] _extractAssistantContent: toolcallMarkdowns=%d', toolcallMarkdowns.length);
    if (toolcallMarkdowns.length > 0) {
      thinking = Array.from(toolcallMarkdowns)
        .map(m => DOM_ADAPTERS.kimi._extractMarkdownText(m))
        .filter(t => t.trim())
        .join('\n\n');
    }

    // 正式回答: .segment-content-box 下的 markdown（排除 toolcall 内的）
    const answerMarkdowns = el.querySelectorAll('.segment-content-box .markdown-container .markdown');
    console.log('[Kimi/DOM] _extractAssistantContent: answerMarkdowns=%d, thinking长度=%d', answerMarkdowns.length, thinking.length);
    if (answerMarkdowns.length > 0) {
      answer = Array.from(answerMarkdowns)
        .map(m => DOM_ADAPTERS.kimi._extractMarkdownText(m))
        .filter(t => t.trim())
        .join('\n\n');
    }

    // 兜底:若无 segment-content-box，取 segment-content 下非 toolcall/非 actions 的 markdown
    if (!answer) {
      const segContent = el.querySelector('.segment-content');
      if (segContent) {
        const allMarkdowns = segContent.querySelectorAll(':scope .markdown-container .markdown');
        for (const m of allMarkdowns) {
          // 跳过 toolcall 内的（已作为 thinking 提取）
          if (m.closest('.toolcall-container')) continue;
          const t = DOM_ADAPTERS.kimi._extractMarkdownText(m);
          if (t.trim()) {
            answer = answer ? answer + '\n\n' + t : t;
          }
        }
      }
    }

    // 最终兜底:取整个 segment-content 文本
    if (!answer && !thinking) {
      const segContent = el.querySelector('.segment-content');
      if (segContent) {
        // 移除 actions 按钮文本（如"思考已完成"）
        const clone = segContent.cloneNode(true);
        clone.querySelectorAll('.segment-assistant-actions').forEach(n => n.remove());
        answer = clone.textContent.trim();
      }
    }

    // 清理"思考已完成"等噪声文本
    thinking = thinking.replace(/思考已完成\s*/g, '').trim();
    answer = answer.replace(/思考已完成\s*/g, '').trim();

    // 拼接为标准格式（与 network 模式一致，使用  风格包裹思考）
    console.log('[Kimi/DOM] _extractAssistantContent 完成: thinking=%d字, answer=%d字', thinking.length, answer.length);
    return _buildKimiAssistantContent(thinking, answer);
  },

  // 从 .markdown 元素提取纯文本
  // 保留段落分隔（\n\n），列表项用换行，去除 SVG/动画 CSS 噪声
  _extractMarkdownText: (markdownEl) => {
    if (!markdownEl) return '';

    // 克隆后移除噪声元素
    const clone = markdownEl.cloneNode(true);
    clone.querySelectorAll('style, svg, .iconify').forEach(n => n.remove());

    // 按段落提取（只取顶层 block，避免嵌套重复）
    const paragraphs = [];
    const allBlocks = clone.querySelectorAll('.paragraph, pre, code, li, blockquote, table');
    for (const block of allBlocks) {
      // 跳过嵌套 block（父级也是这些标签的）
      if (block.parentElement && block.parentElement.closest('.paragraph, pre, code, li, blockquote, table')) continue;
      const text = block.textContent.trim();
      if (text) paragraphs.push(text);
    }

    // 如果没有 .paragraph 结构，直接取 textContent
    if (paragraphs.length === 0) {
      return clone.textContent.trim();
    }

    // 去重（处理嵌套情况）
    const seen = new Set();
    const unique = [];
    for (const p of paragraphs) {
      if (!seen.has(p)) {
        seen.add(p);
        unique.push(p);
      }
    }
    return unique.join('\n\n');
  }
};
