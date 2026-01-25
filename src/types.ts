export interface ModelConfig {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  createdAt: number;
}

export interface InferenceConfig {
  id: string;
  systemPrompt: string;
  temperature: number | null;
  temperatureEnabled: boolean;
  maxCompletionTokens: number | null;
  tools: string;
  reasoningEffort: 'null' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

export interface FileAttachment {
  id: string;
  name: string;
  type: string;
  data: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  reasoning?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  attachments?: FileAttachment[];
  usage?: TokenUsage;
  createdAt: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  responseTimeMs?: number;
  tokensPerSecond?: number;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  modelConfigId: string;
  inferenceConfigId: string;
  createdAt: number;
  updatedAt: number;
}

export interface StreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string | null;
    reasoning?: string | null;
    reasoning_content?: string | null;
    tool_calls?: {
      index: number;
      id?: string;
      type?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }[];
  };
  finish_reason: string | null;
}

export interface StreamEvent {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: StreamChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
}
