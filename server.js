const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'kripto.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    public_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender, recipient, created_at);
`);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Token gerekli' });
  const session = db.prepare('SELECT username FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Gecersiz oturum' });
  req.username = session.username;
  next();
}

app.post('/api/register', (req, res) => {
  const { username, password, publicKey } = req.body || {};
  if (!username || !password || !publicKey) {
    return res.status(400).json({ error: 'username, password ve publicKey zorunlu' });
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Kullanici adi 3-20 karakter (harf/rakam/altcizgi)' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Sifre en az 4 karakter olmali' });
  }
  const existing = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Bu kullanici adi alinmis' });

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (username, password_hash, public_key, created_at) VALUES (?, ?, ?, ?)'
  ).run(username, hash, publicKey, Date.now());

  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)').run(
    token,
    username,
    Date.now()
  );
  res.json({ token, username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Eksik alan' });
  const user = db.prepare('SELECT password_hash FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Hatali kullanici adi veya sifre' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)').run(
    token,
    username,
    Date.now()
  );
  res.json({ token, username });
});

app.post('/api/logout', auth, (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ username: req.username });
});

app.get('/api/users', auth, (req, res) => {
  const users = db
    .prepare('SELECT username FROM users WHERE username != ? ORDER BY username ASC')
    .all(req.username);
  res.json(users);
});

app.get('/api/users/:username/key', auth, (req, res) => {
  const user = db.prepare('SELECT public_key FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Kullanici bulunamadi' });
  res.json({ publicKey: user.public_key });
});

app.post('/api/messages', auth, (req, res) => {
  const { to, ciphertext, iv, encryptedKey } = req.body || {};
  if (!to || !ciphertext || !iv || !encryptedKey) {
    return res.status(400).json({ error: 'Eksik alan' });
  }
  const recipient = db.prepare('SELECT 1 FROM users WHERE username = ?').get(to);
  if (!recipient) return res.status(404).json({ error: 'Alici bulunamadi' });
  const info = db
    .prepare(
      'INSERT INTO messages (sender, recipient, ciphertext, iv, encrypted_key, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(req.username, to, ciphertext, iv, encryptedKey, Date.now());
  res.json({ id: info.lastInsertRowid, createdAt: Date.now() });
});

app.get('/api/messages', auth, (req, res) => {
  const peer = req.query.with;
  const since = parseInt(req.query.since || '0', 10);
  let rows;
  if (peer) {
    rows = db
      .prepare(
        `SELECT id, sender, recipient, ciphertext, iv, encrypted_key AS encryptedKey, created_at AS createdAt
         FROM messages
         WHERE ((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?))
           AND created_at > ?
         ORDER BY created_at ASC`
      )
      .all(req.username, peer, peer, req.username, since);
  } else {
    rows = db
      .prepare(
        `SELECT id, sender, recipient, ciphertext, iv, encrypted_key AS encryptedKey, created_at AS createdAt
         FROM messages
         WHERE (sender = ? OR recipient = ?) AND created_at > ?
         ORDER BY created_at ASC`
      )
      .all(req.username, req.username, since);
  }
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kripto site http://localhost:${PORT} adresinde calisiyor`);
});
