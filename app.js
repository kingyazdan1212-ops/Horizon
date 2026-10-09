// Horizon — Multi-model AI Chat
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const messagesEl = $('#messages');
const inputEl = $('#input');
const sendBtn = $('#send-btn');
const welcome = $('#welcome');
const convList = $('#conv-list');
const modeSelect = $('#mode-select');
const modelSelect = $('#model-select');
const sidebar = $('#sidebar');
const overlay = $('#overlay');

let conversations = JSON.parse(localStorage.getItem('horizon_convs') || '[]');
let currentId = null;
let isGenerating = false;

// System prompts per mode
const SYSTEM_PROMPTS = {
  general: `You are Horizon, a helpful, sharp and thoughtful AI assistant. Be clear, honest and useful. Answer in the same language the user writes in.`,
  decision: `You are Horizon in Decision Advisor mode. Help the user think through difficult life decisions with clarity and honesty. 
Present multiple realistic scenarios, trade-offs, emotional impacts and practical next steps. 
Be direct, avoid empty motivational talk. Answer in the same language the user writes in.`,
  coding: `You are Horizon in Coding mode. Write clean, modern, well-structured code. Explain briefly when useful. Prefer practical solutions. Answer in the same language the user writes in.`,
  creative: `You are Horizon in Creative mode. Help with writing, ideas, stories and creative work. Be imaginative yet coherent. Answer in the same language the user writes in.`
};

// ========== Settings ==========
function getSettings() {
  try { return JSON.parse(localStorage.getItem('horizon_settings') || '{}'); } catch { return {}; }
}
function saveSettings(s) {
  localStorage.setItem('horizon_settings', JSON.stringify(s));
}
function loadSettingsUI() {
  const s = getSettings();
  $('#api-key').value = s.key || '';
  $('#api-base').value = s.base || 'https://openrouter.ai/api/v1';
}

// ========== Conversations ==========
function saveConvs() {
  localStorage.setItem('horizon_convs', JSON.stringify(conversations.slice(0, 50)));
}

function createConv() {
  const id = Date.now().toString();
  const conv = { id, title: 'New chat', messages: [], created: Date.now() };
  conversations.unshift(conv);
  currentId = id;
  saveConvs();
  renderConvList();
  renderMessages();
  return conv;
}

function getCurrentConv() {
  return conversations.find(c => c.id === currentId);
}

function renderConvList() {
  convList.innerHTML = conversations.map(c => `
    <button data-id="${c.id}" class="conv-item w-full text-left text-sm px-3 py-2 rounded-lg truncate transition ${c.id === currentId ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}">
      ${c.title || 'New chat'}
    </button>
  `).join('');
  $$('.conv-item').forEach(btn => {
    btn.addEventListener('click', () => {
      currentId = btn.dataset.id;
      renderConvList();
      renderMessages();
      closeSidebar();
    });
  });
}

