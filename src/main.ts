import './styles/main.css';
import './styles/markdown-body.css';
import type { ChatMessage, MessageSegment, FileAttachment, ToolCall, ModelConfig, InferenceConfig, Chat, TokenUsage, Provider } from './types';
import { saveModelConfig, getDefaultModelConfig, saveInferenceConfig, getDefaultInferenceConfig, saveChat, getAllChats, deleteChat, saveProvider, getAllProviders, deleteProvider } from './storage/db';
import { buildRequest, streamChat } from './api/chat-client';
import { listModels, type Model } from './api/models-client';
import { generateCurlCommand, parseCurlCommand, importFromCurl } from './api/curl-utils';
import { marked } from 'marked';

const DEFAULT_MODEL_ID = 'default';
const DEFAULT_INFERENCE_ID = 'default';

let modelConfig: ModelConfig = {
  id: DEFAULT_MODEL_ID,
  name: '',
  endpoint: '',
  apiKey: '',
  createdAt: Date.now()
};

let inferenceConfig: InferenceConfig = {
  id: DEFAULT_INFERENCE_ID,
  systemPrompt: '',
  temperature: 1,
  temperatureEnabled: true,
  top_k: null,
  top_p: null,
  stop: [],
  maxCompletionTokens: null,
  tools: '',
  reasoningEffort: 'null',
  structuredJson: '',
  extraBody: ''
};

let chats: Chat[] = [];
let currentChatId: string | null = null;
let providers: Provider[] = [];
let editingProviderId: string | null = null;

let pendingAttachments: FileAttachment[] = [];
let isStreaming = false;
let editingMessageIndex: number | null = null;
let pendingToolCall: { messageIndex: number; toolCall: ToolCall } | null = null;
let abortController: AbortController | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const modelNameInput = $<HTMLInputElement>('model-name');
const endpointInput = $<HTMLInputElement>('endpoint');
const apiKeyInput = $<HTMLInputElement>('api-key');
const systemPromptInput = $<HTMLTextAreaElement>('system-prompt');
const tempEnabledInput = $<HTMLInputElement>('temp-enabled');
const temperatureInput = $<HTMLInputElement>('temperature');
const tempValueSpan = $<HTMLSpanElement>('temp-value');
const topKInput = $<HTMLInputElement>('top-k');
const topKValueSpan = $<HTMLSpanElement>('top-k-value');
const topPInput = $<HTMLInputElement>('top-p');
const topPValueSpan = $<HTMLSpanElement>('top-p-value');
const reasoningSelect = $<HTMLSelectElement>('reasoning-effort');
const maxTokensInput = $<HTMLInputElement>('max-tokens');
const stopSequencesInput = $<HTMLTextAreaElement>('stop-sequences');
const toolsInput = $<HTMLTextAreaElement>('tools');
const structuredJsonInput = $<HTMLTextAreaElement>('structured-json');
const extraBodyInput = $<HTMLTextAreaElement>('extra-body');
const messagesContainer = $<HTMLDivElement>('messages');
const emptyState = $<HTMLDivElement>('empty-state');
const userInput = $<HTMLTextAreaElement>('user-input');
const sendBtn = $<HTMLButtonElement>('send-btn');
const stopBtn = $<HTMLButtonElement>('stop-btn');
const attachBtn = $<HTMLButtonElement>('attach-btn');
const clearBtn = $<HTMLButtonElement>('clear-chat');
const resetParamsBtn = $<HTMLButtonElement>('reset-params-btn');
const fileInput = $<HTMLInputElement>('file-input');
const inputAttachments = $<HTMLDivElement>('input-attachments');
const statusDot = $<HTMLSpanElement>('status-dot');
const statusText = $<HTMLSpanElement>('status-text');
const modelDisplay = $<HTMLSpanElement>('model-display');
const toolModal = $<HTMLDivElement>('tool-modal');
const toolModalName = $<HTMLLabelElement>('tool-modal-name');
const toolResponse = $<HTMLTextAreaElement>('tool-response');
const toolModalCancel = $<HTMLButtonElement>('tool-modal-cancel');
const toolModalSubmit = $<HTMLButtonElement>('tool-modal-submit');
const editModal = $<HTMLDivElement>('edit-modal');
const editContent = $<HTMLTextAreaElement>('edit-content');
const editModalCancel = $<HTMLButtonElement>('edit-modal-cancel');
const editModalSubmit = $<HTMLButtonElement>('edit-modal-submit');
const tabsContainer = $<HTMLDivElement>('tabs-container');
const addTabBtn = $<HTMLButtonElement>('add-tab-btn');
const listModelsBtn = $<HTMLButtonElement>('list-models-btn');
const modelsModal = $<HTMLDivElement>('models-modal');
const modelsList = $<HTMLDivElement>('models-list');
const modelsModalCancel = $<HTMLButtonElement>('models-modal-cancel');
const themeToggleBtn = $<HTMLButtonElement>('theme-toggle-btn');
const providersBtn = $<HTMLButtonElement>('providers-btn');
const providersModal = $<HTMLDivElement>('providers-modal');
const providersList = $<HTMLDivElement>('providers-list');
const providersModalCancel = $<HTMLButtonElement>('providers-modal-cancel');
const providerSaveBtn = $<HTMLButtonElement>('provider-save-btn');
const providerNameInput = $<HTMLInputElement>('provider-name');
const providerEndpointInput = $<HTMLInputElement>('provider-endpoint');
const providerModelInput = $<HTMLInputElement>('provider-model');
const providerApikeyInput = $<HTMLInputElement>('provider-apikey');
const systemPromptBtn = $<HTMLButtonElement>('system-prompt-btn');
const systemPromptModal = $<HTMLDivElement>('system-prompt-modal');
const systemPromptModalClose = $<HTMLButtonElement>('system-prompt-modal-close');
const promptDot = $<HTMLSpanElement>('prompt-dot');
const toolsBtn = $<HTMLButtonElement>('tools-btn');
const toolsModal = $<HTMLDivElement>('tools-modal');
const toolsModalClose = $<HTMLButtonElement>('tools-modal-close');
const toolsDot = $<HTMLSpanElement>('tools-dot');
const stopSeqBtn = $<HTMLButtonElement>('stop-btn');
const stopSeqModal = $<HTMLDivElement>('stop-modal');
const stopSeqModalClose = $<HTMLButtonElement>('stop-modal-close');
const stopSeqDot = $<HTMLSpanElement>('stop-dot');
const formatBtn = $<HTMLButtonElement>('format-btn');
const formatModal = $<HTMLDivElement>('format-modal');
const formatModalClose = $<HTMLButtonElement>('format-modal-close');
const formatDot = $<HTMLSpanElement>('format-dot');
const extraBtn = $<HTMLButtonElement>('extra-btn');
const extraModal = $<HTMLDivElement>('extra-modal');
const extraModalClose = $<HTMLButtonElement>('extra-modal-close');
const extraDot = $<HTMLSpanElement>('extra-dot');
const viewCodeBtn = $<HTMLButtonElement>('view-code-btn');
const viewCodeModal = $<HTMLDivElement>('view-code-modal');
const viewCodeModalCancel = $<HTMLButtonElement>('view-code-modal-cancel');
const embedApiKeyCheckbox = $<HTMLInputElement>('embed-api-key');
const curlCodeOutput = $<HTMLPreElement>('curl-code-output');
const copyCurlBtn = $<HTMLButtonElement>('copy-curl-btn');
const importCurlBtn = $<HTMLButtonElement>('import-curl-btn');
const importCurlModal = $<HTMLDivElement>('import-curl-modal');
const importCurlModalCancel = $<HTMLButtonElement>('import-curl-modal-cancel');
const curlInput = $<HTMLTextAreaElement>('curl-input');
const importPreview = $<HTMLDivElement>('import-preview');
const importPreviewContent = $<HTMLDivElement>('import-preview-content');
const importCurlSubmitBtn = $<HTMLButtonElement>('import-curl-btn-submit');

