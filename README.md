# Kripto Mesaj

Uctan uca sifreli (E2EE) iki kisilik mesajlasma sitesi — okul projesi.

## Hizli baslangic

```bash
npm install
npm start
```

Sonra tarayicidan `http://localhost:3000` adresine git.

## Iki kisilik demo (ayni bilgisayar)

1. Tarayicida iki farkli pencere ac (normal pencere + gizli pencere — boylece her ikisinin localStorage'i ayri olur).
2. Birincisinde "Kayit ol" → `alice` / `1234`.
3. Ikincisinde "Kayit ol" → `bob` / `1234`.
4. Alice'in penceresinde sol listede `bob`'u sec, mesaj yaz.
5. Bob'un penceresinde sol listede `alice`'i sec — mesaj cozulmus olarak gelmeli.
6. "Sifreli icerigi goster" kutusunu isaretle → sunucuya giden ham ciphertext'i gor.

## Iki ayri bilgisayardan demo

Sunucuyu bir yere deploy etmen lazim. En kolay yol Render veya Railway.
Detaylar `DOKUMANTASYON.md` icinde.

## Detayli aciklama

Mimari, sifreleme algoritmalari, kod akisi ve guvenlik notlari icin
[`DOKUMANTASYON.md`](./DOKUMANTASYON.md) dosyasina bak.