function renderMessages() {
  const conv = getCurrentConv();
  if (!conv || conv.messages.length === 0) {
    messagesEl.innerHTML = '';
    messagesEl.appendChild(welcome);
    welcome.classList.remove('hidden');
    return;
  }
  welcome.classList.add('hidden');
  messagesEl.innerHTML = conv.messages.map(m => {
    if (m.role === 'user') {
      return `<div class="flex justify-end"><div class="msg-user max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed">${escapeHtml(m.content)}</div></div>`;
    }
    return `<div class="flex gap-3 max-w-3xl">
      <div class="w-7 h-7 rounded-full bg-violet-600/20 text-violet-400 flex items-center justify-center text-xs shrink-0 mt-0.5">◈</div>
      <div class="msg-ai text-sm leading-relaxed prose prose-invert max-w-none flex-1">${formatMarkdown(m.content)}</div>
    </div>`;
  }).join('');
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

function formatMarkdown(text) {
  // Very lightweight markdown
  let html = escapeHtml(text);
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return html;
}

// ========== AI Call ==========
async function callAI(messages, onDelta) {
  const s = getSettings();
  if (!s.key) throw new Error('NO_KEY');

  const model = modelSelect.value;
  const base = (s.base || 'https://openrouter.ai/api/v1').replace(/\/$/, '');

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${s.key}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Horizon AI'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      stream: true,
      max_tokens: 4096
    })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`API ${res.status}: ${t.slice(0, 150)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
    for (const line of lines) {
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          onDelta(full);
        }
      } catch {}
    }
  }
  return full;
}

// ========== Send ==========
async function sendMessage(text) {
  if (!text.trim() || isGenerating) return;

  let conv = getCurrentConv();
  if (!conv) conv = createConv();

  // Add user message
  conv.messages.push({ role: 'user', content: text.trim() });
  if (conv.title === 'New chat') {
    conv.title = text.trim().slice(0, 40) + (text.length > 40 ? '…' : '');
  }
  saveConvs();
  renderConvList();
  renderMessages();
  inputEl.value = '';
  autoResize();

  // Check key
  const s = getSettings();
  if (!s.key) {
    conv.messages.push({ role: 'assistant', content: 'Please add your API key in Settings to start chatting with real AI models.\n\nRecommended: get a free key from openrouter.ai' });
    saveConvs();
    renderMessages();
    return;
  }

  isGenerating = true;
  sendBtn.disabled = true;

  // Placeholder for AI
  const placeholder = document.createElement('div');
  placeholder.className = 'flex gap-3 max-w-3xl';
  placeholder.innerHTML = `
    <div class="w-7 h-7 rounded-full bg-violet-600/20 text-violet-400 flex items-center justify-center text-xs shrink-0 mt-0.5">◈</div>
    <div class="text-sm text-zinc-400 flex items-center gap-1.5 pt-1">
      <span class="typing-dot">●</span><span class="typing-dot">●</span><span class="typing-dot">●</span>
    </div>`;
  messagesEl.appendChild(placeholder);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const mode = modeSelect.value;
  const system = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.general;

  const apiMessages = [
    { role: 'system', content: system },
    ...conv.messages.map(m => ({ role: m.role, content: m.content }))
  ];

  try {
    const full = await callAI(apiMessages, (partial) => {
      placeholder.innerHTML = `
        <div class="w-7 h-7 rounded-full bg-violet-600/20 text-violet-400 flex items-center justify-center text-xs shrink-0 mt-0.5">◈</div>
        <div class="msg-ai text-sm leading-relaxed prose prose-invert max-w-none flex-1">${formatMarkdown(partial)}</div>`;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });

    conv.messages.push({ role: 'assistant', content: full });
    saveConvs();
    renderMessages();
  } catch (err) {
    console.error(err);
    conv.messages.push({ role: 'assistant', content: `Error: ${err.message}\n\nCheck your API key and base URL in Settings.` });
    saveConvs();
    renderMessages();
  }

  isGenerating = false;
  sendBtn.disabled = false;
  inputEl.focus();
}

// ========== UI Helpers ==========
function autoResize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
}

function openSidebar() {
  sidebar.classList.add('open');
  overlay.classList.remove('hidden');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  overlay.classList.add('hidden');
}

// ========== Events ==========
$('#new-chat').addEventListener('click', () => {
  createConv();
  closeSidebar();
  inputEl.focus();
});

sendBtn.addEventListener('click', () => sendMessage(inputEl.value));
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(inputEl.value);
  }
});
inputEl.addEventListener('input', autoResize);

$$('.example-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    sendMessage(btn.dataset.prompt);
  });
});

$('#open-sidebar').addEventListener('click', openSidebar);
$('#close-sidebar').addEventListener('click', closeSidebar);
overlay.addEventListener('click', closeSidebar);

// Settings
$('#settings-btn').addEventListener('click', () => {
  loadSettingsUI();
  $('#settings-modal').classList.remove('hidden');
  $('#settings-modal').classList.add('flex');
  closeSidebar();
});
$('#close-settings').addEventListener('click', () => {
  $('#settings-modal').classList.add('hidden');
  $('#settings-modal').classList.remove('flex');
});
$('#save-settings').addEventListener('click', () => {
  saveSettings({
    key: $('#api-key').value.trim(),
    base: $('#api-base').value.trim() || 'https://openrouter.ai/api/v1'
  });
  $('#settings-modal').classList.add('hidden');
  $('#settings-modal').classList.remove('flex');
});
$('#clear-settings').addEventListener('click', () => {
  $('#api-key').value = '';
  localStorage.removeItem('horizon_settings');
});
$$('.preset-base').forEach(btn => {
  btn.addEventListener('click', () => { $('#api-base').value = btn.dataset.url; });
});

// Init
if (conversations.length === 0) {
  // stay on welcome
} else {
  currentId = conversations[0].id;
  renderConvList();
  renderMessages();
}
renderConvList();
inputEl.focus();
