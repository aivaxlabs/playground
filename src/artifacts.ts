import el from "@cypherpotato/el";
import { streamChat } from './api';
import { createTab } from './types';
import type { ReasoningEffort, Tab, TabConfig } from './types';

export interface ArtifactDefinition {
    id: string;
    title: string;
    description: string;
    icon: string;
    prompt: string;
}

const ARTIFACTS: ArtifactDefinition[] = [
    {
        id: 'svg-animation',
        title: 'SVG Animation',
        description: 'An animated SVG of a kitten playing with a duck on a lake.',
        icon: 'ri-brush-line',
        prompt: 'Create an animated SVG artwork showing a cute kitten playfully interacting with a duck on a calm lake. Include gentle water ripples, the kitten batting at the duck, and subtle environmental details like reeds and lily pads. Use CSS animations within the SVG for fluid motion.',
    },
    {
        id: 'landing-page',
        title: 'Landing Page',
        description: 'A detailed landing page where the model presents itself.',
        icon: 'ri-pages-line',
        prompt: 'Create a beautiful, detailed landing page about yourself as an AI language model. Present who you are, your capabilities, limitations, and what makes you unique. Include sections like hero, features, how-it-works, and a footer. Use modern design with gradients, smooth typography, and tasteful animations. Make it visually impressive and informative.',
    },
    {
        id: 'credit-card-3d',
        title: '3D Credit Card',
        description: 'A 3D credit card rendered with Three.js.',
        icon: 'ri-bank-card-line',
        prompt: 'Create a realistic 3D credit card using Three.js (import from CDN: https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js). The card should have a metallic finish, embossed numbers, a chip, and the card network logo. Add mouse-controlled rotation so the user can orbit around the card. Include ambient lighting and subtle reflections.',
    },
    {
        id: 'flappy-bird',
        title: 'Flappy Bird',
        description: 'A 2D Flappy Bird game clone.',
        icon: 'ri-gamepad-line',
        prompt: 'Create a fully playable Flappy Bird clone game. Include a bird character that flaps on click/spacebar, scrolling pipes with gaps, score tracking, collision detection, game-over screen with restart, and a ground that scrolls. Use Canvas 2D for rendering. Add simple but polished graphics and smooth 60fps animation.',
    },
    {
        id: 'minecraft-clone',
        title: 'Minecraft Clone',
        description: 'A 3D Minecraft-like voxel world.',
        icon: 'ri-box-3-line',
        prompt: 'Create a 3D Minecraft-like voxel world using Three.js (import from CDN: https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js). Generate a small terrain with different block types (grass, dirt, stone, water). Implement first-person controls with WASD movement and mouse look. Allow placing and breaking blocks with left/right click. Include a simple crosshair and a basic block selector.',
    },
];

const SYSTEM_PROMPT = `You are a creative coding assistant. The user will ask you to build something visual or interactive.

You MUST respond with a SINGLE fenced code block containing a complete, self-contained HTML document. The HTML must include ALL styles in a <style> tag and ALL scripts in a <script> tag (or <script type="module"> for ES modules). Do not use external files — everything must be inline except for CDN libraries.

Do NOT include any text, explanation, or commentary outside the code block. Your entire response must be just the code block.

The HTML will be rendered in an iframe, so it must be a complete document with <!DOCTYPE html>, <html>, <head>, and <body> tags.`;

function extractHtmlFromStream(content: string): string | null {
    const fenceRegex = /```(?:html)?\s*\n([\s\S]*?)(?:\n```|$)/;
    const match = content.match(fenceRegex);
    return match ? match[1] : null;
}

type ArtifactState = {
    phase: 'list' | 'building' | 'done' | 'error';
    activeArtifact: ArtifactDefinition | null;
    streamedContent: string;
    abortController: AbortController | null;
    error: string | null;
    elapsedSeconds: number;
    startTime: number | null;
    outputTokens: number | null;
};

let state: ArtifactState = {
    phase: 'list',
    activeArtifact: null,
    streamedContent: '',
    abortController: null,
    error: null,
    elapsedSeconds: 0,
    startTime: null,
    outputTokens: null,
};

type BuildLayout = 'split' | 'response' | 'preview';

let rerender: (() => void) | null = null;
let getConfig: (() => TabConfig) | null = null;
let iframeEl: HTMLIFrameElement | null = null;
let rawTextEl: HTMLPreElement | null = null;
let buildBodyEl: HTMLElement | null = null;
let timerIntervalId: ReturnType<typeof setInterval> | null = null;
let chunkCounter = 0;
let buildLayout: BuildLayout = 'split';

