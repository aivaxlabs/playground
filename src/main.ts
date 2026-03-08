import el from "@cypherpotato/el";
import { createTab, normalizeReasoningEffort, normalizeTabConfig, uid } from './types';
import type { Tab, ChatMessage, Attachment, TabConfig, MessageMetrics, AssistantMessagePart, ToolCall } from './types';
import { saveState, loadState } from './storage';
import { streamChat } from './api';
import { renderMarkdown } from './markdown';
import './styles/app.css';

const SUGGESTIONS = [
  'Tell me a joke',
  "What's the weather forecast for today?",
  'Help me write a professional email',
  'Which is bigger? 9.8 or 9.11?',
];

const PREDEFINED_TOOLS = {
  webSearch: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for information.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query.' } },
        required: ['query'],
      },
    },
  },
  math: {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Evaluate a mathematical expression.',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: 'The math expression to evaluate.' } },
        required: ['expression'],
      },
    },
  },
};

const PREDEFINED_STRUCTURED_JSON = {
  answer: {
    response_format: {
      type: 'json_schema',
      json_schema: {
        schema: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
          },
          required: ['answer'],
          additionalProperties: false,
        },
      },
    },
  },
  answerWithConfidence: {
    response_format: {
      type: 'json_schema',
      json_schema: {
        schema: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['answer', 'confidence'],
          additionalProperties: false,
        },
      },
    },
  },
  answerWithCitations: {
    response_format: {
      type: 'json_schema',
      json_schema: {
        schema: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
            citations: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['answer', 'citations'],
          additionalProperties: false,
        },
      },
    },
  },
} as const;

const STRUCTURED_JSON_PLACEHOLDER = JSON.stringify(PREDEFINED_STRUCTURED_JSON.answer, null, 2);

type LibraryPreviewKind = 'image' | 'audio' | 'video' | 'pdf' | 'file';

type LibraryItem = {
  type: Attachment['type'];
  name: string;
  mimeType: string;
  url: string;
  previewKind: LibraryPreviewKind;
  iconClass: string;
};

const LIBRARY_FILE_URLS = import.meta.glob('../medialib/*', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>;

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  webm: 'audio/webm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  pdf: 'application/pdf',
  txt: 'text/plain',
  json: 'application/json',
};

const SHARED_URL_PARAM_KEYS = {
  endpoint: 'api-endpoint',
  model: 'api-model',
  apiKey: 'api-key',
} as const;

const LEGACY_SHARED_URL_PARAM_KEYS = {
  endpoint: 'endpoint',
  model: 'model',
  apiKey: 'api_key',
} as const;

