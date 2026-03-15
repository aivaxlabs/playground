import el from "@cypherpotato/el";
import { streamChat } from './api';
import { createTab, normalizeTabConfig, uid } from './types';
import type { Attachment, ChatMessage, MessageMetrics, TabConfig, ToolCall } from './types';

import imageTestUrl from '../medialib/img1.jpg?url';
import audioTestUrl from '../medialib/audio1.mp3?url';
import pdfTestUrl from '../medialib/pdf1.pdf?url';
import videoTestUrl from '../medialib/vid1.mp4?url';

type TestStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'skipped';

type MetricAggregate = {
    average: number;
    min: number;
    max: number;
};

type TestExecutionData = {
    content: string;
    toolCalls: ToolCall[];
    metrics: MessageMetrics;
    connectionLatency: number | null;
    hasReasoning: boolean;
    error?: string;
};

type TestRunResult = TestExecutionData & {
    id: string;
    name: string;
    status: Exclude<TestStatus, 'queued' | 'running'>;
    detail: string;
};

type TestDefinition = {
    id: string;
    name: string;
    description: string;
    defaultEnabled: boolean;
    fixed?: boolean;
    run: (config: TabConfig) => Promise<TestRunResult>;
};

type TestSuiteSummary = {
    connectionLatency: MetricAggregate | null;
    timeToFirstToken: MetricAggregate | null;
    totalTime: MetricAggregate | null;
    inputTokens: number;
    outputTokens: number;
    reasoningDetected: boolean;
};

type DisplayTestState = {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    status: TestStatus;
    detail: string;
    metrics?: MessageMetrics;
    connectionLatency?: number | null;
    hasReasoning?: boolean;
    error?: string;
};

type LoadedAttachment = {
    url: string;
    name: string;
    mimeType: string;
    type: Attachment['type'];
};

const TEST_MEDIA: Record<'image' | 'audio' | 'pdf' | 'video', LoadedAttachment> = {
    image: {
        url: imageTestUrl,
        name: 'img1.jpg',
        mimeType: 'image/jpeg',
        type: 'image',
    },
    audio: {
        url: audioTestUrl,
        name: 'audio1.mp3',
        mimeType: 'audio/mp3',
        type: 'audio',
    },
    pdf: {
        url: pdfTestUrl,
        name: 'pdf1.pdf',
        mimeType: 'application/pdf',
        type: 'file',
    },
    video: {
        url: videoTestUrl,
        name: 'vid1.mp4',
        mimeType: 'video/mp4',
        type: 'video',
    },
};

const attachmentCache = new Map<string, Promise<Attachment>>();

const STRUCTURED_RESPONSE_FORMAT = {
    response_format: {
        type: 'json_schema',
        json_schema: {
            name: 'test_person',
            strict: true,
            schema: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    age: { type: 'number' },
                },
                required: ['name', 'age'],
                additionalProperties: false,
            },
        },
    },
} satisfies Record<string, unknown>;

const WEATHER_TOOL = {
    type: 'function',
    function: {
        name: 'get_weather',
        description: 'Get the weather for a city.',
        parameters: {
            type: 'object',
            properties: {
                city: {
                    type: 'string',
                    description: 'City name.',
                },
            },
            required: ['city'],
        },
    },
};

const TIME_TOOL = {
    type: 'function',
    function: {
        name: 'get_time',
        description: 'Get the current time in a timezone.',
        parameters: {
            type: 'object',
            properties: {
                timezone: {
                    type: 'string',
                    description: 'Timezone name.',
                },
            },
            required: ['timezone'],
        },
    },
};

function showOverlay(content: HTMLElement, closeOnBackdrop = true) {
    removeOverlay();
    const overlay = el('div.overlay', {
        id: 'overlay',
        onClick: (event: Event) => {
            if (closeOnBackdrop && event.target === overlay) {
                removeOverlay();
            }
        },
    }, content);
    document.body.appendChild(overlay);
}

function removeOverlay() {
    document.getElementById('overlay')?.remove();
}

function createUserMessage(content: string, attachments?: Attachment[]): ChatMessage {
    return {
        id: uid(),
        role: 'user',
        content,
        attachments: attachments && attachments.length > 0 ? [...attachments] : undefined,
        timestamp: Date.now(),
    };
}

function toDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error || new Error('Failed to read test media.'));
        reader.readAsDataURL(blob);
    });
}

