// tests/dom/katex-html-to-latex.test.js
// KaTeX HTML → LaTeX 反向解析测试
//
// Kimi 等平台移除了 KaTeX 的 <annotation> 可访问性层（原始 LaTeX 源码），
// 只保留 .katex-html 视觉渲染层。katex-html-to-latex.js 递归解析这个视觉层重建 LaTeX。
//
// 这些测试用例是"DOM 改了立刻发现"的第一道防线：
// KaTeX 升级、Kimi 改用 MathJax、或 katex-html-to-latex.js 重构后，任何公式解析偏差都会被立即捕获。
//
// fixtures 直接写在每个 it() 块内，便于阅读上下文。
// HTML 结构模拟 KaTeX v0.16 真实输出，但只保留解析器依赖的关键类名/属性。

import { describe, it, expect, beforeAll } from 'vitest';
import { loadHtmlToMarkdown, setBody } from '../helpers/load-source.js';

let KatexHtmlToLatex;

beforeAll(() => {
  const lib = loadHtmlToMarkdown();
  KatexHtmlToLatex = lib.KatexHtmlToLatex;
});

// 辅助：从 HTML 字符串构造 .katex-html 元素，调用 convert()
function convertHtml(htmlString) {
  document.body.innerHTML = htmlString;
  const el = document.body.querySelector('.katex-html');
  if (!el) throw new Error('fixture 中未找到 .katex-html');
  return KatexHtmlToLatex.convert(el);
}

// 构造 KaTeX v0.16 风格的 .katex-html 外壳
// 内部 base 内容由调用方提供
function katexHtml(innerBase) {
  return `<span class="katex-html" aria-hidden="true">
    <span class="base">${innerBase}</span>
  </span>`;
}

// 普通字符 .mord
const mord = (text) => `<span class="mord">${text}</span>`;
const mordMathnormal = (text) => `<span class="mord mathnormal">${text}</span>`;

// 操作符 .mop（KaTeX 输出 unicode 符号，如 ∫）
const mop = (symbol) => `<span class="mop">${symbol}</span>`;

// 关系符 .mrel（=）
const mrel = (text) => `<span class="mrel">${text}</span>`;
// 二元运算符 .mbin（+）
const mbin = (text) => `<span class="mbin">${text}</span>`;

// 上标 vlist 项：top 值 < -1.8 视为上标
// KaTeX 实际值：top:-3.063em（上标） / top:-0.8em（下标，但下标实际可能用正值或更接近 0）
function supEntry(content, top = -3.063) {
  return `<span style="top:${top}em;margin-right:0.05em;">
    <span class="pstrut" style="height:2.7em;"></span>
    <span class="mord mtight">${content}</span>
  </span>`;
}
function subEntry(content, top = -0.5) {
  return `<span style="top:${top}em;">
    <span class="pstrut" style="height:2.7em;"></span>
    <span class="mord mtight">${content}</span>
  </span>`;
}

// 上下标容器 .msupsub
function msupsub(...entries) {
  return `<span class="msupsub">
    <span class="vlist-t vlist-r">
      <span class="vlist">${entries.join('')}
      </span>
    </span>
  </span>`;
}

// 分数 .mfrac：分子 top 负值（在上方），分母 top 正值（在下方）
function mfrac(numerator, denominator) {
  return `<span class="mfrac">
    <span class="vlist-t vlist-r">
      <span class="vlist">
        <span style="top:-2.314em;"><span class="pstrut"></span><span class="mord mtight">${denominator}</span></span>
        <span style="top:-3.23em;"><span class="pstrut" style="height:3em;"></span><span class="mord mtight">${numerator}</span></span>
      </span>
    </span>
  </span>`;
}

// 根号 .msqrt：KaTeX v0.16+ 用 SVG 渲染根号线（无文本），不是 √ 字符
// _processSqrt 的 replace(/√/g) 是兼容旧版本，新版本根号符号为空文本，不影响
function msqrt(content) {
  return `<span class="msqrt">
    <span class="vlist-t vlist-r">
      <span class="vlist">
        <span style="top:-3em;">
          <span class="pstrut" style="height:3em;"></span>
          <span class="svg-align"></span>
        </span>
        <span style="top:-2.7em;">
          <span class="pstrut" style="height:2.7em;"></span>
          <span class="mord">${content}</span>
        </span>
      </span>
    </span>
  </span>`;
}