const showModal = (el: HTMLElement) => el.classList.remove('hidden');
const hideModal = (el: HTMLElement) => el.classList.add('hidden');

function getCurrentChat(): Chat | null {
  const chat = chats.find(c => c.id === currentChatId) || null;
  if (chat && !chat.messages) {
    chat.messages = [];
  }
  return chat;
}

async function init() {
  // Handle URL query parameters for API configuration
  const urlParams = new URLSearchParams(window.location.search);
  const paramEndpoint = urlParams.get('api-endpoint');
  const paramKey = urlParams.get('api-key');
  const paramModel = urlParams.get('api-model');

  if (paramEndpoint || paramKey || paramModel) {
    // Load existing config first
    const existingConfig = await getDefaultModelConfig();
    if (existingConfig) {
      modelConfig = existingConfig;
    }

    // Apply URL params
    if (paramEndpoint) modelConfig.endpoint = paramEndpoint;
    if (paramKey) modelConfig.apiKey = paramKey;
    if (paramModel) modelConfig.name = paramModel;

    // Save and reload to remove sensitive data from URL
    await saveModelConfig(modelConfig);
    window.location.replace(window.location.pathname);
    return;
  }

  const savedModel = await getDefaultModelConfig();
  if (savedModel) {
    modelConfig = savedModel;
    modelNameInput.value = savedModel.name;
    endpointInput.value = savedModel.endpoint;
    apiKeyInput.value = savedModel.apiKey;
  }

  const savedInference = await getDefaultInferenceConfig();
  if (savedInference) {
    inferenceConfig = savedInference;
    systemPromptInput.value = savedInference.systemPrompt;
    tempEnabledInput.checked = savedInference.temperatureEnabled;
    temperatureInput.value = String(savedInference.temperature ?? 1);
    temperatureInput.disabled = !savedInference.temperatureEnabled;
    tempValueSpan.textContent = (savedInference.temperature ?? 1).toFixed(1);

    topKInput.value = String(savedInference.top_k ?? 0);
    topKValueSpan.textContent = String(savedInference.top_k ?? 0);

    topPInput.value = String(savedInference.top_p ?? 0);
    topPValueSpan.textContent = (savedInference.top_p ?? 0).toFixed(2);

    stopSequencesInput.value = savedInference.stop?.join('\n') ?? '';

    reasoningSelect.value = savedInference.reasoningEffort;
    maxTokensInput.value = savedInference.maxCompletionTokens ? String(savedInference.maxCompletionTokens) : '';
    toolsInput.value = savedInference.tools;
    structuredJsonInput.value = savedInference.structuredJson ?? '';
    extraBodyInput.value = savedInference.extraBody ?? '';
  }

  chats = await getAllChats();

  if (chats.length === 0) {
    await createNewChat();
  } else {
    currentChatId = chats[0].id;
  }

  renderTabs();
  renderMessages();
  updateModelDisplay();
  updateConfigDots();
  setupEventListeners();
}

async function createNewChat(): Promise<Chat> {
  const chat: Chat = {
    id: crypto.randomUUID(),
    title: 'New Chat',
    messages: [],
    modelConfigId: DEFAULT_MODEL_ID,
    inferenceConfigId: DEFAULT_INFERENCE_ID,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await saveChat(chat);
  chats.unshift(chat);
  currentChatId = chat.id;

  return chat;
}

function renderTabs() {
  tabsContainer.innerHTML = '';

  for (const chat of chats) {
    const tab = document.createElement('div');
    tab.className = `tab${chat.id === currentChatId ? ' active' : ''}`;
    tab.dataset.id = chat.id;

    tab.innerHTML = `
      <span class="tab-title">${escapeHtml(chat.title)}</span>
      <button class="tab-close" data-id="${chat.id}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    `;

    tab.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.tab-close')) return;
      switchToChat(chat.id);
    });

    const closeBtn = tab.querySelector('.tab-close');
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(chat.id);
    });

    tabsContainer.appendChild(tab);
  }
}

async function switchToChat(chatId: string) {
  if (chatId === currentChatId) return;
  if (isStreaming) return;

  currentChatId = chatId;
  renderTabs();
  messagesContainer.querySelectorAll('.message').forEach(el => el.remove());
  renderMessages();

  pendingAttachments = [];
  renderInputAttachments();
}

async function closeTab(chatId: string) {
  if (isStreaming) return;

  if (chats.length <= 1) {
    await deleteChat(chatId);
    chats = [];
    await createNewChat();
    renderTabs();
    messagesContainer.querySelectorAll('.message').forEach(el => el.remove());
    renderMessages();
    return;
  }

  await deleteChat(chatId);
  chats = chats.filter(c => c.id !== chatId);

  if (currentChatId === chatId) {
    currentChatId = chats[0]?.id || null;
    messagesContainer.querySelectorAll('.message').forEach(el => el.remove());
    renderMessages();
  }

  renderTabs();
}

async function addNewTab() {
  if (isStreaming) return;

  await createNewChat();
  renderTabs();
  messagesContainer.querySelectorAll('.message').forEach(el => el.remove());
  renderMessages();
}

