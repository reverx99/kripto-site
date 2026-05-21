const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || `${7 * 24 * 60 * 60 * 1000}`, 10);
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'kripto.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username                  TEXT PRIMARY KEY,
    password_hash             TEXT NOT NULL,
    enc_public_key            TEXT NOT NULL,
    sign_public_key           TEXT NOT NULL,
    wrapped_enc_private_key   TEXT NOT NULL,
    wrapped_sign_private_key  TEXT NOT NULL,
    key_salt                  TEXT NOT NULL,
    enc_priv_iv               TEXT NOT NULL,
    sign_priv_iv              TEXT NOT NULL,
    created_at                INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sender        TEXT NOT NULL,
    recipient     TEXT NOT NULL,
    ciphertext    TEXT NOT NULL,
    iv            TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    signature     TEXT NOT NULL,
    signed_at     INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    FOREIGN KEY (sender) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (recipient) REFERENCES users(username) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender, recipient, created_at);
`);

// ------------ Periyodik temizlik ------------
const cleanupExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at < ?');
setInterval(() => {
  try { cleanupExpiredSessions.run(Date.now()); } catch (e) { console.error('Temizlik hatasi:', e); }
}, 60 * 60 * 1000).unref();

// ------------ Genel middleware ------------

if (NODE_ENV === 'production') {
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    hsts: NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: NODE_ENV === 'production' ? '1h' : 0,
  index: 'index.html',
}));

// ------------ Rate limit'ler ------------

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Cok fazla deneme. Lutfen birkac dakika bekleyin.' },
});

const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Cok hizli mesaj gonderiyorsun. Biraz yavasla.' },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

app.use('/api/', generalLimiter);

// ------------ Auth middleware ------------

const findSession = db.prepare('SELECT username, expires_at FROM sessions WHERE token = ?');
const deleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');
const insertSession = db.prepare(
  'INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)'
);

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  insertSession.run(token, username, now, now + SESSION_TTL_MS);
  return { token, expiresAt: now + SESSION_TTL_MS };
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Token gerekli' });
  const session = findSession.get(token);
  if (!session) return res.status(401).json({ error: 'Gecersiz oturum' });
  if (session.expires_at < Date.now()) {
    deleteSession.run(token);
    return res.status(401).json({ error: 'Oturum suresi doldu' });
  }
  req.username = session.username;
  req.token = token;
  next();
}

// ------------ Yardimcilar ------------

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const MIN_PASSWORD_LEN = 8;

function isB64(s, maxLen) {
  return typeof s === 'string' && s.length > 0 && s.length <= maxLen && /^[A-Za-z0-9+/=]+$/.test(s);
}

// ------------ Routes ------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

app.post('/api/register', authLimiter, (req, res) => {
  const b = req.body || {};
  const {
    username,
    password,
    encPublicKey,
    signPublicKey,
    wrappedEncPrivateKey,
    wrappedSignPrivateKey,
    keySalt,
    encPrivIv,
    signPrivIv,
  } = b;

  if (
    !username ||
    !password ||
    !encPublicKey ||
    !signPublicKey ||
    !wrappedEncPrivateKey ||
    !wrappedSignPrivateKey ||
    !keySalt ||
    !encPrivIv ||
    !signPrivIv
  ) {
    return res.status(400).json({ error: 'Eksik alan' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Kullanici adi 3-20 karakter (harf/rakam/altcizgi)' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN || password.length > 256) {
    return res.status(400).json({ error: `Sifre en az ${MIN_PASSWORD_LEN} karakter olmali` });
  }
  if (
    !isB64(encPublicKey, 4096) ||
    !isB64(signPublicKey, 4096) ||
    !isB64(wrappedEncPrivateKey, 8192) ||
    !isB64(wrappedSignPrivateKey, 8192) ||
    !isB64(keySalt, 64) ||
    !isB64(encPrivIv, 32) ||
    !isB64(signPrivIv, 32)
  ) {
    return res.status(400).json({ error: 'Anahtar formati hatali' });
  }

  const existing = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Bu kullanici adi alinmis' });

  const hash = bcrypt.hashSync(password, 12);
  db.prepare(
    `INSERT INTO users
      (username, password_hash, enc_public_key, sign_public_key,
       wrapped_enc_private_key, wrapped_sign_private_key,
       key_salt, enc_priv_iv, sign_priv_iv, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    username,
    hash,
    encPublicKey,
    signPublicKey,
    wrappedEncPrivateKey,
    wrappedSignPrivateKey,
    keySalt,
    encPrivIv,
    signPrivIv,
    Date.now()
  );

  const session = createSession(username);
  res.json({ token: session.token, username, expiresAt: session.expiresAt });
});

