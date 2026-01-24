# Chat Playground

A modern, universal OpenAI-compatible chat interface built with vanilla TypeScript and Vite. Connect to any LLM provider that implements the OpenAI API specification.

## Features

- **Universal Compatibility** - Works with OpenAI, DeepSeek, Anthropic (via proxy), local models, and any OpenAI-compatible API
- **Streaming Responses** - Real-time SSE streaming with typing indicators
- **Multi-Chat Tabs** - Manage multiple conversations simultaneously
- **Markdown Rendering** - Full markdown support for assistant messages
- **Reasoning Models** - Displays thinking/reasoning from models like DeepSeek R1 and o1
- **Tool Calling** - Visual tool calls with inline response input
- **File Attachments** - Support for images and files via base64 encoding
- **Message Editing** - Edit messages and regenerate from any point
- **Dark/Light Theme** - Toggle between themes with localStorage persistence
- **Model Discovery** - List available models from your API endpoint
- **IndexedDB Storage** - All data persisted locally in the browser

## Quick Start

```bash
# Install dependencies
bun install

# Development server
bun run dev

# Production build
bun run build
```

## URL Parameters

Pre-configure the app via URL query parameters:

```
?api-endpoint=https://api.openai.com/v1/chat/completions&api-key=sk-xxx&api-model=gpt-4
```

The app will save the configuration and reload to remove sensitive data from the URL.

| Parameter | Description |
|-----------|-------------|
| `api-endpoint` | Full URL to chat completions endpoint |
| `api-key` | API key for authentication |
| `api-model` | Model name/identifier |

## Configuration

### Model Configuration
- **Model Name** - The model identifier (e.g., `gpt-4`, `@deepseek/deepseek-r1`)
- **Endpoint URL** - Chat completions endpoint
- **API Key** - Bearer token for authentication

### Inference Settings
- **System Prompt** - Custom system instructions
- **Temperature** - Sampling temperature (0-2)
- **Max Completion Tokens** - Limit response length
- **Reasoning Effort** - For reasoning models (null, none, minimal, low, medium, high, xhigh)
- **Tools (JSON)** - Function calling definitions

## Tech Stack

- **TypeScript** - Type-safe development
- **Vite** - Fast build tooling
- **IndexedDB** (via idb) - Local data persistence
- **Marked** - Markdown parsing

## License

MIT
