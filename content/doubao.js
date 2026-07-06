// doubao.js - 豆包平台入口

// 网络拦截器必须在最早时机启动，不能等DOMContentLoaded
// 否则会错过页面初始的API请求
(function() {
  const savedMode = localStorage.getItem('doubao-export-mode') || EXTRACTION_MODE.NETWORK;
  const exporter = new ChatExporterBase('doubao', savedMode);

  // AI 问答悬浮球
  new AIBall();
})();