function loadTestAttachment(source: LoadedAttachment): Promise<Attachment> {
    const cacheKey = `${source.url}|${source.name}|${source.mimeType}|${source.type}`;
    const cached = attachmentCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const pending = fetch(source.url)
        .then(async response => {
            if (!response.ok) {
                throw new Error(`Failed to load ${source.name}: HTTP ${response.status}`);
            }

            const blob = await response.blob();
            return {
                type: source.type,
                name: source.name,
                mimeType: source.mimeType,
                dataUrl: await toDataUrl(blob),
            } satisfies Attachment;
        });

    attachmentCache.set(cacheKey, pending);
    return pending;
}

function mergeConfig(baseConfig: TabConfig, overrides?: Partial<TabConfig>): TabConfig {
    return normalizeTabConfig({
        ...baseConfig,
        ...overrides,
        tools: overrides?.tools ?? baseConfig.tools,
        structuredJson: overrides?.structuredJson ?? baseConfig.structuredJson,
        enabledParams: {
            ...baseConfig.enabledParams,
            ...(overrides?.enabledParams ?? {}),
        },
    });
}

async function runConversation(config: TabConfig, messages: ChatMessage[], overrides?: Partial<TabConfig>): Promise<TestExecutionData> {
    const tab = createTab();
    tab.config = mergeConfig(config, overrides);
    tab.messages = messages;

    let content = '';
    let toolCalls: ToolCall[] = [];
    let metrics: MessageMetrics = {};
    let connectionLatency: number | null = null;
    let hasReasoning = false;
    let error: string | undefined;
    const startedAt = performance.now();

    await streamChat(tab, {
        onPart: part => {
            if (part.type === 'reasoning') {
                hasReasoning = true;
                return;
            }

            content += part.text;
        },
        onToolCalls: calls => {
            toolCalls = calls;
        },
        onDone: nextMetrics => {
            metrics = nextMetrics;
        },
        onError: nextError => {
            if (!error) {
                error = nextError;
            }
        },
        onDebug: debugInfo => {
            if (connectionLatency === null && typeof debugInfo.responseStatus === 'number') {
                connectionLatency = Math.round(performance.now() - startedAt);
            }
        },
    });

    return {
        content,
        toolCalls,
        metrics,
        connectionLatency,
        hasReasoning,
        error,
    };
}

