import type { ChatRequest } from './chat-client';
import type { ModelConfig, ChatMessage } from '../types';

export interface ParsedCurlCommand {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: any;
}

export interface ImportedConfig {
    endpoint: string;
    apiKey: string;
    model: string;
    messages: ChatMessage[];
    systemPrompt: string;
    temperature?: number;
    topK?: number;
    topP?: number;
    maxTokens?: number;
    stop?: string[];
    tools?: string;
    reasoningEffort?: string;
}

function extractDataBody(text: string): { found: boolean; data: string; remaining: string } {
    const dataFlags = ['-d', '--data', '--data-raw', '--data-binary'];

    for (const flag of dataFlags) {
        const flagIndex = text.indexOf(flag + ' ');
        if (flagIndex === -1) continue;

        const afterFlag = text.slice(flagIndex + flag.length).trimStart();

        if (afterFlag.startsWith("$'")) {
            const start = 2;
            let end = start;
            let depth = 0;
            while (end < afterFlag.length) {
                const char = afterFlag[end];
                if (char === '\\' && end + 1 < afterFlag.length) {
                    end += 2;
                    continue;
                }
                if (char === '{') depth++;
                if (char === '}') depth--;
                if (char === "'" && depth === 0) break;
                end++;
            }
            const data = afterFlag.slice(start, end);
            const remaining = text.slice(0, flagIndex) + ' ' + afterFlag.slice(end + 1);
            return { found: true, data, remaining };
        }

        const quoteChar = afterFlag[0];
        if (quoteChar === "'" || quoteChar === '"') {
            let end = 1;
            let depth = 0;
            while (end < afterFlag.length) {
                const char = afterFlag[end];
                if (char === '\\' && end + 1 < afterFlag.length) {
                    end += 2;
                    continue;
                }
                if (char === '{') depth++;
                if (char === '}') depth--;
                if (char === quoteChar && depth === 0) break;
                end++;
            }
            const data = afterFlag.slice(1, end);
            const remaining = text.slice(0, flagIndex) + ' ' + afterFlag.slice(end + 1);
            return { found: true, data, remaining };
        }

        const spaceIndex = afterFlag.indexOf(' ');
        if (spaceIndex === -1) {
            return { found: true, data: afterFlag, remaining: text.slice(0, flagIndex) };
        }
        const data = afterFlag.slice(0, spaceIndex);
        const remaining = text.slice(0, flagIndex) + ' ' + afterFlag.slice(spaceIndex);
        return { found: true, data, remaining };
    }

    return { found: false, data: '', remaining: text };
}

export function parseCurlCommand(curlCommand: string): ParsedCurlCommand {
    const normalized = curlCommand
        .replace(/\\\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized.toLowerCase().startsWith('curl ')) {
        throw new Error('Invalid cURL command: must start with "curl"');
    }

    const result: ParsedCurlCommand = {
        url: '',
        method: 'GET',
        headers: {},
        body: null
    };

    let remaining = normalized.slice(5).trim();

    const headerRegex = /(?:^|\s)(?:-H|--header)\s+(['"])((?:(?!\1).)*)\1/gi;
    let headerMatch;
    while ((headerMatch = headerRegex.exec(remaining)) !== null) {
        const headerValue = headerMatch[2];
        const colonIndex = headerValue.indexOf(':');
        if (colonIndex > 0) {
            const key = headerValue.slice(0, colonIndex).trim();
            const value = headerValue.slice(colonIndex + 1).trim();
            result.headers[key] = value;
        }
    }
    remaining = remaining.replace(headerRegex, ' ');

    const methodRegex = /(?:^|\s)(?:-X|--request)\s+(['"]?)(\w+)\1/i;
    const methodMatch = remaining.match(methodRegex);
    if (methodMatch) {
        result.method = methodMatch[2].toUpperCase();
        remaining = remaining.replace(methodRegex, ' ');
    }

    const dataBody = extractDataBody(remaining);
    if (dataBody.found) {
        try {
            result.body = JSON.parse(dataBody.data);
        } catch {
            result.body = dataBody.data;
        }
        result.method = 'POST';
        remaining = dataBody.remaining;
    }

    remaining = remaining.replace(/(?:^|\s)(?:--compressed|-s|--silent|-S|--show-error|-k|--insecure|-L|--location)/gi, ' ');

    const urlMatch = remaining.match(/(['"])(https?:\/\/[^'"]+)\1|(?:^|\s)(https?:\/\/\S+)/);
    if (urlMatch) {
        result.url = urlMatch[2] || urlMatch[3];
    }

    if (!result.url) {
        throw new Error('No URL found in cURL command');
    }

    return result;
}

export function importFromCurl(parsed: ParsedCurlCommand): ImportedConfig {
    const result: ImportedConfig = {
        endpoint: parsed.url,
        apiKey: '',
        model: '',
        messages: [],
        systemPrompt: ''
    };

    const authHeader = parsed.headers['Authorization'] || parsed.headers['authorization'];
    if (authHeader) {
        const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
        if (bearerMatch) {
            result.apiKey = bearerMatch[1];
        }
    }

    if (parsed.body && typeof parsed.body === 'object') {
        const body = parsed.body;

        if (body.model) {
            result.model = body.model;
        }

        if (Array.isArray(body.messages)) {
            for (const msg of body.messages) {
                if (msg.role === 'system') {
                    result.systemPrompt = typeof msg.content === 'string' ? msg.content : '';
                    continue;
                }

                const chatMsg: ChatMessage = {
                    id: crypto.randomUUID(),
                    role: msg.role,
                    content: typeof msg.content === 'string' ? msg.content : null,
                    createdAt: Date.now()
                };

                if (msg.tool_calls) {
                    chatMsg.toolCalls = msg.tool_calls;
                }

                if (msg.tool_call_id) {
                    chatMsg.toolCallId = msg.tool_call_id;
                }

                result.messages.push(chatMsg);
            }
        }

        if (body.temperature !== undefined) {
            result.temperature = body.temperature;
        }

        if (body.top_k !== undefined) {
            result.topK = body.top_k;
        }

        if (body.top_p !== undefined) {
            result.topP = body.top_p;
        }

        if (body.max_completion_tokens !== undefined) {
            result.maxTokens = body.max_completion_tokens;
        } else if (body.max_tokens !== undefined) {
            result.maxTokens = body.max_tokens;
        }

        if (body.stop) {
            result.stop = Array.isArray(body.stop) ? body.stop : [body.stop];
        }

        if (body.tools) {
            result.tools = JSON.stringify(body.tools, null, 2);
        }

        if (body.reasoning_effort) {
            result.reasoningEffort = body.reasoning_effort;
        }
    }

    return result;
}

export function generateCurlCommand(
    modelConfig: ModelConfig,
    request: ChatRequest,
    embedApiKey: boolean
): string {
    const lines: string[] = [];

    lines.push(`curl '${modelConfig.endpoint}' \\`);
    lines.push(`  -H 'Content-Type: application/json' \\`);

    if (embedApiKey && modelConfig.apiKey) {
        lines.push(`  -H 'Authorization: Bearer ${modelConfig.apiKey}' \\`);
    } else {
        lines.push(`  -H 'Authorization: Bearer $API_KEY' \\`);
    }

    const requestCopy = { ...request, stream: false };
    const jsonBody = JSON.stringify(requestCopy, null, 2);
    const escapedBody = jsonBody.replace(/'/g, "'\\''");

    lines.push(`  -d '${escapedBody}'`);

    return lines.join('\n');
}
