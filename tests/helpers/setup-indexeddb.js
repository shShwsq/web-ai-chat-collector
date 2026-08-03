// tests/helpers/setup-indexeddb.js
// 在 jsdom 环境注入 fake-indexeddb，让源码中的 indexedDB.open / IDBKeyRange 等可用
//
// fake-indexeddb 的 auto 模式会挂到 Node globalThis；
// vitest 的 jsdom 环境下 window === globalThis，但保险起见显式同步到 window，
// 确保源码（通过 indirect eval 在 jsdom 上下文执行）能访问到

import 'fake-indexeddb/auto';

// 显式同步到 window（部分 vitest/jsdom 版本下 globalThis !== window）
if (typeof window !== 'undefined') {
  if (!window.indexedDB) window.indexedDB = globalThis.indexedDB;
  if (!window.IDBKeyRange) window.IDBKeyRange = globalThis.IDBKeyRange;
  if (!window.IDBTransaction) window.IDBTransaction = globalThis.IDBTransaction;
}