function buildErrorResult(definition: TestDefinition, execution: TestExecutionData): TestRunResult {
    return {
        ...execution,
        id: definition.id,
        name: definition.name,
        status: 'error',
        detail: execution.error || 'The API returned an unknown error.',
    };
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsKeyword(content: string, keyword: string): boolean {
    return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(content);
}

function truncateText(value: string, maxLength = 180): string {
    const trimmed = value.trim();
    if (trimmed.length <= maxLength) {
        return trimmed;
    }

    return `${trimmed.slice(0, maxLength)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseToolArguments(value: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(value);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function buildKeywordValidatorResult(definition: TestDefinition, execution: TestExecutionData, keyword: string, successDetail: string): TestRunResult {
    if (execution.error) {
        return buildErrorResult(definition, execution);
    }

    if (containsKeyword(execution.content, keyword)) {
        return {
            ...execution,
            id: definition.id,
            name: definition.name,
            status: 'passed',
            detail: successDetail,
        };
    }

    return {
        ...execution,
        id: definition.id,
        name: definition.name,
        status: 'failed',
        detail: execution.content.trim()
            ? `Expected keyword ${keyword}. Received: ${truncateText(execution.content)}`
            : `Expected keyword ${keyword}, but the model returned no visible content.`,
    };
}

async function runBasicResponseTest(config: TabConfig, definition: TestDefinition): Promise<TestRunResult> {
    const execution = await runConversation(config, [
        createUserMessage('Reply with exactly the word: PONG'),
    ]);

    return buildKeywordValidatorResult(definition, execution, 'PONG', 'The model returned the expected text response.');
}

async function runMediaKeywordTest(
    config: TabConfig,
    definition: TestDefinition,
    media: LoadedAttachment,
    prompt: string,
    keyword: string,
    successDetail: string,
): Promise<TestRunResult> {
    const attachment = await loadTestAttachment(media);
    const execution = await runConversation(config, [createUserMessage(prompt, [attachment])]);
    return buildKeywordValidatorResult(definition, execution, keyword, successDetail);
}

async function runStructuredResponseTest(config: TabConfig, definition: TestDefinition): Promise<TestRunResult> {
    const execution = await runConversation(
        config,
        [createUserMessage('Generate a person named John who is 30 years old.')],
        { structuredJson: STRUCTURED_RESPONSE_FORMAT },
    );

    if (execution.error) {
        return buildErrorResult(definition, execution);
    }

    try {
        const parsed = JSON.parse(execution.content);
        if (isRecord(parsed) && typeof parsed.name === 'string' && typeof parsed.age === 'number') {
            return {
                ...execution,
                id: definition.id,
                name: definition.name,
                status: 'passed',
                detail: 'The model returned valid structured JSON for the requested schema.',
            };
        }
    } catch {
        // handled below
    }

    return {
        ...execution,
        id: definition.id,
        name: definition.name,
        status: 'failed',
        detail: execution.content.trim()
            ? `Invalid structured output: ${truncateText(execution.content)}`
            : 'The model did not return parseable JSON.',
    };
}

async function runFunctionCallingTest(config: TabConfig, definition: TestDefinition): Promise<TestRunResult> {
    const execution = await runConversation(
        config,
        [createUserMessage('What is the weather in Tokyo?')],
        { tools: [WEATHER_TOOL] },
    );

    if (execution.error) {
        return buildErrorResult(definition, execution);
    }

    const weatherCall = execution.toolCalls.find(toolCall => toolCall.function.name === 'get_weather');
    if (!weatherCall) {
        return {
            ...execution,
            id: definition.id,
            name: definition.name,
            status: 'failed',
            detail: 'The model did not call the expected function.',
        };
    }

    const argumentsObject = parseToolArguments(weatherCall.function.arguments);
    if (!argumentsObject || typeof argumentsObject.city !== 'string' || !argumentsObject.city.trim()) {
        return {
            ...execution,
            id: definition.id,
            name: definition.name,
            status: 'failed',
            detail: 'The function call arguments were missing or invalid for get_weather(city).',
        };
    }

    return {
        ...execution,
        id: definition.id,
        name: definition.name,
        status: 'passed',
        detail: 'The model called get_weather with valid arguments.',
    };
}

async function runParallelFunctionCallingTest(config: TabConfig, definition: TestDefinition): Promise<TestRunResult> {
    const execution = await runConversation(
        config,
        [createUserMessage('What is the weather in Tokyo and what time is it in UTC?')],
        { tools: [WEATHER_TOOL, TIME_TOOL] },
    );

    if (execution.error) {
        return buildErrorResult(definition, execution);
    }

    const weatherCall = execution.toolCalls.find(toolCall => toolCall.function.name === 'get_weather');
    const timeCall = execution.toolCalls.find(toolCall => toolCall.function.name === 'get_time');
    const weatherArgs = weatherCall ? parseToolArguments(weatherCall.function.arguments) : null;
    const timeArgs = timeCall ? parseToolArguments(timeCall.function.arguments) : null;

    if (!weatherCall || !timeCall) {
        return {
            ...execution,
            id: definition.id,
            name: definition.name,
            status: 'failed',
            detail: `Expected two function calls in parallel. Received ${execution.toolCalls.length}.`,
        };
    }

    if (!weatherArgs || typeof weatherArgs.city !== 'string' || !weatherArgs.city.trim()) {
        return {
            ...execution,
            id: definition.id,
            name: definition.name,
            status: 'failed',
            detail: 'The get_weather function call arguments were invalid.',
        };
    }

    if (!timeArgs || typeof timeArgs.timezone !== 'string' || !timeArgs.timezone.trim()) {
        return {
            ...execution,
            id: definition.id,
            name: definition.name,
            status: 'failed',
            detail: 'The get_time function call arguments were invalid.',
        };
    }

    return {
        ...execution,
        id: definition.id,
        name: definition.name,
        status: 'passed',
        detail: 'The model called both functions with valid arguments in a single response.',
    };
}

const TEST_DEFINITIONS: TestDefinition[] = [
    {
        id: 'basic-response',
        name: 'Basic Response',
        description: 'Validate that the model returns the expected text reply.',
        defaultEnabled: true,
        fixed: true,
        run: config => runBasicResponseTest(config, TEST_DEFINITIONS[0]),
    },
    {
        id: 'image-reading',
        name: 'Image Reading',
        description: 'Check if the model can inspect an image attachment.',
        defaultEnabled: true,
        run: config => runMediaKeywordTest(
            config,
            TEST_DEFINITIONS[1],
            TEST_MEDIA.image,
            'If you can see this image, reply with exactly the word: VISIBLE',
            'VISIBLE',
            'The model confirmed that it could read the image input.',
        ),
    },
    {
        id: 'audio-reading',
        name: 'Audio Reading',
        description: 'Check if the model can inspect an audio attachment.',
        defaultEnabled: false,
        run: config => runMediaKeywordTest(
            config,
            TEST_DEFINITIONS[2],
            TEST_MEDIA.audio,
            'If you can hear this audio, reply with exactly the word: AUDIBLE',
            'AUDIBLE',
            'The model confirmed that it could read the audio input.',
        ),
    },
    {
        id: 'pdf-reading',
        name: 'PDF Reading',
        description: 'Check if the model can inspect a PDF attachment.',
        defaultEnabled: false,
        run: config => runMediaKeywordTest(
            config,
            TEST_DEFINITIONS[3],
            TEST_MEDIA.pdf,
            'If you can read this document, reply with exactly the word: READABLE',
            'READABLE',
            'The model confirmed that it could read the PDF input.',
        ),
    },
    {
        id: 'video-reading',
        name: 'Video Reading',
        description: 'Check if the model can inspect a video attachment.',
        defaultEnabled: false,
        run: config => runMediaKeywordTest(
            config,
            TEST_DEFINITIONS[4],
            TEST_MEDIA.video,
            'If you can see this video, reply with exactly the word: WATCHABLE',
            'WATCHABLE',
            'The model confirmed that it could read the video input.',
        ),
    },
    {
        id: 'structured-response',
        name: 'Structured Responses',
        description: 'Validate JSON schema constrained output.',
        defaultEnabled: true,
        run: config => runStructuredResponseTest(config, TEST_DEFINITIONS[5]),
    },
    {
        id: 'function-calling',
        name: 'Function Calling',
        description: 'Validate that a function call is emitted with correct parameters.',
        defaultEnabled: true,
        run: config => runFunctionCallingTest(config, TEST_DEFINITIONS[6]),
    },
    {
        id: 'parallel-function-calling',
        name: 'Parallel Function Calling',
        description: 'Validate that multiple tools are called in a single response.',
        defaultEnabled: true,
        run: config => runParallelFunctionCallingTest(config, TEST_DEFINITIONS[7]),
    },
];

function aggregateNumbers(values: number[]): MetricAggregate | null {
    if (values.length === 0) {
        return null;
    }

    const total = values.reduce((sum, value) => sum + value, 0);
    return {
        average: Math.round(total / values.length),
        min: Math.min(...values),
        max: Math.max(...values),
    };
}

function createSummary(states: DisplayTestState[]): TestSuiteSummary {
    const completedStates = states.filter(state => state.status !== 'queued' && state.status !== 'running' && state.status !== 'skipped');
    const connectionLatency = aggregateNumbers(
        completedStates
            .map(state => state.connectionLatency)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    );

    const timeToFirstToken = aggregateNumbers(
        completedStates
            .map(state => state.metrics?.timeToFirstToken)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    );

    const totalTime = aggregateNumbers(
        completedStates
            .map(state => state.metrics?.totalTime)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    );

    const inputTokens = completedStates.reduce((sum, state) => sum + (state.metrics?.inputTokens || 0), 0);
    const outputTokens = completedStates.reduce((sum, state) => sum + (state.metrics?.outputTokens || 0), 0);
    const reasoningDetected = completedStates.some(state => state.hasReasoning === true);

    return {
        connectionLatency,
        timeToFirstToken,
        totalTime,
        inputTokens,
        outputTokens,
        reasoningDetected,
    };
}

function formatMetricNumber(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}

function buildMetricUnit(value: string): HTMLElement {
    return el('span.test-metric-unit', value);
}

function buildAggregateMetricBlock(label: string, aggregate: MetricAggregate | null): HTMLElement {
    if (!aggregate) {
        return el('div.test-metric-group',
            el('div.test-metric-group-label', label),
            el('div.test-metric-subrow',
                el('span.test-metric-subrow-label', 'Status'),
                el('span.test-metric-value', 'No data'),
            ),
        );
    }

    return el('div.test-metric-group',
        el('div.test-metric-group-label', label),
        el('div.test-metric-subrow',
            el('span.test-metric-subrow-label', 'Average'),
            el('span.test-metric-value',
                formatMetricNumber(aggregate.average),
                buildMetricUnit('ms'),
            ),
        ),
        el('div.test-metric-subrow',
            el('span.test-metric-subrow-label', 'Minimum'),
            el('span.test-metric-value',
                formatMetricNumber(aggregate.min),
                buildMetricUnit('ms'),
            ),
        ),
        el('div.test-metric-subrow',
            el('span.test-metric-subrow-label', 'Maximum'),
            el('span.test-metric-value',
                formatMetricNumber(aggregate.max),
                buildMetricUnit('ms'),
            ),
        ),
    );
}

function buildTokenMetricBlock(inputTokens: number, outputTokens: number): HTMLElement {
    return el('div.test-metric-group',
        el('div.test-metric-group-label', 'Tokens used'),
        el('div.test-metric-subrow',
            el('span.test-metric-subrow-label', 'Input'),
            el('span.test-metric-value', formatMetricNumber(inputTokens)),
        ),
        el('div.test-metric-subrow',
            el('span.test-metric-subrow-label', 'Output'),
            el('span.test-metric-value', formatMetricNumber(outputTokens)),
        ),
    );
}

function buildReasoningMetricBlock(reasoningDetected: boolean): HTMLElement {
    return el('div.test-metric-group',
        el('div.test-metric-group-label', 'Reasoning visible'),
        el('div.test-metric-subrow',
            el('span.test-metric-subrow-label', 'Detected'),
            el(`span.test-metric-value.test-metric-boolean${reasoningDetected ? '.is-positive' : ''}`, reasoningDetected ? 'Yes' : 'No'),
        ),
    );
}

function getStatusIcon(status: TestStatus): string {
    if (status === 'running') return 'ri-loader-4-line';
    if (status === 'passed') return 'ri-check-line';
    if (status === 'failed') return 'ri-close-line';
    if (status === 'error') return 'ri-error-warning-line';
    if (status === 'skipped') return 'ri-skip-forward-line';
    return 'ri-time-line';
}

function getStatusDetail(state: DisplayTestState): string {
    if (state.status === 'queued') return state.enabled ? 'Waiting to run' : 'Disabled by user';
    if (state.status === 'running') return 'Running...';
    if (state.status === 'skipped') return state.detail || 'Skipped';

    const duration = typeof state.metrics?.totalTime === 'number' ? `${state.metrics.totalTime} ms` : 'No timing data';
    const statusLabel = state.status === 'error'
        ? 'API error'
        : state.status === 'failed'
            ? 'Model error'
            : 'Passed';

    return `${statusLabel} • ${duration}`;
}

function buildTestRow(state: DisplayTestState): HTMLElement {
    const detailNodes: HTMLElement[] = [];

    if (state.status !== 'queued' && state.status !== 'running' && state.status !== 'skipped' && state.detail) {
        detailNodes.push(el('div.test-error-detail', state.detail));
    }

    return el('div.test-row-wrap',
        el('div.test-item', { 'data-test-id': state.id },
            el(`span.test-item-icon.${state.status}`,
                el('i', { class: getStatusIcon(state.status) }),
            ),
            el('div.test-item-main',
                el('div.test-item-name', state.name),
                el('div.test-item-description', state.description),
            ),
            el('div.test-item-detail', getStatusDetail(state)),
        ),
        ...detailNodes,
    );
}

export function showTestingModal(config: TabConfig) {
    const checkboxMap = new Map<string, HTMLInputElement>();

    const configReady = config.model.trim().length > 0 && config.endpoint.trim().length > 0;

    const optionNodes = TEST_DEFINITIONS.map(definition => {
        if (definition.fixed) {
            return el('div.test-fixed-row',
                el('div.test-fixed-copy',
                    el('div.test-fixed-title', definition.name),
                    el('div.test-fixed-description', definition.description),
                ),
                el('span.test-fixed-badge', 'Always on'),
            );
        }

        const checkbox = el('input', { type: 'checkbox' }) as HTMLInputElement;
        checkbox.checked = definition.defaultEnabled;
        checkboxMap.set(definition.id, checkbox);

        return el('label.test-checkbox-label',
            checkbox,
            el('span.test-checkbox-copy',
                el('span.test-checkbox-title', definition.name),
                el('span.test-checkbox-description', definition.description),
            ),
        );
    });

    const modal = el('div.modal',
        el('div.modal-header',
            el('h3', 'Automated Tests'),
            el('button.modal-close', { onClick: removeOverlay }, el('i.ri-close-line')),
        ),
        el('div.modal-body',
            el('p.test-disclaimer', 'Running these tests will send multiple real requests to the configured API and may incur costs.'),
            el('div.test-config-summary',
                el('span.test-config-pill', `Model: ${config.model || 'Not configured'}`),
                el('span.test-config-pill', `Endpoint: ${config.endpoint || 'Not configured'}`),
            ),
            el('div.test-checkbox-list', ...optionNodes),
            !configReady
                ? el('div.tool-info', 'Configure a model and endpoint before running the test suite.')
                : null,
        ),
        el('div.modal-footer',
            el('button.btn', { onClick: removeOverlay }, 'Cancel'),
            el('button.btn.btn-primary', {
                ...(configReady ? {} : { disabled: 'true' }),
                onClick: () => {
                    if (!configReady) {
                        return;
                    }

                    const states = TEST_DEFINITIONS.map(definition => ({
                        id: definition.id,
                        name: definition.name,
                        description: definition.description,
                        enabled: definition.fixed ? true : checkboxMap.get(definition.id)?.checked === true,
                        status: definition.fixed || checkboxMap.get(definition.id)?.checked === true ? 'queued' as TestStatus : 'skipped' as TestStatus,
                        detail: definition.fixed || checkboxMap.get(definition.id)?.checked === true ? '' : 'Disabled by user',
                    }));
                    showResultsModal(config, states);
                },
            }, 'Run Tests'),
        ),
    );

    showOverlay(modal);
}

function showResultsModal(config: TabConfig, states: DisplayTestState[]) {
    let cancelRequested = false;
    let finished = false;

    const listElement = el('div.test-results-list');
    const metricsElement = el('div.test-metrics');
    const progressElement = el('div.test-progress');
    const footerElement = el('div.modal-footer');

    const modal = el('div.modal',
        el('div.modal-header',
            el('h3', 'Test Results'),
            el('button.modal-close', {
                onClick: () => {
                    if (!finished) {
                        cancelRequested = true;
                        renderResults();
                        return;
                    }

                    removeOverlay();
                },
            }, el('i.ri-close-line')),
        ),
        el('div.modal-body',
            progressElement,
            listElement,
            metricsElement,
        ),
        footerElement,
    );

    function renderResults() {
        const completed = states.filter(state => state.status !== 'queued' && state.status !== 'running').length;
        const enabledCount = states.filter(state => state.enabled).length;
        const summary = createSummary(states);
        const visibleStates = states.filter(state => state.status !== 'skipped');

        progressElement.replaceChildren(el('div.test-progress-copy',
            el('span.test-progress-title', finished ? 'Finished' : cancelRequested ? 'Cancel requested' : 'Running test suite'),
            el('span.test-progress-detail', `${Math.min(completed, enabledCount)} / ${enabledCount} completed`),
        ));

        listElement.replaceChildren(...visibleStates.map(buildTestRow));

        metricsElement.replaceChildren(
            el('div.test-metrics-title', 'Aggregated Metrics'),
            buildAggregateMetricBlock('Connection latency', summary.connectionLatency),
            buildAggregateMetricBlock('Time to first token', summary.timeToFirstToken),
            buildAggregateMetricBlock('Complete response time', summary.totalTime),
            buildTokenMetricBlock(summary.inputTokens, summary.outputTokens),
            buildReasoningMetricBlock(summary.reasoningDetected),
        );

        footerElement.replaceChildren(
            !finished
                ? el('button.btn', {
                    ...(cancelRequested ? { disabled: 'true' } : {}),
                    onClick: () => {
                        cancelRequested = true;
                        renderResults();
                    },
                }, cancelRequested ? 'Stopping after current test...' : 'Cancel Remaining Tests')
                : el('button.btn.btn-primary', { onClick: removeOverlay }, 'Close'),
        );
    }

    showOverlay(modal, false);
    renderResults();

    void (async () => {
        for (const definition of TEST_DEFINITIONS) {
            const state = states.find(item => item.id === definition.id);
            if (!state || !state.enabled) {
                continue;
            }

            if (cancelRequested) {
                state.status = 'skipped';
                state.detail = 'Canceled before execution.';
                continue;
            }

            state.status = 'running';
            state.detail = '';
            renderResults();

            try {
                const result = await definition.run(config);
                state.status = result.status;
                state.detail = result.detail;
                state.metrics = result.metrics;
                state.error = result.error;
                state.connectionLatency = result.connectionLatency;
                state.hasReasoning = result.hasReasoning;
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                state.status = 'error';
                state.detail = message;
                state.error = message;
            }

            renderResults();
        }

        for (const state of states) {
            if (state.status === 'queued') {
                state.status = 'skipped';
                state.detail = cancelRequested ? 'Canceled before execution.' : 'Skipped.';
            }
        }

        finished = true;
        renderResults();
    })();
}