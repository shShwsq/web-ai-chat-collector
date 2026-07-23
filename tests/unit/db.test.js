// tests/unit/db.test.js
// lib/db.js 纯函数测试：_stripAugmentBlocks / tokenize / highlightSearchResult
// 这些函数是 IIFE 外的函数声明，加载后挂到 window 全局。

import { describe, it, expect, beforeAll } from 'vitest';
import { loadDb } from '../helpers/load-source.js';

let _stripAugmentBlocks, tokenize, highlightSearchResult;

beforeAll(() => {
  const lib = loadDb();
  _stripAugmentBlocks = lib._stripAugmentBlocks;
  tokenize = lib.tokenize;
  highlightSearchResult = lib.highlightSearchResult;
});

// think 块的开闭标签用拼接构造，避免在源码中直接出现被工具误处理
const THINK_OPEN = '<' + 'think' + '>';
const THINK_CLOSE = '</' + 'think' + '>';

// =================================================================
// _stripAugmentBlocks：剥离思考块和搜索来源块，返回纯回答部分
// =================================================================
describe('_stripAugmentBlocks', () => {
  it('空输入返回空串', () => {
    expect(_stripAugmentBlocks('')).toBe('');
    expect(_stripAugmentBlocks(null)).toBe('');
    expect(_stripAugmentBlocks(undefined)).toBe('');
  });

  it('纯文本（无任何块）原样返回（trim 后）', () => {
    expect(_stripAugmentBlocks('Hello world')).toBe('Hello world');
    expect(_stripAugmentBlocks('  纯文本  ')).toBe('纯文本');
  });

  it('剥离 think 块（标准格式）', () => {
    const input = THINK_OPEN + '\n这是思考\n' + THINK_CLOSE + '\n\n这是回答';
    expect(_stripAugmentBlocks(input)).toBe('这是回答');
  });

  it('剥离 search_result 块', () => {
    const input = '回答\n<search_result>\n来源内容\n</search_result>\n更多回答';
    expect(_stripAugmentBlocks(input)).toBe('回答\n更多回答');
  });

  it('剥离千问 DOM 模式的【搜索】和【来源】标记', () => {
    const input = '【搜索】关键词1、关键词2\n【来源】来源1\n实际回答';
    expect(_stripAugmentBlocks(input)).toBe('实际回答');
  });

  it('剥离所有类型的块（混合场景）', () => {
    const input = THINK_OPEN + '\n思考过程\n' + THINK_CLOSE +
                  '\n【搜索】查询词\n【来源】来源\n' +
                  '<search_result>\n搜索结果\n</search_result>\n实际回答';
    expect(_stripAugmentBlocks(input)).toBe('实际回答');
  });

  it('保留多个 think 块之间的回答', () => {
    const input = THINK_OPEN + '\n思考1\n' + THINK_CLOSE +
                  '\n回答1\n' +
                  THINK_OPEN + '\n思考2\n' + THINK_CLOSE +
                  '\n回答2';
    expect(_stripAugmentBlocks(input)).toBe('回答1\n回答2');
  });

  it('只有 think 块无回答时返回空串', () => {
    const input = THINK_OPEN + '\n只有思考\n' + THINK_CLOSE;
    expect(_stripAugmentBlocks(input)).toBe('');
  });

  it('think 块未闭合时不被剥离（正则非贪婪匹配）', () => {
    // 未闭合的开标签不在剥离范围内，原样返回
    const input = THINK_OPEN + '\n思考未闭合\n这是回答';
    expect(_stripAugmentBlocks(input)).toBe(THINK_OPEN + '\n思考未闭合\n这是回答');
  });
});

