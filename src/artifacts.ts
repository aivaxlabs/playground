import el from "@cypherpotato/el";
import { streamChat } from './api';
import { createTab } from './types';
import type { MessageMetrics, ReasoningEffort, Tab, TabConfig } from './types';

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
    {
        id: 'voxel-mini-world',
        title: 'Voxel Mini World',
        description: 'An isometric voxel scene with trees, grass, animals, TNT, planting, spawning, and reset controls.',
        icon: 'ri-landscape-line',
        prompt: `Create a polished interactive 3D isometric voxel-art mini world in a single self-contained HTML file using Three.js (import from CDN: https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js).

Build a charming block-based scene with a small grass island, layered terrain, trees, flowers, rocks, and several animated animals wandering around. The visual direction should feel like a cozy voxel diorama: crisp cubes, soft shadows, saturated natural colors, and an isometric camera view.

Interaction requirements:

- Add a compact toolbar with exactly three selectable world actions: TNT, Plant Tree, and Add Animal.
- TNT mode: when the user clicks a grass block, place a voxel TNT block there. The TNT should visibly fuse for a short moment, then explode with particles, camera shake, and a circular blast that clears nearby small objects without destroying the entire world.
- Plant Tree mode: when the user clicks a valid grass block, grow a small voxel tree there with a quick pop-in animation.
- Add Animal mode: when selected, clicking the world should add a random animated animal, such as a sheep, cow, pig, chicken, or fox. The animal should join the wandering animation immediately.
- Include a Reset World button that restores the currently viewed mini world to its initial generated state.

Scene and animation requirements:

- Animals must walk around autonomously, turn occasionally, bob subtly while moving, avoid leaving the island, and look visually different by species.
- Trees should be built from voxel trunks and leafy block clusters.
- The terrain must use individual voxel blocks, not one flat plane.
- Use raycasting so clicks land on world blocks rather than generic screen positions.
- Add ambient light, directional light, soft shadows, and a simple sky/background.
- Keep the camera fixed in an isometric orbit-like view with optional gentle pan/zoom controls.
- Provide clear selected-action state in the toolbar without using explanatory tutorial text.
- The result should start automatically, run smoothly, and feel alive even before the user interacts with it.

Implementation requirements:

- Everything must be contained in a single HTML file.
- All styles must be inline in a <style> tag.
- All JavaScript must be inline in a <script type="module"> tag.
- CDN import for Three.js is allowed; do not use any other external assets or files.
- Organize the code clearly enough to be maintainable while keeping the experience complete.`,
    },
    {
        id: 'isometric-city-simulation',
        title: 'Isometric City Simulation',
        description: 'A dense procedural city-builder prototype with traffic, weather, disasters, and economy.',
        icon: 'ri-building-4-line',
        prompt: `Create a highly detailed isometric city simulation in a single self-contained HTML file. No external assets, libraries, CDNs, or backend.

Requirements:

- Render a large isometric city entirely using HTML5 Canvas or SVG.
- Generate the city procedurally from a random seed.
- Display the current seed in the HUD.
- Add a "Regenerate City" button that creates a new coherent city layout with a new seed without reloading the page.
- The city must contain roads, intersections, traffic lights, residential buildings, offices, parks, industrial zones, rivers, bridges, and public transportation.
- At least 500 visible animated entities should exist simultaneously: cars, buses, trains, pedestrians, boats, birds, etc.
- Vehicles must follow road networks realistically and obey traffic lights.
- Pedestrians should walk on sidewalks, cross streets, and enter/leave buildings.
- Include a dynamic day/night cycle with lighting changes, shadows, illuminated windows, and street lamps.
- Add weather effects such as rain, fog, snow, and thunderstorms, changing automatically over time.
- Include ambient city effects such as smoke from factories, moving clouds, birds, water animation, and construction cranes.
- Buildings should have procedural variations so districts do not look repetitive.
- Simulate a simple economy: population, jobs, traffic congestion, happiness, power consumption, and tax revenue updating in real time.
- Include random disasters: fire, blackout, traffic accidents, storms, with visible emergency response vehicles.
- Add a polished HUD showing city statistics, current weather, time of day, active disasters, and simulation state.
- Allow smooth camera pan and zoom.
- Maintain good performance and organization despite the simulation complexity.

Visual quality requirements:

- The result should resemble a modern city-builder game prototype, not a simple tech demo.
- Prioritize visual richness, animation density, and the feeling of a living city.
- Avoid placeholder graphics and repetitive patterns.
- The simulation should feel alive even if the user never interacts with it.

Implementation requirements:

- Everything must be contained in a single HTML file.
- No external resources.
- Write clean, maintainable code with clear separation between rendering, simulation, procedural generation, and entity systems.
- The simulation must start automatically when the page loads.`,
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
    tokensPerSecond: number | null;
    metrics: MessageMetrics | null;
    runConfig: Pick<TabConfig, 'model' | 'endpoint' | 'reasoningEffort'> | null;
    startedAt: string | null;
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
    tokensPerSecond: null,
    metrics: null,
    runConfig: null,
    startedAt: null,
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
        tokensPerSecond: null,
        metrics: null,
        runConfig: null,
        startedAt: null,
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
    state.tokensPerSecond = null;
    state.metrics = null;
    state.runConfig = {
        model: config.model,
        endpoint: config.endpoint,
        reasoningEffort: config.reasoningEffort,
    };
    state.startedAt = new Date().toISOString();
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
            state.tokensPerSecond = metrics.tokensPerSecond ?? null;
            state.metrics = metrics;
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

function downloadArtifact(kind: 'html' | 'json') {
    const artifact = state.activeArtifact;
    if (!artifact) return;

    const html = extractHtmlFromStream(state.streamedContent);
    const createdAt = new Date().toISOString();
    const filenameSafeDate = createdAt.replace(/[:.]/g, '-');
    const content = kind === 'html'
        ? html ?? state.streamedContent
        : JSON.stringify({
            artifact: {
                type: artifact.id,
                id: artifact.id,
                title: artifact.title,
                description: artifact.description,
            },
            prompt: artifact.prompt,
            output: {
                html,
                raw: state.streamedContent,
            },
            metadata: {
                model: state.runConfig?.model ?? null,
                endpoint: state.runConfig?.endpoint ?? null,
                reasoningEffort: state.runConfig?.reasoningEffort ?? null,
                phase: state.phase,
                startedAt: state.startedAt,
                exportedAt: createdAt,
                elapsedSeconds: state.elapsedSeconds,
                tokens: {
                    input: state.metrics?.inputTokens ?? null,
                    cached: state.metrics?.cachedTokens ?? null,
                    output: state.metrics?.outputTokens ?? state.outputTokens,
                },
                timing: {
                    totalMs: state.metrics?.totalTime ?? null,
                    timeToFirstTokenMs: state.metrics?.timeToFirstToken ?? null,
                    tokensPerSecond: state.metrics?.tokensPerSecond ?? state.tokensPerSecond,
                },
            },
        }, null, 2);
    const blob = new Blob([content], {
        type: kind === 'html' ? 'text/html;charset=utf-8' : 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${artifact.id}-${filenameSafeDate}.${kind}`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
    const tokensPerSecondText = state.tokensPerSecond == null
        ? '- tok/s'
        : `${state.tokensPerSecond.toFixed(2)} tok/s`;
    const hasArtifactHtml = html !== null;

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
    const downloadOption = (kind: 'html' | 'json', label: string) =>
        el('button.artifact-download-option', {
            onClick(e: Event) {
                downloadArtifact(kind);
                (e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
            },
        }, label);

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
                el('span.artifact-build-metric', { title: 'Tokens per second' },
                    el('i.ri-speed-up-line'),
                    ` ${tokensPerSecondText}`,
                ),
            ),
            el('div.artifact-layout-btns',
                layoutBtn('response', 'ri-file-text-line', 'Response only'),
                layoutBtn('split', 'ri-layout-column-line', 'Side by side'),
                layoutBtn('preview', 'ri-eye-line', 'Preview only'),
            ),
            el('details.artifact-download-menu',
                el('summary.btn.btn-sm', el('i.ri-download-2-line'), ' Download as'),
                el('div.artifact-download-options',
                    downloadOption('html', 'HTML'),
                    downloadOption('json', 'JSON'),
                ),
            ),
            isBuilding
                ? el('button.btn.btn-sm', { onClick: stopArtifact }, el('i.ri-stop-line'), ' Stop')
                : el('div.artifact-build-actions',
                    el('button.btn.btn-sm', {
                        ...(hasArtifactHtml ? {} : { disabled: 'true' }),
                        onClick: () => {
                            if (html) updateIframeContent(html);
                        },
                    }, el('i.ri-restart-line'), ' Reload Artifact'),
                    el('button.btn.btn-sm', { onClick: () => startArtifact(artifact) }, el('i.ri-refresh-line'), ' Retry'),
                ),
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
