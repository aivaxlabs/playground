import type { DebugInfo, Tab, MessageMetrics, ToolCall } from './types';

export interface StreamTextPart {
    type: 'content' | 'reasoning';
    text: string;
}

export interface StreamCallbacks {
    onPart: (part: StreamTextPart) => void;
    onToolCalls: (toolCalls: ToolCall[], newIndexes: number[]) => void;
    onDone: (metrics: MessageMetrics) => void;
    onError: (error: string) => void;
    onDebug: (debugInfo: DebugInfo) => void;
}

function sanitizeHeaderValue(name: string, value: string): string {
    const lowerName = name.toLowerCase();
    if (lowerName === 'authorization') {
        return value.startsWith('Bearer ') ? 'Bearer [hidden]' : '[hidden]';
    }

    if (lowerName === 'x-api-key' || lowerName === 'api-key') {
        return '[hidden]';
    }

    return value;
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name, sanitizeHeaderValue(name, value)]),
    );
}

function readResponseHeaders(response: Response): Record<string, string> {
    const entries: Array<[string, string]> = [];
    response.headers.forEach((value, key) => {
        entries.push([key, sanitizeHeaderValue(key, value)]);
    });
    return Object.fromEntries(entries);
}

function truncateDataUrl(dataUrl: string, maxLength: number): string {
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex === -1) {
        return dataUrl.length > maxLength
            ? `${dataUrl.slice(0, maxLength)}...[truncated ${dataUrl.length - maxLength} chars]`
            : dataUrl;
    }

    const prefix = dataUrl.slice(0, commaIndex + 1);
    const payload = dataUrl.slice(commaIndex + 1);
    if (payload.length <= maxLength) {
        return dataUrl;
    }

    return `${prefix}${payload.slice(0, maxLength)}...[truncated ${payload.length - maxLength} chars]`;
}

function sanitizeValueForDebug(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(item => sanitizeValueForDebug(item));
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
            if (key === 'file_data' && typeof entryValue === 'string') {
                return [key, truncateDataUrl(entryValue, 160)];
            }

            if (key === 'data' && typeof entryValue === 'string') {
                return [
                    key,
                    entryValue.length > 160
                        ? `${entryValue.slice(0, 160)}...[truncated ${entryValue.length - 160} chars]`
                        : entryValue,
                ];
            }

            if (key === 'url' && typeof entryValue === 'string' && entryValue.startsWith('data:')) {
                return [key, truncateDataUrl(entryValue, 160)];
            }

            return [key, sanitizeValueForDebug(entryValue)];
        }),
    );
}

function createDebugInfo(url: string, headers: Record<string, string>, body: unknown): DebugInfo {
    return {
        requestUrl: url,
        requestMethod: 'POST',
        requestHeaders: sanitizeHeaders(headers),
        requestBody: JSON.stringify(sanitizeValueForDebug(body), null, 2),
        responseHeaders: {},
        modelResponse: '',
        sseResponse: '',
        updatedAt: Date.now(),
    };
}

