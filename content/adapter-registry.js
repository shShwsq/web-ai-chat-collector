// adapter-registry.js - 适配器注册表与常量

// 提取模式
const EXTRACTION_MODE = {
  NETWORK: 'network',  // 网络拦截模式
  DOM: 'dom'          // DOM提取模式
};

// 适配器注册表（由 network/*.js 和 dom/*.js 填充）
window.NETWORK_ADAPTERS = {};
window.DOM_ADAPTERS = {};
