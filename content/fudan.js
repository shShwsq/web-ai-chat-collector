// fudan.js - 复旦 AI Agent 平台入口

// 网络拦截器必须在最早时机启动，不能等DOMContentLoaded
// 否则会错过页面初始的API请求
(function() {
  const savedMode = localStorage.getItem('fudan-export-mode') || EXTRACTION_MODE.NETWORK;
  const exporter = new ChatExporterBase('fudan', savedMode);

  // AI 问答悬浮球
  new AIBall();
})();