function setupEventListeners() {
  modelNameInput.addEventListener('input', saveModelConfigDebounced);
  endpointInput.addEventListener('input', saveModelConfigDebounced);
  apiKeyInput.addEventListener('input', saveModelConfigDebounced);

  systemPromptInput.addEventListener('input', saveInferenceConfigDebounced);
  tempEnabledInput.addEventListener('change', () => {
    temperatureInput.disabled = !tempEnabledInput.checked;
    saveInferenceConfigDebounced();
  });
  temperatureInput.addEventListener('input', () => {
    tempValueSpan.textContent = parseFloat(temperatureInput.value).toFixed(1);
    saveInferenceConfigDebounced();
  });
  topKInput.addEventListener('input', () => {
    topKValueSpan.textContent = topKInput.value;
    saveInferenceConfigDebounced();
  });
  topPInput.addEventListener('input', () => {
    topPValueSpan.textContent = parseFloat(topPInput.value).toFixed(2);
    saveInferenceConfigDebounced();
  });
  reasoningSelect.addEventListener('change', saveInferenceConfigDebounced);
  maxTokensInput.addEventListener('input', saveInferenceConfigDebounced);
  stopSequencesInput.addEventListener('input', saveInferenceConfigDebounced);
  toolsInput.addEventListener('input', () => {
    validateToolsJson();
    saveInferenceConfigDebounced();
  });
  structuredJsonInput.addEventListener('input', () => {
    validateJsonField(structuredJsonInput);
    saveInferenceConfigDebounced();
  });
  extraBodyInput.addEventListener('input', () => {
    validateJsonField(extraBodyInput);
    saveInferenceConfigDebounced();
  });

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 200) + 'px';
  });

  sendBtn.addEventListener('click', sendMessage);
  stopBtn.addEventListener('click', stopStreaming);
  attachBtn.addEventListener('click', () => fileInput.click());
  clearBtn.addEventListener('click', clearChat);
  resetParamsBtn.addEventListener('click', resetParameters);
  fileInput.addEventListener('change', handleFileSelect);
  userInput.addEventListener('paste', handlePaste);
  addTabBtn.addEventListener('click', addNewTab);
  listModelsBtn.addEventListener('click', openModelsModal);
  modelsModalCancel.addEventListener('click', () => hideModal(modelsModal));
  themeToggleBtn.addEventListener('click', toggleTheme);

  providersBtn.addEventListener('click', openProvidersModal);
  providersModalCancel.addEventListener('click', closeProvidersModal);
  providerSaveBtn.addEventListener('click', saveOrUpdateProvider);

  systemPromptBtn.addEventListener('click', () => showModal(systemPromptModal));
  systemPromptModalClose.addEventListener('click', () => hideModal(systemPromptModal));
  toolsBtn.addEventListener('click', () => showModal(toolsModal));
  toolsModalClose.addEventListener('click', () => hideModal(toolsModal));
  stopSeqBtn.addEventListener('click', () => showModal(stopSeqModal));
  stopSeqModalClose.addEventListener('click', () => hideModal(stopSeqModal));
  formatBtn.addEventListener('click', () => showModal(formatModal));
  formatModalClose.addEventListener('click', () => hideModal(formatModal));
  extraBtn.addEventListener('click', () => showModal(extraModal));
  extraModalClose.addEventListener('click', () => {
    if (validateAndFormatJson(extraBodyInput)) {
      hideModal(extraModal);
    }
  });

  viewCodeBtn.addEventListener('click', openViewCodeModal);
  viewCodeModalCancel.addEventListener('click', () => hideModal(viewCodeModal));
  embedApiKeyCheckbox.addEventListener('change', updateCurlCode);
  copyCurlBtn.addEventListener('click', copyCurlToClipboard);

  importCurlBtn.addEventListener('click', openImportCurlModal);
  importCurlModalCancel.addEventListener('click', () => {
    hideModal(importCurlModal);
    curlInput.value = '';
    hideModal(importPreview);
  });
  curlInput.addEventListener('input', updateImportPreview);
  importCurlSubmitBtn.addEventListener('click', importCurlCommand);

  // Initialize theme from localStorage
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = savedTheme;

  toolModalCancel.addEventListener('click', () => {
    hideModal(toolModal);
    pendingToolCall = null;
  });

  toolModalSubmit.addEventListener('click', submitToolResponse);

  editModalCancel.addEventListener('click', () => {
    hideModal(editModal);
    editingMessageIndex = null;
  });

  editModalSubmit.addEventListener('click', submitEditedMessage);

  document.querySelectorAll('.hint-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const endpoint = target.dataset.endpoint;
      const tool = target.dataset.tool;

      if (endpoint) {
        providerEndpointInput.value = endpoint;
      }

      if (tool) {
        const toolExamples: Record<string, any[]> = {
          weather: [{
            type: "function",
            function: {
              name: "get_weather",
              description: "Get the current weather for a location",
              parameters: {
                type: "object",
                properties: {
                  location: {
                    type: "string",
                    description: "The city and state, e.g. San Francisco, CA"
                  },
                  unit: {
                    type: "string",
                    enum: ["celsius", "fahrenheit"],
                    description: "The temperature unit"
                  }
                },
                required: ["location"]
              }
            }
          }],
          calculator: [{
            type: "function",
            function: {
              name: "calculate",
              description: "Perform mathematical calculations",
              parameters: {
                type: "object",
                properties: {
                  expression: {
                    type: "string",
                    description: "The mathematical expression to evaluate, e.g. '2 + 2' or 'sqrt(16)'"
                  }
                },
                required: ["expression"]
              }
            }
          }],
          websearch: [{
            type: "function",
            function: {
              name: "web_search",
              description: "Search the web for current information",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "The search query"
                  },
                  num_results: {
                    type: "integer",
                    description: "Number of results to return (default: 5)",
                    minimum: 1,
                    maximum: 10
                  }
                },
                required: ["query"]
              }
            }
          }]
        };

        if (toolExamples[tool]) {
          toolsInput.value = JSON.stringify(toolExamples[tool], null, 2);
          saveInferenceConfigDebounced();
        }
      }
    });
  });
}

let saveModelTimeout: number;
function saveModelConfigDebounced() {
  clearTimeout(saveModelTimeout);
  saveModelTimeout = window.setTimeout(async () => {
    modelConfig.name = modelNameInput.value;
    modelConfig.endpoint = endpointInput.value;
    modelConfig.apiKey = apiKeyInput.value;
    await saveModelConfig(modelConfig);
    updateModelDisplay();
  }, 500);
}

let saveInferenceTimeout: number;
function saveInferenceConfigDebounced() {
  clearTimeout(saveInferenceTimeout);
  saveInferenceTimeout = window.setTimeout(async () => {
    inferenceConfig.systemPrompt = systemPromptInput.value;
    inferenceConfig.temperatureEnabled = tempEnabledInput.checked;
    inferenceConfig.temperature = parseFloat(temperatureInput.value);

    const topKValue = parseInt(topKInput.value, 10);
    inferenceConfig.top_k = topKValue > 0 ? topKValue : null;

    const topPValue = parseFloat(topPInput.value);
    inferenceConfig.top_p = topPValue > 0 ? topPValue : null;

    const stopSeq = stopSequencesInput.value.split('\n').filter(s => s.trim());
    inferenceConfig.stop = stopSeq.length > 0 ? stopSeq : [];

    inferenceConfig.reasoningEffort = reasoningSelect.value as InferenceConfig['reasoningEffort'];
    inferenceConfig.maxCompletionTokens = maxTokensInput.value ? parseInt(maxTokensInput.value, 10) : null;
    inferenceConfig.tools = toolsInput.value;
    inferenceConfig.structuredJson = structuredJsonInput.value;
    inferenceConfig.extraBody = extraBodyInput.value;
    await saveInferenceConfig(inferenceConfig);
    updateConfigDots();
  }, 500);
}

function updateConfigDots() {
  const hasPrompt = systemPromptInput.value.trim().length > 0;
  promptDot.classList.toggle('hidden', !hasPrompt);

  const hasTools = toolsInput.value.trim().length > 0;
  toolsDot.classList.toggle('hidden', !hasTools);

  const hasStop = stopSequencesInput.value.trim().length > 0;
  stopSeqDot.classList.toggle('hidden', !hasStop);

  const hasStructured = structuredJsonInput.value.trim().length > 0;
  formatDot.classList.toggle('hidden', !hasStructured);

  const hasExtra = extraBodyInput.value.trim().length > 0;
  extraDot.classList.toggle('hidden', !hasExtra);
}

