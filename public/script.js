const form = document.getElementById('chat-form');
const input = document.getElementById('user-input');
const chatBox = document.getElementById('chat-box');

let conversation = [];

function renderBotMessage(element, text) {
  element.replaceChildren();

  const lines = text.split(/\r?\n/);
  let list;

  const appendInlineContent = (container, value) => {
    const parts = value.split(/(\*\*[^*]+\*\*)/g);

    parts.forEach((part) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = part.slice(2, -2);
        container.appendChild(strong);
      } else if (part) {
        container.appendChild(document.createTextNode(part));
      }
    });
  };

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    const bulletMatch = trimmedLine.match(/^[-*]\s+(.+)/);
    const headingMatch = trimmedLine.match(/^#{1,3}\s+(.+)/);

    if (bulletMatch) {
      if (!list) {
        list = document.createElement('ul');
        element.appendChild(list);
      }

      const item = document.createElement('li');
      appendInlineContent(item, bulletMatch[1]);
      list.appendChild(item);
      return;
    }

    list = null;
    if (!trimmedLine) return;

    const content = document.createElement(headingMatch ? 'h3' : 'p');
    appendInlineContent(content, headingMatch ? headingMatch[1] : trimmedLine);
    element.appendChild(content);
  });
}

function appendMessage(sender, text) {
  const msg = document.createElement('div');
  msg.classList.add('message', sender);
  if (sender === 'bot') {
    renderBotMessage(msg, text);
  } else {
    msg.textContent = text;
  }
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
  return msg;
}

function replaceThinkingMessage(text) {
  const thinkingMsg = [...chatBox.querySelectorAll('.message')].find(
    (el) => el.dataset.thinking === 'true'
  );

  if (thinkingMsg) {
    renderBotMessage(thinkingMsg, text);
    thinkingMsg.dataset.thinking = 'false';
    return;
  }

  appendMessage('bot', text);
}

function isTransientGeminiError(message = '') {
  return /429|500|503|UNAVAILABLE|busy|temporar|rate limit|exhausted/i.test(message);
}

function getFriendlyFallbackMessage(message = '') {
  if (isTransientGeminiError(message)) {
    return 'Asisten perjalanan sedang cukup sibuk. Silakan coba lagi sebentar lagi.';
  }

  if (/no response/i.test(message)) {
    return 'Maaf, server tidak mengembalikan jawaban.';
  }

  return 'Gagal mendapatkan jawaban dari server. Silakan coba lagi.';
}

async function sendChatRequest(payload, retries = 2) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const contentType = response.headers.get('content-type') || '';
      let data;

      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        data = { message: text || 'No response body received.' };
      }

      if (!response.ok) {
        const errorMessage = data?.message || data?.error || 'Failed to get response from server.';
        throw new Error(errorMessage);
      }

      if (typeof data?.result !== 'string' || !data.result.trim()) {
        throw new Error('Sorry, no response received.');
      }

      return data.result;
    } catch (error) {
      lastError = error;
      const message = error?.message || '';
      const shouldRetry = isTransientGeminiError(message) && attempt < retries;

      if (!shouldRetry) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  throw lastError;
}

form.addEventListener('submit', async function (e) {
  e.preventDefault();

  const userMessage = input.value.trim();
  if (!userMessage) return;

  appendMessage('user', userMessage);
  input.value = '';
  input.focus();

  const thinkingMsg = appendMessage('bot', 'Thinking...');
  thinkingMsg.dataset.thinking = 'true';

  try {
    conversation.push({ role: 'user', text: userMessage });
    const reply = await sendChatRequest({ conversation }, 2);
    conversation.push({ role: 'model', text: reply });
    replaceThinkingMessage(reply);
  } catch (error) {
    console.error('Chat request failed:', error);
    const friendlyMessage = getFriendlyFallbackMessage(error?.message || '');
    replaceThinkingMessage(friendlyMessage);
  }
});
