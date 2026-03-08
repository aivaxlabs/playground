export interface Attachment {
    type: 'image' | 'audio' | 'file';
    name: string;
    mimeType: string;
    dataUrl: string;
}

export interface ToolCall {
    id: string;
    function: { name: string; arguments: string };
    type: 'function';
}

export interface MessageMetrics {
    tokensPerSecond?: number;
    timeToFirstToken?: number;
    totalTime?: number;
    inputTokens?: number;
    cachedTokens?: number;
    outputTokens?: number;
}

export type ReasoningEffort = 'disabled' | 'none' | 'low' | 'medium' | 'high';

export type AssistantMessagePart =
    | { type: 'content'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'tool-call'; index: number };

export interface ChatMessage {
    id: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    model?: string;
    parts?: AssistantMessagePart[];
    attachments?: Attachment[];
    toolCalls?: ToolCall[];
    toolCallId?: string;
    metrics?: MessageMetrics;
    timestamp: number;
}

export interface TabConfig {
    model: string;
    endpoint: string;
    apiKey: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    temperature: number | null;
    topP: number | null;
    frequencyPenalty: number | null;
    presencePenalty: number | null;
    maxTokens: number | null;
    stopSequences: string[] | null;
    tools: any[];
    structuredJson: Record<string, unknown> | null;
    enabledParams: Record<string, boolean>;
}

export interface Tab {
    id: string;
    messages: ChatMessage[];
    config: TabConfig;
    streaming: boolean;
    abortController?: AbortController;
}

const REASONING_EFFORTS: ReasoningEffort[] = ['disabled', 'none', 'low', 'medium', 'high'];

function normalizeNullableNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : null;
}

function normalizeStopSequences(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const stopSequences = value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean);

    return stopSequences.length > 0 ? stopSequences : null;
}

function normalizeJsonObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as Record<string, unknown>;
}

export function normalizeReasoningEffort(value?: string | null): ReasoningEffort {
    return REASONING_EFFORTS.includes(value as ReasoningEffort)
        ? (value as ReasoningEffort)
        : 'disabled';
}

export function normalizeTabConfig(config?: Partial<TabConfig> | null): TabConfig {
    const defaults = createDefaultConfig();

    return {
        ...defaults,
        ...config,
        reasoningEffort: normalizeReasoningEffort(config?.reasoningEffort),
        temperature: normalizeNullableNumber(config?.temperature),
        topP: normalizeNullableNumber(config?.topP),
        frequencyPenalty: normalizeNullableNumber(config?.frequencyPenalty),
        presencePenalty: normalizeNullableNumber(config?.presencePenalty),
        maxTokens: normalizeNullableNumber(config?.maxTokens),
        stopSequences: normalizeStopSequences(config?.stopSequences),
        tools: Array.isArray(config?.tools) ? config.tools : defaults.tools,
        structuredJson: normalizeJsonObject(config?.structuredJson),
        enabledParams: {
            ...defaults.enabledParams,
            ...(config?.enabledParams ?? {}),
        },
    };
}

export function createDefaultConfig(): TabConfig {
    return {
        model: 'gpt-4o',
        endpoint: 'https://api.openai.com/v1',
        apiKey: '',
        systemPrompt: '',
        reasoningEffort: 'disabled',
        temperature: null,
        topP: null,
        frequencyPenalty: null,
        presencePenalty: null,
        maxTokens: null,
        stopSequences: null,
        tools: [],
        structuredJson: null,
        enabledParams: {
            temperature: false,
            topP: false,
            frequencyPenalty: false,
            presencePenalty: false,
            maxTokens: false,
        },
    };
}

export function createTab(): Tab {
    return {
        id: crypto.randomUUID(),
        messages: [],
        config: createDefaultConfig(),
        streaming: false,
    };
}

export function uid(): string {
    return crypto.randomUUID();
}