// =================================================================
// 基础字符与符号
// =================================================================
describe('基础字符与符号', () => {
  it('简单变量赋值 x = 1', () => {
    const html = katexHtml(`${mordMathnormal('x')}${mrel('=')}${mord('1')}`);
    expect(convertHtml(html)).toBe('x = 1');
  });

  it('多个字符拼接 xy', () => {
    const html = katexHtml(`${mordMathnormal('x')}${mordMathnormal('y')}`);
    expect(convertHtml(html)).toBe('xy');
  });

  it('二元运算符 + 两侧有空格', () => {
    const html = katexHtml(`${mord('1')}${mbin('+')}${mord('2')}`);
    expect(convertHtml(html)).toBe('1 + 2');
  });

  it('关系符 = 两侧有空格', () => {
    const html = katexHtml(`${mord('x')}${mrel('=')}${mord('y')}`);
    expect(convertHtml(html)).toBe('x = y');
  });

  it('strut 布局占位被忽略', () => {
    const html = katexHtml(
      `<span class="strut" style="height:0.6em;"></span>${mord('x')}`
    );
    expect(convertHtml(html)).toBe('x');
  });

  it('mspace 间隔转为单个空格', () => {
    const html = katexHtml(`${mord('x')}<span class="mspace"></span>${mord('y')}`);
    // mspace 返回 ' '，拼接为 'x y'，但 trim 后是 'x y'
    expect(convertHtml(html)).toBe('x y');
  });
});

// =================================================================
// 上下标
// =================================================================
describe('上下标', () => {
  it('上标 x^2', () => {
    const html = katexHtml(`${mordMathnormal('x')}${msupsub(supEntry('2'))}`);
    expect(convertHtml(html)).toBe('x^{2}');
  });

  it('下标 x_n', () => {
    const html = katexHtml(`${mordMathnormal('x')}${msupsub(subEntry('n'))}`);
    expect(convertHtml(html)).toBe('x_{n}');
  });

  it('上下标同时 x_n^2（先下后上）', () => {
    // KaTeX 输出顺序：先上标（top 更负）后下标
    const html = katexHtml(
      `${mordMathnormal('x')}${msupsub(supEntry('2'), subEntry('n'))}`
    );
    // entries 按 top 升序：上标(-3.063) 在前，下标(-0.5) 在后
    // 多 entries 时：第一个是上标 ^{2}，第二个是下标 _{n}
    // 结果应该是 _{n}^{2}（下标在前，上标在后，符合 LaTeX 惯例）
    expect(convertHtml(html)).toBe('x_{n}^{2}');
  });

  it('导数符号 x\' 不包裹 ^{}（直接输出）', () => {
    // ′ 在 OP_MAP 中映射为 '，且 entries[0].text === "'" 时直接输出
    const html = katexHtml(`${mordMathnormal('x')}${msupsub(supEntry('′'))}`);
    expect(convertHtml(html)).toBe("x'");
  });

  it('双重导数 x\'\'（″ 映射为 \'\'，作为整体 token 不触发单引号特例）', () => {
    // ″ 在 OP_MAP 中映射为 ''（两个单引号），entries[0].text === "''"
    // 单引号特例只匹配 entries[0].text === "'"（单个），所以 "''" 走 ^{''} 分支
    const html = katexHtml(`${mordMathnormal('x')}${msupsub(supEntry('″'))}`);
    expect(convertHtml(html)).toBe("x^{''}");
  });

  it('上标含多个字符（mord 包含 2n+1）', () => {
    // KaTeX 实际会把 2n+1 拆成多个 mord/mbin，这里简化为单个 mord
    const html = katexHtml(
      `${mordMathnormal('x')}${msupsub(supEntry('2n+1'))}`
    );
    expect(convertHtml(html)).toBe('x^{2n+1}');
  });
});