function setLayout(layout: BuildLayout) {
    buildLayout = layout;
    if (buildBodyEl) {
        buildBodyEl.dataset.layout = layout;
    }
    const btns = buildBodyEl?.closest('.artifact-build')?.querySelectorAll<HTMLButtonElement>('.artifact-layout-btn');
    btns?.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layout === layout);
    });
}

function resetState() {
    if (state.abortController) {
        state.abortController.abort();
    }
    stopTimer();
    state = {
        phase: 'list',
        activeArtifact: null,
        streamedContent: '',
        abortController: null,
        error: null,
        elapsedSeconds: 0,
        startTime: null,
        outputTokens: null,
    };
    iframeEl = null;
    rawTextEl = null;
    buildBodyEl = null;
    chunkCounter = 0;
}

function startTimer() {
    state.startTime = Date.now();
    state.elapsedSeconds = 0;
    timerIntervalId = setInterval(() => {
        if (state.startTime) {
            state.elapsedSeconds = Math.floor((Date.now() - state.startTime) / 1000);
            updateTimerDisplay();
        }
    }, 1000);
}

function stopTimer() {
    if (timerIntervalId !== null) {
        clearInterval(timerIntervalId);
        timerIntervalId = null;
    }
}

function updateTimerDisplay() {
    const el = document.getElementById('artifact-timer');
    if (el) el.textContent = formatElapsed(state.elapsedSeconds);
}

function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function updateIframeContent(html: string) {
    if (!iframeEl) return;
    const doc = iframeEl.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
}

function appendRawText(text: string) {
    if (!rawTextEl) return;
    rawTextEl.textContent += text;
    rawTextEl.scrollTop = rawTextEl.scrollHeight;
}

async function startArtifact(artifact: ArtifactDefinition) {
    const config = getConfig?.();
    if (!config) return;

    stopTimer();
    chunkCounter = 0;
    state.phase = 'building';
    state.activeArtifact = artifact;
    state.streamedContent = '';
    state.error = null;
    state.elapsedSeconds = 0;
    rerender?.();
    startTimer();

    const tab: Tab = createTab();
    tab.config = {
        ...config,
        systemPrompt: SYSTEM_PROMPT,
        tools: [],
        structuredJson: null,
        customJson: null,
    };
    tab.messages = [
        { id: crypto.randomUUID(), role: 'user', content: artifact.prompt, timestamp: Date.now() },
    ];

    const controller = await streamChat(tab, {
        onPart(part) {
            if (part.type === 'content') {
                state.streamedContent += part.text;
                appendRawText(part.text);
                chunkCounter++;
                if (chunkCounter % 3 === 0) {
                    const html = extractHtmlFromStream(state.streamedContent);
                    if (html) updateIframeContent(html);
                }
            }
        },
        onToolCalls() { },
        onDone(metrics) {
            stopTimer();
            state.phase = 'done';
            state.abortController = null;
            state.outputTokens = metrics.outputTokens ?? null;
            const html = extractHtmlFromStream(state.streamedContent);
            if (html) updateIframeContent(html);
            rerender?.();
        },
        onError(error) {
            stopTimer();
            state.error = error;
            state.phase = 'error';
            state.abortController = null;
            rerender?.();
        },
        onDebug() { },
    });

    state.abortController = controller;
}

function stopArtifact() {
    if (state.abortController) {
        state.abortController.abort();
        state.abortController = null;
    }
    stopTimer();
    state.phase = 'done';
    rerender?.();
}

function renderArtifactList(opts: ArtifactPageOptions): HTMLElement {
    const cards = ARTIFACTS.map(artifact =>
        el('div.artifact-card', { onClick: () => startArtifact(artifact) },
            el('div.artifact-card-icon', el(`i.${artifact.icon}`)),
            el('div.artifact-card-body',
                el('div.artifact-card-title', artifact.title),
                el('div.artifact-card-desc', artifact.description),
            ),
            el('div.artifact-card-arrow', el('i.ri-arrow-right-s-line')),
        ),
    );

    const effortOptions: ReasoningEffort[] = ['disabled', 'none', 'low', 'medium', 'high', 'xhigh'];
    let endpointHost: string;
    try { endpointHost = new URL(opts.endpoint).host; } catch { endpointHost = opts.endpoint; }

    return el('div.artifacts-list',
        el('div.artifacts-header',
            el('h2', 'Artifacts'),
            el('p.artifacts-subtitle', 'Select an artifact to build. The model will generate it in real time.'),
        ),
        el('div.artifacts-config-bar',
            el('div.artifacts-config-model',
                el('span.artifacts-model-name', opts.model || 'No model'),
                el('span.artifacts-model-endpoint', endpointHost),
            ),
            el('div.artifacts-config-controls',
                el('select.artifacts-effort-select', {
                    value: opts.reasoningEffort,
                    onChange(e: Event) {
                        opts.onReasoningChange((e.target as HTMLSelectElement).value as ReasoningEffort);
                    },
                },
                    ...effortOptions.map(opt =>
                        el('option', { value: opt, ...(opt === opts.reasoningEffort ? { selected: 'selected' } : {}) }, opt),
                    ),
                ),
                el('button.btn.btn-sm', { onClick: opts.onSettingsClick },
                    el('i.ri-settings-3-line'), ' Settings',
                ),
            ),
        ),
        el('div.artifacts-grid', ...cards),
    );
}