function aggregateModelResponse(events: any[]): string {
    const toolCalls: ToolCall[] = [];
    const reasoningParts: StreamTextPart[] = [];
    const contentParts: StreamTextPart[] = [];
    let usage: Record<string, unknown> | undefined;
    let finishReason: string | null = null;
    let id: string | undefined;
    let model: string | undefined;
    let created: number | undefined;
    let systemFingerprint: string | undefined;

    for (const event of events) {
        if (!event || typeof event !== 'object') {
            continue;
        }

        if (typeof event.id === 'string') id = event.id;
        if (typeof event.model === 'string') model = event.model;
        if (typeof event.created === 'number') created = event.created;
        if (typeof event.system_fingerprint === 'string') systemFingerprint = event.system_fingerprint;
        if (event.usage && typeof event.usage === 'object') usage = event.usage as Record<string, unknown>;

        const choice = event.choices?.[0];
        if (!choice) {
            continue;
        }

        if (typeof choice.finish_reason === 'string') {
            finishReason = choice.finish_reason;
        }

        const delta = choice.delta;
        if (!delta || typeof delta !== 'object') {
            continue;
        }

        pushStructuredTextParts(delta.content, 'content', contentParts);
        pushStructuredTextParts(delta.reasoning, 'reasoning', reasoningParts);
        pushStructuredTextParts(delta.reasoning_content, 'reasoning', reasoningParts);
        pushStructuredTextParts(delta.reasoning_details, 'reasoning', reasoningParts);

        if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
                const index = tc.index ?? toolCalls.length;
                if (!toolCalls[index]) {
                    toolCalls[index] = {
                        id: tc.id || '',
                        type: 'function',
                        function: { name: '', arguments: '' },
                    };
                }
                if (tc.id) toolCalls[index].id = tc.id;
                if (tc.function?.name) toolCalls[index].function.name += tc.function.name;
                if (tc.function?.arguments) toolCalls[index].function.arguments += tc.function.arguments;
            }
        }
    }

    return JSON.stringify({
        id,
        object: 'chat.completion.aggregated',
        created,
        model,
        system_fingerprint: systemFingerprint,
        finish_reason: finishReason,
        reasoning: reasoningParts.map(part => part.text).join(''),
        content: contentParts.map(part => part.text).join(''),
        tool_calls: toolCalls.filter(Boolean),
        usage,
    }, null, 2);
}

function getStructuredResponseFormat(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const responseFormat = (value as Record<string, unknown>).response_format;
    return responseFormat && typeof responseFormat === 'object' && !Array.isArray(responseFormat)
        ? (responseFormat as Record<string, unknown>)
        : null;
}

function cloneToolCalls(toolCalls: ToolCall[]): ToolCall[] {
    return toolCalls.map(tc => ({
        ...tc,
        function: {
            ...tc.function,
        },
    }));
}

function pushStructuredTextParts(value: any, fallbackType: StreamTextPart['type'], parts: StreamTextPart[]) {
    if (typeof value === 'string') {
        if (value.length > 0) {
            parts.push({ type: fallbackType, text: value });
        }
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            pushStructuredTextParts(item, fallbackType, parts);
        }
        return;
    }

    if (!value || typeof value !== 'object') {
        return;
    }

    const hintedType = typeof value.type === 'string' && value.type.toLowerCase().includes('reason')
        ? 'reasoning'
        : fallbackType;

    const directValues = [value.text, value.value, value.content, value.reasoning, value.reasoning_content];
    for (const directValue of directValues) {
        if (typeof directValue === 'string' && directValue.length > 0) {
            parts.push({ type: hintedType, text: directValue });
            return;
        }
    }

    const nestedValues = [value.text, value.value, value.content, value.reasoning, value.reasoning_content, value.items];
    for (const nestedValue of nestedValues) {
        if (Array.isArray(nestedValue)) {
            pushStructuredTextParts(nestedValue, hintedType, parts);
            return;
        }
    }
}

function emitTextParts(value: any, fallbackType: StreamTextPart['type'], callbacks: StreamCallbacks, touchFirstChunk: () => void, bumpOutputToken: () => void) {
    const parts: StreamTextPart[] = [];
    pushStructuredTextParts(value, fallbackType, parts);

    for (const part of parts) {
        touchFirstChunk();
        bumpOutputToken();
        callbacks.onPart(part);
    }
}