// =================================================================
// tokenize：中文 bigram + 单字符分词
// =================================================================
describe('tokenize', () => {
  it('空输入返回空数组', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
  });

  it('纯英文：按空白分词，小写归一化', () => {
    const tokens = tokenize('Hello World');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
  });

  it('纯中文：生成 bigram + 整词', () => {
    const tokens = tokenize('你好世界');
    // 整词
    expect(tokens).toContain('你好世界');
    // bigram
    expect(tokens).toContain('你好');
    expect(tokens).toContain('好世');
    expect(tokens).toContain('世界');
  });

  it('中英混合：英文词独立，中文词生成 bigram', () => {
    const tokens = tokenize('Hello 世界');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('世界');
    // 'Hello 世界' 不在一个 word 内（被空白分隔），不产生跨语言的 bigram
    expect(tokens).not.toContain('o世');
  });

  it('中英连续（无空白）：会产生跨语言 bigram', () => {
    const tokens = tokenize('abc你好');
    // 整词
    expect(tokens).toContain('abc你好');
    // 跨语言 bigram：'c你'（'c' 不是中文但 '你' 是中文，触发 bigram）
    expect(tokens).toContain('c你');
    // 纯中文 bigram
    expect(tokens).toContain('你好');
  });

  it('过滤标点和特殊字符（只保留 \\w 和中文）', () => {
    // 'a.b' 被切为 ['a', 'b']（点号被替换为空白）
    const tokens = tokenize('a.b');
    expect(tokens).toContain('a');
    expect(tokens).toContain('b');
    expect(tokens).not.toContain('a.b');
  });

  it('去重：相同 token 只出现一次', () => {
    const tokens = tokenize('你好 你好 你好');
    const count = tokens.filter(t => t === '你好').length;
    expect(count).toBe(1);
  });

  it('数字被保留', () => {
    const tokens = tokenize('test123 hello');
    expect(tokens).toContain('test123');
    expect(tokens).toContain('hello');
  });

  it('空格分隔的多词都入 token', () => {
    const tokens = tokenize('foo bar baz');
    expect(tokens).toContain('foo');
    expect(tokens).toContain('bar');
    expect(tokens).toContain('baz');
  });
});

// =================================================================
// highlightSearchResult：在消息内容中标记匹配 token
// =================================================================
describe('highlightSearchResult', () => {
  it('空查询原样返回消息', () => {
    const messages = [{ role: 'user', content: 'Hello' }];
    expect(highlightSearchResult(messages, '')).toEqual(messages);
    expect(highlightSearchResult(messages, '   ')).toEqual(messages);
    expect(highlightSearchResult(messages, null)).toEqual(messages);
  });

  it('单 term 匹配被 <mark> 包裹', () => {
    const messages = [{ role: 'user', content: 'hello world' }];
    const result = highlightSearchResult(messages, 'hello');
    expect(result[0].highlighted).toBe('<mark>hello</mark> world');
  });

  it('多 term 全部高亮', () => {
    const messages = [{ role: 'user', content: 'foo bar baz' }];
    const result = highlightSearchResult(messages, 'foo bar');
    expect(result[0].highlighted).toBe('<mark>foo</mark> <mark>bar</mark> baz');
  });

  it('大小写不敏感匹配', () => {
    const messages = [{ role: 'user', content: 'Hello HELLO hello' }];
    const result = highlightSearchResult(messages, 'hello');
    expect(result[0].highlighted).toBe('<mark>Hello</mark> <mark>HELLO</mark> <mark>hello</mark>');
  });

  it('长 term 优先匹配（避免短 term 提前消费）', () => {
    // 'foobar' 比 'foo' 长，应先匹配，避免 'foo' 把 'foobar' 的前半截匹配掉
    const messages = [{ role: 'user', content: 'foobar foo' }];
    const result = highlightSearchResult(messages, 'foo foobar');
    expect(result[0].highlighted).toBe('<mark>foobar</mark> <mark>foo</mark>');
  });

  it('不修改原消息对象（返回新对象，含 highlighted 字段）', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const result = highlightSearchResult(messages, 'hello');
    expect(result[0]).not.toBe(messages[0]);
    expect(result[0].content).toBe('hello');
    expect(result[0].highlighted).toBe('<mark>hello</mark>');
  });

  it('中文 bigram 高亮', () => {
    const messages = [{ role: 'user', content: '你好世界' }];
    const result = highlightSearchResult(messages, '你好');
    expect(result[0].highlighted).toBe('<mark>你好</mark>世界');
  });

  it('content 为空时不抛错', () => {
    const messages = [{ role: 'user', content: '' }];
    const result = highlightSearchResult(messages, 'foo');
    expect(result[0].highlighted).toBe('');
  });

  it('多消息同时高亮', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world hello' }
    ];
    const result = highlightSearchResult(messages, 'hello');
    expect(result[0].highlighted).toBe('<mark>hello</mark>');
    expect(result[1].highlighted).toBe('world <mark>hello</mark>');
  });
});
