import './styles/main.css';
import type { ChatMessage, FileAttachment, ToolCall, ModelConfig, InferenceConfig, Chat, TokenUsage } from './types';
import { saveModelConfig, getDefaultModelConfig, saveInferenceConfig, getDefaultInferenceConfig, saveChat, getAllChats, deleteChat } from './storage/db';
import { buildRequest, streamChat } from './api/chat-client';
import { listModels, type Model } from './api/models-client';
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
  maxCompletionTokens: null,
  tools: '',
  reasoningEffort: 'null'
};

let chats: Chat[] = [];
let currentChatId: string | null = null;

let pendingAttachments: FileAttachment[] = [];
let isStreaming = false;
let editingMessageIndex: number | null = null;
let pendingToolCall: { messageIndex: number; toolCall: ToolCall } | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const modelNameInput = $<HTMLInputElement>('model-name');
const endpointInput = $<HTMLInputElement>('endpoint');
const apiKeyInput = $<HTMLInputElement>('api-key');
const systemPromptInput = $<HTMLTextAreaElement>('system-prompt');
const tempEnabledInput = $<HTMLInputElement>('temp-enabled');
const temperatureInput = $<HTMLInputElement>('temperature');
const tempValueSpan = $<HTMLSpanElement>('temp-value');
const reasoningSelect = $<HTMLSelectElement>('reasoning-effort');
const maxTokensInput = $<HTMLInputElement>('max-tokens');
const toolsInput = $<HTMLTextAreaElement>('tools');
const messagesContainer = $<HTMLDivElement>('messages');
const emptyState = $<HTMLDivElement>('empty-state');
const userInput = $<HTMLTextAreaElement>('user-input');
const sendBtn = $<HTMLButtonElement>('send-btn');
const attachBtn = $<HTMLButtonElement>('attach-btn');
const clearBtn = $<HTMLButtonElement>('clear-chat');
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

