# Kripto Mesaj — Proje Dokumantasyonu

## 1. Projenin amaci

Iki kullanicinin birbirine **uctan uca sifreli (end-to-end encrypted, E2EE)** mesaj
gonderebildigi bir web sitesi. "Uctan uca sifreli" demek: mesaj gondericinin
tarayicisinda sifrelenir, sunucuya yalnizca sifreli hali gider, alicinin
tarayicisinda cozulur. **Sunucu mesajin icerigine erisemez** — veritabaninda
sadece anlamsiz bayt dizileri durur.

Bu, WhatsApp/Signal gibi uygulamalarin temel calismaprenibibinin sadelestirilmis
bir versiyonudur.

## 2. Mimari

```
+--------------------+        +--------------------+        +--------------------+
|   Alice'in         |        |     Sunucu         |        |   Bob'un           |
|   tarayicisi       |        |   (Node.js)        |        |   tarayicisi       |
|                    |        |                    |        |                    |
|  - Anahtar uret    |        |  - Kullanicilari   |        |  - Anahtar uret    |
|  - Mesaji sifrele  | -----> |    sakla           | -----> |  - Mesaji coz      |
|  - Sifreli yolla   |        |  - Acik anahtari   |        |                    |
|  - Gelen sifreliyi |        |    dagit           |        |                    |
|    coz             |        |  - Sifreli mesaji  |        |                    |
|                    |        |    sakla & ilet    |        |                    |
+--------------------+        +--------------------+        +--------------------+
       (özel anahtar              (sadece şifreli              (özel anahtar
        burada kalır)              veriyi görür)                burada kalır)
```

### 2.1 Bilesenler

| Katman      | Teknoloji                           | Gorevi                                       |
| ----------- | ----------------------------------- | -------------------------------------------- |
| Frontend    | HTML + CSS + Vanilla JavaScript     | Kullanici arayuzu                            |
| Sifreleme   | Web Crypto API (tarayicinin yerleşik) | RSA-OAEP-2048 + AES-GCM-256                  |
| Backend     | Node.js + Express                   | HTTP API                                     |
| Veritabani  | SQLite (`better-sqlite3`)           | Kullanicilar, oturumlar, sifreli mesajlar    |
| Sifre hash  | bcryptjs                            | Kullanici sifrelerinin hash'lenmesi          |

### 2.2 Klasor yapisi

```
kripto-site/
├── server.js              # Express backend
├── package.json
├── public/
│   ├── index.html         # Tek sayfa: giris + chat ekrani
│   ├── styles.css         # Goruntu
│   ├── crypto.js          # Web Crypto API yardimcilari
│   └── app.js             # UI mantigi (auth, mesaj gonder/al)
├── DOKUMANTASYON.md       # Bu dosya
└── README.md
```

## 3. Sifreleme akisi (en kritik kisim)

Iki tip sifreleme algoritmasi birlikte kullanilir. Buna **hibrit sifreleme**
denir; gercek dunyadaki PGP, S/MIME ve TLS de ayni mantigi kullanir.

### 3.1 Neden iki algoritma?

- **AES (simetrik)**: cok hizli ama her iki tarafin da ayni anahtari bilmesi
  gerekir. "Ayni anahtari nasil guvenle paylasiriz?" sorusu kalir.
- **RSA (asimetrik)**: yavas ama "acik anahtarla sifrele, ozel anahtarla coz"
  yapisi sayesinde anahtar paylasimi problemini cozer.

Cozum: **kucuk olan AES anahtarini RSA ile sifrele, asil mesaji AES ile sifrele.**

### 3.2 Adim adim sifreleme (gondericide)

Alice, Bob'a mesaj gonderecek. `public/crypto.js`'in `encryptMessage` fonksiyonu:

1. **Rastgele bir AES-GCM-256 anahtari uret.** (Her mesaj icin yeni.)
2. **Rastgele bir IV (12 bayt) uret.** GCM modunda IV her seferinde benzersiz olmalidir.
3. **Mesaji UTF-8'e cevir** ve AES-GCM ile sifrele → `ciphertext`.
4. **AES anahtarini ham bayt olarak dis ari aktar** (32 bayt).
5. **Bob'un RSA acik anahtarini al** (sunucudan `/api/users/bob/key` ile).
6. **AES anahtarini Bob'un RSA acik anahtariyla sifrele** → `encryptedKey`.
7. Sunucuya gonder: `{ ciphertext, iv, encryptedKey }` (her uçü de base64).