// =================================================================
// 分数
// =================================================================
describe('分数', () => {
  it('简单分数 \\frac{1}{2}', () => {
    const html = katexHtml(mfrac('1', '2'));
    expect(convertHtml(html)).toBe('\\frac{1}{2}');
  });

  it('分子分母含变量 \\frac{x}{y}', () => {
    const html = katexHtml(mfrac('x', 'y'));
    expect(convertHtml(html)).toBe('\\frac{x}{y}');
  });

  it('嵌套分数 \\frac{\\frac{1}{2}}{3}（已知限制：querySelectorAll 递归选中内层 vlist）', () => {
    // _processFrac 用 querySelectorAll('.vlist > span[style*="top:"]') 递归查找所有后代
    // 嵌套分数的内层 vlist 也会被选中，导致 entries 排序后分子分母取错
    // 这是源码的已知限制，注释中提到"复杂嵌套降级为 textContent"
    // 此测试断言当前（不完美）行为，以便未来修复时立即被发现
    const innerFrac = mfrac('1', '2');
    const html = katexHtml(mfrac(innerFrac, '3'));
    const result = convertHtml(html);
    // 当前行为：内外层 vlist 的 span 都被收集，sort 后取最负和最大
    // 结果不一定是 \frac{\frac{1}{2}}{3}，但至少应包含 \frac{
    expect(result).toMatch(/^\\frac\{.*\}\{.*\}$/);
    expect(result).toContain('\\frac{');
  });
});

// =================================================================
// 根号
// =================================================================
describe('根号', () => {
  it('简单根号 \\sqrt{x}', () => {
    const html = katexHtml(msqrt('x'));
    expect(convertHtml(html)).toBe('\\sqrt{x}');
  });

  it('根号内含数字 \\sqrt{2}', () => {
    const html = katexHtml(msqrt('2'));
    expect(convertHtml(html)).toBe('\\sqrt{2}');
  });
});

// =================================================================
// 操作符（OP_MAP 查表）
// =================================================================
describe('操作符 OP_MAP 查表', () => {
  it('积分 ∫ → \\int', () => {
    const html = katexHtml(mop('∫'));
    expect(convertHtml(html)).toBe('\\int');
  });

  it('求和 ∑ → \\sum', () => {
    const html = katexHtml(mop('∑'));
    expect(convertHtml(html)).toBe('\\sum');
  });

  it('乘号 × → \\times', () => {
    const html = katexHtml(`${mord('2')}${mop('×')}${mord('3')}`);
    expect(convertHtml(html)).toBe('2\\times3');
  });

  it('无穷 ∞ → \\infty', () => {
    const html = katexHtml(mop('∞'));
    expect(convertHtml(html)).toBe('\\infty');
  });

  it('不等 ≠（已知限制：mrel 不查 OP_MAP，原样输出 Unicode 符号）', () => {
    // _processNode 中 mrel/mbin/mpunct 走 _nodeText 而非 _textWithOpMap
    // 因此 ≤ ≥ ≠ ≈ 等关系符不被转为 LaTeX 命令，输出 Unicode 原字符
    // 这是源码的已知限制，未来修复后此测试需同步更新
    const html = katexHtml(`${mord('x')}${mrel('≠')}${mord('y')}`);
    expect(convertHtml(html)).toBe('x ≠ y');
  });

  it('小于等于 ≤（已知限制：同 ≠ 不查 OP_MAP）', () => {
    const html = katexHtml(`${mord('x')}${mrel('≤')}${mord('y')}`);
    expect(convertHtml(html)).toBe('x ≤ y');
  });
});

