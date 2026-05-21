# Kripto Mesaj — Proje Dokumantasyonu

## 1. Projenin amaci

Iki kullanicinin birbirine **uctan uca sifreli (end-to-end encrypted, E2EE)** mesaj
gonderebildigi bir web sitesi. "Uctan uca sifreli" demek: mesaj gondericinin
tarayicisinda sifrelenir, sunucuya yalnizca sifreli hali gider, alicinin
tarayicisinda cozulur. **Sunucu mesajin icerigine erisemez** — veritabaninda
sadece anlamsiz bayt dizileri durur.

Bu, WhatsApp/Signal gibi uygulamalarin temel calisma prensibinin sadelestirilmis
bir versiyonudur.

## 2. Mimari

```
+--------------------+        +--------------------+        +--------------------+
|   Alice'in         |        |     Sunucu         |        |   Bob'un           |
|   tarayicisi       |        |   (Node.js)        |        |   tarayicisi       |
|                    |        |                    |        |                    |
|  - Iki RSA cifti   |        |  - Kullanicilari   |        |  - Iki RSA cifti   |
|    uret (sifre +   |        |    sakla           |        |    uret            |
|    imza)           | -----> |  - Sarili ozel     | -----> |                    |
|  - Ozel anahtari   |        |    anahtarlari     |        |  - Sifreyle        |
|    sifre ile sar   |        |    sakla           |        |    ozel anahtari   |
|  - Mesaji sifrele  |        |  - Acik anahtari   |        |    coz             |
|  - Imzala          |        |    dagit           |        |  - Imzayi dogrula  |
|  - Sifreli + imzali|        |  - Sifreli mesaji  |        |  - Mesaji coz      |
|    paketi yolla    |        |    sakla & ilet    |        |                    |
+--------------------+        +--------------------+        +--------------------+
       (özel anahtar              (sadece şifreli              (özel anahtar
        sifre ile sarili)           veriyi görür)                sifre ile sarili)
```

### 2.1 Bilesenler

| Katman      | Teknoloji                                         | Gorevi                                       |
| ----------- | ------------------------------------------------- | -------------------------------------------- |
| Frontend    | HTML + CSS + Vanilla JavaScript                   | Kullanici arayuzu                            |
| Sifreleme   | Web Crypto API (tarayicinin yerleşik)             | RSA-OAEP + RSA-PSS + AES-GCM + PBKDF2        |
| Backend     | Node.js + Express                                 | HTTP API                                     |
| Guvenlik    | helmet, express-rate-limit                        | Guvenlik basliklari, brute-force koruma      |
| Veritabani  | SQLite (`better-sqlite3`, WAL mode)               | Kullanicilar, oturumlar, sifreli mesajlar    |
| Sifre hash  | bcryptjs (cost 12)                                | Kullanici sifrelerinin hash'lenmesi          |
| Deploy      | Docker / Render / Fly.io                          | Production hosting                           |

### 2.2 Klasor yapisi

```
kripto-site/
├── server.js              # Express backend
├── package.json
├── Dockerfile             # Production container imaji
├── .dockerignore
├── render.yaml            # Render.com deploy config
├── fly.toml               # Fly.io deploy config
├── .env.example           # Ornek environment variable'lar
├── public/
│   ├── index.html         # Tek sayfa: giris + chat ekrani
│   ├── styles.css         # Goruntu
│   ├── crypto.js          # Web Crypto API yardimcilari
│   └── app.js             # UI mantigi (auth, mesaj gonder/al)
├── DOKUMANTASYON.md       # Bu dosya
└── README.md
```

## 3. Sifreleme akisi (en kritik kisim)

Dort farkli kripto primitifini birlikte kullaniriz. Buna **hibrit sifreleme** denir;
gercek dunyadaki PGP, S/MIME ve TLS de ayni mantigi kullanir.