function validateToolsJson() {
  const value = toolsInput.value.trim();
  if (!value) {
    toolsInput.classList.remove('error');
    return true;
  }
  try {
    JSON.parse(value);
    toolsInput.classList.remove('error');
    return true;
  } catch {
    toolsInput.classList.add('error');
    return false;
  }
}

function validateJsonField(textarea: HTMLTextAreaElement) {
  const value = textarea.value.trim();
  if (!value) {
    textarea.classList.remove('error');
    return true;
  }
  try {
    JSON.parse(value);
    textarea.classList.remove('error');
    return true;
  } catch {
    textarea.classList.add('error');
    return false;
  }
}

function validateAndFormatJson(textarea: HTMLTextAreaElement) {
  const value = textarea.value.trim();
  if (!value) {
    textarea.classList.remove('error');
    return true;
  }
  try {
    const parsed = JSON.parse(value);
    textarea.value = JSON.stringify(parsed, null, 2);
    textarea.classList.remove('error');
    return true;
  } catch (error) {
    textarea.classList.add('error');
    const errorMessage = error instanceof Error ? error.message : 'Invalid JSON syntax';
    alert(`Erro na sintaxe JSON:\n${errorMessage}`);
    return false;
  }
}

function updateModelDisplay() {
  if (modelConfig.name && modelConfig.endpoint) {
    modelDisplay.textContent = modelConfig.name;
    statusDot.classList.add('connected');
  } else {
    modelDisplay.textContent = 'No model';
    statusDot.classList.remove('connected');
  }
}

function renderMessages() {
  const chat = getCurrentChat();
  const hasMessages = chat && chat.messages.length > 0;
  hasMessages ? hideModal(emptyState) : showModal(emptyState);

  if (!hasMessages) {
    Array.from(messagesContainer.querySelectorAll('.message')).forEach(el => el.remove());
    return;
  }

  const existingMessages = messagesContainer.querySelectorAll('.message');
  const existingCount = existingMessages.length;

  for (let i = existingCount; i < chat!.messages.length; i++) {
    const msg = chat!.messages[i];
    const msgEl = createMessageElement(msg, i);
    messagesContainer.insertBefore(msgEl, emptyState);
  }

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function updateMessageContent(msgIndex: number, segments: MessageSegment[], currentSegmentType?: 'content' | 'reasoning' | null) {
  const msgEl = messagesContainer.querySelector(`.message[data-index="${msgIndex}"]`);
  if (!msgEl) return;

  const chat = getCurrentChat();
  const msg = chat?.messages[msgIndex];
  if (!msg) return;

  // Find or create content container
  let contentContainer = msgEl.querySelector('.message-body');
  if (!contentContainer) {
    const header = msgEl.querySelector('.message-header');
    contentContainer = document.createElement('div');
    contentContainer.className = 'message-body';
    if (header?.nextSibling) {
      msgEl.insertBefore(contentContainer, header.nextSibling);
    } else {
      msgEl.appendChild(contentContainer);
    }
  }

  // Render segments incrementally
  let html = '';
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLastSegment = i === segments.length - 1;
    const isStreaming = isLastSegment && currentSegmentType === segment.type;

    if (segment.type === 'reasoning') {
      html += `
        <details class="reasoning-block"${isStreaming ? ' open' : ''}>
          <summary>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Thinking
          </summary>
          <div class="reasoning-content">${await marked.parse(segment.text)}</div>
        </details>
      `;
    } else if (segment.type === 'content') {
      html += `<div class="message-content markdown-body">${await marked.parse(segment.text)}</div>`;
    }
  }

  contentContainer.innerHTML = html;
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function renderAssistantContent(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const formatted = JSON.stringify(parsed, null, 2);
      return `<pre><code class="language-json">${escapeHtml(formatted)}</code></pre>`;
    } catch {
      return marked.parse(text) as string;
    }
  }
  return marked.parse(text) as string;
}

