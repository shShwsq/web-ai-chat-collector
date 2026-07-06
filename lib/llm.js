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

    // 2. 向量搜索
    const searchResults = await VectorStore.similaritySearch(queryVector, 20);

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

    const searchResults = await VectorStore.similaritySearch(queryVector, 20);
    const contexts = await this._buildContexts(searchResults);

    const systemPrompt = `你是一个教育测验生成助手。根据用户提供的对话记录片段，生成小测验。
要求：
- 生成 5-10 道题目
- 题型包括：选择题、判断题、填空题
- 每题标注正确答案和解析
- 题目应覆盖关键知识点
- 难度适中
- 用中文出题`;

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

    const searchResults = await VectorStore.similaritySearch(queryVector, 10);
    const contexts = await this._buildContexts(searchResults);

    const systemPrompt = `你是一个基于对话记录的问答助手。根据检索到的对话片段回答用户问题。
要求：
- 基于提供的对话片段回答，不要编造信息
- 如果片段中没有相关信息，明确说明
- 引用来源对话
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

  // 构建上下文文本
  async _buildContexts(searchResults) {
    if (!searchResults || searchResults.length === 0) {
      return '（未找到相关对话片段）';
    }

    const convIds = [...new Set(searchResults.map(r => r.convId).filter(Boolean))];
    const contexts = [];

    for (const convId of convIds) {
      try {
        const conv = await getConversation(convId);
        if (!conv) continue;

        // 找到与该对话相关的搜索结果
        const relatedResults = searchResults.filter(r => r.convId === convId);

        // 提取相关消息片段
        let contextText = `--- 对话：${conv.title}（相似度: ${relatedResults[0]?.score?.toFixed(3) || 'N/A'}）---\n`;

        // 限制上下文长度，避免超出 token 限制
        const maxChars = 3000;
        let charCount = 0;

        for (const msg of conv.messages) {
          if (charCount >= maxChars) {
            contextText += '...（内容过长，已截断）\n';
            break;
          }
          const role = msg.role === 'user' ? '用户' : '助手';
          // 与向量库嵌入保持一致的过滤口径：按设置剥离 <think>/<search_result> 块
          const filtered = EmbeddingService.filterContentForEmbedding(msg.content || '');
          if (!filtered) continue;
          const content = filtered.substring(0, 500);
          contextText += `[${role}]: ${content}\n`;
          charCount += content.length;
        }

        contexts.push(contextText);
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
