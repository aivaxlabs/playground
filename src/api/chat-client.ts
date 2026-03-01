import type { ChatMessage, StreamEvent, ToolCall, ModelConfig, InferenceConfig, FileAttachment } from '../types';

type ChatContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
    | { type: 'file'; file: { filename: string; file_data: string } }
    | { type: 'input_audio'; input_audio: { data: string; format: string } };

interface ChatRequestMessage {
    role: string;
    content: string | ChatContentPart[] | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

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
    messages: ChatRequestMessage[];
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

function extractMimeTypeFromDataUrl(dataUrl: string): string | null {
    const match = dataUrl.match(/^data:([^;]+);base64,/i);
    return match?.[1]?.toLowerCase() ?? null;
}

function extractBase64FromDataUrl(dataUrl: string): string {
    const commaIndex = dataUrl.indexOf(',');
    return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

function getAudioFormat(att: FileAttachment, mimeType: string): string {
    if (mimeType.startsWith('audio/')) {
        return mimeType.split('/')[1].split(';')[0].toLowerCase();
    }

    const ext = att.name.split('.').pop()?.toLowerCase();
    return ext || 'wav';
}

function buildAttachmentPart(att: FileAttachment): ChatContentPart {
    const mimeType = (att.type || extractMimeTypeFromDataUrl(att.data) || '').toLowerCase();

    if (mimeType.startsWith('image/')) {
        return {
            type: 'image_url',
            image_url: { url: att.data }
        };
    }

    if (mimeType.startsWith('audio/')) {
        return {
            type: 'input_audio',
            input_audio: {
                data: extractBase64FromDataUrl(att.data),
                format: getAudioFormat(att, mimeType)
            }
        };
    }

    return {
        type: 'file',
        file: {
            filename: att.name || 'attachment',
            file_data: att.data
        }
    };
}

export function buildRequest(
    modelConfig: ModelConfig,
    inferenceConfig: InferenceConfig,
    messages: ChatMessage[]
): ChatRequest {
    const reqMessages: ChatRequest['messages'] = [];
    const systemPrompt = inferenceConfig.systemPrompt ?? '';
    const stopSequences = Array.isArray(inferenceConfig.stop) ? inferenceConfig.stop : [];
    const toolsJson = inferenceConfig.tools ?? '';
    const structuredJson = inferenceConfig.structuredJson ?? '';
    const extraBody = inferenceConfig.extraBody ?? '';

    if (systemPrompt.trim()) {
        reqMessages.push({
            role: 'system',
            content: systemPrompt
        });
    }

    for (const msg of messages) {
        if (msg.role === 'system') continue;

        const reqMsg: ChatRequestMessage = {
            role: msg.role,
            content: msg.content
        };

        if (msg.attachments && msg.attachments.length > 0 && msg.role === 'user') {
            const parts: ChatContentPart[] = [];

            if (msg.content) {
                parts.push({ type: 'text', text: msg.content });
            }

            for (const att of msg.attachments) {
                parts.push(buildAttachmentPart(att));
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

    if (stopSequences.length > 0) {
        request.stop = stopSequences;
    }

    if (toolsJson.trim()) {
        try {
            request.tools = JSON.parse(toolsJson);
        } catch { }
    }

    if (inferenceConfig.maxCompletionTokens) {
        request.max_completion_tokens = inferenceConfig.maxCompletionTokens;
    }

    if (inferenceConfig.reasoningEffort !== 'null') {
        request.reasoning_effort = inferenceConfig.reasoningEffort;
    }

    if (structuredJson.trim()) {
        try {
            const schema = JSON.parse(structuredJson);
            request.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: 'response',
                    schema
                }
            };
        } catch { }
    }

    if (extraBody.trim()) {
        try {
            const extra = JSON.parse(extraBody);
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