function createMessageElement(msg: ChatMessage, index: number): HTMLElement {
  const div = document.createElement('div');
  div.className = `message ${msg.role}`;
  div.dataset.index = String(index);

  let actionsHtml = '';
  if (msg.role === 'user') {
    actionsHtml = `
      <div class="message-actions">
        <button class="btn btn-icon btn-sm rerun-btn" title="Rerun from here">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 4v6h6M23 20v-6h-6"/>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
          </svg>
        </button>
        <button class="btn btn-icon btn-sm copy-btn" title="Copy message">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
        <button class="btn btn-icon btn-sm edit-btn" title="Edit message">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </div>
    `;
  }

  let contentHtml = '';

  // Render segments if available (interleaved reasoning and content)
  if (msg.segments && msg.segments.length > 0) {
    for (const segment of msg.segments) {
      if (segment.type === 'reasoning') {
        contentHtml += `
          <details class="reasoning-block">
            <summary>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              Thinking
            </summary>
            <div class="reasoning-content">${marked.parse(segment.text)}</div>
          </details>
        `;
      } else if (segment.type === 'content') {
        if (msg.role === 'assistant') {
          contentHtml += `<div class="message-content markdown-body">${renderAssistantContent(segment.text)}</div>`;
        } else {
          contentHtml += `<div class="message-content">${escapeHtml(segment.text)}</div>`;
        }
      }
    }
  } else {
    // Fallback to legacy rendering for backward compatibility
    if (msg.content || msg.role === 'assistant') {
      const content = msg.content || '';
      if (msg.role === 'assistant' && content) {
        contentHtml = `<div class="message-content markdown-body">${renderAssistantContent(content)}</div>`;
      } else {
        contentHtml = `<div class="message-content">${escapeHtml(content)}</div>`;
      }
    }
  }



  const chat = getCurrentChat();

  if (msg.attachments && msg.attachments.length > 0) {
    contentHtml += '<div class="attachments">';
    for (const att of msg.attachments) {
      if (att.type.startsWith('image/')) {
        contentHtml += `<div class="attachment"><img src="${att.data}" alt="${escapeHtml(att.name)}" /></div>`;
      } else {
        contentHtml += `<div class="attachment"><span>📎 ${escapeHtml(att.name)}</span></div>`;
      }
    }
    contentHtml += '</div>';
  }

  if (msg.toolCalls && msg.toolCalls.length > 0) {
    contentHtml += '<div class="tool-calls">';
    for (const tc of msg.toolCalls) {
      const hasResponse = chat?.messages.some(m => m.toolCallId === tc.id);
      contentHtml += `
        <div class="tool-call" data-tool-id="${tc.id}">
          <div class="tool-call-header">
            <i class="ri-wrench-line"></i>
            <span class="tool-call-name">${escapeHtml(tc.function.name)}</span>
            <span class="tool-call-id">${escapeHtml(tc.id)}</span>
          </div>
          <div class="tool-call-body">
            <pre class="tool-call-args">${escapeHtml(formatJson(tc.function.arguments))}</pre>
            ${!hasResponse ? `<button class="btn btn-secondary btn-sm tool-response-btn" data-tool-id="${tc.id}" data-msg-index="${index}"><i class="ri-reply-line"></i> Provide Response</button>` : ''}
          </div>
        </div>
      `;
    }
    contentHtml += '</div>';
  }

  if (msg.role === 'tool' && msg.toolCallId) {
    const linkedToolCall = chat?.messages.flatMap(m => m.toolCalls || []).find(tc => tc.id === msg.toolCallId);
    const toolName = linkedToolCall?.function.name || 'unknown';
    contentHtml = `
      <div class="tool-response" data-tool-call-id="${msg.toolCallId}">
        <div class="tool-response-header">
          <i class="ri-checkbox-circle-line"></i>
          <span>Tool Response</span>
          <span class="tool-response-ref">
            <i class="ri-arrow-right-s-line"></i>
            <span class="tool-response-name">${escapeHtml(toolName)}</span>
            <span class="tool-response-id">${escapeHtml(msg.toolCallId)}</span>
          </span>
          <button class="btn btn-icon btn-sm tool-edit-btn" title="Edit response">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>
        <div class="tool-response-content">${escapeHtml(msg.content || '')}</div>
      </div>
    `;
  }

  // Only show single reasoning block at top if using legacy mode (no segments)
  const reasoningHtml = (msg.reasoning && !msg.segments?.length) ? `
    <details class="reasoning-block">
      <summary>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        Thinking
      </summary>
      <div class="reasoning-content">${marked.parse(msg.reasoning)}</div>
    </details>
  ` : '';

  div.innerHTML = `
    <div class="message-header">
      <span class="message-role ${msg.role}">${msg.role}</span>
      ${actionsHtml}
      ${msg.role === 'assistant' ? `
        <div class="message-actions">
          <button class="btn btn-icon btn-sm copy-btn" title="Copy message">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      ` : ''}
    </div>
    <div class="message-body">
      ${reasoningHtml}
      ${contentHtml}
    </div>
    ${msg.usage ? `<div class="token-usage"><span><i class="ri-arrow-down-line"></i>${msg.usage.promptTokens} in</span><span><i class="ri-arrow-up-line"></i>${msg.usage.completionTokens} out</span>${msg.usage.cachedTokens ? `<span><i class="ri-database-2-line"></i>${msg.usage.cachedTokens} cached</span>` : ''}${msg.usage.tokensPerSecond ? `<span><i class="ri-speed-line"></i>${msg.usage.tokensPerSecond.toFixed(1)} tok/s</span>` : ''}${msg.usage.responseTimeMs ? `<span><i class="ri-timer-line"></i>${(msg.usage.responseTimeMs / 1000).toFixed(2)}s</span>` : ''}</div>` : ''}
  `;

  const editBtn = div.querySelector('.edit-btn');
  if (editBtn) {
    editBtn.addEventListener('click', () => openEditModal(index));
  }

  const rerunBtn = div.querySelector('.rerun-btn');
  if (rerunBtn) {
    rerunBtn.addEventListener('click', () => rerunFromMessage(index));
  }

  const copyBtn = div.querySelector('.copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyToClipboard(index, copyBtn as HTMLButtonElement));
  }

  const toolBtns = div.querySelectorAll('.tool-response-btn');
  toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const toolId = (btn as HTMLButtonElement).dataset.toolId!;
      const msgIndex = parseInt((btn as HTMLButtonElement).dataset.msgIndex!, 10);
      const toolCall = chat?.messages[msgIndex].toolCalls?.find(tc => tc.id === toolId);
      if (toolCall) {
        openToolModal(msgIndex, toolCall);
      }
    });
  });

  const toolEditBtn = div.querySelector('.tool-edit-btn');
  if (toolEditBtn) {
    toolEditBtn.addEventListener('click', () => openEditModal(index));
  }

  return div;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

