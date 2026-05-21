const state = {
  token: localStorage.getItem('token') || null,
  username: localStorage.getItem('username') || null,
  privateKey: localStorage.getItem('privateKey') || null,
  peer: null,
  lastMessageTime: 0,
  pollTimer: null,
  peerKeyCache: {},
  decryptedCache: {},
};

const $ = (sel) => document.querySelector(sel);

function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(path, { ...opts, headers }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  });
}

function setError(id, msg) {
  $(id).textContent = msg || '';
}

function showAuth() {
  $('#auth-view').classList.remove('hidden');
  $('#chat-view').classList.add('hidden');
  $('#user-info').classList.add('hidden');
}

function showChat() {
  $('#auth-view').classList.add('hidden');
  $('#chat-view').classList.remove('hidden');
  $('#user-info').classList.remove('hidden');
  $('#me-label').textContent = `👤 ${state.username}`;
  loadUsers();
}

// --- Auth ---

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.tab;
    $('#login-form').classList.toggle('hidden', which !== 'login');
    $('#register-form').classList.toggle('hidden', which !== 'register');
  });
});

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('#register-error', '');
  const fd = new FormData(e.target);
  const username = fd.get('username').trim();
  const password = fd.get('password');

  try {
    const submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Anahtarlar uretiliyor...';

    const keyPair = await KripoCrypto.generateKeyPair();
    const publicKey = await KripoCrypto.exportPublicKey(keyPair.publicKey);
    const privateKey = await KripoCrypto.exportPrivateKey(keyPair.privateKey);

    const res = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, publicKey }),
    });

    state.token = res.token;
    state.username = res.username;
    state.privateKey = privateKey;
    localStorage.setItem('token', state.token);
    localStorage.setItem('username', state.username);
    localStorage.setItem('privateKey', privateKey);
    showChat();
  } catch (err) {
    setError('#register-error', err.message);
    const submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Kayit ol';
  }
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('#login-error', '');
  const fd = new FormData(e.target);
  const username = fd.get('username').trim();
  const password = fd.get('password');
  try {
    const res = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    state.token = res.token;
    state.username = res.username;
    localStorage.setItem('token', state.token);
    localStorage.setItem('username', state.username);

    if (!state.privateKey) {
      setError(
        '#login-error',
        'Bu tarayicida ozel anahtarin yok — eski mesajlarini cozemezsin (anahtarlar sadece kayit oldugun tarayicida durur). Devam ediliyor...'
      );
    }
    showChat();
  } catch (err) {
    setError('#login-error', err.message);
  }
});

$('#logout-btn').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (_) {}
  state.token = null;
  state.username = null;
  state.peer = null;
  state.lastMessageTime = 0;
  state.decryptedCache = {};
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  if (state.pollTimer) clearInterval(state.pollTimer);
  showAuth();
});

// --- Chat ---

async function loadUsers() {
  try {
    const users = await api('/api/users');
    const ul = $('#user-list');
    ul.innerHTML = '';
    if (users.length === 0) {
      ul.innerHTML = '<li style="opacity:0.6;cursor:default">Henuz kimse yok</li>';
      return;
    }
    users.forEach((u) => {
      const li = document.createElement('li');
      li.textContent = u.username;
      li.dataset.username = u.username;
      if (u.username === state.peer) li.classList.add('active');
      li.addEventListener('click', () => selectPeer(u.username));
      ul.appendChild(li);
    });
  } catch (err) {
    console.error(err);
  }
}

$('#refresh-users').addEventListener('click', loadUsers);

async function selectPeer(username) {
  state.peer = username;
  state.lastMessageTime = 0;
  state.decryptedCache = {};
  document.querySelectorAll('#user-list li').forEach((li) => {
    li.classList.toggle('active', li.dataset.username === username);
  });
  $('#peer-label').textContent = `💬 ${username} ile sohbet`;
  $('#send-form').classList.remove('hidden');
  $('#messages').innerHTML = '';

  try {
    if (!state.peerKeyCache[username]) {
      const { publicKey } = await api(`/api/users/${encodeURIComponent(username)}/key`);
      state.peerKeyCache[username] = publicKey;
    }
  } catch (err) {
    console.error('Acik anahtar alinamadi:', err);
  }

  await pollMessages();
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(pollMessages, 2000);
}

$('#send-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#message-input');
  const text = input.value.trim();
  if (!text || !state.peer) return;

  try {
    const peerPubKey = state.peerKeyCache[state.peer];
    if (!peerPubKey) throw new Error('Aliciya ait acik anahtar yok');

    const payload = await KripoCrypto.encryptMessage(text, peerPubKey);
    await api('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ to: state.peer, ...payload }),
    });
    input.value = '';
    await pollMessages();
  } catch (err) {
    alert('Mesaj gonderilemedi: ' + err.message);
  }
});

$('#debug-toggle').addEventListener('change', (e) => {
  $('#messages').classList.toggle('show-cipher', e.target.checked);
});

async function pollMessages() {
  if (!state.peer) return;
  try {
    const msgs = await api(
      `/api/messages?with=${encodeURIComponent(state.peer)}&since=${state.lastMessageTime}`
    );
    if (msgs.length === 0) return;

    const container = $('#messages');
    for (const m of msgs) {
      state.lastMessageTime = Math.max(state.lastMessageTime, m.createdAt);
      const isMine = m.sender === state.username;
      let plaintext;

      if (isMine) {
        plaintext = state.decryptedCache[m.id] || '(senin gonderdigin mesaj — yerel olarak gosterilemedi)';
      } else if (state.privateKey) {
        try {
          plaintext = await KripoCrypto.decryptMessage(
            { ciphertext: m.ciphertext, iv: m.iv, encryptedKey: m.encryptedKey },
            state.privateKey
          );
          state.decryptedCache[m.id] = plaintext;
        } catch (err) {
          plaintext = '🔒 (cozulemedi — bu tarayicida dogru ozel anahtar yok)';
        }
      } else {
        plaintext = '🔒 (ozel anahtar yok — bu tarayicida cozulemiyor)';
      }

      const div = document.createElement('div');
      div.className = 'msg ' + (isMine ? 'mine' : 'theirs');
      const safeText = document.createElement('div');
      safeText.textContent = plaintext;
      div.appendChild(safeText);

      const meta = document.createElement('div');
      meta.className = 'meta';
      const t = new Date(m.createdAt).toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      meta.textContent = `${isMine ? 'Sen' : m.sender} · ${t}`;
      div.appendChild(meta);

      const cipher = document.createElement('div');
      cipher.className = 'cipher';
      cipher.textContent =
        `ciphertext: ${m.ciphertext.slice(0, 60)}...\n` +
        `iv: ${m.iv}\n` +
        `encryptedKey: ${m.encryptedKey.slice(0, 60)}...`;
      div.appendChild(cipher);

      container.appendChild(div);
    }
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    console.error('Mesaj cekme hatasi:', err);
  }
}

// --- Acilis ---
if (state.token && state.username) {
  // oturum hala gecerli mi kontrol et
  api('/api/me')
    .then(() => showChat())
    .catch(() => {
      localStorage.removeItem('token');
      state.token = null;
      showAuth();
    });
} else {
  showAuth();
}
