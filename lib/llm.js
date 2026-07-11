// lib/llm.js - LLM 服务
// 支持三种后端：
//   1. Qwen/DashScope（阿里云百炼）
//   2. OpenAI 兼容 API（DeepSeek / OpenAI / 其他兼容接口）
//   3. Ollama 本地

const LLMService = {
  _backend: 'dashscope', // 'dashscope' | 'openai' | 'ollama'
  _config: {},
  _initialized: false,

  async init() {
    const settings = await getLLMSettings();
    this._backend = settings.backend || 'dashscope';
    this._config = settings.config || {};
    this._initialized = true;
    console.log(`[LLM] 初始化完成，后端: ${this._backend}`);
  },

  getBackend() {
    return this._backend;
  },

  async setBackend(backend, config = {}) {
    this._backend = backend;
    this._config = config;
    await saveLLMSettings({ backend, config });
  },

  // 主入口：对话式调用
  // messages: [{ role: 'system'|'user'|'assistant', content: '' }]
  // options: { maxTokens, temperature, stream }
  async chat(messages, options = {}) {
    switch (this._backend) {
      case 'dashscope':
        return await this._chatDashscope(messages, options);
      case 'openai':
        return await this._chatOpenAI(messages, options);
      case 'ollama':
        return await this._chatOllama(messages, options);
      default:
        throw new Error(`未知 LLM 后端: ${this._backend}`);
    }
  },

  // 流式对话
  async chatStream(messages, onChunk, options = {}) {
    switch (this._backend) {
      case 'dashscope':
        return await this._chatDashscopeStream(messages, onChunk, options);
      case 'openai':
        return await this._chatOpenAIStream(messages, onChunk, options);
      case 'ollama':
        return await this._chatOllamaStream(messages, onChunk, options);
      default:
        throw new Error(`未知 LLM 后端: ${this._backend}`);
    }
  },

  // ---- Qwen/DashScope ----
  async _chatDashscope(messages, options) {
    const { apiKey, model } = this._config;
    if (!apiKey) throw new Error('未配置 DashScope API Key');

    const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'deepseek-v4-flash',
        messages,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature ?? 0.7
      })
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.choices[0].message.content;
  },

  async _chatDashscopeStream(messages, onChunk, options) {
    const { apiKey, model } = this._config;
    if (!apiKey) throw new Error('未配置 DashScope API Key');

    const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'deepseek-v4-flash',
        messages,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature ?? 0.7,
        stream: true
      })
    });

    return await this._parseSSE(resp, onChunk);
  },

  // ---- OpenAI 兼容 ----
  async _chatOpenAI(messages, options) {
    const { apiKey, baseUrl, model } = this._config;
    if (!apiKey) throw new Error('未配置 API Key');

    const url = `${baseUrl || 'https://api.openai.com'}/v1/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'gpt-3.5-turbo',
        messages,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature ?? 0.7
      })
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.choices[0].message.content;
  },

  async _chatOpenAIStream(messages, onChunk, options) {
    const { apiKey, baseUrl, model } = this._config;
    if (!apiKey) throw new Error('未配置 API Key');

    const url = `${baseUrl || 'https://api.openai.com'}/v1/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'gpt-3.5-turbo',
        messages,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature ?? 0.7,
        stream: true
      })
    });

    return await this._parseSSE(resp, onChunk);
  },

  // ---- Ollama 本地 ----
  async _chatOllama(messages, options) {
    const { baseUrl, model } = this._config;
    const url = `${baseUrl || 'http://localhost:11434'}/api/chat`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'qwen2.5:7b',
        messages,
        stream: false,
        options: {
          num_predict: options.maxTokens || 4096,
          temperature: options.temperature ?? 0.7
        }
      })
    });

    const data = await resp.json();
    return data.message?.content || '';
  },

  async _chatOllamaStream(messages, onChunk, options) {
    const { baseUrl, model } = this._config;
    const url = `${baseUrl || 'http://localhost:11434'}/api/chat`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'qwen2.5:7b',
        messages,
        stream: true,
        options: {
          num_predict: options.maxTokens || 4096,
          temperature: options.temperature ?? 0.7
        }
      })
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            fullContent += json.message.content;
            if (onChunk) onChunk(json.message.content, fullContent);
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }

    return fullContent;
  },

  // ---- SSE 解析（OpenAI/DashScope 通用） ----
  async _parseSSE(resp, onChunk) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullContent += delta;
            if (onChunk) onChunk(delta, fullContent);
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }

    return fullContent;
  }
};

// ============================================================
// AI 问答功能
// ============================================================

