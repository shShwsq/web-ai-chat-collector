// content/ai-ball.js - AI 问答悬浮球 + 面板 UI

class AIBall {
  constructor() {
    this.ball = null;
    this.panel = null;
    this.isDragging = false;
    this.isPanelOpen = false;
    this.dragOffset = { x: 0, y: 0 };
    this.dragStartPos = { x: 0, y: 0 };
    this.hasMoved = false;
    this.currentTab = 'organize'; // organize | quiz | chat
    this.isGenerating = false;
    this._streamingContent = ''; // 流式累积内容
    this._streamRequestId = null; // 当前流式请求 ID

    // 等 DOM 就绪后再创建所有元素
    const init = () => {
      this.injectStyles();
      this.createBall();
      this.createPanel();
    };
    if (document.body) {
      init();
    } else {
      document.addEventListener('DOMContentLoaded', init);
    }
  }

  injectStyles() {
    if (document.getElementById('ai-ball-styles')) return;
    const style = document.createElement('style');
    style.id = 'ai-ball-styles';
    style.textContent = `
      #ai-qa-ball {
        position: fixed;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: linear-gradient(135deg, #7c3aed, #a855f7);
        box-shadow: 0 2px 12px rgba(124, 58, 237, 0.4);
        cursor: grab;
        z-index: 2147483645;
        display: flex;
        align-items: center;
        justify-content: center;
        user-select: none;
        transition: box-shadow 0.2s, transform 0.2s;
        right: 24px;
        bottom: 80px;
      }
      #ai-qa-ball:hover {
        box-shadow: 0 4px 20px rgba(124, 58, 237, 0.6);
        transform: scale(1.08);
      }
      #ai-qa-ball:active {
        cursor: grabbing;
      }
      #ai-qa-ball svg {
        width: 22px;
        height: 22px;
        fill: #fff;
        pointer-events: none;
      }
      #ai-qa-ball .loading-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #fff;
        animation: ai-ball-pulse 1.2s ease-in-out infinite;
      }
      @keyframes ai-ball-pulse {
        0%, 100% { opacity: 0.4; transform: scale(0.8); }
        50% { opacity: 1; transform: scale(1.2); }
      }

      #ai-qa-panel {
        position: fixed;
        width: 400px;
        max-height: 560px;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.18);
        z-index: 2147483644;
        display: none;
        flex-direction: column;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        color: #1a1a1a;
      }
      #ai-qa-panel.open {
        display: flex;
      }

      /* 面板头部 */
      #ai-qa-panel .qa-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: linear-gradient(135deg, #7c3aed, #a855f7);
        color: #fff;
        cursor: grab;
      }
      #ai-qa-panel .qa-header h2 {
        font-size: 14px;
        font-weight: 600;
        margin: 0;
      }
      #ai-qa-panel .qa-header .close-btn {
        background: none;
        border: none;
        color: #fff;
        font-size: 18px;
        cursor: pointer;
        padding: 0 4px;
        opacity: 0.8;
      }
      #ai-qa-panel .qa-header .close-btn:hover {
        opacity: 1;
      }
      #ai-qa-panel .qa-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      #ai-qa-panel .qa-header .history-btn {
        background: none;
        border: none;
        color: #fff;
        cursor: pointer;
        padding: 4px 6px;
        opacity: 0.8;
        border-radius: 4px;
        display: flex;
        align-items: center;
        transition: opacity 0.15s, background 0.15s;
      }
      #ai-qa-panel .qa-header .history-btn:hover {
        opacity: 1;
        background: rgba(255,255,255,0.15);
      }

      /* 主内容区 */
      #ai-qa-panel .qa-main {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }

      /* Tab 切换 */
      #ai-qa-panel .qa-tabs {
        display: flex;
        border-bottom: 1px solid #e5e7eb;
        background: #fafafa;
      }
      #ai-qa-panel .qa-tabs button {
        flex: 1;
        padding: 8px;
        border: none;
        background: none;
        font-size: 12px;
        cursor: pointer;
        color: #6b7280;
        border-bottom: 2px solid transparent;
        transition: all 0.15s;
      }
      #ai-qa-panel .qa-tabs button:hover {
        color: #7c3aed;
        background: #f5f3ff;
      }
      #ai-qa-panel .qa-tabs button.active {
        color: #7c3aed;
        border-bottom-color: #7c3aed;
        font-weight: 600;
      }

      /* 输入区域 */
      #ai-qa-panel .qa-input-area {
        padding: 12px;
        border-bottom: 1px solid #f0f0f0;
      }
      #ai-qa-panel .qa-input-area textarea {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        font-size: 13px;
        outline: none;
        color: #1a1a1a;
        background: #fff;
        resize: vertical;
        min-height: 60px;
        max-height: 120px;
        font-family: inherit;
      }
      #ai-qa-panel .qa-input-area textarea:focus {
        border-color: #7c3aed;
        box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.15);
      }
      #ai-qa-panel .qa-input-area textarea::placeholder {
        color: #9ca3af;
      }
      #ai-qa-panel .qa-input-area .qa-actions {
        display: flex;
        gap: 6px;
        margin-top: 8px;
        justify-content: flex-end;
      }
      #ai-qa-panel .qa-input-area .qa-actions button {
        padding: 6px 16px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;
      }
      #ai-qa-panel .qa-input-area .qa-actions .btn-send {
        background: #7c3aed;
        color: #fff;
      }
      #ai-qa-panel .qa-input-area .qa-actions .btn-send:hover {
        background: #6d28d9;
      }
      #ai-qa-panel .qa-input-area .qa-actions .btn-send:disabled {
        background: #c4b5fd;
        cursor: not-allowed;
      }
      #ai-qa-panel .qa-input-area .qa-actions .btn-export {
        background: #f3f4f6;
        color: #374151;
        border: 1px solid #e0e0e0;
      }
      #ai-qa-panel .qa-input-area .qa-actions .btn-export:hover {
        background: #e5e7eb;
      }

      /* 结果区域 */
      #ai-qa-panel .qa-result {
        flex: 1;
        overflow-y: auto;
        padding: 12px 16px;
        min-height: 0;
        line-height: 1.6;
      }
      #ai-qa-panel .qa-result .empty {
        text-align: center;
        padding: 40px 16px;
        color: #9ca3af;
        font-size: 13px;
      }
      #ai-qa-panel .qa-result .qa-msg {
        margin-bottom: 12px;
        padding: 10px 14px;
        border-radius: 8px;
      }
      #ai-qa-panel .qa-result .qa-msg.user {
        background: #f5f3ff;
        border-left: 3px solid #7c3aed;
      }
      #ai-qa-panel .qa-result .qa-msg.assistant {
        background: #f0fdf4;
        border-left: 3px solid #22c55e;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-role {
        font-weight: 600;
        font-size: 11px;
        margin-bottom: 4px;
        text-transform: uppercase;
      }
      #ai-qa-panel .qa-result .qa-msg.user .qa-msg-role {
        color: #7c3aed;
      }
      #ai-qa-panel .qa-result .qa-msg.assistant .qa-msg-role {
        color: #16a34a;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content {
        font-size: 13px;
        color: #1a1a1a;
        word-break: break-word;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content p { margin: 0 0 8px; }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content p:last-child { margin-bottom: 0; }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content pre {
        background: #1e293b;
        color: #e2e8f0;
        padding: 10px 12px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 6px 0;
        font-size: 11px;
        line-height: 1.5;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content code {
        background: #f1f5f9;
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 12px;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content pre code {
        background: none;
        padding: 0;
        color: inherit;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content strong {
        color: #7c3aed;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content table {
        border-collapse: collapse;
        margin: 6px 0;
        font-size: 12px;
        width: 100%;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content th,
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content td {
        border: 1px solid #e2e8f0;
        padding: 4px 8px;
        text-align: left;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content th {
        background: #f8fafc;
        font-weight: 600;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content ul,
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content ol {
        padding-left: 18px;
        margin: 4px 0;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content li { margin: 2px 0; }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content blockquote {
        border-left: 3px solid #d1d5db;
        padding-left: 10px;
        color: #6b7280;
        margin: 6px 0;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content a {
        color: #7c3aed;
        text-decoration: none;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content a:hover {
        text-decoration: underline;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content hr {
        border: none;
        border-top: 1px solid #e5e7eb;
        margin: 10px 0;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content img {
        max-width: 100%;
        border-radius: 6px;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content h2,
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content h3,
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content h4 {
        margin: 10px 0 6px;
        color: #1a1a1a;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content h2 { font-size: 15px; }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content h3 { font-size: 14px; }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content h4 { font-size: 13px; }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .math-block {
        text-align: center;
        margin: 8px 0;
        overflow-x: auto;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .math-inline {
        display: inline;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .think-block,
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .search-block {
        margin: 6px 0;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .collapsible-header {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        user-select: none;
        font-size: 12px;
        padding: 3px 0;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .collapsible-header:hover { opacity: 0.8; }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .collapsible-header .arrow {
        transition: transform 0.2s;
        font-size: 10px;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .collapsible-header.collapsed .arrow {
        transform: rotate(-90deg);
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .collapsible-body {
        overflow: hidden;
        transition: max-height 0.3s ease;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .collapsible-body.collapsed {
        max-height: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        border: none !important;
        background: none !important;
        overflow: hidden;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .think-block .collapsible-header { color: #6b7280; }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .think-block .collapsible-body {
        color: #6b7280;
        font-style: italic;
        border-left: 2px solid #d1d5db;
        padding-left: 8px;
      }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .search-block .collapsible-header { color: #0369a1; }
      #ai-qa-panel .qa-result .qa-msg .qa-msg-content .search-block .collapsible-body {
        color: #0369a1;
        background: #f0f9ff;
        padding: 6px 8px;
        border-radius: 4px;
        font-size: 12px;
      }

      /* 底部状态栏 */
      #ai-qa-panel .qa-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 12px;
        background: #fafafa;
        border-top: 1px solid #f0f0f0;
        font-size: 11px;
        color: #9ca3af;
      }
      #ai-qa-panel .qa-footer a {
        color: #7c3aed;
        text-decoration: none;
      }
      #ai-qa-panel .qa-footer a:hover {
        text-decoration: underline;
      }

      /* 生成中动画 */
      .typing-indicator {
        display: inline-flex;
        gap: 4px;
        padding: 4px 0;
      }
      .typing-indicator span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #7c3aed;
        animation: typing-bounce 1.4s ease-in-out infinite;
      }
      .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
      .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes typing-bounce {
        0%, 60%, 100% { transform: translateY(0); }
        30% { transform: translateY(-6px); }
      }

      /* 历史对话面板 */
      #ai-qa-panel .qa-history {
        display: none;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
      }
      #ai-qa-panel .qa-history-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid #f0f0f0;
        background: #fafafa;
        font-size: 13px;
        font-weight: 600;
        color: #374151;
      }
      #ai-qa-panel .qa-history-header .history-back-btn {
        background: none;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: #7c3aed;
        padding: 4px 8px;
        border-radius: 4px;
        transition: background 0.15s;
      }
      #ai-qa-panel .qa-history-header .history-back-btn:hover {
        background: #f5f3ff;
      }
      #ai-qa-panel .qa-history-list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
      }
      #ai-qa-panel .qa-history-list .empty {
        text-align: center;
        padding: 40px 16px;
        color: #9ca3af;
        font-size: 13px;
      }
      #ai-qa-panel .qa-history-item {
        background: #fff;
        border: 1px solid #eee;
        border-radius: 8px;
        padding: 10px 12px;
        margin-bottom: 6px;
        transition: border-color 0.15s;
      }
      #ai-qa-panel .qa-history-item:hover {
        border-color: #c4b5fd;
      }
      #ai-qa-panel .qa-history-item-top {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
      }
      #ai-qa-panel .qa-history-tag {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 4px;
        background: #f5f3ff;
        color: #7c3aed;
        white-space: nowrap;
        font-weight: 600;
      }
      #ai-qa-panel .qa-history-title {
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        color: #1a1a1a;
      }
      #ai-qa-panel .qa-history-item-bottom {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      #ai-qa-panel .qa-history-date {
        font-size: 11px;
        color: #9ca3af;
      }
      #ai-qa-panel .qa-history-item-btns {
        display: flex;
        gap: 4px;
      }
      #ai-qa-panel .qa-history-item-btns button {
        padding: 3px 8px;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;
        background: #fff;
        color: #374151;
        transition: background 0.15s;
      }
      #ai-qa-panel .qa-history-item-btns button:hover {
        background: #f3f4f6;
      }
      #ai-qa-panel .qa-history-item-btns .qa-history-del-btn {
        color: #dc2626;
        border-color: #fca5a5;
      }
      #ai-qa-panel .qa-history-item-btns .qa-history-del-btn:hover {
        background: #fef2f2;
      }
      #ai-qa-panel .qa-history-detail {
        display: none;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
      }
      #ai-qa-panel .qa-history-detail-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid #f0f0f0;
        background: #fafafa;
      }
      #ai-qa-panel .qa-history-detail-title {
        font-size: 13px;
        font-weight: 600;
        color: #1a1a1a;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }
      #ai-qa-panel .qa-history-detail-body {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
      }
      #ai-qa-panel .qa-history-msg {
        margin-bottom: 12px;
        padding: 10px 12px;
        border-radius: 8px;
      }
      #ai-qa-panel .qa-history-msg.user {
        background: #f5f3ff;
        border-left: 3px solid #7c3aed;
      }
      #ai-qa-panel .qa-history-msg.assistant {
        background: #f0fdf4;
        border-left: 3px solid #22c55e;
      }
      #ai-qa-panel .qa-history-msg-role {
        font-weight: 600;
        font-size: 11px;
        margin-bottom: 4px;
        text-transform: uppercase;
      }
      #ai-qa-panel .qa-history-msg.user .qa-history-msg-role {
        color: #7c3aed;
      }
      #ai-qa-panel .qa-history-msg.assistant .qa-history-msg-role {
        color: #16a34a;
      }
      #ai-qa-panel .qa-history-msg-content {
        font-size: 13px;
        color: #1a1a1a;
        line-height: 1.6;
        word-break: break-word;
      }
      #ai-qa-panel .qa-history-msg-content p { margin: 0 0 6px; }
      #ai-qa-panel .qa-history-msg-content p:last-child { margin-bottom: 0; }
      #ai-qa-panel .qa-history-msg-content pre {
        background: #1e293b;
        color: #e2e8f0;
        padding: 10px 12px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 6px 0;
        font-size: 11px;
      }
      #ai-qa-panel .qa-history-msg-content code {
        background: #f1f5f9;
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 12px;
      }
      #ai-qa-panel .qa-history-msg-content pre code {
        background: none;
        padding: 0;
        color: inherit;
      }
      #ai-qa-panel .qa-history-msg-content strong {
        color: #7c3aed;
      }
    `;
    document.head.appendChild(style);
  }