| Algoritma  | Parametre          | Kullanim                                                    |
| ---------- | ------------------ | ----------------------------------------------------------- |
| RSA-OAEP   | 2048-bit, SHA-256  | AES anahtarinin alicinin acik anahtariyla sarilmasi         |
| RSA-PSS    | 2048-bit, SHA-256  | Mesajin gonderici tarafindan imzalanmasi (kimlik dogrulama) |
| AES-GCM    | 256-bit + 96-bit IV| Asil mesaj sifrelemesi (gizlilik + butunluk birlikte)       |
| PBKDF2     | SHA-256, 310k iter | Kullanici sifresinden ozel anahtarlari saracak anahtar uret |
| Bcrypt     | cost 12            | Sunucu tarafinda sifre hash'leme                            |

### 3.1 Neden bu kadar algoritma var?

- **AES (simetrik)**: cok hizli ama her iki tarafin da ayni anahtari bilmesi
  gerekir. "Ayni anahtari nasil guvenle paylasiriz?" sorusu kalir.
- **RSA-OAEP (asimetrik sifreleme)**: yavas ama "acik anahtarla sifrele, ozel
  anahtarla coz" yapisi sayesinde anahtar paylasimi problemini cozer.
- **RSA-PSS (asimetrik imza)**: "ozel anahtarla imzala, acik anahtarla dogrula".
  Bu olmadan sunucu, kotu niyetli olsa, sahte mesajlar uretip "alice gonderdi"
  diye gosterebilir. Imza ile alici, gondericinin kimliginden emin olur.
- **PBKDF2**: kullanicinin RSA ozel anahtari sunucuda da bir yerde tutulmali
  (yoksa baska tarayicidan giremezsin). Ama plaintext olarak tutmak felaket olur.
  Cozum: kullanicinin sifresinden 310,000 iterasyonla bir AES anahtari turetip
  ozel anahtari onunla sar. Sifreyi bilmeyen (sunucu dahil) acamaz.
- **Bcrypt**: sifre hashing'i icin standart secim. 12 cost factor su an icin
  yeterli yavaslikta (~250ms/hash).

### 3.2 Kayit akisi (adim adim)

`public/app.js` icinde `register-form` event handler:

1. Tarayici **iki RSA cifti uretir**: biri RSA-OAEP (sifreleme), biri RSA-PSS (imza).
2. **Rastgele 16 bayt tuz (salt)** uretilir.
3. Kullanici sifresinden PBKDF2 ile **AES-GCM-256 sarma anahtari** turetilir
   (310,000 SHA-256 iterasyonu).
