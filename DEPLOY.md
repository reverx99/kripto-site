# Deploy Rehberi (Adim Adim)

Bu rehber, kripto siteni **ucretsiz, kredi karti istemeyen** host'lara nasil
deploy edecegini gosterir.

Kodun zaten su anda **GitHub'da**: `https://github.com/reverx99/kripto-site`
branch: `claude/focused-bardeen-8mpQA`

---

## 1. Render.com (Primary / asil deploy)

### Adim 1 — Hesap
1. https://render.com adresine git
2. **Get Started** → **Sign in with GitHub**
3. GitHub hesabinla giris yap, izinleri onayla.

### Adim 2 — Servis olustur
1. Render dashboard'da sag ust **+ New** → **Web Service**
2. **Connect a repository** kisminda `reverx99/kripto-site`'i bul ve **Connect**'e bas.
   - Gozukmuyorsa: **Configure GitHub App** linkine bas, sadece bu repo'ya yetki ver.
3. Acilan formda:
   - **Name**: `kripto-site` (URL bunu kullanacak: `kripto-site-xxxx.onrender.com`)
   - **Region**: `Frankfurt (EU Central)`
   - **Branch**: `claude/focused-bardeen-8mpQA`  *(dropdown'dan sec)*
   - **Runtime**: `Node` *(otomatik dolar)*
   - **Build Command**: `npm ci --only=production`
   - **Start Command**: `node server.js`
   - **Instance Type**: **Free**
4. **Environment Variables** kisminda **+ Add**:
   - `NODE_ENV` = `production`
5. En altta **Create Web Service** butonuna bas.

### Adim 3 — Bekle
- Render kodu cekip kuracak, ~2-3 dakika.
- Logs sekmesinde `[production] Kripto site http://localhost:10000 adresinde calisiyor` yazinca hazir.
- Servis URL'in: `https://kripto-site-XXXX.onrender.com` (sayfanin ustunde yazar)

### Adim 4 — Test
1. URL'i tarayicida ac.
2. **Kayit ol** → `alice` / `gizli12345`
3. Baska bir tarayici/cihaz/arkadasin → `bob` / `gizli67890`
4. Mesajlasin, "Sifreli icerigi goster" kutusunu ac.

> ⚠️ **15 dakika bos kalirsa servis uyur.** Sonraki istekte ~30 saniye uyanir.
> Demo'dan 1 dakika once URL'i acip "uyandirmis" ol.

---

## 2. Glitch.com (Mirror / yedek)

Render uyursa veya inerse Glitch yedegi devreye girer. Veri ayri kalir
(her host kendi kullanici listesi tutar).

### Adim 1 — Hesap
1. https://glitch.com → **Sign in** → GitHub ile gir.

### Adim 2 — Import
1. Sag ust **New project** → **Import from GitHub**
2. URL: `https://github.com/reverx99/kripto-site`
3. **OK**. Glitch kodu cekip kuracak.

> Branch sorunu: Glitch genelde default branch'i ceker. GitHub'da default
> branch'i `claude/focused-bardeen-8mpQA` yap (Settings → Branches → default
> branch dropdown), VEYA Glitch import sonrasi `.git` config'inden duzelt.
> En kolayi: yeni main branch olustur (asagiya bak).

### Adim 3 — Calistir
Glitch otomatik `npm install` + `npm start` yapar. Birkac saniye sonra
sag ust **Preview** → **Open in a new window**.

URL'in: `https://<proje-adi>.glitch.me`

> Glitch SQLite'i diskte tutar, veri kalici. Ama 5 dk inaktif sonra uyur,
> uyaninca veri olduguyla durur.

---

## 3. (Onerilen) main branch olustur

Render ve Glitch hayatini kolaylastirmak icin GitHub'da `main` branch
olusturup default yap:

```bash
# Lokal'de zaten yoksa, su anki branch'i main'e cevirelim
git push origin claude/focused-bardeen-8mpQA:main
```

Veya GitHub web UI:
1. Repo sayfasinda branch dropdown → **View all branches**
2. **New branch** → from `claude/focused-bardeen-8mpQA` → name `main` → **Create**
3. Repo **Settings** → **General** → **Default branch** → kalemden `main`'e cevir.

---

## 4. Hocaya teslim paketi

1. **Asil site URL**: `https://kripto-site-XXXX.onrender.com`
2. **Yedek (mirror) URL**: `https://<proje>.glitch.me`
3. **GitHub repo**: `https://github.com/reverx99/kripto-site`
4. **Dokumantasyon**: `DOKUMANTASYON.md` (PDF'e cevirip de yollayabilirsin)

### Demo sirasinda hocaya goster

- ✅ Iki tarayici/cihazdan mesajlasin.
- ✅ "Sifreli icerigi goster" kutusunu acip ciphertext'i goster.
- ✅ Imza dogrulama isaretini (✅) goster.
- ✅ Render'in admin panelinden DB'ye bakip (veya `sqlite3` ile lokal'de
  acip) sunucuda **sadece sifreli verinin durdugunu** kanitla.
- ✅ "Mirror site"e gec, ayni demo'yu orada da yap.

---

## 5. Sorun cikarsa

### "Application failed to respond"
- Render Logs sekmesine bak. Genelde port hatasi olur — Render `PORT`
  environment variable'ini kendi atar, biz `process.env.PORT`'u dinliyoruz,
  sorun olmamali. Hata buraya bak.

### "Cannot connect to database"
- SQLite dosyasi DATA_DIR'a yazilamiyorsa. Render free tier'da
  `/opt/render/project/src` yazilabilir, default ayar bu sekilde calisir.

### "Anahtarlar uretiliyor..." cok uzun
- PBKDF2 310k iterasyon eski bilgisayarlarda 1-2 saniye surer. Normal.

### Glitch import hatasi
- Branch sorunu ihtimali yuksek. main branch olusturup oradan import et.