### 3.3 Adim adim cozme (alicida)

Bob, gelen paketi alir. `decryptMessage` fonksiyonu:

1. **Kendi RSA ozel anahtarini** localStorage'dan al.
2. **`encryptedKey`'i RSA ozel anahtariyla coz** → ham AES anahtarini elde et.
3. **AES anahtarini Web Crypto'ya import et.**
4. **`ciphertext`'i AES-GCM ile coz** (IV ile birlikte) → mesajin UTF-8'i.
5. UTF-8'i metne cevir → orjinal mesaj.

### 3.4 Anahtar yonetimi

- Kayit anindaki RSA anahtar cifti tarayicida `crypto.subtle.generateKey` ile uretilir.
- **Acik anahtar (public key)** sunucuya yollanir, veritabaninda `users.public_key`
  olarak durur. Diger kullanicilara dagitilir.
- **Ozel anahtar (private key)** tarayicidan asla cikmaz — `localStorage.privateKey`
  alanina kaydedilir.
- Bu sebeple **baska bir tarayicidan girersen eski mesajlarini cozemezsin** (cunku
  ozel anahtar o tarayicida yok). Bu E2EE'nin dogal sonucudur ve Signal/WhatsApp'ta
  da boyledir.

## 4. Backend API

Tum istekler JSON, kimlik dogrulamasi `Authorization: Bearer <token>` header'i ile.

| Metod | Yol                          | Aciklama                                 |
| ----- | ---------------------------- | ---------------------------------------- |
| POST  | `/api/register`              | `{username, password, publicKey}` → `{token}` |
| POST  | `/api/login`                 | `{username, password}` → `{token}`       |
| POST  | `/api/logout`                | Oturumu silmek                           |
| GET   | `/api/me`                    | Oturum gecerli mi?                       |
| GET   | `/api/users`                 | Diger kullanicilarin listesi             |
| GET   | `/api/users/:username/key`   | Bir kullanicinin acik anahtari           |
| POST  | `/api/messages`              | `{to, ciphertext, iv, encryptedKey}`     |
| GET   | `/api/messages?with=X&since=T` | Belirli bir kullaniciyla mesajlar     |

### 4.1 Veritabani semasi

```sql
users (
  username       TEXT PRIMARY KEY,
  password_hash  TEXT NOT NULL,     -- bcrypt
  public_key     TEXT NOT NULL,     -- base64 SPKI
  created_at     INTEGER
)

sessions (
  token          TEXT PRIMARY KEY,
  username       TEXT NOT NULL,
  created_at     INTEGER
)

messages (
  id             INTEGER PRIMARY KEY,
  sender         TEXT NOT NULL,
  recipient      TEXT NOT NULL,
  ciphertext     TEXT NOT NULL,     -- base64, sunucu ICERIGI GORMUYOR
  iv             TEXT NOT NULL,
  encrypted_key  TEXT NOT NULL,     -- base64 RSA-OAEP ciktisi
  created_at     INTEGER
)
```

## 5. Demo nasil yapilir

### 5.1 Lokal demo (tek bilgisayar)

```bash
npm install
npm start
```

Sonra:
1. `http://localhost:3000` adresini ac.
2. Bir pencerede **Kayit ol** → `alice` / `1234`.
3. Ayni siteyi **gizli pencerede** ac (normal pencereyle ayni localStorage'i
   paylasmasin diye) → **Kayit ol** → `bob` / `1234`.
4. Alice'in penceresinde sol listede `bob`'u sec, mesaj yaz.
5. Bob'un penceresinde `alice`'i sec — mesaj cozulmus olarak gelir.
6. **"Sifreli icerigi goster"** kutusunu tikla → her mesajin altinda sunucuya
   giden ciphertext, IV ve sifrelenmis AES anahtari goruntulenir.

### 5.2 Iki bilgisayar (gercek demo)

Sunucu internete acik bir yerde calismalı. En kolay yol:

**Render.com (ucretsiz):**
1. Repoyu GitHub'a push et.
2. render.com → "New Web Service" → repoyu sec.
3. Build command: `npm install`, Start command: `npm start`.
4. Deploy bitince size verilen URL'i arkadasinla paylas.

> Not: SQLite dosyasi ucretsiz tier'da yeniden baslayinca silinebilir. Demo
> icin sorun degil, ama gercek bir urunde Postgres tercih edilir.

### 5.3 Sunucuda hicbir seyin gorunmedigini dogrulama (hocaya demo)