app.post('/api/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Eksik alan' });

  const user = db
    .prepare(
      `SELECT password_hash, wrapped_enc_private_key, wrapped_sign_private_key,
              key_salt, enc_priv_iv, sign_priv_iv
       FROM users WHERE username = ?`
    )
    .get(username);

  // Sabit-zamanli yanit: kullanici bulunmasa bile bcrypt'i bos calistirip
  // ayni hatayi dondur (kullanici-listesi sizintilarini onler).
  const PHONY = '$2a$12$abcdefghijklmnopqrstuOPLnSV5VS/o4lqXkD8wWoQyAr/L2qVu4u';
  const ok = bcrypt.compareSync(password, user ? user.password_hash : PHONY);
  if (!user || !ok) return res.status(401).json({ error: 'Hatali kullanici adi veya sifre' });

  const session = createSession(username);
  res.json({
    token: session.token,
    username,
    expiresAt: session.expiresAt,
    wrappedEncPrivateKey: user.wrapped_enc_private_key,
    wrappedSignPrivateKey: user.wrapped_sign_private_key,
    keySalt: user.key_salt,
    encPrivIv: user.enc_priv_iv,
    signPrivIv: user.sign_priv_iv,
  });
});

app.post('/api/logout', auth, (req, res) => {
  deleteSession.run(req.token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const u = db
    .prepare(
      `SELECT wrapped_enc_private_key, wrapped_sign_private_key,
              key_salt, enc_priv_iv, sign_priv_iv
       FROM users WHERE username = ?`
    )
    .get(req.username);
  if (!u) return res.status(404).json({ error: 'Kullanici bulunamadi' });
  res.json({
    username: req.username,
    wrappedEncPrivateKey: u.wrapped_enc_private_key,
    wrappedSignPrivateKey: u.wrapped_sign_private_key,
    keySalt: u.key_salt,
    encPrivIv: u.enc_priv_iv,
    signPrivIv: u.sign_priv_iv,
  });
});

app.get('/api/users', auth, (req, res) => {
  const rows = db
    .prepare('SELECT username FROM users WHERE username != ? ORDER BY username ASC')
    .all(req.username);
  res.json(rows);
});

app.get('/api/users/:username/keys', auth, (req, res) => {
  const u = db
    .prepare('SELECT enc_public_key, sign_public_key FROM users WHERE username = ?')
    .get(req.params.username);
  if (!u) return res.status(404).json({ error: 'Kullanici bulunamadi' });
  res.json({ encPublicKey: u.enc_public_key, signPublicKey: u.sign_public_key });
});

app.post('/api/messages', messageLimiter, auth, (req, res) => {
  const { to, ciphertext, iv, encryptedKey, signature, signedAt } = req.body || {};
  if (!to || !ciphertext || !iv || !encryptedKey || !signature || !signedAt) {
    return res.status(400).json({ error: 'Eksik alan' });
  }
  if (
    !USERNAME_RE.test(to) ||
    !isB64(ciphertext, 200000) ||
    !isB64(iv, 32) ||
    !isB64(encryptedKey, 1024) ||
    !isB64(signature, 1024) ||
    typeof signedAt !== 'number'
  ) {
    return res.status(400).json({ error: 'Gecersiz parametre' });
  }
  // Saat kayma toleransi 5 dakika; tekrar saldirisi onlemeye yardimci olur.
  const drift = Math.abs(Date.now() - signedAt);
  if (drift > 5 * 60 * 1000) {
    return res.status(400).json({ error: 'Mesaj zaman damgasi cok eski/ileri' });
  }
  if (to === req.username) {
    return res.status(400).json({ error: 'Kendine mesaj gonderemezsin' });
  }
  const recipient = db.prepare('SELECT 1 FROM users WHERE username = ?').get(to);
  if (!recipient) return res.status(404).json({ error: 'Alici bulunamadi' });

  const info = db
    .prepare(
      `INSERT INTO messages
        (sender, recipient, ciphertext, iv, encrypted_key, signature, signed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.username, to, ciphertext, iv, encryptedKey, signature, signedAt, Date.now());
  res.json({ id: info.lastInsertRowid, createdAt: Date.now() });
});

app.get('/api/messages', auth, (req, res) => {
  const peer = req.query.with;
  const since = parseInt(req.query.since || '0', 10) || 0;
  let rows;
  if (peer) {
    if (!USERNAME_RE.test(peer)) return res.status(400).json({ error: 'Gecersiz kullanici' });
    rows = db
      .prepare(
        `SELECT id, sender, recipient, ciphertext, iv, encrypted_key AS encryptedKey,
                signature, signed_at AS signedAt, created_at AS createdAt
         FROM messages
         WHERE ((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?))
           AND created_at > ?
         ORDER BY created_at ASC
         LIMIT 500`
      )
      .all(req.username, peer, peer, req.username, since);
  } else {
    rows = db
      .prepare(
        `SELECT id, sender, recipient, ciphertext, iv, encrypted_key AS encryptedKey,
                signature, signed_at AS signedAt, created_at AS createdAt
         FROM messages
         WHERE (sender = ? OR recipient = ?) AND created_at > ?
         ORDER BY created_at ASC
         LIMIT 500`
      )
      .all(req.username, req.username, since);
  }
  res.json(rows);
});

// 404 JSON
app.use('/api/', (req, res) => res.status(404).json({ error: 'Bulunamadi' }));

// Hata yakalayici (stack trace sizdirma)
app.use((err, req, res, next) => {
  console.error('Hata:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Sunucu hatasi' });
});

const server = app.listen(PORT, () => {
  console.log(`[${NODE_ENV}] Kripto site http://localhost:${PORT} adresinde calisiyor (DB: ${DB_PATH})`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`${signal} alindi, kapaniyor...`);
  server.close(() => {
    try { db.close(); } catch (_) {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
