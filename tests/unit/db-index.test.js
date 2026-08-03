// tests/unit/db-index.test.js
// lib/db.js 中 updateSearchIndex 的回归测试
// 使用 fake-indexeddb 在 jsdom 环境模拟 IndexedDB，验证倒排索引写入正确性
//
// 核心回归场景：同一 term 出现在多条消息时，计数必须正确累加（而非被并发 get→put 覆盖为 1）
// 修复前的 bug：对每条消息的每个 term 都排队 get→put，多个 get 在前一个 put 完成前已读到旧值，
//              导致计数丢失（应为 N 实为 1）

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadDb } from '../helpers/load-source.js';

let updateSearchIndex, clearConvFromIndex, openDB, initDB, STORE_INDEX;
// 复用单个长连接，避免反复 open/close 导致 fake-indexeddb 事务调度异常
let db;

beforeAll(async () => {
  const lib = loadDb();
  updateSearchIndex = lib.updateSearchIndex;
  clearConvFromIndex = lib.clearConvFromIndex;
  openDB = lib.openDB;
  initDB = lib.initDB;
  STORE_INDEX = lib.STORE_INDEX;
  // 初始化数据库结构（触发 onupgradeneeded 创建 objectStore + 索引）
  await initDB();
  // 取一个长连接用于所有测试
  db = await openDB();
});

// 每个测试前清空 STORE_INDEX，避免相互影响
beforeEach(async () => {
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_INDEX, 'readwrite');
    tx.objectStore(STORE_INDEX).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
});

// 调用 updateSearchIndex 并等待事务完成
// updateSearchIndex 内部排队 get→put，必须等 readwrite 事务 oncomplete 才能保证所有 put 落库
async function runIndexUpdate(convId, messages) {
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_INDEX, 'readwrite');
    const indexStore = tx.objectStore(STORE_INDEX);
    updateSearchIndex(indexStore, convId, messages);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// 读取某个 term 的索引项
async function readIndexEntry(term) {
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_INDEX, 'readonly');
    const req = tx.objectStore(STORE_INDEX).get(term);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 统计 STORE_INDEX 中所有索引项数
async function countIndexEntries() {
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_INDEX, 'readonly');
    const req = tx.objectStore(STORE_INDEX).count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}

describe('updateSearchIndex', () => {
  // =================================================================
  // 核心回归：同 term 在多条消息中出现时，计数必须累加（非覆盖为 1）
  // 这是修复前的 bug 场景：3 条消息都含 "AI"，原实现最终 count=1（应=3）
  // =================================================================
  it('回归：3 条消息都含同一 term "AI"，count 累加为 3（非被覆盖为 1）', async () => {
    const convId = 'test::conv1';
    const messages = [
      { role: 'user', content: 'AI 是什么' },
      { role: 'assistant', content: 'AI 是人工智能' },
      { role: 'user', content: 'AI 的应用' }
    ];

    await runIndexUpdate(convId, messages);

    const entry = await readIndexEntry('ai');
    expect(entry).not.toBeNull();
    expect(entry.convIds[convId]).toBe(3);
  });

  // 更极端：10 条消息都含 "test"，count 必须为 10
  it('回归：10 条消息都含 "test"，count 为 10', async () => {
    const convId = 'test::bulk';
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: 'user',
      content: `test message ${i}`
    }));

    await runIndexUpdate(convId, messages);

    const entry = await readIndexEntry('test');
    expect(entry.convIds[convId]).toBe(10);
  });

  // =================================================================
  // 基础场景
  // =================================================================

  it('单条消息单个 term：count 为 1', async () => {
    const convId = 'test::single';
    await runIndexUpdate(convId, [{ role: 'user', content: 'hello' }]);

    const entry = await readIndexEntry('hello');
    expect(entry).not.toBeNull();
    expect(entry.convIds[convId]).toBe(1);
  });

  it('同一消息内重复 token 不重复计数（tokenize 已去重）', async () => {
    const convId = 'test::dedup';
    // "你好 你好 你好" 经 tokenize 后 "你好" 只出现一次
    await runIndexUpdate(convId, [{ role: 'user', content: '你好 你好 你好' }]);

    const entry = await readIndexEntry('你好');
    expect(entry.convIds[convId]).toBe(1);
  });

  it('不同对话的同一 term 各自独立计数', async () => {
    await runIndexUpdate('test::convA', [{ role: 'user', content: 'shared' }]);
    await runIndexUpdate('test::convB', [
      { role: 'user', content: 'shared' },
      { role: 'assistant', content: 'shared' }
    ]);

    const entry = await readIndexEntry('shared');
    expect(entry.convIds['test::convA']).toBe(1);
    expect(entry.convIds['test::convB']).toBe(2);
  });

  it('增量更新：同一对话分两次写入，计数累加', async () => {
    const convId = 'test::incremental';
    await runIndexUpdate(convId, [{ role: 'user', content: 'AI 第一条' }]);
    await runIndexUpdate(convId, [
      { role: 'assistant', content: 'AI 第二条' },
      { role: 'user', content: 'AI 第三条' }
    ]);

    const entry = await readIndexEntry('ai');
    expect(entry.convIds[convId]).toBe(3);
  });

  it('中文 bigram 正确索引（"人工智能" 产生 ai/人工/工智/智能 等 token）', async () => {
    const convId = 'test::chinese';
    await runIndexUpdate(convId, [{ role: 'user', content: '人工智能' }]);

    const bigram = await readIndexEntry('人工');
    expect(bigram).not.toBeNull();
    expect(bigram.convIds[convId]).toBe(1);

    const fullWord = await readIndexEntry('人工智能');
    expect(fullWord).not.toBeNull();
    expect(fullWord.convIds[convId]).toBe(1);
  });

  // =================================================================
  // 边界场景
  // =================================================================

  it('空 messages 数组不写入任何索引', async () => {
    const before = await countIndexEntries();
    await runIndexUpdate('test::empty', []);
    const after = await countIndexEntries();
    expect(after).toBe(before);
  });

  it('content 为空字符串不抛错、不写入', async () => {
    const before = await countIndexEntries();
    await runIndexUpdate('test::emptyContent', [
      { role: 'user', content: '' },
      { role: 'assistant', content: null }
    ]);
    const after = await countIndexEntries();
    expect(after).toBe(before);
  });

  it('无 content 字段不抛错', async () => {
    const before = await countIndexEntries();
    await runIndexUpdate('test::noContent', [{ role: 'user' }]);
    const after = await countIndexEntries();
    expect(after).toBe(before);
  });

  // =================================================================
  // 倒排索引结构正确性
  // =================================================================

  it('索引项结构：{ term, convIds: { [convId]: count } }', async () => {
    await runIndexUpdate('test::struct', [{ role: 'user', content: 'structure' }]);

    const entry = await readIndexEntry('structure');
    expect(entry).toEqual({
      term: 'structure',
      convIds: { 'test::struct': 1 }
    });
  });

  it('一条消息的多个 term 都入索引', async () => {
    await runIndexUpdate('test::multi', [{ role: 'user', content: 'foo bar baz' }]);

    expect((await readIndexEntry('foo')).convIds['test::multi']).toBe(1);
    expect((await readIndexEntry('bar')).convIds['test::multi']).toBe(1);
    expect((await readIndexEntry('baz')).convIds['test::multi']).toBe(1);
  });
});