const ENDPOINT_PRESETS = [
  { label: 'OpenAI', endpoint: 'https://api.openai.com/v1' },
  { label: 'Google', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1' },
  { label: 'Vercel AI Gateway', endpoint: 'https://ai-gateway.vercel.sh/v1' },
  { label: 'Groq', endpoint: 'https://api.groq.com/openai/v1' },
  { label: 'X.Ai', endpoint: 'https://api.x.ai/v1' },
  { label: 'AIVAX', endpoint: 'https://inference.aivax.net/v1' },
] as const;

const SAMPLING_FALLBACKS = {
  temperature: 1,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  maxTokens: 4096,
} as const;

const LIBRARY_ITEMS = Object.entries(LIBRARY_FILE_URLS)
  .map(([path, url]) => createLibraryItem(path, url))
  .filter((item): item is LibraryItem => item !== null)
  .sort((a, b) => a.name.localeCompare(b.name));

let tabs: Tab[] = [];
let activeTabId: string | null = null;
let theme: 'light' | 'dark' = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
let pendingAttachments: Attachment[] = [];
let mediaRecorder: MediaRecorder | null = null;
let recording = false;
let pendingToolResponseFocusId: string | null = null;

const openToolResponseEditors = new Set<string>();
const reasoningPartUserState = new Map<string, boolean>();

function createLibraryItem(path: string, url: string): LibraryItem | null {
  const normalizedPath = path.replace(/\\/g, '/');
  const name = normalizedPath.split('/').pop();
  if (!name) return null;

  const mimeType = getMimeTypeFromName(name);
  const previewKind = getLibraryPreviewKind(mimeType);

  return {
    type: getAttachmentTypeFromMime(mimeType),
    name,
    mimeType,
    url,
    previewKind,
    iconClass: getLibraryIconClass(previewKind),
  };
}

function getMimeTypeFromName(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return MIME_TYPES_BY_EXTENSION[ext] || 'application/octet-stream';
}

function getAttachmentTypeFromMime(mimeType: string): Attachment['type'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

function getLibraryPreviewKind(mimeType: string): LibraryPreviewKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'file';
}

function getLibraryIconClass(previewKind: LibraryPreviewKind): string {
  if (previewKind === 'audio') return 'ri-music-2-line';
  if (previewKind === 'video') return 'ri-film-line';
  if (previewKind === 'pdf') return 'ri-file-pdf-line';
  return 'ri-file-line';
}

async function urlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load media example: ${response.status}`);
  }

  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('Failed to read media example'));
    reader.readAsDataURL(blob);
  });
}

async function createAttachmentFromLibraryItem(item: LibraryItem): Promise<Attachment> {
  return {
    type: item.type,
    name: item.name,
    mimeType: item.mimeType,
    dataUrl: await urlToDataUrl(item.url),
  };
}

function getActiveTab(): Tab | undefined {
  return tabs.find(t => t.id === activeTabId);
}

function getReasoningPartKey(messageId: string, partIndex: number): string {
  return `${messageId}:${partIndex}`;
}

function collapseLatestReasoningPart(msg: ChatMessage) {
  const parts = ensureAssistantParts(msg);

  for (let index = parts.length - 1; index >= 0; index--) {
    if (parts[index].type === 'reasoning') {
      reasoningPartUserState.delete(getReasoningPartKey(msg.id, index));
      return;
    }
  }
}

function isReasoningPartAutoOpen(msg: ChatMessage, partIndex: number): boolean {
  const parts = getAssistantParts(msg);
  return !parts.slice(partIndex + 1).some(part => part.type !== 'reasoning');
}

function isReasoningPartOpen(msg: ChatMessage, partIndex: number): boolean {
  const key = getReasoningPartKey(msg.id, partIndex);
  const manualState = reasoningPartUserState.get(key);
  if (manualState !== undefined) {
    return manualState;
  }

  return isReasoningPartAutoOpen(msg, partIndex);
}

function setReasoningPartOpenState(msg: ChatMessage, partIndex: number, open: boolean) {
  const key = getReasoningPartKey(msg.id, partIndex);
  const autoOpen = isReasoningPartAutoOpen(msg, partIndex);

  if (open === autoOpen) {
    reasoningPartUserState.delete(key);
    return;
  }

  reasoningPartUserState.set(key, open);
}

function clearReasoningStateForMessages(messages: ChatMessage[]) {
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;

    for (const key of Array.from(reasoningPartUserState.keys())) {
      if (key.startsWith(`${msg.id}:`)) {
        reasoningPartUserState.delete(key);
      }
    }
  }
}

function getAssistantParts(msg: ChatMessage): AssistantMessagePart[] {
  const parts = msg.parts ? [...msg.parts] : [];

  if (parts.length === 0 && msg.content) {
    parts.push({ type: 'content', text: msg.content });
  }

  if (msg.toolCalls?.length) {
    for (let index = 0; index < msg.toolCalls.length; index++) {
      const hasMarker = parts.some(part => part.type === 'tool-call' && part.index === index);
      if (!hasMarker) {
        parts.push({ type: 'tool-call', index });
      }
    }
  }

  return parts;
}

function ensureAssistantParts(msg: ChatMessage): AssistantMessagePart[] {
  if (!msg.parts) {
    msg.parts = [];
  }
  return msg.parts;
}

function appendAssistantTextPart(msg: ChatMessage, type: 'content' | 'reasoning', text: string) {
  if (!text) return;

  const parts = ensureAssistantParts(msg);
  const lastPart = parts[parts.length - 1];

  if (type !== 'reasoning') {
    collapseLatestReasoningPart(msg);
  }

  if (lastPart && lastPart.type === type) {
    lastPart.text += text;
  } else {
    parts.push({ type, text });
  }

  if (type === 'content') {
    msg.content += text;
  }
}

function appendAssistantToolCallPart(msg: ChatMessage, index: number) {
  const parts = ensureAssistantParts(msg);
  collapseLatestReasoningPart(msg);
  const hasMarker = parts.some(part => part.type === 'tool-call' && part.index === index);
  if (!hasMarker) {
    parts.push({ type: 'tool-call', index });
  }
}

function hasAssistantRenderableOutput(msg: ChatMessage): boolean {
  return getAssistantParts(msg).some(part => {
    if (part.type === 'tool-call') {
      return true;
    }
    return part.text.trim().length > 0;
  });
}

function getContinuableAssistantMessage(tab: Tab): ChatMessage | null {
  let index = tab.messages.length - 1;

  while (index >= 0 && tab.messages[index].role === 'tool') {
    index--;
  }

  const msg = tab.messages[index];
  if (msg?.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    return msg;
  }

  return null;
}

function getToolResponseEditorKey(tabId: string, toolCallId: string): string {
  return `${tabId}:${toolCallId}`;
}

function isToolResponseEditorOpen(tab: Tab, toolCallId: string): boolean {
  return openToolResponseEditors.has(getToolResponseEditorKey(tab.id, toolCallId));
}

function openToolResponseEditor(tab: Tab, toolCallId: string) {
  openToolResponseEditors.add(getToolResponseEditorKey(tab.id, toolCallId));
  pendingToolResponseFocusId = `tool-resp-${toolCallId}`;
  render();
}

function closeToolResponseEditor(tab: Tab, toolCallId: string) {
  openToolResponseEditors.delete(getToolResponseEditorKey(tab.id, toolCallId));
}

function clearToolResponseEditorsForTab(tabId: string) {
  for (const key of Array.from(openToolResponseEditors)) {
    if (key.startsWith(`${tabId}:`)) {
      openToolResponseEditors.delete(key);
    }
  }
}

function persist() {
  saveState(tabs, activeTabId, theme);
}

function createTabWithInitialConfig(initialConfig?: Partial<Pick<TabConfig, 'model' | 'endpoint' | 'apiKey'>>): Tab {
  const tab = createTab();
  if (!initialConfig) return tab;

  if (initialConfig.model !== undefined) tab.config.model = initialConfig.model;
  if (initialConfig.endpoint !== undefined) tab.config.endpoint = initialConfig.endpoint;
  if (initialConfig.apiKey !== undefined) tab.config.apiKey = initialConfig.apiKey;

  return tab;
}

function init() {
  const saved = loadState();
  if (saved) {
    tabs = saved.tabs;
    activeTabId = saved.activeTabId;
    theme = saved.theme || theme;
  }

  parseUrlParams();

  if (tabs.length === 0) {
    const t = createTab();
    tabs.push(t);
    activeTabId = t.id;
  }
  if (!activeTabId) activeTabId = tabs[0].id;

  applyTheme();
  render();
}

function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const model = params.get(SHARED_URL_PARAM_KEYS.model) ?? params.get(LEGACY_SHARED_URL_PARAM_KEYS.model);
  const endpoint = params.get(SHARED_URL_PARAM_KEYS.endpoint) ?? params.get(LEGACY_SHARED_URL_PARAM_KEYS.endpoint);
  const apiKey = params.get(SHARED_URL_PARAM_KEYS.apiKey) ?? params.get(LEGACY_SHARED_URL_PARAM_KEYS.apiKey);

  if (model || endpoint || apiKey) {
    const t = createTabWithInitialConfig({
      model: model ?? undefined,
      endpoint: endpoint ?? undefined,
      apiKey: apiKey ?? undefined,
    });
    tabs.push(t);
    activeTabId = t.id;
    window.history.replaceState({}, '', window.location.pathname);
  }
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
  theme = theme === 'light' ? 'dark' : 'light';
  applyTheme();
  persist();
  render();
}

function addTab(initialConfig?: Partial<Pick<TabConfig, 'model' | 'endpoint' | 'apiKey'>>) {
  const t = createTabWithInitialConfig(initialConfig);
  tabs.push(t);
  activeTabId = t.id;
  pendingAttachments = [];
  persist();
  render();
}

function closeTab(id: string) {
  const tab = tabs.find(t => t.id === id);
  const replacementTabConfig = tabs.length === 1 && tab
    ? {
      model: tab.config.model,
      endpoint: tab.config.endpoint,
      apiKey: tab.config.apiKey,
    }
    : undefined;

  if (tab?.abortController) tab.abortController.abort();
  clearToolResponseEditorsForTab(id);
  if (tab) clearReasoningStateForMessages(tab.messages);
  tabs = tabs.filter(t => t.id !== id);
  if (activeTabId === id) {
    activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
  }
  if (tabs.length === 0) {
    const replacementTab = createTabWithInitialConfig(replacementTabConfig);
    tabs.push(replacementTab);
    activeTabId = replacementTab.id;
  }
  pendingAttachments = [];
  persist();
  render();
}

function cloneTab(id: string) {
  const src = tabs.find(t => t.id === id);
  if (!src) return;
  const nt = createTab();
  nt.messages = JSON.parse(JSON.stringify(src.messages));
  nt.config = normalizeTabConfig(JSON.parse(JSON.stringify(src.config)));
  tabs.push(nt);
  activeTabId = nt.id;
  persist();
  render();
}

function switchTab(id: string) {
  activeTabId = id;
  pendingAttachments = [];
  persist();
  render();
}

function closeAllTabs() {
  for (const t of tabs) {
    if (t.abortController) t.abortController.abort();
    clearToolResponseEditorsForTab(t.id);
    clearReasoningStateForMessages(t.messages);
  }
  tabs = [];
  pendingAttachments = [];
  addTab();
}

function clearCurrentChat() {
  const tab = getActiveTab();
  if (!tab || (tab.messages.length === 0 && pendingAttachments.length === 0)) return;

  const confirmed = window.confirm('Clear the current chat? This will remove all messages from the active tab.');
  if (!confirmed) return;

  if (tab.abortController) tab.abortController.abort();
  clearReasoningStateForMessages(tab.messages);
  tab.messages = [];
  tab.streaming = false;
  tab.abortController = undefined;
  clearToolResponseEditorsForTab(tab.id);
  pendingAttachments = [];
  persist();
  render();
}

// ── Render ──

function render() {
  const app = document.getElementById('app')!;
  app.innerHTML = '';
  app.appendChild(renderApp());
  scrollChatToBottom();
  focusPendingToolResponseEditor();
}

function focusPendingToolResponseEditor() {
  if (!pendingToolResponseFocusId) return;

  const focusId = pendingToolResponseFocusId;
  pendingToolResponseFocusId = null;

  requestAnimationFrame(() => {
    const textarea = document.getElementById(focusId) as HTMLTextAreaElement | null;
    if (!textarea) return;
    textarea.focus();
    const cursor = textarea.value.length;
    textarea.setSelectionRange(cursor, cursor);
    textarea.scrollIntoView({ block: 'center' });
  });
}

function renderApp(): HTMLElement {
  return el('div.app-container',
    renderTabStrip(),
    renderContent(),
  );
}

// ── Tab Strip ──

function renderTabStrip(): HTMLElement {
  const activeTab = getActiveTab();
  const canClearChat = Boolean(activeTab && (activeTab.messages.length > 0 || pendingAttachments.length > 0));

  const tabEls = tabs.map(tab => {
    const isActive = tab.id === activeTabId;
    const label = `${tab.config.model}`;
    let endpoint: string;
    try { endpoint = new URL(tab.config.endpoint).host; } catch { endpoint = tab.config.endpoint; }

    return el(`div.tab${isActive ? '.active' : ''}`,
      { onClick: () => switchTab(tab.id) },
      el('span.tab-label',
        el('span.tab-model', label),
        el('span.tab-provider', ` — ${endpoint}`),
      ),
      el('span.tab-actions',
        el('button.tab-btn', { title: 'Clone', onClick: (e: Event) => { e.stopPropagation(); cloneTab(tab.id); } },
          el('i.ri-file-copy-line'),
        ),
        el('button.tab-btn', { title: 'Close', onClick: (e: Event) => { e.stopPropagation(); closeTab(tab.id); } },
          el('i.ri-close-line'),
        ),
      ),
    );
  });

  return el('div.tab-strip',
    el('div.tab-strip-main',
      el('div.tab-strip-tabs', ...tabEls),
      el('button.tab-strip-btn.tab-strip-add-btn', { title: 'New tab', onClick: addTab },
        el('i.ri-add-line'),
      ),
    ),
    el('div.tab-strip-actions',
      el('button.tab-strip-btn', {
        title: 'Clear current chat',
        onClick: clearCurrentChat,
        ...(canClearChat ? {} : { disabled: 'true' }),
      },
        el('i.ri-delete-bin-line'),
      ),
      el('button.tab-strip-btn', { title: 'Theme', onClick: toggleTheme },
        el('i', { class: theme === 'light' ? 'ri-moon-line' : 'ri-sun-line' }),
      ),
      el('button.tab-strip-btn', { title: 'View LLM Playground Repository', onClick() { window.open('https://github.com/aivaxlabs/playground', '_blank') } },
        el('i.ri-github-fill'),
      ),
      el('button.tab-strip-btn', { title: 'Options', onClick: showOptionsMenu },
        el('i.ri-more-2-fill'),
      ),
    ),
  );
}

// ── Options Menu ──

function showOptionsMenu() {
  removeOverlay();
  const tab = getActiveTab();
  if (!tab) return;

  const menu = el('div.dropdown-menu',
    el('button.dropdown-item', { onClick: () => { removeOverlay(); exportChat(tab); } },
      el('i.ri-download-line'), ' Export chat (JSON)'),
    el('button.dropdown-item', { onClick: () => { removeOverlay(); showCurlModal(tab); } },
      el('i.ri-code-line'), ' View code (cURL)'),
    el('button.dropdown-item', { onClick: () => { removeOverlay(); void shareParameters(tab); } },
      el('i.ri-share-forward-line'), ' Share parameters'),
    el('button.dropdown-item', { onClick: () => { removeOverlay(); closeAllTabs(); } },
      el('i.ri-close-circle-line'), ' Close all tabs'),
  );

  showOverlay(menu);
}

function buildShareParametersUrl(tab: Tab): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set(SHARED_URL_PARAM_KEYS.endpoint, tab.config.endpoint);
  url.searchParams.set(SHARED_URL_PARAM_KEYS.model, tab.config.model);

  if (tab.config.apiKey) {
    url.searchParams.set(SHARED_URL_PARAM_KEYS.apiKey, tab.config.apiKey);
  }

  return url.toString();
}

async function shareParameters(tab: Tab) {
  await navigator.clipboard.writeText(buildShareParametersUrl(tab));
}

function exportChat(tab: Tab) {
  const data = JSON.stringify({ messages: tab.messages, config: tab.config }, null, 2);
  downloadString(data, `chat-${tab.config.model}-${Date.now()}.json`, 'application/json');
}

function downloadString(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function showCurlModal(tab: Tab) {
  let includeKey = false;
  let useGeneric = false;

  function getStructuredResponseFormat(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const responseFormat = (value as Record<string, unknown>).response_format;
    return responseFormat && typeof responseFormat === 'object' && !Array.isArray(responseFormat)
      ? (responseFormat as Record<string, unknown>)
      : null;
  }

  function buildCurl() {
    const cfg = tab.config;
    const url = cfg.endpoint.replace(/\/+$/, '') + '/chat/completions';
    const msgs = useGeneric
      ? [{ role: 'user', content: 'Hello!' }]
      : tab.messages.map(m => ({ role: m.role, content: m.content }));

    const body: any = { model: cfg.model, messages: msgs, stream: true };
    const responseFormat = getStructuredResponseFormat(cfg.structuredJson);

    if (responseFormat) {
      body.response_format = responseFormat;
    }

    const bodyStr = JSON.stringify(body, null, 2);
    const authHeader = includeKey && cfg.apiKey
      ? `\n  -H "Authorization: Bearer ${cfg.apiKey}" \\`
      : `\n  -H "Authorization: Bearer YOUR_API_KEY" \\`;

    return `curl "${url}" \\
  -H "Content-Type: application/json" \\${authHeader}
  -d '${bodyStr}'`;
  }

  function renderModal() {
    removeOverlay();
    const code = buildCurl();
    const modal = el('div.modal',
      el('div.modal-header',
        el('h3', 'cURL Code'),
        el('button.modal-close', { onClick: removeOverlay }, el('i.ri-close-line')),
      ),
      el('div.modal-body',
        el('label.checkbox-label',
          el('input', { type: 'checkbox', ...(includeKey ? { checked: 'true' } : {}), onChange: (e: Event) => { includeKey = (e.target as HTMLInputElement).checked; renderModal(); } }),
          ' Include API key',
        ),
        el('label.checkbox-label',
          el('input', { type: 'checkbox', ...(useGeneric ? { checked: 'true' } : {}), onChange: (e: Event) => { useGeneric = (e.target as HTMLInputElement).checked; renderModal(); } }),
          ' Use generic chat (Hello World)',
        ),
        el('pre.code-block', code),
      ),
      el('div.modal-footer',
        el('button.btn', { onClick: () => { navigator.clipboard.writeText(code); } },
          el('i.ri-clipboard-line'), ' Copy'),
      ),
    );
    showOverlay(modal);
  }

  renderModal();
}

// ── Content ──

function renderContent(): HTMLElement {
  const tab = getActiveTab();
  if (!tab) return el('div');

  return el('div.content',
    renderChat(tab),
    renderInput(tab),
  );
}

// ── Chat Messages ──

function renderChat(tab: Tab): HTMLElement {
  const chat = el('div.chat-area');

  if (tab.messages.length === 0) {
    chat.appendChild(renderSuggestions(tab));
  }

  for (const msg of tab.messages) {
    if (msg.role === 'user') chat.appendChild(renderUserMessage(tab, msg));
    else if (msg.role === 'assistant') {
      chat.appendChild(renderAssistantMessage(tab, msg));
    }
    else if (msg.role === 'tool') {
      if (!msg.toolCallId || !isToolResponseEditorOpen(tab, msg.toolCallId)) {
        chat.appendChild(renderToolMessage(tab, msg));
      }
    }
  }

  const continuableMsg = getContinuableAssistantMessage(tab);
  if (continuableMsg && !tab.streaming) {
    const allAnswered = continuableMsg.toolCalls!.every(tc =>
      tab.messages.some(m => m.role === 'tool' && m.toolCallId === tc.id)
    );
    const hasOpenEditor = continuableMsg.toolCalls!.some(tc => tc.id && isToolResponseEditorOpen(tab, tc.id));
    if (allAnswered && !hasOpenEditor) {
      chat.appendChild(el('div.tool-continue-row',
        el('button.btn.btn-primary', {
          onClick: () => sendMessage(tab, undefined, true),
        }, 'Continue'),
      ));
    }
  }

  if (tab.streaming) {
    chat.appendChild(el('div.streaming-indicator',
      el('span.dot'), el('span.dot'), el('span.dot'),
    ));
  }

  return el('div.chat-scroll', { id: 'chat-scroll' }, chat);
}

function renderSuggestions(tab: Tab): HTMLElement {
  return el('div.suggestions',
    el('h2.suggestions-title', 'LLM Playground'),
    el('div.suggestions-grid',
      ...SUGGESTIONS.map(s =>
        el('button.suggestion-card', { onClick: () => sendMessage(tab, s) }, s)
      ),
    ),
  );
}

function renderUserMessage(tab: Tab, msg: ChatMessage): HTMLElement {
  const bubble = el('div.message.message-user',
    el('div.message-bubble.user-bubble',
      msg.attachments && msg.attachments.length > 0
        ? el('div.message-attachments', ...msg.attachments.map(renderAttachmentThumb))
        : null,
      el('div.message-text', { style: { whiteSpace: 'pre-wrap' } }, msg.content),
    ),
    el('div.message-actions',
      el('button.msg-action-btn.msg-action-icon-btn', { title: 'Edit', onClick: () => editUserMessage(tab, msg) },
        el('i.ri-pencil-line')),
      el('button.msg-action-btn.msg-action-icon-btn', { title: 'Retry from here', onClick: () => retryFromMessage(tab, msg) },
        el('i.ri-refresh-line')),
    ),
  );
  return bubble;
}

function renderAssistantMessage(tab: Tab, msg: ChatMessage): HTMLElement {
  if (!hasAssistantRenderableOutput(msg)) {
    return el('div.message.message-assistant', { 'data-message-id': msg.id, style: { display: 'none' } });
  }

  const stream = el('div.assistant-stream',
    ...getAssistantParts(msg).map((part, partIndex) => renderAssistantPart(tab, msg, part, partIndex)),
  );

  const actions = el('div.message-meta-row',
    el('div.message-actions',
      el('button.msg-action-btn.msg-action-icon-btn', { title: 'Copy', onClick: () => navigator.clipboard.writeText(msg.content) },
        el('i.ri-clipboard-line')),
      el('button.msg-action-btn.msg-action-icon-btn', { title: 'Retry', onClick: () => retryAssistant(tab, msg) },
        el('i.ri-refresh-line')),
      msg.metrics
        ? el('button.msg-action-btn.msg-action-icon-btn', { title: 'Metrics', onClick: (e: Event) => showMetricsPopover(e, msg.metrics!) },
          el('i.ri-information-line'))
        : null,
    ),
    el('span.message-model-chip', { title: msg.model || tab.config.model }, msg.model || tab.config.model),
  );

  return el('div.message.message-assistant', { 'data-message-id': msg.id },
    stream,
    actions,
  );
}

function renderAssistantPart(tab: Tab, msg: ChatMessage, part: AssistantMessagePart, partIndex: number): HTMLElement | null {
  if (part.type === 'content') {
    return renderAssistantContentPart(part.text);
  }

  if (part.type === 'reasoning') {
    return renderAssistantReasoningPart(msg, partIndex, part.text);
  }

  const toolCall = msg.toolCalls?.[part.index];
  if (!toolCall) return null;

  const existingResponse = toolCall.id
    ? tab.messages.find(m => m.role === 'tool' && m.toolCallId === toolCall.id)
    : undefined;

  if (toolCall.id && existingResponse && !isToolResponseEditorOpen(tab, toolCall.id)) {
    return null;
  }

  return renderToolCallBubble(tab, toolCall, part.index);
}

function tryFormatAssistantJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

function renderAssistantContentPart(text: string): HTMLElement {
  const formattedJson = tryFormatAssistantJson(text);
  if (formattedJson) {
    return el('div.message-bubble.assistant-bubble.assistant-content-block',
      el('div.message-content',
        el('pre', el('code', formattedJson)),
      ),
    );
  }

  const contentEl = el('div.message-content');
  contentEl.innerHTML = renderMarkdown(text);

  return el('div.message-bubble.assistant-bubble.assistant-content-block', contentEl);
}

function renderAssistantReasoningPart(msg: ChatMessage, partIndex: number, text: string): HTMLElement {
  const isOpen = isReasoningPartOpen(msg, partIndex);

  return el(`details.assistant-thinking${isOpen ? '[open=true]' : ''}`,
    {
      onToggle: (event: Event) => {
        const details = event.currentTarget as HTMLDetailsElement;
        setReasoningPartOpenState(msg, partIndex, details.open);
      },
    },
    el('summary.assistant-thinking-summary',
      el('span.assistant-thinking-caret', '›'),
      el('div.assistant-thinking-label',
        el('span.assistant-thinking-dot'),
        el('span', 'Thinking'),
      ),
    ),
    el('div.assistant-thinking-body', { style: { whiteSpace: 'pre-wrap' } }, text),
  );
}

function renderToolMessage(tab: Tab, msg: ChatMessage): HTMLElement {
  return el('div.message.message-tool',
    el('div.message-bubble.tool-bubble',
      el('div.tool-info',
        el('span.tool-label', `Tool response: ${msg.toolCallId || 'unknown'}`),
      ),
      el('div.tool-content', { style: { whiteSpace: 'pre-wrap' } }, msg.content),
      el('button.msg-action-btn.msg-action-text-btn', {
        title: 'Edit response',
        onClick: () => editToolResponse(tab, msg),
      }, el('i.ri-pencil-line'), ' Edit'),
    ),
  );
}

function getToolCallEditorId(tab: Tab, tc: ToolCall, toolCallIndex?: number): string {
  const toolCallKey = tc.id || `${tab.id}-tool-call-${toolCallIndex ?? 0}`;
  return `tool-resp-${toolCallKey}`;
}

function renderToolCallBubble(tab: Tab, tc: ToolCall, toolCallIndex?: number): HTMLElement {
  let args = '';
  try { args = JSON.stringify(JSON.parse(tc.function.arguments), null, 2); } catch { args = tc.function.arguments; }
  const existingResponse = tc.id
    ? tab.messages.find(m => m.role === 'tool' && m.toolCallId === tc.id)
    : undefined;
  const isEditing = Boolean(existingResponse);
  const editorId = getToolCallEditorId(tab, tc, toolCallIndex);
  const canSubmit = Boolean(tc.id);

  const textarea = el('textarea.tool-response-input', {
    placeholder: 'Tool response...',
    rows: '3',
    id: editorId,
    ...(canSubmit ? {} : { disabled: 'true' }),
  }) as HTMLTextAreaElement;

  if (existingResponse) {
    textarea.value = existingResponse.content;
  }

  return el('div.message.message-tool-call',
    el('div.message-bubble.tool-call-bubble',
      el('div.tool-call-header',
        el('i.ri-tools-line'),
        el('strong', ` ${tc.function.name || 'Tool call'}`),
      ),
      el('pre.tool-call-args', args || (tab.streaming ? 'Streaming tool call...' : '{}')),
      textarea,
      el('div', { style: { display: 'flex', gap: '8px' } },
        el(`button.btn.btn-sm${isEditing ? '' : '.btn-primary'}`, {
          ...(canSubmit ? {} : { disabled: 'true' }),
          onClick: () => {
            if (!tc.id) return;
            const val = (document.getElementById(editorId) as HTMLTextAreaElement | null)?.value || '';
            submitToolResponse(tab, tc.id, val);
          },
        }, isEditing ? 'Save' : 'Submit'),
        isEditing
          ? el('button.btn.btn-sm', {
            onClick: () => {
              closeToolResponseEditor(tab, tc.id);
              render();
            },
          }, 'Cancel')
          : null,
      ),
    ),
  );
}

function renderAttachmentThumb(att: Attachment): HTMLElement {
  if (att.type === 'image') {
    return el('img.attachment-thumb', { src: att.dataUrl, alt: att.name });
  }
  if (att.type === 'audio') {
    return el('audio.attachment-audio', { src: att.dataUrl, controls: 'true' });
  }
  return el('div.attachment-file',
    el('i.ri-file-line'),
    el('span', att.name),
  );
}

function showMetricsPopover(e: Event, metrics: MessageMetrics) {
  removeOverlay();
  const modal = el('div.modal.modal-sm',
    el('div.modal-header',
      el('h3', 'Response Metrics'),
      el('button.modal-close', { onClick: removeOverlay }, el('i.ri-close-line')),
    ),
    el('div.modal-body',
      el('div.metrics-grid',
        metricRow('Tokens/sec', metrics.tokensPerSecond?.toFixed(2)),
        metricRow('Time to first token', metrics.timeToFirstToken ? `${metrics.timeToFirstToken}ms` : '-'),
        metricRow('Total time', metrics.totalTime ? `${metrics.totalTime}ms` : '-'),
        metricRow('Input tokens', metrics.inputTokens),
        metricRow('Cached tokens', metrics.cachedTokens),
        metricRow('Output tokens', metrics.outputTokens),
      ),
    ),
  );
  showOverlay(modal);
}

function metricRow(label: string, value: any) {
  return el('div.metric-row',
    el('span.metric-label', label),
    el('span.metric-value', value != null ? String(value) : '-'),
  );
}

// ── Input Area ──

function renderInput(tab: Tab): HTMLElement {
  const inputArea = el('div.input-area');
  const container = el('div.input-container');

  if (pendingAttachments.length > 0) {
    container.appendChild(renderPendingAttachments());
  }

  const textarea = el('textarea.chat-input', {
    placeholder: 'Type your message here...',
    id: 'chat-textarea',
    rows: '1',
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const val = (document.getElementById('chat-textarea') as HTMLTextAreaElement)?.value || '';
        if (val.trim() || pendingAttachments.length > 0) sendMessage(tab, val);
      }
    },
    onInput: () => autoResize(),
    onPaste: (e: ClipboardEvent) => handlePaste(e),
  }) as HTMLTextAreaElement;

  const sendBtn = el('button.send-btn', {
    title: 'Send (Enter)',
    onClick: () => {
      const val = (document.getElementById('chat-textarea') as HTMLTextAreaElement)?.value || '';
      if (val.trim() || pendingAttachments.length > 0) sendMessage(tab, val);
    },
  }, tab.streaming
    ? el.fragment(el('i.ri-stop-circle-line'), "Stop")
    : el.fragment(el('i.ri-send-plane-2-fill'), "Send"));

  if (tab.streaming) {
    sendBtn.onclick = () => {
      if (tab.abortController) tab.abortController.abort();
      tab.streaming = false;
      persist();
      render();
    };
  }

  const inputRow = el('div.input-row', textarea);

  const toolbar = el('div.input-toolbar',
    el('button.toolbar-btn.model-btn', { title: 'Model settings', onClick: () => showModelSettings(tab) },
      el('i.ri-robot-line'),
      el('span.model-label', ` ${tab.config.model}`),
    ),
    el('button.toolbar-btn', { title: 'Attach file', onClick: () => openFilePicker() },
      el('i.ri-attachment-2')),
    el('button.toolbar-btn', {
      title: recording ? 'Stop recording' : 'Record voice',
      onClick: () => toggleRecording(),
      ...(recording ? { class: ['toolbar-btn', 'recording'] } : {}),
    }, el('i', { class: recording ? 'ri-stop-circle-line' : 'ri-mic-line' })),
    el('button.toolbar-btn', { title: 'Library', onClick: () => showLibraryModal() },
      el('i.ri-image-line')),
    el('button.toolbar-btn', { title: 'Advanced settings', onClick: () => showAdvancedSettings(tab) },
      el('i.ri-settings-3-line')),
  );

  const inputFooter = el('div.input-footer',
    toolbar,
    el('div.input-actions', sendBtn),
  );

  container.appendChild(inputRow);
  container.appendChild(inputFooter);

  inputArea.appendChild(container);

  inputArea.addEventListener('dragover', (e: any) => { e.preventDefault(); inputArea.classList.add('drag-over'); });
  inputArea.addEventListener('dragleave', () => inputArea.classList.remove('drag-over'));
  inputArea.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    inputArea.classList.remove('drag-over');
    if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
  });

  return inputArea;
}

function renderPendingAttachments(): HTMLElement {
  return el('div.pending-attachments',
    ...pendingAttachments.map((att, i) =>
      el('div.pending-att',
        att.type === 'image'
          ? el('img.pending-att-thumb', { src: att.dataUrl })
          : el('span.pending-att-name', att.name),
        el('button.pending-att-remove', { onClick: () => { pendingAttachments.splice(i, 1); render(); } },
          el('i.ri-close-line')),
      )
    ),
  );
}

function autoResize() {
  const ta = document.getElementById('chat-textarea') as HTMLTextAreaElement;
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) readFileAsAttachment(file);
    }
  }
}

function openFilePicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*,audio/*,.pdf,.txt,.csv,.json';
  input.onchange = () => {
    if (input.files) handleFiles(input.files);
  };
  input.click();
}

function handleFiles(files: FileList) {
  for (const file of Array.from(files)) {
    readFileAsAttachment(file);
  }
}

function readFileAsAttachment(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result as string;
    let type: Attachment['type'] = 'file';
    if (file.type.startsWith('image/')) type = 'image';
    else if (file.type.startsWith('audio/')) type = 'audio';

    pendingAttachments.push({ type, name: file.name, mimeType: file.type, dataUrl });
    render();
  };
  reader.readAsDataURL(file);
}

function toggleRecording() {
  if (recording && mediaRecorder) {
    mediaRecorder.stop();
    recording = false;
    render();
    return;
  }

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const chunks: Blob[] = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = () => {
        pendingAttachments.push({
          type: 'audio',
          name: 'voice-recording.webm',
          mimeType: 'audio/webm',
          dataUrl: reader.result as string,
        });
        render();
      };
      reader.readAsDataURL(blob);
    };
    mediaRecorder.start();
    recording = true;
    render();
  }).catch(() => {
    alert('Microphone access denied.');
  });
}

// ── Library ──

function showLibraryModal() {
  removeOverlay();
  const selected = new Set<number>();
  let adding = false;

  function renderLib() {
    removeOverlay();
    const items = LIBRARY_ITEMS.map((item, i) => {
      const isSelected = selected.has(i);
      return el(`div.library-item${isSelected ? '.selected' : ''}`, {
        onClick: () => { isSelected ? selected.delete(i) : selected.add(i); renderLib(); },
      },
        item.previewKind === 'image'
          ? el('img.library-thumb', { src: item.url, alt: item.name })
          : el('div.library-file-icon', el('i', { class: item.iconClass })),
        el('span.library-name', item.name),
      );
    });

    const modal = el('div.modal',
      el('div.modal-header',
        el('h3', 'Content Library'),
        el('button.modal-close', { onClick: removeOverlay }, el('i.ri-close-line')),
      ),
      el('div.modal-body',
        items.length > 0
          ? el('div.library-grid', ...items)
          : el('div.tool-info', 'No example media found in the medialib folder.'),
      ),
      el('div.modal-footer',
        el('button.btn.btn-primary', {
          ...(selected.size === 0 || adding ? { disabled: 'true' } : {}),
          onClick: async () => {
            if (selected.size === 0 || adding) return;

            adding = true;
            renderLib();

            try {
              const attachments = await Promise.all(
                Array.from(selected).map(idx => createAttachmentFromLibraryItem(LIBRARY_ITEMS[idx])),
              );
              pendingAttachments.push(...attachments);
            } catch {
              window.alert('Failed to load one or more media examples.');
              adding = false;
              renderLib();
              return;
            }

            removeOverlay();
            render();
          },
        }, adding ? 'Adding media...' : `Add ${selected.size} item(s)`),
      ),
    );
    showOverlay(modal);
  }
  renderLib();
}

// ── Model Settings ──

function showModelSettings(tab: Tab) {
  removeOverlay();
  const cfg = tab.config;
  const draftCfg = {
    model: cfg.model,
    endpoint: cfg.endpoint,
    apiKey: cfg.apiKey,
  };
  let presetsOpen = false;

  function readDraftFromInputs() {
    const modelInput = document.getElementById('cfg-model') as HTMLInputElement | null;
    const endpointInput = document.getElementById('cfg-endpoint') as HTMLInputElement | null;
    const apiKeyInput = document.getElementById('cfg-apikey') as HTMLInputElement | null;

    if (modelInput) draftCfg.model = modelInput.value;
    if (endpointInput) draftCfg.endpoint = endpointInput.value;
    if (apiKeyInput) draftCfg.apiKey = apiKeyInput.value;
  }

  function renderModelSettings() {
    removeOverlay();

    const presetMenu = presetsOpen
      ? el('div.dropdown-menu.endpoint-preset-menu',
        ...ENDPOINT_PRESETS.map(preset =>
          el('button.dropdown-item.endpoint-preset-item', {
            onClick: () => {
              draftCfg.endpoint = preset.endpoint;
              presetsOpen = false;
              renderModelSettings();
            },
          },
            el('span.endpoint-preset-copy',
              el('span.endpoint-preset-label', preset.label),
              el('span.endpoint-preset-value', preset.endpoint),
            ),
          ),
        ),
      )
      : null;

    const modal = el('div.modal',
      el('div.modal-header',
        el('h3', 'Model Settings'),
        el('button.modal-close', { onClick: removeOverlay }, el('i.ri-close-line')),
      ),
      el('div.modal-body',
        formGroup('Model', el('input.form-input', { type: 'text', value: draftCfg.model, id: 'cfg-model' })),
        formGroup('API Endpoint',
          el('div.endpoint-field',
            el('div.endpoint-field-row',
              el('input.form-input', { type: 'text', value: draftCfg.endpoint, id: 'cfg-endpoint' }),
              el('button.btn.endpoint-picker-btn', {
                title: 'Choose a preset endpoint',
                onClick: () => {
                  readDraftFromInputs();
                  presetsOpen = !presetsOpen;
                  renderModelSettings();
                },
              }, '...'),
            ),
            presetMenu,
          )),
        formGroup('API Key', el('input.form-input', { type: 'password', value: draftCfg.apiKey, id: 'cfg-apikey', placeholder: 'sk-...' })),
      ),
      el('div.modal-footer',
        el('button.btn.btn-primary', {
          onClick: () => {
            readDraftFromInputs();
            cfg.model = draftCfg.model;
            cfg.endpoint = draftCfg.endpoint;
            cfg.apiKey = draftCfg.apiKey;
            persist();
            removeOverlay();
            render();
          },
        }, 'Save'),
      ),
    );

    showOverlay(modal);
  }

  renderModelSettings();
}

// ── Advanced Settings ──

function showAdvancedSettings(tab: Tab) {
  removeOverlay();
  let activeSettingsTab = 0;
  const draftCfg = normalizeTabConfig(JSON.parse(JSON.stringify(tab.config)));

  function parseNullableFloat(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseNullableInt(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function tryParseJSONObject(value: string): Record<string, unknown> | null {
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }

  function readSettingsIntoDraft() {
    if (activeSettingsTab === 0) {
      const system = document.getElementById('cfg-system') as HTMLTextAreaElement | null;
      const reasoning = document.getElementById('cfg-reasoning') as HTMLSelectElement | null;

      if (system) draftCfg.systemPrompt = system.value;
      if (reasoning) draftCfg.reasoningEffort = normalizeReasoningEffort(reasoning.value);
      return;
    }

    if (activeSettingsTab === 1) {
      const temp = document.getElementById('cfg-temp') as HTMLInputElement | null;
      const topP = document.getElementById('cfg-topp') as HTMLInputElement | null;
      const freq = document.getElementById('cfg-freq') as HTMLInputElement | null;
      const pres = document.getElementById('cfg-pres') as HTMLInputElement | null;
      const maxTokens = document.getElementById('cfg-maxtokens') as HTMLInputElement | null;
      const stop = document.getElementById('cfg-stop') as HTMLInputElement | null;
      const tempEnabled = document.getElementById('cfg-temp-enabled') as HTMLInputElement | null;
      const topPEnabled = document.getElementById('cfg-topp-enabled') as HTMLInputElement | null;
      const freqEnabled = document.getElementById('cfg-freq-enabled') as HTMLInputElement | null;
      const presEnabled = document.getElementById('cfg-pres-enabled') as HTMLInputElement | null;
      const maxTokensEnabled = document.getElementById('cfg-maxtokens-enabled') as HTMLInputElement | null;

      const temperatureEnabled = tempEnabled?.checked ?? false;
      const topPIsEnabled = topPEnabled?.checked ?? false;
      const frequencyPenaltyEnabled = freqEnabled?.checked ?? false;
      const presencePenaltyEnabled = presEnabled?.checked ?? false;
      const maxTokensIsEnabled = maxTokensEnabled?.checked ?? false;

      draftCfg.enabledParams.temperature = temperatureEnabled;
      draftCfg.enabledParams.topP = topPIsEnabled;
      draftCfg.enabledParams.frequencyPenalty = frequencyPenaltyEnabled;
      draftCfg.enabledParams.presencePenalty = presencePenaltyEnabled;
      draftCfg.enabledParams.maxTokens = maxTokensIsEnabled;

      if (temp && temperatureEnabled) draftCfg.temperature = parseNullableFloat(temp.value) ?? SAMPLING_FALLBACKS.temperature;
      if (topP && topPIsEnabled) draftCfg.topP = parseNullableFloat(topP.value) ?? SAMPLING_FALLBACKS.topP;
      if (freq && frequencyPenaltyEnabled) draftCfg.frequencyPenalty = parseNullableFloat(freq.value) ?? SAMPLING_FALLBACKS.frequencyPenalty;
      if (pres && presencePenaltyEnabled) draftCfg.presencePenalty = parseNullableFloat(pres.value) ?? SAMPLING_FALLBACKS.presencePenalty;
      if (maxTokens && maxTokensIsEnabled) draftCfg.maxTokens = parseNullableInt(maxTokens.value) ?? SAMPLING_FALLBACKS.maxTokens;

      const stopSequences = stop?.value
        ? stop.value.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      draftCfg.stopSequences = stopSequences.length > 0 ? stopSequences : null;
      return;
    }

    if (activeSettingsTab === 2) {
      const tools = document.getElementById('cfg-tools') as HTMLTextAreaElement | null;
      if (tools) draftCfg.tools = tryParseJSON(tools.value) || [];
      return;
    }

    const structuredJson = document.getElementById('cfg-structured-json') as HTMLTextAreaElement | null;
    if (structuredJson) draftCfg.structuredJson = tryParseJSONObject(structuredJson.value);
  }

  function renderSettings() {
    removeOverlay();
    const cfg = draftCfg;

    const tabBtns = ['Model', 'Sampling', 'Tools', 'Structured JSON'].map((name, i) =>
      el(`button.settings-tab-btn${i === activeSettingsTab ? '.active' : ''}`, {
        onClick: () => {
          readSettingsIntoDraft();
          activeSettingsTab = i;
          renderSettings();
        },
      }, name)
    );

    let content: HTMLElement;

    if (activeSettingsTab === 0) {
      content = el('div.settings-panel',
        formGroup('System Instructions',
          el('textarea.form-input.form-textarea', { id: 'cfg-system', rows: '5' }, cfg.systemPrompt)),
        formGroup('Reasoning Effort',
          el('select.form-input', { id: 'cfg-reasoning' },
            ...['disabled', 'none', 'low', 'medium', 'high'].map(v =>
              el('option', { value: v, ...(v === cfg.reasoningEffort ? { selected: 'true' } : {}) }, v)
            ),
          )),
      );
    } else if (activeSettingsTab === 1) {
      const ep = cfg.enabledParams || {};
      content = el('div.settings-panel.sampling-panel',
        toggleSliderGroup('Temperature', 'cfg-temp', cfg.temperature, SAMPLING_FALLBACKS.temperature, 0, 2, 0.1, ep.temperature === true, 'temperature', cfg,
          'Controls how deterministic or creative the reply should feel.'),
        toggleSliderGroup('Top P', 'cfg-topp', cfg.topP, SAMPLING_FALLBACKS.topP, 0, 1, 0.05, ep.topP === true, 'topP', cfg,
          'Limits token selection to the most likely candidates.'),
        toggleSliderGroup('Frequency Penalty', 'cfg-freq', cfg.frequencyPenalty, SAMPLING_FALLBACKS.frequencyPenalty, 0, 2, 0.1, ep.frequencyPenalty === true, 'frequencyPenalty', cfg,
          'Reduces repeated words and phrases across the response.'),
        toggleSliderGroup('Presence Penalty', 'cfg-pres', cfg.presencePenalty, SAMPLING_FALLBACKS.presencePenalty, 0, 2, 0.1, ep.presencePenalty === true, 'presencePenalty', cfg,
          'Encourages the model to introduce fresher topics.'),
        toggleFormGroup('Max Tokens', ep.maxTokens === true, 'maxTokens', cfg,
          el('input.form-input', {
            type: 'number',
            value: cfg.maxTokens == null ? '' : String(cfg.maxTokens),
            id: 'cfg-maxtokens',
            min: '0',
            placeholder: 'null',
          }),
          String(SAMPLING_FALLBACKS.maxTokens),
          'Caps the maximum size of the generated answer.'),
        describedFormGroup('Stop Sequences',
          'Comma-separated values that immediately stop generation when matched.',
          el('input.form-input', { type: 'text', value: cfg.stopSequences?.join(', ') ?? '', id: 'cfg-stop', placeholder: 'Observation:, </tool_output>' })),
      );
    } else if (activeSettingsTab === 2) {
      content = el('div.settings-panel',
        formGroup('Tools JSON',
          el('textarea.form-input.form-textarea', {
            id: 'cfg-tools',
            rows: '10',
            placeholder: '[{"type":"function","function":{...}}]',
          }, JSON.stringify(cfg.tools, null, 2))),
        el('div.tool-presets',
          el('span', 'Presets: '),
          el('button.btn.btn-sm', {
            onClick: () => {
              const ta = document.getElementById('cfg-tools') as HTMLTextAreaElement;
              const current = tryParseJSON(ta.value) || [];
              current.push(PREDEFINED_TOOLS.webSearch);
              ta.value = JSON.stringify(current, null, 2);
            },
          }, 'Web Search'),
          el('button.btn.btn-sm', {
            onClick: () => {
              const ta = document.getElementById('cfg-tools') as HTMLTextAreaElement;
              const current = tryParseJSON(ta.value) || [];
              current.push(PREDEFINED_TOOLS.math);
              ta.value = JSON.stringify(current, null, 2);
            },
          }, 'Math'),
        ),
      );
    } else {
      content = el('div.settings-panel',
        formGroup('Structured JSON',
          el('textarea.form-input.form-textarea', {
            id: 'cfg-structured-json',
            rows: '16',
            placeholder: STRUCTURED_JSON_PLACEHOLDER,
          }, cfg.structuredJson ? JSON.stringify(cfg.structuredJson, null, 2) : '')),
        el('div.tool-presets',
          el('span', 'Presets: '),
          el('button.btn.btn-sm', {
            onClick: () => {
              const ta = document.getElementById('cfg-structured-json') as HTMLTextAreaElement;
              ta.value = JSON.stringify(PREDEFINED_STRUCTURED_JSON.answer, null, 2);
            },
          }, 'Answer'),
          el('button.btn.btn-sm', {
            onClick: () => {
              const ta = document.getElementById('cfg-structured-json') as HTMLTextAreaElement;
              ta.value = JSON.stringify(PREDEFINED_STRUCTURED_JSON.answerWithConfidence, null, 2);
            },
          }, 'Answer + Confidence'),
          el('button.btn.btn-sm', {
            onClick: () => {
              const ta = document.getElementById('cfg-structured-json') as HTMLTextAreaElement;
              ta.value = JSON.stringify(PREDEFINED_STRUCTURED_JSON.answerWithCitations, null, 2);
            },
          }, 'Answer + Citations'),
        ),
      );
    }

    const modal = el('div.modal',
      el('div.modal-header',
        el('h3', 'Advanced Settings'),
        el('button.modal-close', { onClick: removeOverlay }, el('i.ri-close-line')),
      ),
      el('div.settings-tabs', ...tabBtns),
      el('div.modal-body', content),
      el('div.modal-footer',
        el('button.btn.btn-primary', {
          onClick: () => {
            readSettingsIntoDraft();
            Object.assign(tab.config, draftCfg, { enabledParams: { ...draftCfg.enabledParams } });
            persist();
            removeOverlay();
            render();
          },
        }, 'Save'),
      ),
    );
    showOverlay(modal);
  }

  renderSettings();
}

function formGroup(label: string, input: HTMLElement): HTMLElement {
  return el('div.form-group',
    el('label.form-label', label),
    input,
  );
}

function describedFormGroup(label: string, description: string, input: HTMLElement): HTMLElement {
  return el('div.form-group.form-card',
    el('div.control-copy',
      el('span.control-title', label),
      el('span.control-description', description),
    ),
    input,
  );
}

function formatNullableSettingValue(value: number | null): string {
  return value == null ? 'null' : String(value);
}

function toggleSliderGroup(label: string, id: string, value: number | null, fallbackValue: number, min: number, max: number, step: number, enabled: boolean, paramKey: string, cfg: TabConfig, description: string): HTMLElement {
  let group!: HTMLElement;
  let currentValue = value;
  const display = el('span.slider-value.slider-value-badge', formatNullableSettingValue(value));
  const slider = el('input.form-slider', {
    type: 'range', id, value: String(value ?? fallbackValue),
    min: String(min), max: String(max), step: String(step),
    ...(enabled ? {} : { disabled: 'true' }),
    onInput: (e: Event) => {
      currentValue = parseFloat((e.target as HTMLInputElement).value);
      display.textContent = formatNullableSettingValue(currentValue);
    },
  });

  const toggle = el('input.param-toggle.toggle-input', {
    id: `${id}-enabled`,
    type: 'checkbox',
    ...(enabled ? { checked: 'true' } : {}),
    onChange: (e: Event) => {
      const on = (e.target as HTMLInputElement).checked;
      cfg.enabledParams[paramKey] = on;
      (slider as HTMLInputElement).disabled = !on;
      group.classList.toggle('is-disabled', !on);

      if (on && currentValue == null) {
        currentValue = parseFloat((slider as HTMLInputElement).value);
      }

      display.textContent = on
        ? formatNullableSettingValue(currentValue)
        : formatNullableSettingValue(currentValue);
    },
  });

  group = el(`div.form-group.form-card${enabled ? '' : '.is-disabled'}`,
    el('div.slider-header',
      el('label.control-toggle',
        toggle,
        el('span.toggle-switch'),
        el('span.control-copy',
          el('span.control-title', label),
          el('span.control-description', description),
        ),
      ),
      display,
    ),
    slider,
  );

  return group;
}

function toggleFormGroup(label: string, enabled: boolean, paramKey: string, cfg: TabConfig, input: HTMLElement, defaultValueOnEnable: string, description: string): HTMLElement {
  let group!: HTMLElement;
  const control = input as HTMLInputElement;
  const toggle = el('input.param-toggle.toggle-input', {
    id: `${control.id}-enabled`,
    type: 'checkbox',
    ...(enabled ? { checked: 'true' } : {}),
    onChange: (e: Event) => {
      const on = (e.target as HTMLInputElement).checked;
      cfg.enabledParams[paramKey] = on;
      control.disabled = !on;
      if (on && !control.value) {
        control.value = defaultValueOnEnable;
      }
      group.classList.toggle('is-disabled', !on);
    },
  });
  if (!enabled) control.disabled = true;

  group = el(`div.form-group.form-card${enabled ? '' : '.is-disabled'}`,
    el('div.control-header',
      el('label.control-toggle',
        toggle,
        el('span.toggle-switch'),
        el('span.control-copy',
          el('span.control-title', label),
          el('span.control-description', description),
        ),
      ),
    ),
    input,
  );

  return group;
}

function tryParseJSON(val: string): any[] | null {
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ── Message Actions ──

function editUserMessage(tab: Tab, msg: ChatMessage) {
  removeOverlay();
  const textarea = el('textarea.form-input.form-textarea', { id: 'edit-msg', rows: '5' }, msg.content) as HTMLTextAreaElement;

  const modal = el('div.modal',
    el('div.modal-header',
      el('h3', 'Edit Message'),
      el('button.modal-close', { onClick: removeOverlay }, el('i.ri-close-line')),
    ),
    el('div.modal-body', textarea),
    el('div.modal-footer',
      el('button.btn.btn-primary', {
        onClick: () => {
          msg.content = (document.getElementById('edit-msg') as HTMLTextAreaElement).value;
          persist();
          removeOverlay();
          render();
        },
      }, 'Save'),
    ),
  );
  showOverlay(modal);
}

function retryFromMessage(tab: Tab, msg: ChatMessage) {
  const idx = tab.messages.indexOf(msg);
  if (idx === -1) return;
  clearReasoningStateForMessages(tab.messages.slice(idx + 1));
  tab.messages = tab.messages.slice(0, idx + 1);
  persist();
  sendMessage(tab, undefined, true);
}

function retryAssistant(tab: Tab, msg: ChatMessage) {
  const idx = tab.messages.indexOf(msg);
  if (idx === -1) return;
  clearReasoningStateForMessages(tab.messages.slice(idx));
  tab.messages = tab.messages.slice(0, idx);
  persist();
  sendMessage(tab, undefined, true);
}

function editToolResponse(tab: Tab, msg: ChatMessage) {
  if (!msg.toolCallId) return;
  openToolResponseEditor(tab, msg.toolCallId);
}

function submitToolResponse(tab: Tab, toolCallId: string, response: string) {
  const existingResponse = tab.messages.find(m => m.role === 'tool' && m.toolCallId === toolCallId);

  if (existingResponse) {
    existingResponse.content = response;
    existingResponse.timestamp = Date.now();
  } else {
    tab.messages.push({
      id: uid(),
      role: 'tool',
      content: response,
      toolCallId,
      timestamp: Date.now(),
    });
  }

  closeToolResponseEditor(tab, toolCallId);
  persist();
  render();
}

// ── Send & Stream ──

async function sendMessage(tab: Tab, content?: string, continueOnly?: boolean) {
  if (tab.streaming) return;

  if (!continueOnly && content !== undefined) {
    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: content,
      attachments: pendingAttachments.length > 0 ? [...pendingAttachments] : undefined,
      timestamp: Date.now(),
    };
    tab.messages.push(userMsg);
    pendingAttachments = [];
  }

  const assistantMsg: ChatMessage = {
    id: uid(),
    role: 'assistant',
    content: '',
    model: tab.config.model,
    parts: [],
    timestamp: Date.now(),
  };
  tab.messages.push(assistantMsg);
  tab.streaming = true;

  persist();
  render();

  const controller = await streamChat(tab, {
    onPart: (part) => {
      appendAssistantTextPart(assistantMsg, part.type, part.text);
      updateStreamingMessage(tab, assistantMsg);
    },
    onToolCalls: (toolCalls, newIndexes) => {
      assistantMsg.toolCalls = toolCalls;
      for (const index of newIndexes) {
        appendAssistantToolCallPart(assistantMsg, index);
      }
      updateStreamingMessage(tab, assistantMsg);
    },
    onDone: (metrics) => {
      assistantMsg.metrics = metrics;
      tab.streaming = false;
      tab.abortController = undefined;

      if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
        persist();
        render();
        return;
      }

      if (!hasAssistantRenderableOutput(assistantMsg)) {
        tab.messages = tab.messages.filter(m => m.id !== assistantMsg.id);
      }

      persist();
      render();
    },
    onError: (error) => {
      appendAssistantTextPart(assistantMsg, 'content', `${assistantMsg.content ? '\n\n' : ''}**Error:** ${error}`);
      updateStreamingMessage(tab, assistantMsg);
    },
  });

  tab.abortController = controller;
}

function updateStreamingMessage(tab: Tab, msg: ChatMessage) {
  const currentMessage = document.querySelector(`.message-assistant[data-message-id="${msg.id}"]`) as HTMLElement | null;
  if (!currentMessage) {
    render();
    return;
  }

  currentMessage.replaceWith(renderAssistantMessage(tab, msg));
  scrollChatToBottom();
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    const scrollEl = document.getElementById('chat-scroll');
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });
}

// ── Overlay System ──

function showOverlay(content: HTMLElement) {
  removeOverlay();
  const overlay = el('div.overlay', { id: 'overlay', onClick: (e: Event) => { if (e.target === overlay) removeOverlay(); } },
    content,
  );
  document.body.appendChild(overlay);
}

function removeOverlay() {
  document.getElementById('overlay')?.remove();
}

// ── Init ──

init();
