// deepseek.js - DeepSeek 平台入口

// 网络拦截器必须在最早时机启动，不能等DOMContentLoaded
// 否则会错过页面初始的API请求
(function() {
  const savedMode = localStorage.getItem('deepseek-export-mode') || EXTRACTION_MODE.NETWORK;
  const exporter = new ChatExporterBase('deepseek', savedMode);

  // AI 问答悬浮球
  new AIBall();
})();
