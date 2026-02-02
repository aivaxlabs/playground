import type { ChatMessage, StreamEvent, ToolCall, ModelConfig, InferenceConfig } from '../types';

function deepMerge<T extends Record<string, unknown>>(target: T, source: Record<string, unknown>): T {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        const sourceVal = source[key];
        const targetVal = result[key as keyof T];
        if (
            sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal) &&
            targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)
        ) {
            (result as Record<string, unknown>)[key] = deepMerge(
                targetVal as Record<string, unknown>,
                sourceVal as Record<string, unknown>
            );
        } else {
            (result as Record<string, unknown>)[key] = sourceVal;
        }
    }
    return result;
}

export interface ChatRequest {
    model: string;
    messages: {
        role: string;
        content: string | { type: string; text?: string; image_url?: { url: string } }[] | null;
        tool_calls?: ToolCall[];
        tool_call_id?: string;
    }[];
    stream: boolean;
    temperature?: number;
    top_k?: number;
    top_p?: number;
    stop?: string[];
    max_completion_tokens?: number;
    tools?: object[];
    reasoning_effort?: string;
    response_format?: object;
    [key: string]: unknown;
}

export function buildRequest(
    modelConfig: ModelConfig,
    inferenceConfig: InferenceConfig,
    messages: ChatMessage[]
): ChatRequest {
    const reqMessages: ChatRequest['messages'] = [];

    if (inferenceConfig.systemPrompt.trim()) {
        reqMessages.push({
            role: 'system',
            content: inferenceConfig.systemPrompt
        });
    }

    for (const msg of messages) {
        if (msg.role === 'system') continue;

        const reqMsg: ChatRequest['messages'][0] = {
            role: msg.role,
            content: msg.content
        };

        if (msg.attachments && msg.attachments.length > 0 && msg.role === 'user') {
            const parts: { type: string; text?: string; image_url?: { url: string } }[] = [];

            if (msg.content) {
                parts.push({ type: 'text', text: msg.content });
            }

            for (const att of msg.attachments) {
                if (att.type.startsWith('image/')) {
                    parts.push({
                        type: 'image_url',
                        image_url: { url: att.data }
                    });
                }
            }

            reqMsg.content = parts;
        }

        if (msg.toolCalls) {
            reqMsg.tool_calls = msg.toolCalls;
        }

        if (msg.toolCallId) {
            reqMsg.tool_call_id = msg.toolCallId;
        }

        reqMessages.push(reqMsg);
    }

    const request: ChatRequest = {
        model: modelConfig.name,
        messages: reqMessages,
        stream: true
    };

    if (inferenceConfig.temperatureEnabled && inferenceConfig.temperature !== null) {
        request.temperature = inferenceConfig.temperature;
    }

    if (inferenceConfig.top_k !== null && inferenceConfig.top_k > 0) {
        request.top_k = inferenceConfig.top_k;
    }

    if (inferenceConfig.top_p !== null && inferenceConfig.top_p > 0) {
        request.top_p = inferenceConfig.top_p;
    }

    if (inferenceConfig.stop.length > 0) {
        request.stop = inferenceConfig.stop;
    }

    if (inferenceConfig.tools.trim()) {
        try {
            request.tools = JSON.parse(inferenceConfig.tools);
        } catch { }
    }

    if (inferenceConfig.maxCompletionTokens) {
        request.max_completion_tokens = inferenceConfig.maxCompletionTokens;
    }

    if (inferenceConfig.reasoningEffort !== 'null') {
        request.reasoning_effort = inferenceConfig.reasoningEffort;
    }

    if (inferenceConfig.structuredJson?.trim()) {
        try {
            const schema = JSON.parse(inferenceConfig.structuredJson);
            request.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: 'response',
                    schema
                }
            };
        } catch { }
    }

    if (inferenceConfig.extraBody?.trim()) {
        try {
            const extra = JSON.parse(inferenceConfig.extraBody);
            return deepMerge(request, extra);
        } catch { }
    }

    return request;
}

export async function* streamChat(
    modelConfig: ModelConfig,
    request: ChatRequest,
    signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
    const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${modelConfig.apiKey}`
        },
        body: JSON.stringify(request),
        signal
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;

            if (trimmed.startsWith('data: ')) {
                try {
                    const data = JSON.parse(trimmed.slice(6));
                    yield data as StreamEvent;
                } catch { }
            }
        }
    }
}