  createBall() {
    this.ball = document.createElement('div');
    this.ball.id = 'ai-qa-ball';
    this.ball.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
      </svg>
    `;

    document.body.appendChild(this.ball);

    this.ball.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mouseup', (e) => this.onMouseUp(e));
  }

  createPanel() {
    this.panel = document.createElement('div');
    this.panel.id = 'ai-qa-panel';
    this.panel.innerHTML = `
      <div class="qa-header">
        <h2>AI 问答助手</h2>
        <div class="qa-header-actions">
          <button class="history-btn" id="ai-qa-history-btn" title="查看历史对话">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
              <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" fill="#fff"/>
            </svg>
          </button>
          <button class="close-btn">&times;</button>
        </div>
      </div>
      <div class="qa-main" id="ai-qa-main">
        <div class="qa-tabs">
          <button data-tab="organize" class="active">整理信息</button>
          <button data-tab="quiz">生成测验</button>
          <button data-tab="chat">自由问答</button>
        </div>
        <div class="qa-input-area">
          <textarea id="ai-qa-input" placeholder="输入你的问题或主题..." rows="3"></textarea>
          <div class="qa-actions">
            <button class="btn-export" id="ai-qa-export" style="display:none">导出结果</button>
            <button class="btn-send" id="ai-qa-send">发送</button>
          </div>
        </div>
        <div class="qa-result" id="ai-qa-result">
          <div class="empty">输入问题后点击发送<br><small style="color:#ccc">AI 将基于你的对话记录回答</small></div>
        </div>
      </div>
      <div class="qa-history" id="ai-qa-history" style="display:none">
        <div class="qa-history-header">
          <button class="history-back-btn" id="ai-qa-history-back">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="14" height="14"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill="#7c3aed"/></svg>
            返回
          </button>
          <span>历史对话</span>
        </div>
        <div class="qa-history-list" id="ai-qa-history-list">
          <div class="empty">暂无历史对话</div>
        </div>
        <div class="qa-history-detail" id="ai-qa-history-detail" style="display:none">
          <div class="qa-history-detail-header" id="ai-qa-history-detail-header"></div>
          <div class="qa-history-detail-body" id="ai-qa-history-detail-body"></div>
        </div>
      </div>
      <div class="qa-footer">
        <span id="ai-qa-status">就绪</span>
        <a href="#" id="ai-qa-settings-link">设置</a>
      </div>
    `;

    document.body.appendChild(this.panel);

    // 面板拖拽（通过 header 拖动）
    makeDraggable(this.panel, this.panel.querySelector('.qa-header'));

    // 关闭按钮
    this.panel.querySelector('.close-btn').addEventListener('click', () => this.togglePanel(false));

    // 历史对话按钮
    this.panel.querySelector('#ai-qa-history-btn').addEventListener('click', () => this.showHistory());

    // 历史对话返回按钮
    this.panel.querySelector('#ai-qa-history-back').addEventListener('click', () => this.hideHistory());

    // Tab 切换
    this.panel.querySelectorAll('.qa-tabs button').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // 发送
    this.panel.querySelector('#ai-qa-send').addEventListener('click', () => this.handleSend());

    // 导出
    this.panel.querySelector('#ai-qa-export').addEventListener('click', () => this.handleExport());

    // 设置链接
    this.panel.querySelector('#ai-qa-settings-link').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' });
    });

    // 回车发送
    this.panel.querySelector('#ai-qa-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // 监听来自 background 的流式消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'AI_STREAM_CHUNK' && message.requestId === this._streamRequestId) {
        this._streamingContent = message.fullContent;
        this._renderAssistantContent(this._streamingContent);
        // 自动滚动到底部
        const resultEl = this.panel.querySelector('#ai-qa-result');
        resultEl.scrollTop = resultEl.scrollHeight;
      } else if (message.type === 'AI_STREAM_DONE' && message.requestId === this._streamRequestId) {
        this._streamingContent = message.fullContent;
        this._renderAssistantContent(this._streamingContent);
        this._onStreamComplete();
      } else if (message.type === 'AI_STREAM_ERROR' && message.requestId === this._streamRequestId) {
        const asstMsg = this.panel.querySelector('#ai-qa-assistant-msg .qa-msg-content');
        if (asstMsg) {
          asstMsg.innerHTML = `<span style="color:#dc2626">${message.error || '生成失败'}</span>`;
        }
        this._onStreamComplete();
      }
    });
  }

  onMouseDown(e) {
    this.isDragging = true;
    this.hasMoved = false;
    const rect = this.ball.getBoundingClientRect();
    this.dragOffset.x = e.clientX - rect.left;
    this.dragOffset.y = e.clientY - rect.top;
    this.dragStartPos.x = e.clientX;
    this.dragStartPos.y = e.clientY;
    this.ball.style.cursor = 'grabbing';
    e.preventDefault();
  }

  onMouseMove(e) {
    if (!this.isDragging) return;
    const dx = e.clientX - this.dragStartPos.x;
    const dy = e.clientY - this.dragStartPos.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.hasMoved = true;

    const x = e.clientX - this.dragOffset.x;
    const y = e.clientY - this.dragOffset.y;
    const maxX = window.innerWidth - this.ball.offsetWidth;
    const maxY = window.innerHeight - this.ball.offsetHeight;
    this.ball.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
    this.ball.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
    this.ball.style.right = 'auto';
    this.ball.style.bottom = 'auto';
  }

  onMouseUp(e) {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.ball.style.cursor = 'grab';
    if (!this.hasMoved) this.togglePanel();
  }

  togglePanel(forceState) {
    this.isPanelOpen = forceState !== undefined ? forceState : !this.isPanelOpen;
    if (this.isPanelOpen) {
      this.positionPanel();
      this.panel.classList.add('open');
    } else {
      this.panel.classList.remove('open');
    }
  }

  positionPanel() {
    const ballRect = this.ball.getBoundingClientRect();
    const panelW = 400;
    const panelH = 560;
    let left = ballRect.left - panelW + ballRect.width;
    let top = ballRect.top - panelH;
    if (left < 8) left = ballRect.right + 8;
    if (top < 8) top = ballRect.bottom + 8;
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8;
    if (top + panelH > window.innerHeight - 8) top = window.innerHeight - panelH - 8;
    this.panel.style.left = left + 'px';
    this.panel.style.top = top + 'px';
  }

  switchTab(tab) {
    this.currentTab = tab;
    this.panel.querySelectorAll('.qa-tabs button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    const input = this.panel.querySelector('#ai-qa-input');
    const placeholders = {
      organize: '输入你想整理的主题或问题...',
      quiz: '输入测验主题，AI 将生成相关测验题...',
      chat: '输入你的问题，AI 将基于对话记录回答...'
    };
    input.placeholder = placeholders[tab] || '';
  }

  async handleSend() {
    const input = this.panel.querySelector('#ai-qa-input');
    const query = input.value.trim();
    if (!query || this.isGenerating) return;

    this.isGenerating = true;
    this._streamingContent = '';
    this._streamRequestId = null;
    this._lastQuery = query; // 保存当前问题，用于历史记录
    input.value = ''; // 清空输入框
    const sendBtn = this.panel.querySelector('#ai-qa-send');
    const exportBtn = this.panel.querySelector('#ai-qa-export');
    const resultEl = this.panel.querySelector('#ai-qa-result');
    const statusEl = this.panel.querySelector('#ai-qa-status');

    sendBtn.disabled = true;
    sendBtn.textContent = '生成中...';
    exportBtn.style.display = 'none';
    statusEl.textContent = '正在检索和生成...';

    // 显示用户消息 + 加载动画
    resultEl.innerHTML = `
      <div class="qa-msg user">
        <div class="qa-msg-role">你</div>
        <div class="qa-msg-content">${this._escapeHtml(query)}</div>
      </div>
      <div class="qa-msg assistant" id="ai-qa-assistant-msg">
        <div class="qa-msg-role">AI</div>
        <div class="qa-msg-content">
          <div class="typing-indicator"><span></span><span></span><span></span></div>
        </div>
      </div>
    `;

    let fullContent = '';

    try {
      const actionMap = {
        organize: 'ORGANIZE_INFO',
        quiz: 'GENERATE_QUIZ',
        chat: 'AI_ASK_QUESTION'
      };

      const resp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: actionMap[this.currentTab],
          query,
          stream: true
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      });

      if (resp && resp.success) {
        // 流式模式：记录 requestId，后续通过 onMessage 接收 chunk
        this._streamRequestId = resp.requestId || null;
        if (!this._streamRequestId && resp.content) {
          // 非流式回退：直接渲染
          this._renderAssistantContent(resp.content);
          this._lastResult = resp.content;
          exportBtn.style.display = 'inline-block';
          statusEl.textContent = '生成完成';
          this.isGenerating = false;
          sendBtn.disabled = false;
          sendBtn.textContent = '发送';
        }
        // 流式模式下，chunk 和完成由 onMessage 监听器处理
      } else {
        const asstMsg = resultEl.querySelector('#ai-qa-assistant-msg .qa-msg-content');
        asstMsg.innerHTML = `<span style="color:#dc2626">${resp?.error || '生成失败，请检查设置'}</span>`;
        statusEl.textContent = '生成失败';
        this.isGenerating = false;
        sendBtn.disabled = false;
        sendBtn.textContent = '发送';
      }
    } catch (e) {
      const asstMsg = resultEl.querySelector('#ai-qa-assistant-msg .qa-msg-content');
      asstMsg.innerHTML = `<span style="color:#dc2626">错误: ${e.message}</span>`;
      statusEl.textContent = '出错';
      this.isGenerating = false;
      sendBtn.disabled = false;
      sendBtn.textContent = '发送';
    }
  }

  _onStreamComplete() {
    const exportBtn = this.panel.querySelector('#ai-qa-export');
    const statusEl = this.panel.querySelector('#ai-qa-status');
    const sendBtn = this.panel.querySelector('#ai-qa-send');

    this._lastResult = this._streamingContent;
    exportBtn.style.display = 'inline-block';
    statusEl.textContent = '生成完成';
    this.isGenerating = false;
    sendBtn.disabled = false;
    sendBtn.textContent = '发送';

    // 自动保存到 IndexedDB
    this._saveToHistory();
  }

  // 保存当前 Q&A 到 IndexedDB（qaHistory 表）
  async _saveToHistory() {
    const query = this._lastQuery;
    if (!query || !this._lastResult) return;

    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'SAVE_QA_HISTORY',
          data: {
            tab: this.currentTab,
            query,
            answer: this._lastResult
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[AIBall] 保存历史失败:', chrome.runtime.lastError.message);
          }
          resolve(response);
        });
      });
    } catch (e) {
      console.warn('[AIBall] 保存历史失败:', e);
    }
  }

  // 显示历史对话面板
  async showHistory() {
    const mainEl = this.panel.querySelector('#ai-qa-main');
    const historyEl = this.panel.querySelector('#ai-qa-history');
    const footerEl = this.panel.querySelector('.qa-footer');

    mainEl.style.display = 'none';
    footerEl.style.display = 'none';
    historyEl.style.display = 'flex';
    historyEl.style.flexDirection = 'column';
    historyEl.style.flex = '1';
    historyEl.style.overflow = 'hidden';

    // 重置到列表视图
    this.panel.querySelector('#ai-qa-history-list').style.display = 'block';
    this.panel.querySelector('#ai-qa-history-detail').style.display = 'none';

    await this._loadHistoryList();
  }

  // 隐藏历史对话面板
  hideHistory() {
    const mainEl = this.panel.querySelector('#ai-qa-main');
    const historyEl = this.panel.querySelector('#ai-qa-history');
    const footerEl = this.panel.querySelector('.qa-footer');

    mainEl.style.display = '';
    footerEl.style.display = '';
    historyEl.style.display = 'none';
  }

  // 加载历史对话列表
  async _loadHistoryList() {
    const listEl = this.panel.querySelector('#ai-qa-history-list');

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'GET_QA_HISTORY',
          filters: {}
        }, (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(resp);
          }
        });
      });

      if (!response || response.length === 0) {
        listEl.innerHTML = '<div class="empty">暂无历史对话<br><small style="color:#ccc">问答结果将自动保存</small></div>';
        return;
      }

      const tabLabels = { organize: '整理', quiz: '测验', chat: '问答' };

      listEl.innerHTML = '';
      for (const record of response) {
        const item = document.createElement('div');
        item.className = 'qa-history-item';

        const tag = tabLabels[record.tab] || '问答';
        const displayTitle = record.query.substring(0, 60);

        const date = new Date(record.createdAt).toLocaleString('zh-CN', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        item.innerHTML = `
          <div class="qa-history-item-top">
            <span class="qa-history-tag">${tag}</span>
            <span class="qa-history-title">${this._escapeHtml(displayTitle)}</span>
          </div>
          <div class="qa-history-item-bottom">
            <span class="qa-history-date">${date}</span>
            <div class="qa-history-item-btns">
              <button class="qa-history-view-btn" data-id="${record.id}">查看</button>
              <button class="qa-history-del-btn" data-id="${record.id}">删除</button>
            </div>
          </div>
        `;

        item.querySelector('.qa-history-view-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          this._showHistoryDetail(record);
        });

        item.querySelector('.qa-history-del-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm('确定删除这条历史记录？')) {
            await new Promise((resolve) => {
              chrome.runtime.sendMessage({ type: 'DELETE_QA_HISTORY', id: record.id }, resolve);
            });
            this._loadHistoryList();
          }
        });

        listEl.appendChild(item);
      }
    } catch (e) {
      listEl.innerHTML = '<div class="empty" style="color:#dc2626">加载失败</div>';
    }
  }

  // 显示历史对话详情
  _showHistoryDetail(record) {
    const listEl = this.panel.querySelector('#ai-qa-history-list');
    const detailEl = this.panel.querySelector('#ai-qa-history-detail');
    const headerEl = this.panel.querySelector('#ai-qa-history-detail-header');
    const bodyEl = this.panel.querySelector('#ai-qa-history-detail-body');

    listEl.style.display = 'none';
    detailEl.style.display = 'flex';
    detailEl.style.flexDirection = 'column';
    detailEl.style.flex = '1';
    detailEl.style.overflow = 'hidden';

    const tabLabels = { organize: '整理信息', quiz: '生成测验', chat: '自由问答' };
    const tabLabel = tabLabels[record.tab] || '问答';

    headerEl.innerHTML = `
      <button class="history-back-btn" id="ai-qa-detail-back">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="14" height="14"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill="#7c3aed"/></svg>
        返回列表
      </button>
      <span class="qa-history-detail-title">[${tabLabel}] ${this._escapeHtml(record.query.substring(0, 40))}</span>
    `;

    headerEl.querySelector('#ai-qa-detail-back').addEventListener('click', () => {
      detailEl.style.display = 'none';
      listEl.style.display = 'block';
    });

    bodyEl.innerHTML = '';

    // 用户提问
    const userBlock = document.createElement('div');
    userBlock.className = 'qa-history-msg user';
    userBlock.innerHTML = `
      <div class="qa-history-msg-role">你</div>
      <div class="qa-history-msg-content">${this._escapeHtml(record.query)}</div>
    `;
    bodyEl.appendChild(userBlock);

    // AI 回答
    const asstBlock = document.createElement('div');
    asstBlock.className = 'qa-history-msg assistant';
    asstBlock.innerHTML = `
      <div class="qa-history-msg-role">AI</div>
      <div class="qa-history-msg-content">${this._renderResultHTML(record.answer || '')}</div>
    `;
    bodyEl.appendChild(asstBlock);
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 用 marked + katex 渲染 Markdown 内容
  _renderMarkdown(content) {
    if (!content) return '';

    // 先提取特殊块，用占位符替换
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

    // 提取行间公式 $$...$$
    processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
      const idx = blocks.length;
      blocks.push({ type: 'math_display', content: math.trim() });
      return `\n%%BLOCK_${idx}%%\n`;
    });

    // 提取行内公式 $...$（不匹配 $$）
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
      html = this._escapeHtml(processed).replace(/\n/g, '<br>');
    }

    // 还原占位符
    html = html.replace(/%%BLOCK_(\d+)%%/g, (_, idx) => {
      const block = blocks[parseInt(idx)];
      if (!block) return '';

      if (block.type === 'math_display') {
        return this._renderMath(block.content, true);
      }
      if (block.type === 'math_inline') {
        return this._renderMath(block.content, false);
      }

      // think / search 块内内容也用 marked 渲染
      let inner = '';
      if (typeof marked !== 'undefined') {
        inner = marked.parse(block.content, { breaks: true, gfm: true });
      } else {
        inner = this._escapeHtml(block.content).replace(/\n/g, '<br>');
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

  _renderMath(tex, displayMode) {
    if (typeof katex !== 'undefined') {
      try {
        return katex.renderToString(tex, { displayMode, throwOnError: false });
      } catch (e) {
        // KaTeX 渲染失败，降级显示
      }
    }
    const escaped = this._escapeHtml(tex);
    if (displayMode) {
      return `<div class="math-block">$$${escaped}$$</div>`;
    }
    return `<span class="math-inline">$${escaped}$</span>`;
  }

  _renderResultHTML(content) {
    return this._renderMarkdown(content);
  }

  _renderAssistantContent(content) {
    const asstMsg = this.panel.querySelector('#ai-qa-assistant-msg .qa-msg-content');
    if (!asstMsg) return;
    asstMsg.innerHTML = this._renderMarkdown(content);
  }

  handleExport() {
    if (!this._lastResult) return;
    const tabNames = { organize: '整理结果', quiz: '测验', chat: '问答' };
    const filename = `${tabNames[this.currentTab] || '结果'}_${new Date().toLocaleDateString('zh-CN')}.txt`;
    const blob = new Blob([this._lastResult], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  setLoading(isLoading) {
    if (isLoading) {
      this.ball.innerHTML = '<div class="loading-dot"></div>';
    } else {
      this.ball.innerHTML = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
      `;
    }
  }
}