// =================================================================
// 希腊字母
// =================================================================
describe('希腊字母', () => {
  it('α → \\alpha', () => {
    const html = katexHtml(mord('α'));
    expect(convertHtml(html)).toBe('\\alpha');
  });

  it('π → \\pi', () => {
    const html = katexHtml(mord('π'));
    expect(convertHtml(html)).toBe('\\pi');
  });

  it('θ → \\theta', () => {
    const html = katexHtml(mord('θ'));
    expect(convertHtml(html)).toBe('\\theta');
  });

  it('Σ（大写）→ \\Sigma', () => {
    const html = katexHtml(mord('Σ'));
    expect(convertHtml(html)).toBe('\\Sigma');
  });

  it('Δ → \\Delta', () => {
    const html = katexHtml(mord('Δ'));
    expect(convertHtml(html)).toBe('\\Delta');
  });
});

// =================================================================
// 复杂组合公式
// =================================================================
describe('复杂组合公式', () => {
  it('定积分 \\int_0^1 x^2 dx', () => {
    // ∫ + 上下标（0 下标，1 上标）+ x + ^2 + d + x
    const html = katexHtml(
      mop('∫') +
      msupsub(supEntry('1'), subEntry('0')) +
      mordMathnormal('x') +
      msupsub(supEntry('2')) +
      mordMathnormal('d') +
      mordMathnormal('x')
    );
    // 期望：\int_{0}^{1}x^{2}dx
    expect(convertHtml(html)).toBe('\\int_{0}^{1}x^{2}dx');
  });

  it('求和公式 \\sum_{n=1}^{\\infty} \\frac{1}{n}', () => {
    const html = katexHtml(
      mop('∑') +
      msupsub(supEntry(mop('∞')), subEntry(`${mordMathnormal('n')}${mrel('=')}${mord('1')}`)) +
      mfrac('1', 'n')
    );
    // 上标：∞ → \infty
    // 下标：n=1（注意 n=1 中 = 是 mrel 会被 _processNode 处理为 ' = '，trim 后为 'n = 1'）
    expect(convertHtml(html)).toBe('\\sum_{n = 1}^{\\infty}\\frac{1}{n}');
  });

  it('二次公式 x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', () => {
    // 简化版：只验证核心结构，不追求完全等价
    const html = katexHtml(
      mordMathnormal('x') +
      mrel('=') +
      mfrac(
        `${mord('-')}${mordMathnormal('b')}${mop('±')}${msqrt(`${mordMathnormal('b')}${msupsub(supEntry('2'))}${mbin('-')}${mord('4')}${mordMathnormal('a')}${mordMathnormal('c')}`)}`,
        `${mord('2')}${mordMathnormal('a')}`
      )
    );
    const result = convertHtml(html);
    // 验证关键部分存在
    expect(result).toContain('x =');
    expect(result).toContain('\\frac{');
    expect(result).toContain('\\sqrt{');
    expect(result).toContain('b^{2}');
  });
});

// =================================================================
// 降级处理
// =================================================================
describe('降级处理', () => {
  it('空 .katex-html 返回空字符串', () => {
    const html = `<span class="katex-html"><span class="base"></span></span>`;
    expect(convertHtml(html)).toBe('');
  });

  it('未识别的 class 节点降级为 textContent', () => {
    // .unknown 类未在分派表中，会走"递归子节点或 textContent"
    const html = katexHtml(`<span class="unknown-class">hello</span>`);
    expect(convertHtml(html)).toBe('hello');
  });

  it('未在 OP_MAP 中的符号原样返回', () => {
    // ❤ 不在 OP_MAP 中，原样输出
    const html = katexHtml(mord('❤'));
    expect(convertHtml(html)).toBe('❤');
  });

  it('解析异常时降级为 textContent（不抛错）', () => {
    // 构造一个会让 _processSupSub 抛错的场景：vlist 中 span 缺失 style 属性
    // 实际上当前实现用了 try-catch，会降级到 textContent
    const html = `<span class="katex-html">
      <span class="base">
        <span class="mord mathnormal">x</span>
        <span class="msupsub">
          <span class="vlist-t">
            <span class="vlist-r">
              <span class="vlist">broken structure</span>
            </span>
          </span>
        </span>
      </span>
    </span>`;
    // 不会抛错，至少返回 'x' 或包含 'x' 的字符串
    const result = convertHtml(html);
    expect(result).toContain('x');
  });
});