function buildMessages(tab: Tab): any[] {
    const msgs: any[] = [];

    if (tab.config.systemPrompt.trim()) {
        msgs.push({ role: 'system', content: tab.config.systemPrompt });
    }

    for (const msg of tab.messages) {
        if (msg.role === 'assistant' && !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0)) {
            continue;
        }

        if (msg.role === 'tool') {
            msgs.push({
                role: 'tool',
                tool_call_id: msg.toolCallId,
                content: msg.content,
            });
            continue;
        }

        if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
            msgs.push({
                role: 'assistant',
                content: typeof msg.content === 'string' ? msg.content : '',
                tool_calls: msg.toolCalls,
            });
            continue;
        }

        if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
            const parts: any[] = [];
            for (const att of msg.attachments) {
                if (att.type === 'image') {
                    parts.push({ type: 'image_url', image_url: { url: att.dataUrl } });
                } else if (att.type === 'audio') {
                    const formatMatch = att.mimeType.match(/audio\/(\w+)/);
                    const format = formatMatch ? formatMatch[1] : 'wav';
                    const base64 = att.dataUrl.split(',')[1] || att.dataUrl;
                    parts.push({ type: 'input_audio', input_audio: { data: base64, format } });
                } else if (att.type === 'video') {
                    parts.push({ type: 'video_url', video_url: { url: att.dataUrl } });
                } else {
                    const base64 = att.dataUrl.split(',')[1] || att.dataUrl;
                    parts.push({
                        type: 'file',
                        file: {
                            filename: att.name,
                            file_data: `data:${att.mimeType};base64,${base64}`,
                        },
                    });
                }
            }
            if (msg.content) {
                parts.push({ type: 'text', text: msg.content });
            }
            msgs.push({ role: 'user', content: parts });
            continue;
        }

        msgs.push({ role: msg.role, content: msg.content });
    }

    return msgs;
}

