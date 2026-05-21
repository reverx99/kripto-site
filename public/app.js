const state = {
  token: sessionStorage.getItem('token') || null,
  username: sessionStorage.getItem('username') || null,
  encPrivateKey: sessionStorage.getItem('encPrivateKey') || null,
  signPrivateKey: sessionStorage.getItem('signPrivateKey') || null,
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

function setError(id, msg) { $(id).textContent = msg || ''; }

function showAuth() {
  $('#auth-view').classList.remove('hidden');
  $('#chat-view').classList.add('hidden');
  $('#unlock-view').classList.add('hidden');
  $('#user-info').classList.add('hidden');
}

function showChat() {
  $('#auth-view').classList.add('hidden');
  $('#chat-view').classList.remove('hidden');
  $('#unlock-view').classList.add('hidden');
  $('#user-info').classList.remove('hidden');
  $('#me-label').textContent = `👤 ${state.username}`;
  loadUsers();
}

function showUnlock() {
  $('#auth-view').classList.add('hidden');
  $('#chat-view').classList.add('hidden');
  $('#unlock-view').classList.remove('hidden');
  $('#user-info').classList.remove('hidden');
  $('#me-label').textContent = `👤 ${state.username}`;
  $('#unlock-username').textContent = state.username || '';
}

function clearSession() {
  state.token = null;
  state.username = null;
  state.encPrivateKey = null;
  state.signPrivateKey = null;
  state.peer = null;
  state.lastMessageTime = 0;
  state.decryptedCache = {};
  state.peerKeyCache = {};
  sessionStorage.clear();
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

// ------------ Auth ekrani sekmeleri ------------

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.tab;
    $('#login-form').classList.toggle('hidden', which !== 'login');
    $('#register-form').classList.toggle('hidden', which !== 'register');
  });
});

// ------------ Kayit ------------

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('#register-error', '');
  const fd = new FormData(e.target);
  const username = fd.get('username').trim();
  const password = fd.get('password');
  const submitBtn = e.target.querySelector('button[type=submit]');

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Anahtarlar uretiliyor...';

    // 1. Iki RSA cifti uret (sifreleme + imzalama)
    const [encKp, signKp] = await Promise.all([
      KripoCrypto.generateEncryptionKeyPair(),
      KripoCrypto.generateSigningKeyPair(),
    ]);

    // 2. Sifreden sarma anahtari turet (PBKDF2)
    const keySalt = KripoCrypto.randomSaltB64(16);
    const wrappingKey = await KripoCrypto.deriveWrappingKey(password, keySalt);

    // 3. Ozel anahtarlari sar
    const wrappedEnc = await KripoCrypto.wrapPrivateKey(encKp.privateKey, wrappingKey);
    const wrappedSign = await KripoCrypto.wrapPrivateKey(signKp.privateKey, wrappingKey);

    // 4. Acik anahtarlari export et
    const [encPub, signPub, encPrivPlain, signPrivPlain] = await Promise.all([
      KripoCrypto.exportSpki(encKp.publicKey),
      KripoCrypto.exportSpki(signKp.publicKey),
      crypto.subtle.exportKey('pkcs8', encKp.privateKey).then((b) => KripoCrypto.bufToBase64(b)),
      crypto.subtle.exportKey('pkcs8', signKp.privateKey).then((b) => KripoCrypto.bufToBase64(b)),
    ]);

    const res = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password,
        encPublicKey: encPub,
        signPublicKey: signPub,
        wrappedEncPrivateKey: wrappedEnc.wrapped,
        wrappedSignPrivateKey: wrappedSign.wrapped,
        keySalt,
        encPrivIv: wrappedEnc.iv,
        signPrivIv: wrappedSign.iv,
      }),
    });

    state.token = res.token;
    state.username = res.username;
    state.encPrivateKey = encPrivPlain;
    state.signPrivateKey = signPrivPlain;
    sessionStorage.setItem('token', state.token);
    sessionStorage.setItem('username', state.username);
    sessionStorage.setItem('encPrivateKey', state.encPrivateKey);
    sessionStorage.setItem('signPrivateKey', state.signPrivateKey);
    showChat();
  } catch (err) {
    setError('#register-error', err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Kayit ol';
  }
});

// ------------ Giris ------------

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('#login-error', '');
  const fd = new FormData(e.target);
  const username = fd.get('username').trim();
  const password = fd.get('password');
  const submitBtn = e.target.querySelector('button[type=submit]');

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Giris yapiliyor...';

    const res = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    submitBtn.textContent = 'Anahtarlar coyuluyor...';

    // Sunucudan gelen sarili ozel anahtarlari sifre ile coz
    const wrappingKey = await KripoCrypto.deriveWrappingKey(password, res.keySalt);
    const [encPrivPlain, signPrivPlain] = await Promise.all([
      KripoCrypto.unwrapPrivateKey(res.wrappedEncPrivateKey, res.encPrivIv, wrappingKey),
      KripoCrypto.unwrapPrivateKey(res.wrappedSignPrivateKey, res.signPrivIv, wrappingKey),
    ]);

    state.token = res.token;
    state.username = res.username;
    state.encPrivateKey = encPrivPlain;
    state.signPrivateKey = signPrivPlain;
    sessionStorage.setItem('token', state.token);
    sessionStorage.setItem('username', state.username);
    sessionStorage.setItem('encPrivateKey', encPrivPlain);
    sessionStorage.setItem('signPrivateKey', signPrivPlain);
    showChat();
  } catch (err) {
    setError('#login-error', err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Giris yap';
  }
});