Server calisirken, ayri bir terminalde:

```bash
sqlite3 kripto.db "SELECT sender, recipient, ciphertext FROM messages;"
```

Cikti seyle goz onunde olur:

```
alice|bob|POUtgcGEIz3fdhkNM6zom...
```

`ciphertext` sutununda hicbir okunabilir metin yok. Mesaji okuyabilmek icin
Bob'un ozel anahtarina ihtiyac var; o da yalnizca Bob'un tarayicisinda.

## 6. Guvenlik notlari ve sinirlamalar

Bu bir okul projesi oldugundan bazi sadelestirmeler yapildi. Gercek bir urunde
yapilmasi gerekenler:

| Konu                                    | Mevcut durum                     | Olmasi gereken                                                          |
| --------------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| HTTPS                                   | Yok (lokal)                      | Production'da zorunlu (TLS sertifikasi)                                 |
| Ozel anahtar saklama                    | Duz halde localStorage           | Kullanicinin sifresinden turetilen bir anahtarla sifreli sakla (PBKDF2) |
| Mesaj butunlugu (gondericiyi dogrulama) | Sadece oturum token'i ile        | Imzalama: gonderici ayrica mesaji ozel anahtariyla imzalamali           |
| Forward secrecy                         | Yok (ayni RSA anahtari hep ayni) | Double Ratchet (Signal'in yaptigi)                                      |
| Meta-veri                               | Sunucu kim-kimle-ne-zaman gorur  | Onion routing / mix-net (cok zor)                                       |
| Sifre policy                            | Min 4 karakter                   | Daha guclu kurallar, rate limit                                         |

## 7. Kullanilan kripto algoritmalarinin parametreleri

| Algoritma | Parametre              | Kaynak                          |
| --------- | ---------------------- | ------------------------------- |
| RSA-OAEP  | 2048-bit, SHA-256 hash | NIST SP 800-56B Rev. 2          |
| AES-GCM   | 256-bit anahtar, 96-bit IV | NIST SP 800-38D             |
| Bcrypt    | 10 cost factor         | OpenBSD ekibinin orijinal makalesi |
| Oturum token | 32 bayt rastgele (crypto.randomBytes) | -            |

## 8. Kod akisinin ozeti

### 8.1 Kayit (register)

```
[Tarayici]
  KripoCrypto.generateKeyPair()           // RSA-OAEP-2048
  → publicKey, privateKey
  localStorage.privateKey = privateKey
  POST /api/register { username, password, publicKey }

[Sunucu]
  bcrypt.hash(password)
  INSERT INTO users
  yeni rastgele token uret
  INSERT INTO sessions
  → { token }
```

### 8.2 Mesaj gonderme

```
[Alice'in tarayicisi]
  GET /api/users/bob/key                   // Bob'un public key'ini al
  KripoCrypto.encryptMessage(text, bobPub)
    aes = AES-256-GCM rastgele anahtar
    iv = 12 bayt rastgele
    ciphertext = AES-GCM.encrypt(text, aes, iv)
    encryptedKey = RSA-OAEP.encrypt(aes, bobPub)
  POST /api/messages { to: 'bob', ciphertext, iv, encryptedKey }

[Sunucu]
  INSERT INTO messages    // sadece ciphertext'i saklar
```

### 8.3 Mesaj alma

```
[Bob'un tarayicisi]
  Her 2 saniyede:
    GET /api/messages?with=alice&since=<son zaman>
    Her gelen mesaj icin:
      KripoCrypto.decryptMessage(msg, localStorage.privateKey)
        aes = RSA-OAEP.decrypt(encryptedKey, bobPriv)
        text = AES-GCM.decrypt(ciphertext, aes, iv)
      Ekrana yaz
```

## 9. Olasi gelistirmeler (zaman kalirsa)

- WebSocket ile gercek zamanli iletim (polling yerine)
- Dosya/resim gonderme (ayni hibrit yontemle sifrelenir)
- Anahtar parmak izi (fingerprint) gosterme — arkadasinla telefonla teyit
- Mesaj imzalama (RSA-PSS ile gondericiyi dogrulama)
- Mesaj silme & kendini imha eden mesajlar

## 10. Kaynaklar

- MDN — Web Crypto API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
- NIST FIPS 197 (AES): https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.197.pdf
- RFC 8017 (PKCS #1 / RSA): https://www.rfc-editor.org/rfc/rfc8017
- Signal protocol genel bakis: https://signal.org/docs/
