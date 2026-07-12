// content/dom/html-to-markdown.js
// 统一 HTML → Markdown 转换封装，基于 turndown.js v7.2.4 + turndown-plugin-gfm v1.0.2
//
// 依赖：lib/turndown.min.js（需在之前加载，暴露全局 TurndownService）
//      lib/turndown-plugin-gfm.js（需在之前加载，暴露全局 turndownPluginGfm）
//
// 各平台 DOM 适配器通过 window.HtmlToMarkdown.convert(el) 调用，
// 将渲染后的 HTML 容器（.markdown / .segment-content-box 等）转为 Markdown 文本。
//
// 自定义规则：
//   - <div class="paragraph"> 视作 <p> 段落
//   - 移除噪声：svg、.iconify、按钮、操作栏、引用标签等
//   - GFM 插件提供表格/删除线/任务列表/高亮代码块支持

(function () {
  'use strict';

  if (typeof TurndownService === 'undefined') {
    console.warn('[HtmlToMarkdown] TurndownService 未加载，转换将降级为 textContent');
    window.HtmlToMarkdown = {
      convert: function (el) {
        if (!el) return '';
        return el.textContent.trim();
      }
    };
    return;
  }

  var turndownService = new TurndownService({
    headingStyle: 'atx',         // # 风格标题（非 setext === 风格）
    hr: '---',
    bulletListMarker: '-',       // 无序列表用 -
    codeBlockStyle: 'fenced',    // ``` 围栏代码块
    fence: '```',
    emDelimiter: '*',            // *斜体*
    strongDelimiter: '**',       // **粗体**
    linkStyle: 'inlined',        // [text](url) 内联链接
    br: '  ',
    preformattedCode: false
  });

  // 启用 GFM 插件：表格 / 删除线 / 任务列表 / 高亮代码块
  // turndown v7.2.4 默认不转换 <table>，需 GFM 插件支持
  if (typeof turndownPluginGfm !== 'undefined' && turndownPluginGfm.gfm) {
    turndownService.use(turndownPluginGfm.gfm);
  } else {
    console.warn('[HtmlToMarkdown] turndownPluginGfm 未加载，表格将不被转换');
  }

  // 自定义规则：<div class="paragraph"> → 段落
  // Kimi 等平台用 div.paragraph 代替 <p>，turndown 默认将 div 视作块级（仅加换行），
  // 这里显式按段落处理，确保段落间有 \n\n 分隔
  turndownService.addRule('paragraphDiv', {
    filter: function (node) {
      return node.nodeName === 'DIV' &&
             node.getAttribute('class') &&
             /\bparagraph\b/.test(node.getAttribute('class'));
    },
    replacement: function (content) {
      return '\n\n' + content + '\n\n';
    }
  });

  // 自定义规则：千问 <div class="qk-md-paragraph"> → 段落
  // 千问用 div.qk-md-paragraph 代替 <p>，需同样按段落处理
  turndownService.addRule('qkMdParagraphDiv', {
    filter: function (node) {
      return node.nodeName === 'DIV' &&
             node.getAttribute('class') &&
             /\bqk-md-paragraph\b/.test(node.getAttribute('class'));
    },
    replacement: function (content) {
      return '\n\n' + content + '\n\n';
    }
  });

  // 自定义规则：豆包 <div class="container-enLQFx"> → 段落
  // 豆包用 div.container-enLQFx 作为段落容器（div 而非 p）
  turndownService.addRule('doubaoParagraphDiv', {
    filter: function (node) {
      return node.nodeName === 'DIV' &&
             node.getAttribute('class') &&
             /\bcontainer-enLQFx\b/.test(node.getAttribute('class'));
    },
    replacement: function (content) {
      return '\n\n' + content + '\n\n';
    }
  });

  // 自定义规则：KaTeX 行内公式
  // 标准结构：<span class="katex"><span class="katex-mathml"><math>...<annotation encoding="application/x-tex">LATEX</annotation></math></span><span class="katex-html">...</span></span>
  // 降级结构（Kimi 等）：仅有 .katex-html，无 <annotation>，调用 KatexHtmlToLatex 反向解析
  // 输出 $...$
  turndownService.addRule('katexInline', {
    filter: function (node) {
      if (node.nodeName !== 'SPAN') return false;
      var cls = node.getAttribute('class');
      if (!cls || !/\bkatex\b/.test(cls)) return false;
      // 排除被 .katex-display 包裹的情况（由 katexDisplay 规则统一处理）
      var parent = node.parentNode;
      if (parent && parent.getAttribute && parent.getAttribute('class') &&
          /\bkatex-display\b/.test(parent.getAttribute('class'))) {
        return false;
      }
      return true;
    },
    replacement: function (content, node) {
      var latex = HtmlToMarkdown._extractKatexLatex(node);
      return '$' + latex + '$';
    }
  });

  // 自定义规则：KaTeX 块级公式
  // 结构：<span class="katex-display [ds-markdown-math]"><span class="katex">...</span></span>
  // 输出 $$...$$，前后加空行确保 Markdown 块级渲染
  turndownService.addRule('katexDisplay', {
    filter: function (node) {
      return node.nodeName === 'SPAN' &&
             node.getAttribute('class') &&
             /\bkatex-display\b/.test(node.getAttribute('class'));
    },
    replacement: function (content, node) {
      var latex = HtmlToMarkdown._extractKatexLatex(node);
      return '\n\n$$' + latex + '$$\n\n';
    }
  });

  // 噪声元素选择器：转换前从克隆节点中移除
  var NOISE_SELECTORS = [
    'svg',
    '.iconify',
    'style',
    'script',
    'button',
    '.segment-assistant-actions',
    '.segment-user-action-row',
    '[class*="action"]',
    '[class*="toolbar"]',
    '.pua-ref-renderer',
    '.pua-ref-cite-tag',
    '.toolcall-title-container',
    '.thinking-container',
    // DeepSeek 引用图标容器（含 SVG 和隐藏的占位字符，引用编号在相邻的 .ds-markdown-cite 中）
    '._2ed5dee',
    // KaTeX MathML 层（.katex-mathml 是 <annotation> 的容器，源码由 _extractKatexLatex 提取，无需重复渲染）
    '.katex-mathml',
    // 千问搜索结果摘要（嵌套在思考内容中，显示"参考了N篇结果"）
    '[class*="search-wrapper"]',
    // 复旦搜索来源卡片和头像/复制按钮
    '.networking_card',
    '.headImgLeft',
    '.headImgRight',
    '.question_copy_icon',
    '.robot_name',
    '.iconfont',
    // 豆包操作栏、推荐问题、搜索结果块
    '[data-foundation-type="receive-message-action-bar"]',
    '[data-foundation-type="send-message-action-bar"]',
    '[data-foundation-type="receive-message-suggest-foundation"]',
    '[data-plugin-identifier*="block_type:10025"]',
    '[data-plugin-identifier*="block_type:10050"]',
    // 千问视频/文章推荐卡片（回答末尾的相关内容推荐，含缩略图+标题+作者，非回答正文）
    '[data-tpl*="card_video"]',
    // 千问搜索来源按钮（"N篇来源" + 站点图标，无实际 URL，点击才展开）
    '.reference-wrap-iEjeb3',
    // 千问推荐问题（回答结束后"猜你想问"）
    '.recommend-query-wrap'
  ];

  window.HtmlToMarkdown = {
    /**
     * 将 DOM 元素转换为 Markdown 文本
     * @param {Element} el - 要转换的 DOM 元素（如 .markdown 容器）
     * @returns {string} Markdown 文本
     */
    convert: function (el) {
      if (!el) return '';

      // 克隆后移除噪声元素，避免影响原文
      var clone = el.cloneNode(true);
      for (var i = 0; i < NOISE_SELECTORS.length; i++) {
        var nodes = clone.querySelectorAll(NOISE_SELECTORS[i]);
        nodes.forEach(function (n) { n.remove(); });
      }

      // 使用 turndown 转换
      var markdown = turndownService.turndown(clone);

      // 清理：多个连续空行合并为单个，去除首尾空白
      markdown = markdown
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\s+|\s+$/g, '');

      return markdown;
    },

    // 从 KaTeX 节点提取 LaTeX 源码
    // 优先路径：从 <annotation encoding="application/x-tex"> 提取原始 LaTeX（DeepSeek 等标准平台）
    // 降级路径：调用 KatexHtmlToLatex 反向解析 .katex-html（Kimi 等移除了 annotation 的平台）
    _extractKatexLatex: function (node) {
      // 优先：标准 <annotation> 可访问性层
      var ann = node.querySelector('annotation[encoding="application/x-tex"]');
      if (ann && ann.textContent) {
        return ann.textContent;
      }
      // 降级：反向解析 .katex-html
      if (typeof KatexHtmlToLatex !== 'undefined') {
        var katexHtml = node.querySelector('.katex-html');
        if (katexHtml) {
          return KatexHtmlToLatex.convert(katexHtml);
        }
      }
      // 最终降级：纯文本（结构丢失，但保证不中断）
      return node.textContent.trim();
    }
  };

  console.log('[HtmlToMarkdown] 初始化完成 (turndown v7.2.4)');
})();
