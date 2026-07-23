// dom/katex-html-to-latex.js - KaTeX 渲染 HTML → LaTeX 源码反向解析器
//
// 适用场景：部分平台（如 Kimi）主动移除了 KaTeX 标准的 <annotation> 可访问性层，
// 仅保留 .katex-html 视觉渲染层，导致无法直接提取原始 LaTeX 源码。
// 本模块递归解析 .katex-html 的 DOM 结构，重建等价 LaTeX 字符串。
//
// 依赖：无（纯 DOM 解析）
// 挂载：window.KatexHtmlToLatex
// 入口：window.KatexHtmlToLatex.convert(katexHtmlEl)
//
// 支持的 KaTeX 结构（覆盖常见数学公式）：
//   - 普通字符 .mord / .mord.mathnormal（变量、常量）
//   - 操作符 .mop（∫→\int, ∑→\sum, ×→\times 等，查 OP_MAP 表）
//   - 括号 .mopen / .mclose
//   - 二元运算符 .mbin（+, −）
//   - 关系符 .mrel（=, <, >, ≤, ≥, ≠）
//   - 标点 .mpunct
//   - 上下标 .msupsub（通过 vlist 的 top 值判断上标/下标）
//   - 分数 .mfrac
//   - 根号 .msqrt / .mroot
//   - 间隔 .mspace（忽略）
//   - 布局占位 .strut（忽略）
//
// 限制：
//   - 矩阵 .mtable 仅取文本拼接，不重建 \begin{matrix} 结构
//   - 复杂嵌套（如 \underbrace, \overbrace）降级为 textContent
//   - 解析失败时降级返回 textContent，保证不中断导出流程
(function () {
  'use strict';

  // 操作符符号 → LaTeX 命令映射表
  // KaTeX 渲染的操作符文本（如 ∫）需映射回 LaTeX 命令（如 \int）
  var OP_MAP = {
    '∫': '\\int',
    '∬': '\\iint',
    '∭': '\\iiint',
    '∮': '\\oint',
    '∑': '\\sum',
    '∏': '\\prod',
    '∐': '\\coprod',
    '⋃': '\\bigcup',
    '⋂': '\\bigcap',
    '⊕': '\\oplus',
    '⊗': '\\otimes',
    '⊙': '\\odot',
    '×': '\\times',
    '÷': '\\div',
    '±': '\\pm',
    '∓': '\\mp',
    '∞': '\\infty',
    '∂': '\\partial',
    '∇': '\\nabla',
    '∈': '\\in',
    '∉': '\\notin',
    '∋': '\\ni',
    '⊂': '\\subset',
    '⊃': '\\supset',
    '⊆': '\\subseteq',
    '⊇': '\\supseteq',
    '∪': '\\cup',
    '∩': '\\cap',
    '∅': '\\emptyset',
    '∀': '\\forall',
    '∃': '\\exists',
    '¬': '\\neg',
    '∧': '\\wedge',
    '∨': '\\vee',
    '→': '\\to',
    '←': '\\gets',
    '↔': '\\leftrightarrow',
    '⇒': '\\Rightarrow',
    '⇐': '\\Leftarrow',
    '⇔': '\\Leftrightarrow',
    '↦': '\\mapsto',
    '⇌': '\\rightleftharpoons',
    '↑': '\\uparrow',
    '↓': '\\downarrow',
    '≤': '\\leq',
    '≥': '\\geq',
    '≠': '\\neq',
    '≈': '\\approx',
    '≡': '\\equiv',
    '∼': '\\sim',
    '≃': '\\simeq',
    '≅': '\\cong',
    '∝': '\\propto',
    '·': '\\cdot',
    '…': '\\dots',
    '⋯': '\\cdots',
    '⋮': '\\vdots',
    '⋱': '\\ddots',
    'α': '\\alpha',
    'β': '\\beta',
    'γ': '\\gamma',
    'δ': '\\delta',
    'ε': '\\epsilon',
    'ζ': '\\zeta',
    'η': '\\eta',
    'θ': '\\theta',
    'λ': '\\lambda',
    'μ': '\\mu',
    'ν': '\\nu',
    'ξ': '\\xi',
    'π': '\\pi',
    'ρ': '\\rho',
    'σ': '\\sigma',
    'τ': '\\tau',
    'φ': '\\phi',
    'χ': '\\chi',
    'ψ': '\\psi',
    'ω': '\\omega',
    'Γ': '\\Gamma',
    'Δ': '\\Delta',
    'Θ': '\\Theta',
    'Λ': '\\Lambda',
    'Ξ': '\\Xi',
    'Π': '\\Pi',
    'Σ': '\\Sigma',
    'Φ': '\\Phi',
    'Ψ': '\\Psi',
    'Ω': '\\Omega',
    'ℕ': '\\mathbb{N}',
    'ℤ': '\\mathbb{Z}',
    'ℚ': '\\mathbb{Q}',
    'ℝ': '\\mathbb{R}',
    'ℂ': '\\mathbb{C}',
    'ℵ': '\\aleph',
    '∘': '\\circ',
    '′': "'",
    '″': "''",
    '‴': "'''",
    '°': '^\\circ',
    '∠': '\\angle',
    '⊥': '\\perp',
    '∥': '\\parallel',
    '√': '\\surd'
  };

  // 上标/下标判断阈值
  // KaTeX vlist 中，上标 top 值通常 < -2em（如 -3.063em），下标 top 值 > -1.5em
  var SUP_THRESHOLD = -1.8;

  var KatexHtmlToLatex = {
    // 主入口：将 .katex-html 元素转换为 LaTeX 字符串
    // @param {Element} katexHtmlEl - .katex-html DOM 元素
    // @return {string} LaTeX 源码
    convert: function (katexHtmlEl) {
      try {
        // .katex-html 下可能有多个 .base（如 = 号分隔的左右表达式）
        var bases = katexHtmlEl.querySelectorAll(':scope > .base');
        var result = '';
        for (var i = 0; i < bases.length; i++) {
          result += this._processChildren(bases[i]);
        }
        // 压缩连续多空格为单个（.mspace 与 .mbin/.mrel 的空格会叠加）
        return result.replace(/ {2,}/g, ' ').trim();
      } catch (e) {
        console.warn('[KatexHtmlToLatex] 解析失败，降级为 textContent:', e);
        return katexHtmlEl.textContent.trim();
      }
    },

    // 处理一个元素的所有子节点，拼接结果
    _processChildren: function (el) {
      var result = '';
      var children = el.children;
      for (var i = 0; i < children.length; i++) {
        result += this._processNode(children[i]);
      }
      return result;
    },

    // 处理单个节点，根据 class 分派
    _processNode: function (node) {
      var cls = node.getAttribute('class') || '';

      // 布局占位（strut）和间隔（mspace）忽略
      if (/\bstrut\b/.test(cls)) return '';
      if (/\bmspace\b/.test(cls)) return ' ';
      if (/\bpstrut\b/.test(cls)) return '';

      // 上下标容器
      if (/\bmsupsub\b/.test(cls)) {
        return this._processSupSub(node);
      }

      // 分数
      if (/\bmfrac\b/.test(cls)) {
        return this._processFrac(node);
      }

      // 根号
      if (/\bmsqrt\b/.test(cls)) {
        return this._processSqrt(node);
      }
      if (/\bmroot\b/.test(cls)) {
        return this._processRoot(node);
      }

      // 矩阵/表格（简化处理：逐格拼接）
      if (/\bmtable\b/.test(cls)) {
        return this._processMtable(node);
      }

      // 操作符（∫ ∑ 等，需查表）
      if (/\bmop\b/.test(cls)) {
        return this._processOp(node);
      }

      // 括号
      if (/\bmopen\b/.test(cls)) {
        return '(';
      }
      if (/\bmclose\b/.test(cls)) {
        // mclose 可能带上下标（如 )^2），先取括号再处理 msupsub
        var closeText = ')';
        var supsub = node.querySelector(':scope > .msupsub');
        if (supsub) {
          closeText += this._processSupSub(supsub);
        }
        return closeText;
      }

      // 二元运算符（+ − × ÷ 等）
      // 查 OP_MAP：× → \times、÷ → \div、± → \pm 等
      if (/\bmbin\b/.test(cls)) {
        return ' ' + this._textWithOpMap(node) + ' ';
      }

      // 关系符（= < > ≤ ≥ ≠）
      // 查 OP_MAP：≤ → \leq、≥ → \geq、≠ → \neq 等
      if (/\bmrel\b/.test(cls)) {
        return ' ' + this._textWithOpMap(node) + ' ';
      }

      // 标点
      // 查 OP_MAP：… → \dots 等
      if (/\bmpunct\b/.test(cls)) {
        return this._textWithOpMap(node) + ' ';
      }

      // 普通字符 .mord（可能是叶子，也可能嵌套，如 .mord > .mord.mathnormal + .msupsub）
      if (/\bmord\b/.test(cls)) {
        return this._processMord(node);
      }

      // 其他未识别类型：递归处理子节点，或叶子节点查 OP_MAP
      if (node.children.length > 0) {
        return this._processChildren(node);
      }
      return this._textWithOpMap(node);
    },

    // 处理 .mord 节点
    // .mord 可能是叶子（如 .mord.mathnormal "e"），也可能嵌套（.mord > .mord.mathnormal + .msupsub）
    _processMord: function (node) {
      // 如果是叶子节点（无子元素），查 OP_MAP 后取文本
      if (node.children.length === 0) {
        return this._textWithOpMap(node);
      }
      // 嵌套：递归处理子节点（会处理内部的 .mathnormal 和 .msupsub）
      return this._processChildren(node);
    },

    // 处理操作符 .mop（查 OP_MAP 表，未命中则取文本）
    _processOp: function (node) {
      return this._textWithOpMap(node);
    },

    // 取节点文本并查 OP_MAP（将 ∫ → \int、′ → ' 等符号映射为 LaTeX 命令）
    _textWithOpMap: function (node) {
      var text = node.textContent.trim();
      if (OP_MAP[text]) {
        return OP_MAP[text];
      }
      return text;
    },

    // 处理上下标 .msupsub
    // 结构：.msupsub > .vlist-t > .vlist-r > .vlist > span[style="top:Xem"] > .pstrut + .sizing/.mord
    // 判断：top < SUP_THRESHOLD 为上标(^)，否则为下标(_)
    _processSupSub: function (supsubEl) {
      var self = this;
      var entries = [];
      // 找所有带 top 样式的定位 span
      var topSpans = supsubEl.querySelectorAll('.vlist > span[style*="top:"]');
      for (var i = 0; i < topSpans.length; i++) {
        var span = topSpans[i];
        var style = span.getAttribute('style') || '';
        var topMatch = style.match(/top:\s*(-?[\d.]+)em/);
        if (!topMatch) continue;
        var topVal = parseFloat(topMatch[1]);
        // 内容在 .pstrut 之后的兄弟元素（.sizing 或直接 .mord/.mop）
        // 跳过 .pstrut，取其余子节点的内容
        var contentParts = [];
        var children = span.children;
        for (var j = 0; j < children.length; j++) {
          var child = children[j];
          var childCls = child.getAttribute('class') || '';
          if (/\bpstrut\b/.test(childCls)) continue;
          contentParts.push(this._processNode(child));
        }
        var contentText = contentParts.join('').trim();
        if (contentText) {
          entries.push({ top: topVal, text: contentText });
        }
      }

      if (entries.length === 0) return '';

      // 按 top 值排序（从小到大，最负的在前）
      entries.sort(function (a, b) { return a.top - b.top; });

      var result = '';
      if (entries.length === 1) {
        // 单个：根据 top 值判断上标或下标
        if (entries[0].top < SUP_THRESHOLD) {
          // 导数符号 ' 直接输出，不包裹 ^{}（LaTeX 中 x' 等价于 x^\prime）
          if (entries[0].text === "'") {
            result = "'";
          } else {
            result = '^{' + entries[0].text + '}';
          }
        } else {
          result = '_{' + entries[0].text + '}';
        }
      } else {
        // 多个：最负的是上标，其次为下标
        // 上标（top 最小）
        result = '^{' + entries[0].text + '}';
        // 下标（top 第二小，如果有）
        if (entries.length >= 2) {
          result = '_{' + entries[1].text + '}' + result;
        }
      }
      return result;
    },

    // 处理分数 .mfrac
    // 结构：.mfrac > .vlist-t > .vlist-r > .vlist
    //   分子：span[style="top:-Xem"] > .pstrut + 内容
    //   分母：span[style="top:Yem"] > .pstrut + 内容
    _processFrac: function (fracEl) {
      var entries = [];
      var topSpans = fracEl.querySelectorAll('.vlist > span[style*="top:"]');
      for (var i = 0; i < topSpans.length; i++) {
        var span = topSpans[i];
        var style = span.getAttribute('style') || '';
        var topMatch = style.match(/top:\s*(-?[\d.]+)em/);
        if (!topMatch) continue;
        var topVal = parseFloat(topMatch[1]);
        var contentParts = [];
        var children = span.children;
        for (var j = 0; j < children.length; j++) {
          var child = children[j];
          var childCls = child.getAttribute('class') || '';
          if (/\bpstrut\b/.test(childCls)) continue;
          contentParts.push(this._processNode(child));
        }
        entries.push({ top: topVal, text: contentParts.join('').trim() });
      }
      if (entries.length < 2) {
        return this._nodeText(fracEl);
      }
      // 分子 top 最负（在最上方），分母 top 较大（在最下方）
      entries.sort(function (a, b) { return a.top - b.top; });
      return '\\frac{' + entries[0].text + '}{' + entries[entries.length - 1].text + '}';
    },

    // 处理根号 .msqrt
    // 结构：.msqrt > .vlist-t > .vlist-r > .vlist（含根号符号和被开方数）
    _processSqrt: function (sqrtEl) {
      // 收集所有非根号符号的内容
      var content = this._processChildren(sqrtEl);
      // 移除根号符号 √
      content = content.replace(/√/g, '').trim();
      return '\\sqrt{' + content + '}';
    },

    // 处理 n 次根号 .mroot
    _processRoot: function (rootEl) {
      // 简化处理：取所有文本
      return '\\sqrt[' + this._nodeText(rootEl) + ']{}';
    },

    // 处理矩阵/表格 .mtable（简化：逐行逐格拼接）
    _processMtable: function (tableEl) {
      var rows = tableEl.querySelectorAll('.mtr');
      var rowTexts = [];
      for (var i = 0; i < rows.length; i++) {
        var cells = rows[i].querySelectorAll('.mtd');
        var cellTexts = [];
        for (var j = 0; j < cells.length; j++) {
          cellTexts.push(this._processChildren(cells[j]).trim());
        }
        rowTexts.push(cellTexts.join(' & '));
      }
      return '\\begin{matrix}' + rowTexts.join(' \\\\ ') + '\\end{matrix}';
    },

    // 取节点的文本内容（递归所有文本节点）
    _nodeText: function (node) {
      return node.textContent.trim();
    }
  };

  window.KatexHtmlToLatex = KatexHtmlToLatex;
})();
