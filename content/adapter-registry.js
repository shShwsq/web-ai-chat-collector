// adapter-registry.js - 适配器注册表与常量

// 提取模式
const EXTRACTION_MODE = {
  NETWORK: 'network',  // 网络拦截模式
  DOM: 'dom'          // DOM提取模式
};

// 适配器注册表（由 network/*.js 和 dom/*.js 填充）
window.NETWORK_ADAPTERS = {};
window.DOM_ADAPTERS = {};

// 检查指定平台是否启用对话提取
// 默认仅启用 fudan；用户显式保存过的平台按存储值
// content script 中可直接调用 chrome.storage.local
const DEFAULT_ENABLED_PLATFORMS = new Set(['fudan']);

async function isPlatformEnabled(platformName) {
  return new Promise((resolve) => {
    try {
      if (!chrome?.storage?.local) {
        resolve(DEFAULT_ENABLED_PLATFORMS.has(platformName));
        return;
      }
      chrome.storage.local.get('platformSettings', (result) => {
        if (chrome.runtime.lastError) {
          resolve(DEFAULT_ENABLED_PLATFORMS.has(platformName));
          return;
        }
        const settings = result?.platformSettings || {};
        // 已显式保存过的平台按存储值；未保存过的走默认（仅 fudan 启用）
        if (platformName in settings) {
          resolve(settings[platformName] === true);
        } else {
          resolve(DEFAULT_ENABLED_PLATFORMS.has(platformName));
        }
      });
    } catch (e) {
      resolve(DEFAULT_ENABLED_PLATFORMS.has(platformName));
    }
  });
}

// 读取指定平台的提取模式（由 content script 在初始化时调用）
// 默认值表只在 bg/settings-handlers.js 维护一份，content script 通过消息向 bg 查询
function getPlatformMode(platformName) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS', category: 'platformModes' }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response || response.error) return reject(new Error(response?.error || '未知错误'));
      resolve(response[platformName] || EXTRACTION_MODE.NETWORK);
    });
  });
}