// ------------ Unlock (refresh sonrasi) ------------

$('#unlock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('#unlock-error', '');
  const password = new FormData(e.target).get('password');
  const submitBtn = e.target.querySelector('button[type=submit]');
  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Cozulu yor...';
    const me = await api('/api/me');
    const wrappingKey = await KripoCrypto.deriveWrappingKey(password, me.keySalt);
    const [encPrivPlain, signPrivPlain] = await Promise.all([
      KripoCrypto.unwrapPrivateKey(me.wrappedEncPrivateKey, me.encPrivIv, wrappingKey),
      KripoCrypto.unwrapPrivateKey(me.wrappedSignPrivateKey, me.signPrivIv, wrappingKey),
    ]);
    state.encPrivateKey = encPrivPlain;
    state.signPrivateKey = signPrivPlain;
    sessionStorage.setItem('encPrivateKey', encPrivPlain);
    sessionStorage.setItem('signPrivateKey', signPrivPlain);
    showChat();
  } catch (err) {
    setError('#unlock-error', 'Sifre yanlis veya anahtarlar bozuk');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Kilidi ac';
  }
});

$('#unlock-logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (_) {}
  clearSession();
  showAuth();
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (_) {}
  clearSession();
  showAuth();
});

// ------------ Chat ------------

async function loadUsers() {
  try {
    const users = await api('/api/users');
    const ul = $('#user-list');
    ul.innerHTML = '';
    if (users.length === 0) {
      const li = document.createElement('li');
      li.style.opacity = '0.6';
      li.style.cursor = 'default';
      li.textContent = 'Henuz kimse yok';
      ul.appendChild(li);
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
      state.peerKeyCache[username] = await api(`/api/users/${encodeURIComponent(username)}/keys`);
    }
  } catch (err) {
    console.error('Anahtar alinamadi:', err);
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
  if (!state.encPrivateKey || !state.signPrivateKey) {
    alert('Ozel anahtarin yok, lutfen tekrar giris yap');
    return;
  }

  try {
    const peerKeys = state.peerKeyCache[state.peer];
    if (!peerKeys?.encPublicKey) throw new Error('Aliciya ait acik anahtar yok');

    const payload = await KripoCrypto.encryptAndSign(
      text,
      peerKeys.encPublicKey,
      state.signPrivateKey,
      state.username,
      state.peer
    );
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

      // Gondericinin imza public key'ini cek (cache'le)
      if (!state.peerKeyCache[m.sender]) {
        try {
          state.peerKeyCache[m.sender] = await api(`/api/users/${encodeURIComponent(m.sender)}/keys`);
        } catch (e) {
          console.warn('Gonderici anahtari alinamadi:', e);
        }
      }
      const senderKeys = state.peerKeyCache[m.sender];

      let plaintext;
      let verified = null;
      if (isMine && state.decryptedCache[m.id]) {
        plaintext = state.decryptedCache[m.id];
        verified = true;
      } else if (state.encPrivateKey && senderKeys?.signPublicKey) {
        try {
          // Kendi mesajimizsa da gondericinin imza acik anahtarini biziz =>
          // dogrulama yapilabilir. Cozme bizim aliciya yonelikse mumkun.
          if (isMine) {
            // Kendi gonderdigimiz mesaji `encryptedKey` aliciya gore sifrelendigi
            // icin coremezsin; cache yoksa goster degil.
            plaintext = '(gonderildi — yerel kopya yok)';
            verified = true;
          } else {
            const r = await KripoCrypto.verifyAndDecrypt(m, state.encPrivateKey, senderKeys.signPublicKey);
            plaintext = r.plaintext;
            verified = r.verified;
            state.decryptedCache[m.id] = plaintext;
          }
        } catch (err) {
          plaintext = '🔒 (cozulemedi)';
          verified = false;
        }
      } else {
        plaintext = '🔒 (anahtarlar yok)';
      }

      const div = document.createElement('div');
      div.className = 'msg ' + (isMine ? 'mine' : 'theirs');
      if (verified === false) div.classList.add('unverified');

      const safeText = document.createElement('div');
      safeText.textContent = plaintext;
      div.appendChild(safeText);

      const meta = document.createElement('div');
      meta.className = 'meta';
      const t = new Date(m.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const badge =
        verified === true ? '✅ imza dogru' :
        verified === false ? '⚠️ IMZA GECERSIZ' :
        '… imza bilinmiyor';
      meta.textContent = `${isMine ? 'Sen' : m.sender} · ${t} · ${badge}`;
      div.appendChild(meta);

      const cipher = document.createElement('div');
      cipher.className = 'cipher';
      cipher.textContent =
        `ciphertext: ${m.ciphertext.slice(0, 60)}...\n` +
        `iv: ${m.iv}\n` +
        `encryptedKey: ${m.encryptedKey.slice(0, 60)}...\n` +
        `signature: ${m.signature.slice(0, 60)}...`;
      div.appendChild(cipher);

      container.appendChild(div);
    }
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    if (/Gecersiz oturum|suresi doldu/i.test(err.message)) {
      clearSession();
      showAuth();
      return;
    }
    console.error('Mesaj cekme hatasi:', err);
  }
}

// ------------ Acilis akisi ------------

(async function init() {
  if (!state.token || !state.username) {
    showAuth();
    return;
  }
  try {
    await api('/api/me');
  } catch (_) {
    clearSession();
    showAuth();
    return;
  }
  if (state.encPrivateKey && state.signPrivateKey) {
    showChat();
  } else {
    showUnlock();
  }
})();