function renderBuildView(): HTMLElement {
    const artifact = state.activeArtifact!;
    const isBuilding = state.phase === 'building';

    const iframe = el('iframe.artifact-iframe', {
        sandbox: 'allow-scripts allow-same-origin',
    }) as HTMLIFrameElement;
    iframeEl = iframe;

    const rawPre = el('pre.artifact-raw-text') as HTMLPreElement;
    rawTextEl = rawPre;
    rawPre.textContent = state.streamedContent;

    const html = extractHtmlFromStream(state.streamedContent);
    if (html) {
        requestAnimationFrame(() => updateIframeContent(html));
        requestAnimationFrame(() => { rawPre.scrollTop = rawPre.scrollHeight; });
    }

    const statusClass = state.phase === 'error' ? '.artifact-status-error' : '';
    const doneLabel = state.outputTokens != null
        ? `Done — ${formatElapsed(state.elapsedSeconds)} · ${state.outputTokens.toLocaleString()} tokens`
        : `Done — ${formatElapsed(state.elapsedSeconds)}`;
    const statusText = state.phase === 'building' ? 'Building...'
        : state.phase === 'error' ? `Error: ${state.error}`
            : doneLabel;

    const bodyEl = el('div.artifact-build-body') as HTMLElement;
    bodyEl.dataset.layout = buildLayout;
    buildBodyEl = bodyEl;
    bodyEl.append(
        el('div.artifact-raw-panel',
            el('div.artifact-panel-label', 'Response'),
            rawPre,
        ),
        el('div.artifact-preview-panel',
            el('div.artifact-panel-label', 'Preview'),
            el('div.artifact-build-canvas', iframe),
        ),
    );

    const layoutBtn = (layout: BuildLayout, icon: string, title: string) =>
        el(`button.btn.btn-sm.artifact-layout-btn${buildLayout === layout ? '.active' : ''}`, {
            title,
            'data-layout': layout,
            onClick: () => setLayout(layout),
        }, el(`i.${icon}`));

    return el('div.artifact-build',
        el('div.artifact-build-header',
            el('button.btn.btn-sm', {
                onClick() {
                    stopArtifact();
                    resetState();
                    rerender?.();
                },
            }, el('i.ri-arrow-left-s-line'), ' Back'),
            el('div.artifact-build-info',
                el('span.artifact-build-title', el(`i.${artifact.icon}`), ` ${artifact.title}`),
                el(`span.artifact-build-status${statusClass}`,
                    statusText,
                    isBuilding ? el('span.artifact-timer', { id: 'artifact-timer' }, formatElapsed(state.elapsedSeconds)) : null,
                ),
            ),
            el('div.artifact-layout-btns',
                layoutBtn('response', 'ri-file-text-line', 'Response only'),
                layoutBtn('split', 'ri-layout-column-line', 'Side by side'),
                layoutBtn('preview', 'ri-eye-line', 'Preview only'),
            ),
            isBuilding
                ? el('button.btn.btn-sm', { onClick: stopArtifact }, el('i.ri-stop-line'), ' Stop')
                : el('button.btn.btn-sm', { onClick: () => startArtifact(artifact) }, el('i.ri-refresh-line'), ' Retry'),
        ),
        bodyEl,
    );
}

export interface ArtifactPageOptions {
    configGetter: () => TabConfig;
    renderCallback: () => void;
    model: string;
    endpoint: string;
    reasoningEffort: ReasoningEffort;
    onReasoningChange: (v: ReasoningEffort) => void;
    onSettingsClick: () => void;
}

export function renderArtifactsPage(opts: ArtifactPageOptions): HTMLElement {
    rerender = opts.renderCallback;
    getConfig = opts.configGetter;

    if (state.phase === 'list') {
        return el('div.artifacts-page', renderArtifactList(opts));
    }

    return el('div.artifacts-page', renderBuildView());
}

export function cleanupArtifacts() {
    resetState();
}