4. Her iki ozel anahtar bu sarma anahtariyla AES-GCM ile sarilir.
5. Sunucuya yollanir:
   - `username`, `password` (sunucu bcrypt'leyip saklar)
   - `encPublicKey`, `signPublicKey` (acik halde)
   - `wrappedEncPrivateKey`, `wrappedSignPrivateKey`, `keySalt`, `encPrivIv`, `signPrivIv`
     (ozel anahtarlar sifreyle sarilmis halde — sunucu acamaz)
6. Sunucu kayit yapar ve oturum token'i doner.
7. Tarayici, ham ozel anahtarlari **sessionStorage**'da tutar (tab kapaninca silinir).

### 3.3 Giris akisi (adim adim)

1. Kullanici `username` + `password` gonderir.
2. Sunucu bcrypt ile sifreyi dogrular ve oturum token'i + sarili anahtarlari doner.
3. Tarayici, kullanicinin sifresinden ayni PBKDF2 ile sarma anahtarini yeniden uretir.
4. Sarili ozel anahtarlari acar (AES-GCM-decrypt).
5. Anahtarlar sessionStorage'a yazilir.

Yanlis sifre verilirse: AES-GCM cozme **butunluk dogrulamasi** sayesinde basarisiz olur
ve hata firlatir (AES-GCM bir AEAD mod, sifre yanlissa veri reddedilir — magic).

### 3.4 Mesaj gonderme akisi

`KripoCrypto.encryptAndSign` (public/crypto.js):

1. **Rastgele AES-GCM-256 anahtari uret.** (Her mesaj icin yeni — bir mesaj
   ele gecirilirse digerleri etkilenmez.)
2. **Rastgele 12 bayt IV uret.**
3. **Mesaji UTF-8'e cevir** ve AES-GCM ile sifrele → `ciphertext`.
4. AES anahtarini ham bayt olarak dis ari aktar (32 bayt).
5. Alicinin RSA-OAEP acik anahtarini sunucudan al.
6. **AES anahtarini alicinin RSA-OAEP acik anahtariyla sifrele** → `encryptedKey`.
7. **Imzalama yuk metni hazirla**:
   `sender|recipient|signedAt|iv|encryptedKey|ciphertext`
   (Buradaki tum alanlar imzaya dahil; saldirgan herhangi birini degistirirse
    imza dogrulamasi basarisiz olur.)
8. Bu yuku **gondericinin RSA-PSS ozel anahtariyla imzala** → `signature`.
9. Sunucuya gonder: `{ to, ciphertext, iv, encryptedKey, signature, signedAt }`.

Sunucu ek olarak:
- `signedAt`'in 5 dakikadan eski/ileri olmadigini kontrol eder (replay koruma).
- `to != sender` zorunlu.
- Rate limit: dakikada 60 mesaj.

### 3.5 Mesaj alma akisi

`KripoCrypto.verifyAndDecrypt`:

1. Gondericinin RSA-PSS acik anahtarini sunucudan al (cache'le).
2. Ayni imzalama yuk metnini yeniden kur.
3. **Imzayi dogrula.** Basarisizsa mesaj UI'da **kirmizi cerceveyle "IMZA GECERSIZ"** etiketiyle gosterilir.
4. `encryptedKey`'i kendi RSA-OAEP ozel anahtariyla coz → AES anahtarini elde et.
5. AES anahtarini Web Crypto'ya import et.
6. `ciphertext`'i AES-GCM ile coz (IV ile birlikte) → UTF-8 plaintext.

### 3.6 Anahtar yonetimi

- **Iki cift RSA anahtari** vardir: sifreleme (RSA-OAEP) ve imza (RSA-PSS).
  Cryptographic best practice: bir anahtarin sadece bir gorevi olsun.
- **Acik anahtarlar** sunucuda duz halde durur, herkese dagitilir.
- **Ozel anahtarlar** sunucuda **sifre ile sarili** halde durur. Sunucu acamaz.
- Calisma sirasinda acilmis ozel anahtarlar tarayicinin **sessionStorage**'inde
  durur — tab kapatildiginda otomatik silinir.
- Sayfa yenilenirse (tab acikken) anahtarlar hala sessionStorage'da; refresh'te
  sorun olmaz. Tab kapatilirsa tekrar sifre ile kilidi acilir (`unlock` ekrani).

## 4. Guvenlik onlemleri

| Konu                              | Cozum                                                           |
| --------------------------------- | --------------------------------------------------------------- |
| Sunucudan sizinti                 | Ozel anahtarlar AES-GCM ile sarili; PBKDF2 (310k iter) lazim    |
| Sunucu sahte mesaj iddiasi        | Her mesaj RSA-PSS ile imzali, alici dogruluyor                  |
| Sifre brute-force                 | bcrypt cost 12 + login icin 15 dk/20 deneme rate-limit          |
| Mesaj flood                       | Dakikada 60 mesaj rate-limit                                    |
| Replay (eski mesajin tekrarli) | `signedAt` zaman damgasi imzaya dahil + 5 dk pencere          |
| Mesaj kurcalama                   | RSA-PSS imzasi tum alanlari korur + AES-GCM butunluk tag'i      |
| XSS                               | Helmet CSP (sadece self, inline yok); `textContent` kullaniliyor|
| Clickjacking                      | `frame-ancestors: 'none'` + X-Frame-Options DENY                |
| MITM                              | HSTS + HTTPS yonlendirme (production'da)                        |
| Oturum bekleme                    | Token 7 gun sonra otomatik suresi dolar, saatlik temizlik       |
| Username enumeration              | Login'de sabit-zamanli bcrypt karsilastirma (phony hash)        |
| SQL injection                     | Tum sorgular prepared statement                                 |
| Path traversal                    | Express.static + sanitized parametre                            |
| Bilgi sizintisi (stack trace)     | Production hata yakalayicisi sadece `{error}` doner             |

### 4.1 Hala kalan eksiklikler (rapor icin durustluk)

- **Forward secrecy yok.** Ayni RSA cifti tum mesajlarda kullanilir. Anahtar
  cifti ele gecirilirse tum gecmis mesajlar cozulebilir. Tam cozum Signal'in
  Double Ratchet protokolu — okul projesi icin fazla karmasik.
- **Meta-veri sunucuda goruluyor.** Kim-kime-ne-zaman bilgisi sifreli degil.
- **Sifre kurtarma yok.** Kullanici sifresini unutursa eski mesajlarini sonsuza
  kadar kaybeder. Bu E2EE'nin dogal sonucu (Signal'da da boyledir).

## 5. Backend API

Tum istekler JSON, kimlik dogrulama `Authorization: Bearer <token>` header'i ile.

| Metod | Yol                          | Aciklama                                          |
| ----- | ---------------------------- | ------------------------------------------------- |
| GET   | `/api/health`                | Servis ayakta mi (deploy health-check icin)       |
| POST  | `/api/register`              | Yeni kullanici + sarili anahtarlar                |
| POST  | `/api/login`                 | Sifre ile giris, sarili anahtarlari geri doner    |
| POST  | `/api/logout`                | Oturumu silmek                                    |
| GET   | `/api/me`                    | Mevcut kullanicinin sarili anahtarlarini al       |
| GET   | `/api/users`                 | Diger kullanicilarin listesi                      |
| GET   | `/api/users/:username/keys`  | Bir kullanicinin **iki** acik anahtari (enc+sign) |
| POST  | `/api/messages`              | Sifreli + imzali mesaj gonder                     |
| GET   | `/api/messages?with=X&since=T`| Belirli bir kullaniciyla mesajlar                |

### 5.1 Veritabani semasi

```sql
users (
  username                  TEXT PRIMARY KEY,
  password_hash             TEXT NOT NULL,     -- bcrypt cost 12
  enc_public_key            TEXT NOT NULL,     -- base64 SPKI (RSA-OAEP)
  sign_public_key           TEXT NOT NULL,     -- base64 SPKI (RSA-PSS)
  wrapped_enc_private_key   TEXT NOT NULL,     -- AES-GCM ile sarili
  wrapped_sign_private_key  TEXT NOT NULL,     -- AES-GCM ile sarili
  key_salt                  TEXT NOT NULL,     -- PBKDF2 tuzu
  enc_priv_iv               TEXT NOT NULL,     -- AES-GCM IV (enc icin)
  sign_priv_iv              TEXT NOT NULL,     -- AES-GCM IV (sign icin)
  created_at                INTEGER
)

sessions (
  token       TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  created_at  INTEGER,
  expires_at  INTEGER      -- Oturum suresi (7 gun varsayilan)
)

messages (
  id            INTEGER PRIMARY KEY,
  sender        TEXT NOT NULL,
  recipient     TEXT NOT NULL,
  ciphertext    TEXT NOT NULL,     -- base64, sunucu ICERIGI GORMUYOR
  iv            TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,     -- base64 RSA-OAEP ciktisi
  signature     TEXT NOT NULL,     -- base64 RSA-PSS imzasi
  signed_at     INTEGER NOT NULL,  -- replay korumasi icin
  created_at    INTEGER
)
```

## 6. Demo nasil yapilir

### 6.1 Lokal demo (tek bilgisayar)

```bash
npm install
npm start
```

Sonra:
1. `http://localhost:3000` adresini ac.
2. Bir pencerede **Kayit ol** → `alice` / `gizli12345`.
3. Ayni siteyi **gizli pencerede** ac → **Kayit ol** → `bob` / `gizli67890`.
4. Alice'in penceresinde sol listede `bob`'u sec, mesaj yaz.
5. Bob'un penceresinde sol listede `alice`'i sec — mesaj cozulmus olarak gelir.
6. **"Sifreli icerigi goster"** kutusunu tikla → her mesajin altinda sunucuya
   giden ciphertext, IV, sifrelenmis AES anahtari ve imza goruntulenir.
7. Her mesajda **"✅ imza dogru"** etiketi gorunmeli.

### 6.2 Sunucuda hicbir seyin gorunmedigini dogrulama (hocaya demo)

Server calisirken, ayri bir terminalde:

```bash
sqlite3 kripto.db "SELECT sender, recipient, substr(ciphertext, 1, 40) FROM messages;"
```

Cikti soyle gozukur:

```
alice|bob|POUtgcGEIz3fdhkNM6zomF36e75mZ1C9PXZZy2rL...
```

`ciphertext` sutununda hicbir okunabilir metin yok. Mesaji okuyabilmek icin
alicinin **sifre ile acilmis** ozel anahtarina ihtiyac var; o da yalnizca
alicinin tarayicisinda ve sifre bilgisiyle erisilebilir.

Ekstra demo: `users` tablosuna bak:
```bash
sqlite3 kripto.db "SELECT username, substr(wrapped_enc_private_key, 1, 40) FROM users;"
```
Ozel anahtarlarin sarili (anlamsiz bayt) durdugunu goster.

## 7. Production deployment

### 7.1 Render.com (kullanilan host)

Bu projenin canli surumu Render.com ucretsiz tier'da yayinlandi.

- **Canli URL**: https://kripto-site.onrender.com/
- **Region**: Frankfurt (EU Central)
- **Runtime**: Docker (Dockerfile multi-stage build)
- **Otomatik deploy**: `main`'e push edildiginde Render kendiliginden yeniden build alir.

Sifirdan kurmak icin: GitHub ile Render hesabi ac → **New + Web Service**
→ `reverx99/kripto-site` repo'sunu sec → Branch `main`, Language Docker,
Instance Type Free, NODE_ENV=production → Deploy. Detayli adim adim
talimat icin proje koklerindeki `DEPLOY.md` dosyasina bak.

> ⚠️ Render free tier'da kalici disk yok. 15 dakika kullanilmazsa servis uyur,
> uyandiginda SQLite dosyasi sifirlanir. Demo sirasinda yeni hesaplar acip
> canli mesajlasarak gostermek bu kisitlamayi avantaja cevirir — hocaya
> sunucuda hicbir on-veri olmadigi sifir noktasindan baslandigi gosterilir.

### 7.2 Fly.io (kalici veri, biraz daha karmasik)

```bash
# flyctl kur: https://fly.io/docs/hands-on/install-flyctl/
flyctl auth signup
flyctl launch --copy-config --no-deploy   # app ismini onayla
flyctl volumes create data --size 1 --region fra
flyctl deploy
```

Fly.io free tier'da 3GB volume hakkin var, SQLite kalici olarak durur.

### 7.3 Docker (kendi VPS'inde)

```bash
docker build -t kripto-site .
docker run -d \
  -p 80:3000 \
  -e NODE_ENV=production \
  -v $(pwd)/data:/data \
  --name kripto kripto-site
```

HTTPS icin onune **Caddy** veya **nginx + Let's Encrypt** koy.

### 7.4 Yedek strateji

Bu proje icin tek bir canli URL (Render) yeterli goruldu. Demo gunu icin
yedek plani:

1. **Demo'dan ~3 dakika once** Render URL'ini ac → cold start uyumussa
   ~30 saniye bekle, ana sayfa acilana kadar emin ol.
2. **Lokal yedek**: Sunum yapacagin laptop'a repo'yu klonla, `npm install`
   ve `npm start` ile lokal de calisir halde tut. Render demo sirasinda
   olur de tamamen dusarse `http://localhost:3000` ile devam edilebilir.
3. **GitHub repo** zaten kalici bir yedek (kaynak kod kaybolmaz).

> Not: Glitch.com 2025'te kapatildi, "mirror deploy" icin onceden tavsiye
> edilen alternatif artik mevcut degil. Free tier'da Node.js destekleyen
> ve kredi karti istemeyen secenekler azaldi; tek host + lokal yedek bu
> seviye proje icin yeterli.

## 8. Kod akisinin ozeti

### 8.1 Kayit

```
[Tarayici]
  KC.generateEncryptionKeyPair()           // RSA-OAEP-2048
  KC.generateSigningKeyPair()              // RSA-PSS-2048
  salt = random(16 bytes)
  wrappingKey = PBKDF2(password, salt, 310k iter)
  wrappedEncPriv = AES-GCM.encrypt(encPriv_pkcs8, wrappingKey)
  wrappedSignPriv = AES-GCM.encrypt(signPriv_pkcs8, wrappingKey)
  POST /api/register { username, password, encPub, signPub,
                       wrappedEncPriv, wrappedSignPriv, salt, iv'ler }

[Sunucu]
  bcrypt.hash(password, cost=12)
  INSERT INTO users
  yeni rastgele 32-byte session token
  INSERT INTO sessions
  → { token, expiresAt }
```

### 8.2 Mesaj gonderme

```
[Alice'in tarayicisi]
  GET /api/users/bob/keys                   // { encPublicKey, signPublicKey }
  KC.encryptAndSign(text, bobEncPub, aliceSignPriv, 'alice', 'bob')
    aes = AES-256-GCM rastgele anahtar
    iv = 12 bayt rastgele
    ciphertext = AES-GCM.encrypt(text, aes, iv)
    encryptedKey = RSA-OAEP.encrypt(aes, bobEncPub)
    signedAt = Date.now()
    payload = sender|recipient|signedAt|iv|encryptedKey|ciphertext
    signature = RSA-PSS.sign(payload, aliceSignPriv)
  POST /api/messages { to:'bob', ciphertext, iv, encryptedKey, signature, signedAt }

[Sunucu]
  signedAt'i ±5dk kontrol et
  to != sender kontrol et
  rate-limit kontrol et (60/dk)
  INSERT INTO messages    // sadece sifreli + imza saklanir
```

### 8.3 Mesaj alma

```
[Bob'un tarayicisi]
  Her 2 saniyede:
    GET /api/messages?with=alice&since=<son zaman>
    Her gelen mesaj icin:
      GET /api/users/alice/keys (cache'li)
      payload = sender|recipient|signedAt|iv|encryptedKey|ciphertext
      verified = RSA-PSS.verify(signature, payload, aliceSignPub)
      aes = RSA-OAEP.decrypt(encryptedKey, bobEncPriv)
      text = AES-GCM.decrypt(ciphertext, aes, iv)
      Ekrana yaz + imza durumunu goster
```

## 9. Olasi gelistirmeler (zaman kalirsa)

- WebSocket ile gercek zamanli iletim (polling yerine)
- Dosya/resim gonderme (ayni hibrit yontemle sifrelenir)
- Anahtar parmak izi (fingerprint) gosterme — arkadasinla telefonla teyit et
- Forward secrecy (Double Ratchet)
- Kendini imha eden mesajlar / mesaj silme
- WebAuthn / passkey ile sifresiz giris
- Grup sohbeti

## 10. Kaynaklar

- MDN — Web Crypto API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
- NIST FIPS 197 (AES): https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.197.pdf
- RFC 8017 (PKCS #1 / RSA): https://www.rfc-editor.org/rfc/rfc8017
- OWASP Password Storage Cheat Sheet (PBKDF2 iter sayisi): https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Signal protocol genel bakis: https://signal.org/docs/
- Helmet (security headers): https://helmetjs.github.io/
