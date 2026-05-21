/*
 * KripoCrypto — Web Crypto API uzerine kurulu uctan uca sifreleme katmani.
 *
 * Algoritmalar
 * ------------
 *  - RSA-OAEP-2048 / SHA-256 : Anahtar paylasimi (AES anahtarini sarmak)
 *  - RSA-PSS-2048   / SHA-256 : Mesaj imzalama (gondericiyi dogrulama)
 *  - AES-GCM-256    / IV 96b  : Asil mesaj sifrelemesi (gizlilik + butunluk)
 *  - PBKDF2 / SHA-256 / 310k  : Sifreden anahtar uretme (ozel anahtari sarmak)
 *
 * Akis (genel)
 * ------------
 *  Kayit aninda iki RSA cifti uretilir: biri sifreleme, biri imzalama. Her iki
 *  ozel anahtar, kullanicinin sifresinden PBKDF2 ile turetilen AES anahtariyla
 *  sarilir ve sunucuya **sarili halde** yuklenir. Sunucu plaintext ozel anahtari
 *  hicbir zaman gormez; ancak dogru sifreyi bilen kullanici sarmayi acabilir.
 */
const KripoCrypto = {
  // ------------ Anahtar uretimi ------------

  generateEncryptionKeyPair() {
    return crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt']
    );
  },

  generateSigningKeyPair() {
    return crypto.subtle.generateKey(
      {
        name: 'RSA-PSS',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
  },

  // ------------ Anahtar import/export ------------

  async exportSpki(key) {
    return this.bufToBase64(await crypto.subtle.exportKey('spki', key));
  },

  async importEncryptionPublicKey(b64) {
    return crypto.subtle.importKey(
      'spki',
      this.base64ToBuf(b64),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
  },

  async importSigningPublicKey(b64) {
    return crypto.subtle.importKey(
      'spki',
      this.base64ToBuf(b64),
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['verify']
    );
  },

  async importEncryptionPrivateKey(b64) {
    return crypto.subtle.importKey(
      'pkcs8',
      this.base64ToBuf(b64),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt']
    );
  },

  async importSigningPrivateKey(b64) {
    return crypto.subtle.importKey(
      'pkcs8',
      this.base64ToBuf(b64),
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['sign']
    );
  },

  // ------------ Sifreden anahtar uretme (PBKDF2) ------------

  /**
   * Kullanici sifresinden, sarmak/cozmek icin kullanilacak AES-GCM-256
   * anahtarini turet. Iterasyon sayisi OWASP 2023 tavsiyesi (>= 310,000).
   */
  async deriveWrappingKey(password, saltB64) {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: this.base64ToBuf(saltB64),
        iterations: 310000,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },

  /**
   * RSA ozel anahtarini PKCS8 olarak disa aktar, ardindan AES-GCM ile sar.
   */
  async wrapPrivateKey(privateKey, wrappingKey) {
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      wrappingKey,
      pkcs8
    );
    return {
      wrapped: this.bufToBase64(wrapped),
      iv: this.bufToBase64(iv),
    };
  },

  /**
   * Sarili ozel anahtari coz. Sifre yanlissa AES-GCM butunluk kontrolu
   * exception firlatir.
   */
  async unwrapPrivateKey(wrappedB64, ivB64, wrappingKey) {
    const pkcs8 = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.base64ToBuf(ivB64) },
      wrappingKey,
      this.base64ToBuf(wrappedB64)
    );
    return this.bufToBase64(pkcs8);
  },

  // ------------ Mesaj sifreleme / cozme ------------

  /**
   * Mesaji aliciya ait acik anahtarla sifrele ve gondericinin imzasiyla
   * imzala.
   *
   * @param plaintext             {string}
   * @param recipientEncPubB64    {string} Alicinin RSA-OAEP acik anahtari
   * @param senderSignPrivB64     {string} Gondericinin RSA-PSS ozel anahtari
   * @param sender                {string} Gonderici kullanici adi
   * @param recipient             {string} Alici kullanici adi
   * @returns { ciphertext, iv, encryptedKey, signature, signedAt }
   */
  async encryptAndSign(plaintext, recipientEncPubB64, senderSignPrivB64, sender, recipient) {
    const aesKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertextBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      new TextEncoder().encode(plaintext)
    );

    const rawAesKey = await crypto.subtle.exportKey('raw', aesKey);
    const recipientPub = await this.importEncryptionPublicKey(recipientEncPubB64);
    const encryptedKeyBuf = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      recipientPub,
      rawAesKey
    );

    const ciphertextB64 = this.bufToBase64(ciphertextBuf);
    const ivB64 = this.bufToBase64(iv);
    const encryptedKeyB64 = this.bufToBase64(encryptedKeyBuf);
    const signedAt = Date.now();

    // Imzayi paketin BUTUN ana alanlari uzerine at — alici tek bir alan bile
    // degisirse imzayi dogrulayamasin.
    const signingPayload = `${sender}|${recipient}|${signedAt}|${ivB64}|${encryptedKeyB64}|${ciphertextB64}`;
    const signingKey = await this.importSigningPrivateKey(senderSignPrivB64);
    const signatureBuf = await crypto.subtle.sign(
      { name: 'RSA-PSS', saltLength: 32 },
      signingKey,
      new TextEncoder().encode(signingPayload)
    );

    return {
      ciphertext: ciphertextB64,
      iv: ivB64,
      encryptedKey: encryptedKeyB64,
      signature: this.bufToBase64(signatureBuf),
      signedAt,
    };
  },

  /**
   * Gelen mesajin imzasini dogrula, ardindan ozel anahtarla coz.
   *
   * @returns { plaintext, verified, verifyError? }
   */
  async verifyAndDecrypt(message, recipientEncPrivB64, senderSignPubB64) {
    const signingPayload = `${message.sender}|${message.recipient}|${message.signedAt}|${message.iv}|${message.encryptedKey}|${message.ciphertext}`;
    let verified = false;
    let verifyError = null;
    try {
      const sigPubKey = await this.importSigningPublicKey(senderSignPubB64);
      verified = await crypto.subtle.verify(
        { name: 'RSA-PSS', saltLength: 32 },
        sigPubKey,
        this.base64ToBuf(message.signature),
        new TextEncoder().encode(signingPayload)
      );
    } catch (e) {
      verifyError = e.message;
    }

    const privKey = await this.importEncryptionPrivateKey(recipientEncPrivB64);
    const rawAesKey = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privKey,
      this.base64ToBuf(message.encryptedKey)
    );
    const aesKey = await crypto.subtle.importKey(
      'raw',
      rawAesKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const plaintextBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.base64ToBuf(message.iv) },
      aesKey,
      this.base64ToBuf(message.ciphertext)
    );

    return {
      plaintext: new TextDecoder().decode(plaintextBuf),
      verified,
      verifyError,
    };
  },

  // ------------ Yardimcilar ------------

  randomSaltB64(bytes = 16) {
    const salt = crypto.getRandomValues(new Uint8Array(bytes));
    return this.bufToBase64(salt);
  },

  bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  },

  base64ToBuf(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  },
};
