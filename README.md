# Kripto Mesaj

Uctan uca sifreli (E2EE) iki kisilik mesajlasma sitesi — okul projesi.

## Ozellikler

- **Hibrit sifreleme**: RSA-OAEP-2048 + AES-GCM-256 (her mesaj icin yeni AES anahtari)
- **Mesaj imzalama**: RSA-PSS-2048 — alici gondericinin kimliginden emin olur
- **Sifre korumali ozel anahtar**: PBKDF2-SHA-256 (310k iter) + AES-GCM ile sarili
- **Sertlestirilmis sunucu**: helmet (CSP/HSTS), rate-limit, bcrypt cost 12,
  sabit-zamanli login, oturum suresi, HTTPS yonlendirme
- **Sifreli icerik gosterme modu**: hocaya canli demo icin sunucuya giden
  ciphertext'i toggle ile gosterir
- **Production-ready**: Docker, Render, Fly.io deploy config'leri hazir

## Hizli baslangic

```bash
npm install
npm start
```

Tarayicidan `http://localhost:3000` ac.

## Iki kisilik demo

1. Normal pencerede **Kayit ol** → `alice` / `gizli12345`
2. Gizli pencerede **Kayit ol** → `bob` / `gizli67890`
3. Alice ekraninda `bob`'u sec, mesaj yaz.
4. Bob ekraninda `alice`'i sec, mesaj cozulmus halde gelir.
5. **"Sifreli icerigi goster"** kutusunu isaretle → sunucuya giden ciphertext + imza gorulur.

## Production deploy

### Render.com (en kolay)
1. Repoyu GitHub'a push et
2. https://render.com → New Web Service → repo'yu sec
3. `render.yaml` otomatik bulunur, **Apply**

### Fly.io (kalici veri)
```bash
flyctl launch --copy-config --no-deploy
flyctl volumes create data --size 1 --region fra
flyctl deploy
```

### Docker
```bash
docker build -t kripto-site .
docker run -p 80:3000 -v $(pwd)/data:/data -e NODE_ENV=production kripto-site
```

## Detayli aciklama

Mimari, sifreleme algoritmalari, kod akisi, guvenlik onlemleri ve deployment
icin [`DOKUMANTASYON.md`](./DOKUMANTASYON.md) dosyasina bak.

## Lisans

Okul projesi — istedigin gibi kullan.