export async function streamChat(tab: Tab, callbacks: StreamCallbacks): Promise<AbortController> {
    const controller = new AbortController();
    const cfg = tab.config;
    const base = cfg.endpoint.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    const url = base + '/chat/completions';

    const ep = cfg.enabledParams || {};
    const body: any = {
        model: cfg.model,
        messages: buildMessages(tab),
        stream: true,
    };

    if (ep.temperature === true && cfg.temperature != null) body.temperature = cfg.temperature;
    if (ep.topP === true && cfg.topP != null) body.top_p = cfg.topP;
    if (ep.frequencyPenalty === true && cfg.frequencyPenalty != null) body.frequency_penalty = cfg.frequencyPenalty;
    if (ep.presencePenalty === true && cfg.presencePenalty != null) body.presence_penalty = cfg.presencePenalty;
    if (ep.maxTokens === true && cfg.maxTokens != null && cfg.maxTokens > 0) body.max_tokens = cfg.maxTokens;
    if (cfg.stopSequences && cfg.stopSequences.length > 0) body.stop = cfg.stopSequences;
    if (cfg.tools.length > 0) body.tools = cfg.tools;
    if (cfg.reasoningEffort && cfg.reasoningEffort !== 'disabled') body.reasoning_effort = cfg.reasoningEffort;

    const responseFormat = getStructuredResponseFormat(cfg.structuredJson);
    if (responseFormat) body.response_format = responseFormat;

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

    const debugInfo = createDebugInfo(url, headers, body);
    const sseEvents: any[] = [];
    callbacks.onDebug({ ...debugInfo });

    const startTime = performance.now();
    let firstTokenTime = 0;
    let outputTokens = 0;
    let inputTokens = 0;
    let cachedTokens = 0;
    let toolCalls: ToolCall[] = [];

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        debugInfo.responseStatus = response.status;
        debugInfo.responseStatusText = response.statusText;
        debugInfo.responseHeaders = readResponseHeaders(response);
        debugInfo.updatedAt = Date.now();
        callbacks.onDebug({ ...debugInfo });

        if (!response.ok) {
            const errText = await response.text();
            debugInfo.error = `HTTP ${response.status}: ${errText}`;
            debugInfo.modelResponse = errText;
            debugInfo.updatedAt = Date.now();
            callbacks.onDebug({ ...debugInfo });
            callbacks.onError(`HTTP ${response.status}: ${errText}`);
            callbacks.onDone({ totalTime: Math.round(performance.now() - startTime) });
            return controller;
        }

        const reader = response.body?.getReader();
        if (!reader) {
            callbacks.onError('No response body');
            callbacks.onDone({ totalTime: Math.round(performance.now() - startTime) });
            return controller;
        }

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
                if (!trimmed) continue;

                debugInfo.sseResponse += `${trimmed}\n`;
                debugInfo.updatedAt = Date.now();

                if (!trimmed.startsWith('data: ')) {
                    callbacks.onDebug({ ...debugInfo });
                    continue;
                }

                const data = trimmed.slice(6);
                if (data === '[DONE]') {
                    callbacks.onDebug({ ...debugInfo });
                    continue;
                }

                try {
                    const parsed = JSON.parse(data);
                    sseEvents.push(parsed);
                    debugInfo.modelResponse = aggregateModelResponse(sseEvents);
                    debugInfo.updatedAt = Date.now();
                    callbacks.onDebug({ ...debugInfo });

                    if (parsed.error) {
                        debugInfo.error = `${parsed.error.code || 'error'}: ${parsed.error.message || 'Unknown SSE error'}`;
                        debugInfo.updatedAt = Date.now();
                        callbacks.onDebug({ ...debugInfo });
                        callbacks.onError(`${parsed.error.code || 'error'}: ${parsed.error.message || 'Unknown SSE error'}`);
                        continue;
                    }

                    const choice = parsed.choices?.[0];
                    if (!choice) {
                        if (parsed.usage) {
                            inputTokens = parsed.usage.prompt_tokens || 0;
                            cachedTokens = parsed.usage.prompt_tokens_details?.cached_tokens || 0;
                            outputTokens = parsed.usage.completion_tokens || 0;
                        }
                        continue;
                    }

                    if (choice.finish_reason === 'error') {
                        const errMsg = parsed.error?.message || 'The model returned an error';
                        callbacks.onError(errMsg);
                        continue;
                    }

                    const delta = choice.delta;
                    const markFirstChunk = () => {
                        if (!firstTokenTime) {
                            firstTokenTime = performance.now();
                        }
                    };

                    if (delta && typeof delta === 'object') {
                        for (const [key, value] of Object.entries(delta)) {
                            if (key === 'content') {
                                emitTextParts(value, 'content', callbacks, markFirstChunk, () => { outputTokens++; });
                                continue;
                            }

                            if (key === 'reasoning' || key === 'reasoning_content' || key === 'reasoning_details') {
                                emitTextParts(value, 'reasoning', callbacks, markFirstChunk, () => { outputTokens++; });
                                continue;
                            }

                            if (key === 'tool_calls' && Array.isArray(value)) {
                                markFirstChunk();

                                const newIndexes: number[] = [];
                                for (const tc of value) {
                                    const idx = tc.index ?? toolCalls.length;
                                    if (!toolCalls[idx]) {
                                        toolCalls[idx] = {
                                            id: tc.id || '',
                                            type: 'function',
                                            function: { name: '', arguments: '' },
                                        };
                                        newIndexes.push(idx);
                                    }
                                    if (tc.id) toolCalls[idx].id = tc.id;
                                    if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
                                    if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
                                }

                                callbacks.onToolCalls(cloneToolCalls(toolCalls), newIndexes);
                            }
                        }
                    }

                    if (parsed.usage) {
                        inputTokens = parsed.usage.prompt_tokens || inputTokens;
                        cachedTokens = parsed.usage.prompt_tokens_details?.cached_tokens || cachedTokens;
                        outputTokens = parsed.usage.completion_tokens || outputTokens;
                    }
                } catch {
                    // skip malformed JSON
                }
            }
        }
    } catch (err: any) {
        if (err.name !== 'AbortError') {
            debugInfo.error = err.message || 'Unknown error';
            debugInfo.updatedAt = Date.now();
            callbacks.onDebug({ ...debugInfo });
            callbacks.onError(err.message || 'Unknown error');
        }
    }

    const totalTime = performance.now() - startTime;
    const ttft = firstTokenTime ? firstTokenTime - startTime : 0;
    const tps = totalTime > 0 && outputTokens > 0 ? (outputTokens / (totalTime / 1000)) : 0;

    callbacks.onDone({
        tokensPerSecond: Math.round(tps * 100) / 100,
        timeToFirstToken: Math.round(ttft),
        totalTime: Math.round(totalTime),
        inputTokens,
        cachedTokens,
        outputTokens,
    });

    debugInfo.updatedAt = Date.now();
    callbacks.onDebug({ ...debugInfo });

    return controller;
}
