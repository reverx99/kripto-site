# Kurulum ve Calistirma Rehberi

Bu paket, **uctan uca sifreli mesajlasma sitesi** (E2EE) okul projesidir.

Iki sekilde inceleyebilirsiniz:

| Yontem | Sure | Aciklama |
|---|---|---|
| **A) Canli site** | 30 sn | Hicbir kurulum gerekmez, tarayicidan acin |
| **B) Lokal calistirma** | ~5 dk | Node.js yukleyip kendi makinenizde calistirin |

---

## A) Canli site (onerilen)

Site su anda yayinda:

### **https://kripto-site.onrender.com/**

Tarayicidan bu URL'i acmaniz yeterli.

> ⚠️ **Onemli**: Site ucretsiz Render.com hosting'inde calisiyor.
> 15 dakika kullanilmazsa otomatik uyku moduna geciyor. Eger sayfa
> hemen acilmazsa **~30 saniye bekleyin** (uyandirma suresi).
> Acildiktan sonra normal hizda calisir.

### Test demosu (2 dakika)

1. Iki farkli tarayici acin (veya bir normal + bir gizli pencere)
2. Birinde: **Kayit ol** → kullanici adi `alice`, sifre `gizli12345`
3. Digerinde: **Kayit ol** → kullanici adi `bob`, sifre `gizli67890`
4. Alice ekranindan `bob`'u secin, bir mesaj yazip gonderin.
5. Bob ekranindan `alice`'i secin, mesaj otomatik gelir.
6. Bob ekraninda **"Sifreli icerigi goster"** kutusunu acin → sunucuya
   giden ham (Base64) sifreli halini gorursunuz. Bu, sunucunun mesaj
   icerigine erisemedigini gosterir.

---

## B) Lokal calistirma

Eger sistemi kendi bilgisayarinizda incelemek isterseniz:

### Gereksinimler

- **Node.js 18 veya ustu** — https://nodejs.org/ adresinden indirip kurun
  - Kurulu olup olmadigini kontrol etmek icin terminale: `node --version`

### Adim adim

1. **Bu zip'i bos bir klasore acin** (orn. `kripto-site/` adi altinda)

2. **Terminal/Komut Istemcisi acin** ve klasore girin:
   ```bash
   cd /yol/kripto-site
   ```
   *(Windows'ta cmd veya PowerShell; macOS/Linux'ta Terminal)*

3. **Bagimliliklari yukleyin** (ilk seferde ~1 dakika surer):
   ```bash
   npm install
   ```

4. **Sunucuyu baslatin**:
   ```bash
   npm start
   ```
   Asagidaki gibi bir cikti gormelisiniz:
   ```
   [development] Kripto site http://localhost:3000 adresinde calisiyor
   ```

5. **Tarayicidan acin**:
   - http://localhost:3000

6. **Test edin**: Yukaridaki "Test demosu" adimlarinin aynisi.

### Durdurmak icin
Terminal'de **Ctrl+C** basin.

### Veritabani dosyasi
Calistirmaya basladiginizda klasor icinde `kripto.db` dosyasi olusur.
Bu, kayitli kullanicilar ve sifreli mesajlari tutar. Silersek temiz
bir baslangic yapilir.

---

## Sorun cikarsa

### "node: command not found"
Node.js kurulu degil. https://nodejs.org/'dan **LTS** versiyonu indirip
kurun, terminali kapatip yeniden acin, sonra `node --version` ile
dogrulayin.

### "npm install" hatasi
- Internet baglantinizi kontrol edin (npm paketleri internetten indirilir).
- `npm cache clean --force` deneyin, sonra tekrar `npm install`.

### Port 3000 zaten kullanimda
Baska bir port deneyebilirsiniz:
```bash
PORT=4000 npm start
```
Sonra `http://localhost:4000` adresini acin.

### "Anahtarlar uretiliyor..." cok uzun surdu
Tarayici PBKDF2 ile 310.000 iterasyon hesapliyor. Eski cihazlarda
1-2 saniye normaldir. Daha uzun surduyse tarayicinizi guncelleyin.

---

## Proje hakkinda detayli bilgi

- **README.md** — Genel ozet
- **DOKUMANTASYON.md** — Tum teknik detay (sifreleme algoritmalari,
  mimari, kod akisi, guvenlik onlemleri). PDF hali de pakette mevcut:
  `DOKUMANTASYON.pdf`.
- **DEPLOY.md** — Render.com'a nasil deploy edildigi

## Kaynak kod

GitHub repo: https://github.com/reverx99/kripto-site

---

## Iletisim

Sorulariniz veya geri bildirimleriniz icin:
projeyi teslim eden ogrencinin iletisim bilgileri uzerinden ulasabilirsiniz.
