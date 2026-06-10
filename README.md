# AI Chat Exporter

A browser extension that automatically captures and exports AI conversation records.

## Supported Platforms

| Platform | Network Interception | DOM Mode |
|----------|:-------------------:|:--------:|
| DeepSeek (chat.deepseek.com) | ✅ | ✅ |
| Tongyi Qianwen (qianwen.com) | ✅ | ✅ |
| Fudan AI Agent (aiagent.fudan.edu.cn) | ✅ | ✅ |

## Mode Descriptions

### Network Interception Mode (Recommended)

Intercepts browser network requests and parses conversation data directly from API responses. Data is complete and accurate, capable of extracting:

- Conversation content (user questions + AI responses)
- Deep thinking / reasoning process
- Search sources and citations
- Conversation titles

### DOM Mode

Extracts conversation content by parsing the page DOM structure. Serves as a fallback when network interception is not available.

**Known Limitations:**

- DOM mode may not accurately identify search sources and thinking content, as the page DOM structure can change dynamically and thinking/search blocks are rendered alongside the main response
- Network interception mode is recommended for the best data completeness

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the project root directory

## Usage

After installation, visit a supported AI platform and the extension will automatically capture conversations. Click the floating ball to view, search, and export saved conversations.

## Export Formats

- Markdown
- JSON
