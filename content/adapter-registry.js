// adapter-registry.js - 适配器注册表与常量

// 提取模式
const EXTRACTION_MODE = {
  NETWORK: 'network',  // 网络拦截模式
  DOM: 'dom'          // DOM提取模式
};

// 适配器注册表（由 network/*.js 和 dom/*.js 填充）
window.NETWORK_ADAPTERS = {};
window.DOM_ADAPTERS = {};

// 检查指定平台是否启用对话提取（默认启用，保持向后兼容）
// content script 中可直接调用 chrome.storage.local
async function isPlatformEnabled(platformName) {
  return new Promise((resolve) => {
    try {
      if (!chrome?.storage?.local) {
        resolve(true);
        return;
      }
      chrome.storage.local.get('platformSettings', (result) => {
        if (chrome.runtime.lastError) {
          resolve(true);
          return;
        }
        const settings = result?.platformSettings || {};
        // 未设置视为启用（向后兼容）
        resolve(settings[platformName] !== false);
      });
    } catch (e) {
      resolve(true);
    }
  });
}
