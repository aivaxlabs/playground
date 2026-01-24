import type { ChatMessage, StreamEvent, ToolCall, ModelConfig, InferenceConfig } from '../types';

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
    max_completion_tokens?: number;
    tools?: object[];
    reasoning_effort?: string;
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

    return request;
}

export async function* streamChat(
    modelConfig: ModelConfig,
    request: ChatRequest
): AsyncGenerator<StreamEvent> {
    const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${modelConfig.apiKey}`
        },
        body: JSON.stringify(request)
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