const AIAssistant = {
  // 整理信息：检索相关片段 + LLM 归纳总结
  async organizeInfo(query, onChunk) {
    // 1. 生成查询 embedding
    const queryVector = await EmbeddingService.embed(query);
    if (!queryVector) throw new Error('无法生成查询向量，请检查 Embedding 设置');

    // 2. 向量搜索（按召回设置：Top-K / 阈值 / 组合）
    const searchResults = await VectorStore.retrievalSearch(queryVector);

    // 3. 获取相关对话内容
    const contexts = await this._buildContexts(searchResults);

    // 4. 构建 prompt
    const systemPrompt = `你是一个信息整理助手。根据用户提供的对话记录片段，整理和归纳相关信息。
要求：
- 提取关键信息和要点
- 按逻辑组织内容
- 标注信息来源（对话标题）
- 如果信息不足，明确指出
- 用中文回答`;

    const userPrompt = `用户问题：${query}\n\n相关对话片段：\n${contexts}`;

    // 5. 调用 LLM
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    if (onChunk) {
      return await LLMService.chatStream(messages, onChunk);
    }
    return await LLMService.chat(messages);
  },

  // 生成小测验
  async generateQuiz(query, onChunk) {
    const queryVector = await EmbeddingService.embed(query);
    if (!queryVector) throw new Error('无法生成查询向量，请检查 Embedding 设置');

    // 按召回设置（Top-K / 阈值 / 组合）执行检索
    const searchResults = await VectorStore.retrievalSearch(queryVector);
    const contexts = await this._buildContexts(searchResults);

    const systemPrompt = `你是一个教育测验生成助手。根据用户提供的对话记录片段，生成小测验。
要求：
- 生成 5-10 道题目
- 题型包括：选择题、判断题、填空题
- 每题标注正确答案和解析
- 题目应覆盖关键知识点
- 难度适中
- 用中文出题

输出格式：
1. 先输出完整的 Markdown 格式测验内容，包含题目、选项、正确答案和解析
2. 在 Markdown 内容末尾，输出一个 HTML 注释块，内含 JSON 格式的结构化测验数据，用于做题模式解析

JSON 结构如下（type 为 choice/truefalse/fill，分别对应选择题/判断题/填空题）：
<!-- QUIZ_DATA
{"questions":[{"type":"choice","question":"题目内容","options":{"A":"选项A","B":"选项B","C":"选项C","D":"选项D"},"answer":"A","explanation":"解析"},{"type":"truefalse","question":"判断题内容","answer":"正确","explanation":"解析"},{"type":"fill","question":"填空题内容，空格用____表示","answer":"答案","explanation":"解析"}]}
-->

JSON 注意事项：
- JSON 必须完整合法，可被 JSON.parse 解析
- question 和 explanation 中如果需要引用文字，必须使用中文引号""，严禁使用 ASCII 双引号 "
- answer 字段规范：选择题为大写字母（A/B/C/D），判断题固定为"正确"或"错误"，填空题为纯文本答案
- 不要在 JSON 中使用未转义的换行，换行用 \\n 表示
- 填空题答案避免包含特殊字符，数字范围用波浪号（如 65~100）`;

    const userPrompt = `主题：${query}\n\n相关对话片段：\n${contexts}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    if (onChunk) {
      return await LLMService.chatStream(messages, onChunk);
    }
    return await LLMService.chat(messages);
  },

  // 自由问答（RAG）
  async askQuestion(query, onChunk) {
    const queryVector = await EmbeddingService.embed(query);
    if (!queryVector) throw new Error('无法生成查询向量，请检查 Embedding 设置');

    // 按召回设置（Top-K / 阈值 / 组合）执行检索
    const searchResults = await VectorStore.retrievalSearch(queryVector);
    const contexts = await this._buildContexts(searchResults);

    const systemPrompt = `你是一个基于对话记录的问答助手。根据检索到的对话片段回答用户问题。

上下文格式说明：
- 标注 ★ 的消息是与问题高度相关的命中片段，应作为主要回答依据
- 标注 · 的消息是命中消息的上下文（前后发言），仅供理解背景，不要当作答案来源
- 每段对话标题后的"相似度"反映检索置信度：≥0.7 为高相关，0.4-0.7 为中相关，<0.4 为低相关

回答要求：
- 仅基于 ★ 命中消息作答，不要编造信息
- 引用格式：在关键信息后标注 [来源：对话标题]
- 若所有命中相似度均低于 0.4，明确回答"知识库中无明确记录"，不要拼凑答案
- 不要复述"内容过长已截断"等元信息
- 用中文回答`;

    const userPrompt = `问题：${query}\n\n相关对话片段：\n${contexts}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    if (onChunk) {
      return await LLMService.chatStream(messages, onChunk);
    }
    return await LLMService.chat(messages);
  },

  // 从 embId 解析消息定位信息
  // embId 格式：${convId}::msg::${msgHash}::chunk::${chunkIdx}
  // 返回 { msgHash, chunkIdx } 或 null（格式不匹配时）
  _parseEmbId(id) {
    if (!id || typeof id !== 'string') return null;
    const parts = id.split('::');
    if (parts.length < 5) return null;
    // parts: [convId, 'msg', msgHash, 'chunk', chunkIdx]
    if (parts[1] !== 'msg' || parts[3] !== 'chunk') return null;
    const chunkIdx = parseInt(parts[4], 10);
    return { msgHash: parts[2], chunkIdx: isNaN(chunkIdx) ? -1 : chunkIdx };
  },

  // 构建上下文文本：父子文档检索
  // 父 = 命中 chunk 所属的整条消息（按 msgHash 在本地对话中定位）
  // 扩展 = 命中消息前后各 1 条邻居消息，提供发言连贯性
  // 本地对话缺失时跳过（远程库 content 仅供 skill 使用，插件端以本地存储为准）
  async _buildContexts(searchResults) {
    if (!searchResults || searchResults.length === 0) {
      return '（未找到相关对话片段）';
    }

    // 从召回设置读取单对话上下文上限（用户可在设置页调整）
    const rs = await getRetrievalSettings();
    const maxCharsPerConv = Math.max(500, rs.maxContextChars || 8000);

    // 按 convId 分组，同对话的多 chunk 命中合并处理
    const convMap = new Map(); // convId -> { bestScore, msgHashes: Set }
    for (const r of searchResults) {
      if (!r.convId) continue;
      const parsed = this._parseEmbId(r.id);
      const msgHash = parsed?.msgHash || '';
      if (!convMap.has(r.convId)) {
        convMap.set(r.convId, { bestScore: r.score || 0, msgHashes: new Set() });
      } else {
        const entry = convMap.get(r.convId);
        entry.bestScore = Math.max(entry.bestScore, r.score || 0);
        if (msgHash) entry.msgHashes.add(msgHash);
      }
    }

    const contexts = [];

    for (const [convId, info] of convMap) {
      try {
        const conv = await getConversation(convId);
        if (!conv) {
          // 本地对话缺失（远程库命中但本地未同步）：跳过，不喂 LLM 模糊内容
          console.warn('[AIAssistant] 本地对话缺失，跳过:', convId);
          continue;
        }

        const messages = conv.messages || [];
        if (messages.length === 0) continue;

        // 定位命中的消息索引
        const hitIndices = new Set();
        if (info.msgHashes.size > 0) {
          messages.forEach((msg, idx) => {
            if (msg.hash && info.msgHashes.has(String(msg.hash))) {
              hitIndices.add(idx);
            }
          });
        }

        let contextText = `--- 对话：${conv.title}（相似度: ${info.bestScore.toFixed(3)}）---\n`;
        let charCount = 0;
        let addedCount = 0;

        if (hitIndices.size > 0) {
          // 父子检索路径：命中消息 + 前后各 1 条邻居，按索引排序
          const contextIndices = new Set();
          for (const idx of hitIndices) {
            contextIndices.add(idx);
            if (idx - 1 >= 0) contextIndices.add(idx - 1);
            if (idx + 1 < messages.length) contextIndices.add(idx + 1);
          }
          const sortedIndices = [...contextIndices].sort((a, b) => a - b);
          for (const idx of sortedIndices) {
            if (charCount >= maxCharsPerConv) {
              contextText += '...（内容过长，已截断）\n';
              break;
            }
            const msg = messages[idx];
            const role = msg.role === 'user' ? '用户' : '助手';
            const filtered = EmbeddingService.filterContentForEmbedding(msg.content || '');
            if (!filtered) continue;
            // 命中消息取完整内容（父文档），邻居消息取前 500 字
            const isHit = hitIndices.has(idx);
            const content = isHit ? filtered : filtered.substring(0, 500);
            const mark = isHit ? '★' : '·';
            contextText += `[${role}${mark}]: ${content}\n`;
            charCount += content.length;
            addedCount++;
          }
        } else {
          // 回退路径：msgHash 未匹配上（老数据或 hash 缺失），遍历整对话
          for (const msg of messages) {
            if (charCount >= maxCharsPerConv) {
              contextText += '...（内容过长，已截断）\n';
              break;
            }
            const role = msg.role === 'user' ? '用户' : '助手';
            const filtered = EmbeddingService.filterContentForEmbedding(msg.content || '');
            if (!filtered) continue;
            const content = filtered.substring(0, 500);
            contextText += `[${role}]: ${content}\n`;
            charCount += content.length;
            addedCount++;
          }
        }

        if (addedCount > 0) {
          contexts.push(contextText);
        }
      } catch (e) {
        console.error('[AIAssistant] 获取对话失败:', convId, e);
      }
    }

    return contexts.join('\n\n') || '（未找到相关对话片段）';
  },

  // 导出整理结果为文本
  exportAsText(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || '整理结果.txt';
    a.click();
    URL.revokeObjectURL(url);
  }
};

// ============================================================
// 设置持久化
// ============================================================

async function getLLMSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('llmSettings', (result) => {
      resolve(result.llmSettings || { backend: 'dashscope', config: {} });
    });
  });
}

async function saveLLMSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ llmSettings: settings }, resolve);
  });
}