async function copyToClipboard(index: number, btn: HTMLButtonElement) {
  const chat = getCurrentChat();
  if (!chat) return;

  const content = chat.messages[index].content || '';
  await navigator.clipboard.writeText(content);

  const originalHtml = btn.innerHTML;
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `;
  setTimeout(() => btn.innerHTML = originalHtml, 2000);
}

async function rerunFromMessage(index: number) {
  const chat = getCurrentChat();
  if (!chat || isStreaming) return;

  chat.messages = chat.messages.slice(0, index + 1);
  chat.updatedAt = Date.now();
  await saveChat(chat);

  messagesContainer.querySelectorAll('.message').forEach(el => el.remove());
  renderMessages();

  await sendToApi();
}

function openEditModal(index: number) {
  const chat = getCurrentChat();
  if (!chat) return;
  editingMessageIndex = index;
  editContent.value = chat.messages[index].content || '';
  showModal(editModal);
}

function openToolModal(messageIndex: number, toolCall: ToolCall) {
  pendingToolCall = { messageIndex, toolCall };
  toolModalName.textContent = `Function: ${toolCall.function.name}`;
  toolResponse.value = '';
  showModal(toolModal);
}

async function submitEditedMessage() {
  const chat = getCurrentChat();
  if (editingMessageIndex === null || !chat) return;

  chat.messages[editingMessageIndex].content = editContent.value;
  chat.messages = chat.messages.slice(0, editingMessageIndex + 1);
  chat.updatedAt = Date.now();
  await saveChat(chat);

  messagesContainer.querySelectorAll('.message').forEach(el => el.remove());
  renderMessages();

  hideModal(editModal);
  editingMessageIndex = null;

  await sendToApi();
}

async function openModelsModal() {
  if (!modelConfig.endpoint || !modelConfig.apiKey) {
    showError('Please configure Endpoint URL and API Key first');
    return;
  }

  showModal(modelsModal);
  modelsList.innerHTML = '<div class="loading-indicator">Loading models...</div>';

  try {
    const models = await listModels(modelConfig);
    renderModelsList(models);
  } catch (err) {
    modelsList.innerHTML = `<div class="error-message">Error fetching models: ${err instanceof Error ? err.message : String(err)}</div>`;
  }
}

function renderModelsList(models: Model[]) {
  if (models.length === 0) {
    modelsList.innerHTML = '<div class="empty-state">No models found</div>';
    return;
  }

  modelsList.innerHTML = '';

  // Sort models by id
  models.sort((a, b) => a.id.localeCompare(b.id));

  for (const model of models) {
    const div = document.createElement('div');
    div.className = 'model-item';
    div.innerHTML = `
      <div class="model-item-id">${escapeHtml(model.id)}</div>
      <div class="model-item-meta">
        <span>${escapeHtml(model.owned_by)}</span>
        <span>${new Date(model.created * 1000).toLocaleDateString()}</span>
      </div>
    `;

    div.addEventListener('click', () => {
      modelNameInput.value = model.id;
      modelConfig.name = model.id;
      saveModelConfigDebounced(); // Trigger save
      updateModelDisplay();
      hideModal(modelsModal);
    });

    modelsList.appendChild(div);
  }
}

function openViewCodeModal() {
  const chat = getCurrentChat();
  if (!chat) return;

  embedApiKeyCheckbox.checked = false;
  updateCurlCode();
  showModal(viewCodeModal);
}

function updateCurlCode() {
  const chat = getCurrentChat();
  if (!chat) return;

  const request = buildRequest(modelConfig, inferenceConfig, chat.messages);
  const curlCommand = generateCurlCommand(modelConfig, request, embedApiKeyCheckbox.checked);
  curlCodeOutput.textContent = curlCommand;
}

async function copyCurlToClipboard() {
  const code = curlCodeOutput.textContent || '';
  try {
    await navigator.clipboard.writeText(code);
    const originalText = copyCurlBtn.innerHTML;
    copyCurlBtn.innerHTML = '<i class="ri-check-line"></i> Copied!';
    setTimeout(() => {
      copyCurlBtn.innerHTML = originalText;
    }, 2000);
  } catch {
    alert('Failed to copy to clipboard');
  }
}

function openImportCurlModal() {
  curlInput.value = '';
  hideModal(importPreview);
  showModal(importCurlModal);
}

function updateImportPreview() {
  const value = curlInput.value.trim();
  if (!value) {
    hideModal(importPreview);
    return;
  }

  try {
    const parsed = parseCurlCommand(value);
    const imported = importFromCurl(parsed);

    let html = '';
    html += `<div class="import-preview-item"><span class="import-preview-label">Endpoint:</span><span class="import-preview-value">${escapeHtml(imported.endpoint)}</span></div>`;
    html += `<div class="import-preview-item"><span class="import-preview-label">Model:</span><span class="import-preview-value">${escapeHtml(imported.model || '(not specified)')}</span></div>`;
    html += `<div class="import-preview-item"><span class="import-preview-label">API Key:</span><span class="import-preview-value">${imported.apiKey ? '••••••••' : '(not included)'}</span></div>`;
    html += `<div class="import-preview-item"><span class="import-preview-label">Messages:</span><span class="import-preview-value">${imported.messages.length} message(s)</span></div>`;
    if (imported.systemPrompt) {
      const truncated = imported.systemPrompt.length > 100 ? imported.systemPrompt.slice(0, 100) + '...' : imported.systemPrompt;
      html += `<div class="import-preview-item"><span class="import-preview-label">System:</span><span class="import-preview-value truncated">${escapeHtml(truncated)}</span></div>`;
    }
    if (imported.temperature !== undefined) {
      html += `<div class="import-preview-item"><span class="import-preview-label">Temperature:</span><span class="import-preview-value">${imported.temperature}</span></div>`;
    }
    if (imported.tools) {
      html += `<div class="import-preview-item"><span class="import-preview-label">Tools:</span><span class="import-preview-value">Included</span></div>`;
    }

    importPreviewContent.innerHTML = html;
    showModal(importPreview);
  } catch (e) {
    importPreviewContent.innerHTML = `<div class="import-preview-item"><span class="import-preview-label" style="color: var(--error);">Error:</span><span class="import-preview-value">${escapeHtml((e as Error).message)}</span></div>`;
    showModal(importPreview);
  }
}

async function importCurlCommand() {
  const value = curlInput.value.trim();
  if (!value) return;

  try {
    const parsed = parseCurlCommand(value);
    const imported = importFromCurl(parsed);

    if (imported.endpoint) {
      modelConfig.endpoint = imported.endpoint;
      endpointInput.value = imported.endpoint;
    }
    if (imported.apiKey) {
      modelConfig.apiKey = imported.apiKey;
      apiKeyInput.value = imported.apiKey;
    }
    if (imported.model) {
      modelConfig.name = imported.model;
      modelNameInput.value = imported.model;
    }
    await saveModelConfig(modelConfig);
    updateModelDisplay();

    if (imported.systemPrompt) {
      inferenceConfig.systemPrompt = imported.systemPrompt;
      systemPromptInput.value = imported.systemPrompt;
    }
    if (imported.temperature !== undefined) {
      inferenceConfig.temperature = imported.temperature;
      inferenceConfig.temperatureEnabled = true;
      temperatureInput.value = String(imported.temperature);
      tempValueSpan.textContent = imported.temperature.toFixed(1);
      tempEnabledInput.checked = true;
      temperatureInput.disabled = false;
    }
    if (imported.topK !== undefined) {
      inferenceConfig.top_k = imported.topK;
      topKInput.value = String(imported.topK);
      topKValueSpan.textContent = String(imported.topK);
    }
    if (imported.topP !== undefined) {
      inferenceConfig.top_p = imported.topP;
      topPInput.value = String(imported.topP);
      topPValueSpan.textContent = imported.topP.toFixed(2);
    }
    if (imported.maxTokens !== undefined) {
      inferenceConfig.maxCompletionTokens = imported.maxTokens;
      maxTokensInput.value = String(imported.maxTokens);
    }
    if (imported.stop && imported.stop.length > 0) {
      inferenceConfig.stop = imported.stop;
      stopSequencesInput.value = imported.stop.join('\n');
    }
    if (imported.tools) {
      inferenceConfig.tools = imported.tools;
      toolsInput.value = imported.tools;
    }
    if (imported.reasoningEffort) {
      inferenceConfig.reasoningEffort = imported.reasoningEffort as InferenceConfig['reasoningEffort'];
      reasoningSelect.value = imported.reasoningEffort;
    }
    await saveInferenceConfig(inferenceConfig);
    updateConfigDots();

    if (imported.messages.length > 0) {
      const chat = getCurrentChat();
      if (chat) {
        chat.messages = imported.messages;
        chat.updatedAt = Date.now();
        await saveChat(chat);
        messagesContainer.querySelectorAll('.message').forEach(el => el.remove());
        renderMessages();
      }
    }

    hideModal(importCurlModal);
    curlInput.value = '';
    hideModal(importPreview);

  } catch (e) {
    alert('Failed to import: ' + (e as Error).message);
  }
}

async function openProvidersModal() {
  providers = await getAllProviders();
  renderProvidersList();
  prefillProviderForm();
  showModal(providersModal);
}

function prefillProviderForm() {
  const endpoint = endpointInput.value.trim();
  const model = modelNameInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (endpoint && model && apiKey) {
    try {
      const host = new URL(endpoint).hostname;
      providerNameInput.value = `${model} from ${host}`;
    } catch {
      providerNameInput.value = model || '';
    }
    providerEndpointInput.value = endpoint;
    providerModelInput.value = model;
    providerApikeyInput.value = apiKey;
  }
}

function closeProvidersModal() {
  hideModal(providersModal);
  clearProviderForm();
}

function clearProviderForm() {
  editingProviderId = null;
  providerNameInput.value = '';
  providerEndpointInput.value = '';
  providerModelInput.value = '';
  providerApikeyInput.value = '';
  providerSaveBtn.innerHTML = '<i class="ri-add-line"></i> Add Provider';
}

function renderProvidersList() {
  if (providers.length === 0) {
    providersList.innerHTML = '<div class="providers-empty">No providers saved yet</div>';
    return;
  }

  providersList.innerHTML = '';

  for (const provider of providers) {
    const div = document.createElement('div');
    div.className = 'provider-item';
    div.innerHTML = `
      <div class="provider-item-info">
        <div class="provider-item-name">${escapeHtml(provider.name)}</div>
        <div class="provider-item-details">
          <span>${escapeHtml(provider.model)}</span>
          <span>${escapeHtml(new URL(provider.endpoint).hostname)}</span>
        </div>
      </div>
      <div class="provider-item-actions">
        <button class="btn btn-icon btn-sm provider-edit-btn" title="Edit provider">
          <i class="ri-pencil-line"></i>
        </button>
        <button class="btn btn-icon btn-sm provider-delete-btn" title="Delete provider">
          <i class="ri-delete-bin-line"></i>
        </button>
        <button class="btn btn-icon btn-sm provider-select-btn" title="Use this provider">
          <i class="ri-arrow-right-line"></i>
        </button>
      </div>
    `;

    div.querySelector('.provider-select-btn')?.addEventListener('click', () => selectProvider(provider));
    div.querySelector('.provider-edit-btn')?.addEventListener('click', () => editProvider(provider));
    div.querySelector('.provider-delete-btn')?.addEventListener('click', () => removeProvider(provider.id));

    providersList.appendChild(div);
  }
}

function selectProvider(provider: Provider) {
  modelNameInput.value = provider.model;
  endpointInput.value = provider.endpoint;
  apiKeyInput.value = provider.apiKey;

  modelConfig.name = provider.model;
  modelConfig.endpoint = provider.endpoint;
  modelConfig.apiKey = provider.apiKey;

  saveModelConfigDebounced();
  updateModelDisplay();
  closeProvidersModal();
}

function editProvider(provider: Provider) {
  editingProviderId = provider.id;
  providerNameInput.value = provider.name;
  providerEndpointInput.value = provider.endpoint;
  providerModelInput.value = provider.model;
  providerApikeyInput.value = provider.apiKey;
  providerSaveBtn.innerHTML = '<i class="ri-save-line"></i> Update Provider';
}

async function saveOrUpdateProvider() {
  const name = providerNameInput.value.trim();
  const endpoint = providerEndpointInput.value.trim();
  const model = providerModelInput.value.trim();
  const apiKey = providerApikeyInput.value.trim();

  if (!name || !endpoint || !model || !apiKey) {
    showError('Please fill all provider fields');
    return;
  }

  try {
    new URL(endpoint);
  } catch {
    showError('Invalid endpoint URL');
    return;
  }

  const provider: Provider = {
    id: editingProviderId || crypto.randomUUID(),
    name,
    endpoint,
    model,
    apiKey,
    createdAt: editingProviderId ? (providers.find(p => p.id === editingProviderId)?.createdAt || Date.now()) : Date.now()
  };

  await saveProvider(provider);
  providers = await getAllProviders();
  renderProvidersList();
  clearProviderForm();
}

async function removeProvider(id: string) {
  await deleteProvider(id);
  providers = await getAllProviders();
  renderProvidersList();

  if (editingProviderId === id) {
    clearProviderForm();
  }
}

async function submitToolResponse() {
  const chat = getCurrentChat();
  if (!pendingToolCall || !chat) return;

  const toolMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'tool',
    content: toolResponse.value,
    toolCallId: pendingToolCall.toolCall.id,
    createdAt: Date.now()
  };

  chat.messages.push(toolMsg);
  chat.updatedAt = Date.now();
  await saveChat(chat);
  renderMessages();

  hideModal(toolModal);
  pendingToolCall = null;

  await sendToApi();
}

async function handleFileSelect(e: Event) {
  const files = (e.target as HTMLInputElement).files;
  if (!files) return;

  for (const file of Array.from(files)) {
    const base64 = await fileToBase64(file);
    const attachment: FileAttachment = {
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type,
      data: base64,
      size: file.size
    };
    pendingAttachments.push(attachment);
  }

  renderInputAttachments();
  fileInput.value = '';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderInputAttachments() {
  inputAttachments.innerHTML = '';

  for (const att of pendingAttachments) {
    const div = document.createElement('div');
    div.className = 'input-attachment';

    if (att.type.startsWith('image/')) {
      div.innerHTML = `
        <img src="${att.data}" alt="${escapeHtml(att.name)}" />
        <span>${escapeHtml(att.name)}</span>
        <button class="input-attachment-remove" data-id="${att.id}">×</button>
      `;
    } else {
      div.innerHTML = `
        <span>📎 ${escapeHtml(att.name)}</span>
        <button class="input-attachment-remove" data-id="${att.id}">×</button>
      `;
    }

    inputAttachments.appendChild(div);
  }

  inputAttachments.querySelectorAll('.input-attachment-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = (e.target as HTMLButtonElement).dataset.id;
      pendingAttachments = pendingAttachments.filter(a => a.id !== id);
      renderInputAttachments();
    });
  });
}

async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;

  const files: File[] = [];

  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }

  if (files.length === 0) return;

  e.preventDefault();

  for (const file of files) {
    const base64 = await fileToBase64(file);
    const attachment: FileAttachment = {
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type,
      data: base64,
      size: file.size
    };
    pendingAttachments.push(attachment);
  }

  renderInputAttachments();
}

async function sendMessage() {
  const chat = getCurrentChat();
  if (!chat || !chat.messages) return;

  const content = userInput.value.trim();
  if (!content && pendingAttachments.length === 0) return;
  if (isStreaming) return;

  const userMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: content || null,
    attachments: pendingAttachments.length > 0 ? [...pendingAttachments] : undefined,
    createdAt: Date.now()
  };

  chat.messages.push(userMsg);

  if (chat.messages.length === 1 && content) {
    chat.title = content.slice(0, 30) + (content.length > 30 ? '...' : '');
    renderTabs();
  }

  chat.updatedAt = Date.now();
  await saveChat(chat);

  userInput.value = '';
  userInput.style.height = 'auto';
  pendingAttachments = [];
  renderInputAttachments();
  renderMessages();

  await sendToApi();
}

async function sendToApi() {
  const chat = getCurrentChat();
  if (!chat || !chat.messages) return;

  if (!modelConfig.endpoint || !modelConfig.name) {
    showError('Please configure model endpoint and name');
    return;
  }

  isStreaming = true;
  abortController = new AbortController();
  setStatus('Streaming...', true);
  hideModal(sendBtn);
  showModal(stopBtn);

  const assistantMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    createdAt: Date.now()
  };
  chat.messages.push(assistantMsg);
  renderMessages();

  const msgIndex = chat.messages.length - 1;
  const msgEl = messagesContainer.querySelector(`.message[data-index="${msgIndex}"]`);

  let spinnerEl: HTMLElement | null = null;
  const showStreamingSpinner = () => {
    if (!msgEl || spinnerEl) return;
    spinnerEl = document.createElement('div');
    spinnerEl.className = 'streaming-spinner';
    spinnerEl.innerHTML = '<div class="streaming-spinner-icon"></div><span>Streaming...</span>';
    msgEl.appendChild(spinnerEl);
  };

  const hideStreamingSpinner = () => {
    if (spinnerEl) {
      spinnerEl.remove();
      spinnerEl = null;
    }
  };

  showStreamingSpinner();

  try {
    const request = buildRequest(modelConfig, inferenceConfig, chat.messages.slice(0, -1));
    let fullContent = '';
    let fullReasoning = '';
    const segments: MessageSegment[] = [];
    let currentSegmentType: 'content' | 'reasoning' | null = null;
    const toolCalls: Map<number, { id: string; type: string; name: string; arguments: string }> = new Map();
    const startTime = performance.now();

    for await (const event of streamChat(modelConfig, request, abortController!.signal)) {
      const choice = event.choices[0];
      if (!choice) continue;

      if (choice.finish_reason === 'error' && event.error) {
        throw new Error(`[${event.error.code}] ${event.error.message}`);
      }

      // Capture reasoning from API (DeepSeek, OpenAI o1, etc.)
      const reasoningChunk = choice.delta.reasoning || choice.delta.reasoning_content;
      if (reasoningChunk) {
        fullReasoning += reasoningChunk;
        chat.messages[msgIndex].reasoning = fullReasoning;

        // Create new segment if switching from content to reasoning
        if (currentSegmentType === 'content' && fullContent) {
          segments.push({ type: 'content', text: fullContent });
          fullContent = '';
        }
        currentSegmentType = 'reasoning';

        // Live update reasoning during streaming
        const liveSegments = [...segments];
        if (fullReasoning) {
          liveSegments.push({ type: 'reasoning', text: fullReasoning });
        }
        chat.messages[msgIndex].segments = liveSegments;
        await updateMessageContent(msgIndex, liveSegments, currentSegmentType);
      }

      if (choice.delta.content) {
        // Create new segment if switching from reasoning to content
        if (currentSegmentType === 'reasoning' && fullReasoning) {
          segments.push({ type: 'reasoning', text: fullReasoning });
          fullReasoning = '';
        }
        currentSegmentType = 'content';

        fullContent += choice.delta.content;
        chat.messages[msgIndex].content = fullContent;

        const typingIndicator = msgEl?.querySelector('.typing-indicator');
        if (typingIndicator) {
          typingIndicator.remove();
        }

        const liveSegments = [...segments];
        if (fullContent) {
          liveSegments.push({ type: 'content', text: fullContent });
        }
        chat.messages[msgIndex].segments = liveSegments;
        await updateMessageContent(msgIndex, liveSegments, currentSegmentType);
      }

      if (choice.delta.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const existing = toolCalls.get(tc.index);
          if (existing) {
            if (tc.function?.arguments) {
              existing.arguments += tc.function.arguments;
            }
          } else {
            toolCalls.set(tc.index, {
              id: tc.id || '',
              type: tc.type || 'function',
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || ''
            });
          }
        }
      }

      if (event.usage) {
        const responseTimeMs = performance.now() - startTime;
        const tokensPerSecond = event.usage.completion_tokens / (responseTimeMs / 1000);
        const usage: TokenUsage = {
          promptTokens: event.usage.prompt_tokens,
          completionTokens: event.usage.completion_tokens,
          cachedTokens: event.usage.prompt_tokens_details?.cached_tokens,
          responseTimeMs,
          tokensPerSecond
        };
        chat.messages[msgIndex].usage = usage;
      }
    }

    // Finalize last segment
    if (currentSegmentType === 'content' && fullContent) {
      segments.push({ type: 'content', text: fullContent });
    } else if (currentSegmentType === 'reasoning' && fullReasoning) {
      segments.push({ type: 'reasoning', text: fullReasoning });
    }

    // Extract ALL <think>...</think> tags from content if no API reasoning was provided
    if (segments.length === 0 && fullContent) {
      const extractedSegments: MessageSegment[] = [];
      const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
      let lastIndex = 0;
      let match;

      while ((match = thinkRegex.exec(fullContent)) !== null) {
        // Add content before this <think> block
        if (match.index > lastIndex) {
          const contentBefore = fullContent.slice(lastIndex, match.index).trim();
          if (contentBefore) {
            extractedSegments.push({ type: 'content', text: contentBefore });
          }
        }
        // Add reasoning block
        extractedSegments.push({ type: 'reasoning', text: match[1].trim() });
        lastIndex = thinkRegex.lastIndex;
      }

      // Add remaining content after last <think> block
      if (lastIndex < fullContent.length) {
        const contentAfter = fullContent.slice(lastIndex).trim();
        if (contentAfter) {
          extractedSegments.push({ type: 'content', text: contentAfter });
        }
      }

      if (extractedSegments.length > 0) {
        segments.push(...extractedSegments);
        // Clear old fields for backward compat display
        fullContent = '';
        fullReasoning = '';
      }
    }

    // Store segments if any were created
    if (segments.length > 0) {
      chat.messages[msgIndex].segments = segments;
      // Keep legacy fields for backward compatibility
      chat.messages[msgIndex].content = segments.filter(s => s.type === 'content').map(s => s.text).join('\n\n');
      chat.messages[msgIndex].reasoning = segments.filter(s => s.type === 'reasoning').map(s => s.text).join('\n\n');
    }

    if (toolCalls.size > 0) {
      chat.messages[msgIndex].toolCalls = Array.from(toolCalls.values()).map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.arguments
        }
      }));
    }

    chat.updatedAt = Date.now();
    await saveChat(chat);

    hideStreamingSpinner();
    messagesContainer.querySelectorAll('.message').forEach(el => el.remove());
    renderMessages();

  } catch (err) {
    hideStreamingSpinner();
    if (err instanceof Error && err.name === 'AbortError') {
      chat.messages[msgIndex].content = (chat.messages[msgIndex].content || '') + ' [Interrupted by user]';
      await saveChat(chat);
      messagesContainer.querySelectorAll('.message').forEach(el => el.remove());
      renderMessages();
    } else {
      chat.messages.pop();
      await saveChat(chat);
      messagesContainer.querySelectorAll('.message').forEach(el => el.remove());
      renderMessages();
      showError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  isStreaming = false;
  abortController = null;
  setStatus('Ready', false);
  showModal(sendBtn);
  hideModal(stopBtn);
}

function setStatus(text: string, streaming: boolean) {
  statusText.textContent = text;
  if (streaming) {
    statusDot.classList.add('connected');
  }
}

function showError(message: string) {
  const existing = document.querySelector('.error-toast');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.className = 'error-toast';
  div.textContent = message;
  document.body.appendChild(div);

  setTimeout(() => div.remove(), 5000);
}

function resetParameters() {
  systemPromptInput.value = '';
  tempEnabledInput.checked = true;
  temperatureInput.value = '1';
  temperatureInput.disabled = false;
  tempValueSpan.textContent = '1.0';
  topKInput.value = '0';
  topKValueSpan.textContent = '0';
  topPInput.value = '0';
  topPValueSpan.textContent = '0.00';
  reasoningSelect.value = 'null';
  maxTokensInput.value = '';
  stopSequencesInput.value = '';
  toolsInput.value = '';
  toolsInput.classList.remove('error');
  saveInferenceConfigDebounced();
}

async function clearChat() {
  const chat = getCurrentChat();
  if (!chat) return;

  chat.messages = [];
  chat.title = 'New Chat';
  chat.updatedAt = Date.now();
  await saveChat(chat);
  messagesContainer.querySelectorAll('.message').forEach(el => el.remove());
  renderMessages();
  renderTabs();
}

function stopStreaming() {
  if (abortController && isStreaming) {
    abortController.abort();
  }
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
}

init();
