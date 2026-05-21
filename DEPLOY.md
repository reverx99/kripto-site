# Deploy Rehberi

Site su anda canli: **https://kripto-site.onrender.com/**

Bu dosya hem nasil deploy ettigimizi belgeler (hoca bakar) hem de demo
gunu icin pratik talimatlari icerir.

---

## 1. Mevcut deploy

- **Host**: Render.com (ucretsiz tier, kredi karti istenmedi)
- **Region**: Frankfurt (EU Central)
- **Runtime**: Docker (multi-stage build)
- **URL**: https://kripto-site.onrender.com/
- **Repo**: https://github.com/reverx99/kripto-site (branch `main`)
- **Otomatik deploy**: `main`'e push → Render otomatik build & deploy

---

## 2. Yeniden deploy etmek istersen

Render hesabini biz kurduk, kod main'e push edildiginde otomatik
yeniden deploy olur. Sifirdan kurmak istersen:

### Adim 1 — Hesap
1. https://render.com → **Get Started** → **Sign in with GitHub**
2. Repo'ya erisim ver (sadece `kripto-site` icin yetki vermen yeter).

### Adim 2 — Servis olustur
1. Dashboard'da sag ust **+ New** → **Web Service**
2. `reverx99/kripto-site`'i sec → **Connect**
3. Formu doldur:
   - **Name**: `kripto-site`
   - **Region**: Frankfurt (EU Central)
   - **Branch**: `main`
   - **Language**: Docker (otomatik secilir, Dockerfile var)
   - **Instance Type**: **Free**
4. Environment Variables ekle:
   - `NODE_ENV` = `production`
5. **Advanced** → Health Check Path: `/api/health`
6. **Deploy Web Service**

Build ~5 dakika surer (Docker multi-stage). Logs sekmesinde
`[production] Kripto site http://localhost:10000 adresinde calisiyor`
satirini gorunce hazirdir.

---

## 3. Render Free Tier — bilmen gereken davranislar

| Durum | Etkisi |
|---|---|
| **15 dk inaktif** | Servis uyur (spin-down) |
| **Uyuduktan sonra ilk istek** | ~30-50 sn cold start (container baslar) |
| **Kalici disk YOK** | Her restart'ta SQLite DB resetlenir, kullanicilar silinir |
| **750 saat/ay** | Tek servis icin pratik olarak limitsiz |
| **90 gun hicbir trafik gelmezse** | Render servisi suspend edebilir |
| **HTTPS** | Otomatik, ucretsiz, yenilenmesi Render'da |
| **Bandwidth** | 100 GB/ay (okul projesi icin asilamaz) |

### Onemli: DB her uyandirmada bostur

Free tier'da `/data` kalici degil. Yani uzun bir aradan sonra ziyarette
alice/bob yeniden kayit edilmeli. Bu *demo icin sorun degil* — hocaya
canli kayit gosterirsin, "bakin sunucuda hicbir kullanici yokken
basliyoruz" diyebilirsin.

---

## 4. Demo gunu icin checklist

### Demo'dan 5 dakika once
1. `https://kripto-site.onrender.com/` adresini ac.
2. Cold start uyumussa ~30 saniye bekle, ana sayfa acilana kadar.
3. **Normal pencere** → Kayit ol: `alice` / `gizli12345`
4. **Gizli pencere** → Kayit ol: `bob` / `gizli67890`
5. Alice'ten bob'a "test" yaz, geldigini gor.

### Hocaya gosterirken
- Iki pencereyi yan yana ac (Alice solda, Bob sagda).
- Alice mesaj yazar → Bob ekraninda **dakikalar icinde** otomatik
  gorunur (polling 2 sn'de bir).
- Bob mesajda **yesil ✅ imza** isaretini goster — "alice'ten geldigi
  kanitlanmis" demek.
- **"Sifreli icerigi goster"** kutusunu acin → ayni mesajin
  ciphertext + imza hali gozukur. Hocaya bunu vurgula:
  > "Sunucuya bu Base64 cop gidiyor. Veritabaninda da bu var. Acik
  > metin sunucunun hicbir yerinde yok."

### Hoca soracak olursa
- "Sifre nereye kayitli?" → Sunucuda bcrypt hash (cost 12).
  `/api/login` route'unda goruluyor.
- "Ozel anahtar nerede?" → Tarayicida, sifreyle sarili halde sunucuda
  da var (PBKDF2 ile turetilen anahtarla AES-GCM ile). Sifresiz
  acilamaz.
- "Sunucu mesaji okuyabilir mi?" → Hayir. Sifreleme ve cozme istemci
  tarafinda. Sunucu sadece sifreli paket gorur.
- "TLS var mi?" → Evet, Render Let's Encrypt sertifikasi yonetiyor.
  Production'da HTTP istekleri HTTPS'e yonlendiriliyor.

---

## 5. Hocaya teslim paketi

Hocaya su uc seyi yolla:

1. **Canli site**: https://kripto-site.onrender.com/
2. **GitHub repo**: https://github.com/reverx99/kripto-site
3. **Dokumantasyon**: `DOKUMANTASYON.md` (PDF'e cevirip de yollayabilirsin)

### Mail/teslim metni ornegi

> Sayin Hocam,
>
> Kripto dersi projesi olarak uctan uca sifreli mesajlasma sitemi
> hazirladim.
>
> - **Canli URL**: https://kripto-site.onrender.com/
> - **Kaynak kod**: https://github.com/reverx99/kripto-site
> - **Dokumantasyon**: Ekteki DOKUMANTASYON.pdf
>
> **Not**: Site ucretsiz Render.com hosting'inde calisiyor. 15 dakika
> inaktif kalirsa otomatik uykuya geciyor. Ilk acilis ~30 saniye
> surebilir, lutfen bekleyiniz.
>
> Demo icin iki tarayici/pencere acmaniz yeterli. "Kayit ol" ile iki
> kullanici olusturup birbirinize mesaj atabilirsiniz.
>
> Saygilarimla.

---

## 6. Sorun cikarsa

### Site 5 dakikadir acilmiyor
- Render dashboard → kripto-site servisi → **Logs** sekmesine bak.
- En sik: container "Failed to bind port" — PORT environment variable
  ile ilgili. Render kendi atar (10000), server.js `process.env.PORT`'u
  okuyor, sorun olmamali. Hata loglarini paylas.

### Build "exit code 137"
- Free tier RAM yetersizligi. Tekrar dene, build cache devreye girer.

### "Anahtarlar uretiliyor..." cok uzun
- PBKDF2 310.000 iterasyon — eski cihazlarda 1-2 saniye normal.
  Tarayici donmuyorsa bekle.

### Servisi tamamen kapatmak istersen
- Dashboard → kripto-site → Settings → en alt → **Delete Web Service**.
- URL serbest kalir, GitHub repo dokunulmaz.