function getCurrentChat(): Chat | null {
  return chats.find(c => c.id === currentChatId) || null;
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
    reasoningSelect.value = savedInference.reasoningEffort;
    maxTokensInput.value = savedInference.maxCompletionTokens ? String(savedInference.maxCompletionTokens) : '';
    toolsInput.value = savedInference.tools;
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
  if (chats.length <= 1) return;
  if (isStreaming) return;

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
  reasoningSelect.addEventListener('change', saveInferenceConfigDebounced);
  maxTokensInput.addEventListener('input', saveInferenceConfigDebounced);
  toolsInput.addEventListener('input', () => {
    validateToolsJson();
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
  attachBtn.addEventListener('click', () => fileInput.click());
  clearBtn.addEventListener('click', clearChat);
  fileInput.addEventListener('change', handleFileSelect);
  addTabBtn.addEventListener('click', addNewTab);
  listModelsBtn.addEventListener('click', openModelsModal);
  modelsModalCancel.addEventListener('click', () => modelsModal.style.display = 'none');
  themeToggleBtn.addEventListener('click', toggleTheme);

  // Initialize theme from localStorage
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = savedTheme;

  toolModalCancel.addEventListener('click', () => {
    toolModal.style.display = 'none';
    pendingToolCall = null;
  });

  toolModalSubmit.addEventListener('click', submitToolResponse);

  editModalCancel.addEventListener('click', () => {
    editModal.style.display = 'none';
    editingMessageIndex = null;
  });

  editModalSubmit.addEventListener('click', submitEditedMessage);
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
    inferenceConfig.reasoningEffort = reasoningSelect.value as InferenceConfig['reasoningEffort'];
    inferenceConfig.maxCompletionTokens = maxTokensInput.value ? parseInt(maxTokensInput.value, 10) : null;
    inferenceConfig.tools = toolsInput.value;
    await saveInferenceConfig(inferenceConfig);
  }, 500);
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

function updateModelDisplay() {
  if (modelConfig.name && modelConfig.endpoint) {
    modelDisplay.textContent = modelConfig.name;
    statusDot.classList.add('connected');
  } else {
    modelDisplay.textContent = 'No model configured';
    statusDot.classList.remove('connected');
  }
}

function renderMessages() {
  const chat = getCurrentChat();
  const hasMessages = chat && chat.messages.length > 0;
  emptyState.style.display = hasMessages ? 'none' : 'flex';

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

function createMessageElement(msg: ChatMessage, index: number): HTMLElement {
  const div = document.createElement('div');
  div.className = 'message';
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
  if (msg.content || msg.role === 'assistant') {
    const content = msg.content || '';
    if (msg.role === 'assistant' && content) {
      contentHtml = `<div class="message-content markdown-body">${marked.parse(content)}</div>`;
    } else {
      contentHtml = `<div class="message-content">${escapeHtml(content)}</div>`;
    }
  }

  if (msg.role === 'assistant' && !msg.content && !msg.toolCalls?.length) {
    contentHtml += `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>
            <span class="tool-call-name">${escapeHtml(tc.function.name)}</span>
          </div>
          <pre class="tool-call-args">${escapeHtml(formatJson(tc.function.arguments))}</pre>
          ${!hasResponse ? `<button class="btn btn-secondary btn-sm tool-response-btn" data-tool-id="${tc.id}" data-msg-index="${index}">Provide Response</button>` : ''}
        </div>
      `;
    }
    contentHtml += '</div>';
  }

  if (msg.role === 'tool' && msg.toolCallId) {
    contentHtml = `
      <div class="tool-call">
        <div class="tool-call-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>Tool Response</span>
        </div>
        <pre class="tool-call-args">${escapeHtml(msg.content || '')}</pre>
      </div>
    `;
  }

  const reasoningHtml = msg.reasoning ? `
    <details class="reasoning-block">
      <summary>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        Thinking
      </summary>
      <div class="reasoning-content">${escapeHtml(msg.reasoning)}</div>
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
    ${reasoningHtml}
    ${contentHtml}
    ${msg.usage ? `<div class="token-usage"><span>${msg.usage.promptTokens} in</span><span>${msg.usage.completionTokens} out</span>${msg.usage.cachedTokens ? `<span>${msg.usage.cachedTokens} cached</span>` : ''}</div>` : ''}
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
  editModal.style.display = 'flex';
}

function openToolModal(messageIndex: number, toolCall: ToolCall) {
  pendingToolCall = { messageIndex, toolCall };
  toolModalName.textContent = `Function: ${toolCall.function.name}`;
  toolResponse.value = '';
  toolModal.style.display = 'flex';
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

  editModal.style.display = 'none';
  editingMessageIndex = null;

  await sendToApi();
}

async function openModelsModal() {
  if (!modelConfig.endpoint || !modelConfig.apiKey) {
    showError('Please configure Endpoint URL and API Key first');
    return;
  }

  modelsModal.style.display = 'flex';
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
      modelsModal.style.display = 'none';
    });

    modelsList.appendChild(div);
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

  toolModal.style.display = 'none';
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

async function sendMessage() {
  const chat = getCurrentChat();
  if (!chat) return;

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
  if (!chat) return;

  if (!modelConfig.endpoint || !modelConfig.name) {
    showError('Please configure model endpoint and name');
    return;
  }

  isStreaming = true;
  setStatus('Streaming...', true);
  sendBtn.disabled = true;

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
  const contentEl = msgEl?.querySelector('.message-content');

  try {
    const request = buildRequest(modelConfig, inferenceConfig, chat.messages.slice(0, -1));
    let fullContent = '';
    let fullReasoning = '';
    const toolCalls: Map<number, { id: string; type: string; name: string; arguments: string }> = new Map();

    for await (const event of streamChat(modelConfig, request)) {
      const choice = event.choices[0];
      if (!choice) continue;

      // Capture reasoning from API (DeepSeek, OpenAI o1, etc.)
      const reasoningChunk = choice.delta.reasoning || choice.delta.reasoning_content;
      if (reasoningChunk) {
        fullReasoning += reasoningChunk;
        chat.messages[msgIndex].reasoning = fullReasoning;
      }

      if (choice.delta.content) {
        fullContent += choice.delta.content;
        if (contentEl) {
          contentEl.textContent = fullContent;
        }
        chat.messages[msgIndex].content = fullContent;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
        const usage: TokenUsage = {
          promptTokens: event.usage.prompt_tokens,
          completionTokens: event.usage.completion_tokens,
          cachedTokens: event.usage.prompt_tokens_details?.cached_tokens
        };
        chat.messages[msgIndex].usage = usage;
      }
    }

    // Extract <think>...</think> tags from content if no API reasoning was provided
    if (!fullReasoning && fullContent) {
      const thinkMatch = fullContent.match(/^<think>([\s\S]*?)<\/think>\s*/);
      if (thinkMatch) {
        fullReasoning = thinkMatch[1].trim();
        fullContent = fullContent.slice(thinkMatch[0].length);
        chat.messages[msgIndex].reasoning = fullReasoning;
        chat.messages[msgIndex].content = fullContent;
      }
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

    messagesContainer.querySelectorAll('.message').forEach(el => el.remove());
    renderMessages();

  } catch (err) {
    chat.messages.pop();
    await saveChat(chat);
    messagesContainer.querySelectorAll('.message').forEach(el => el.remove());
    renderMessages();
    showError(err instanceof Error ? err.message : 'Unknown error');
  }

  isStreaming = false;
  setStatus('Ready', false);
  sendBtn.disabled = false;
}

function setStatus(text: string, streaming: boolean) {
  statusText.textContent = text;
  if (streaming) {
    statusDot.classList.add('connected');
  }
}

function showError(message: string) {
  const existing = messagesContainer.querySelector('.error-message');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.className = 'error-message';
  div.textContent = message;
  messagesContainer.insertBefore(div, messagesContainer.firstChild);

  setTimeout(() => div.remove(), 5000);
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

function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
}

init();
