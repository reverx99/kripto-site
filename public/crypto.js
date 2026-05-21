/*
 * KripoCrypto — Web Crypto API uzerine kurulu hibrit sifreleme katmani.
 *
 * Akis: her mesaj icin rastgele bir AES-GCM-256 anahtari uretilir, mesaj bu
 * anahtarla sifrelenir, ardindan AES anahtari aliciya ait RSA-OAEP-2048 acik
 * anahtariyla sifrelenir. Bu yontem hem hizli (AES) hem de guvenli anahtar
 * paylasimi (RSA) saglar; gercek hayattaki sistemler (PGP, S/MIME, Signal'in
 * eski versiyonlari) ayni mantigi kullanir.
 */
const KripoCrypto = {
  async generateKeyPair() {
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

  async exportPublicKey(key) {
    const spki = await crypto.subtle.exportKey('spki', key);
    return this.bufToBase64(spki);
  },

  async exportPrivateKey(key) {
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', key);
    return this.bufToBase64(pkcs8);
  },

  async importPublicKey(b64) {
    return crypto.subtle.importKey(
      'spki',
      this.base64ToBuf(b64),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
  },

  async importPrivateKey(b64) {
    return crypto.subtle.importKey(
      'pkcs8',
      this.base64ToBuf(b64),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt']
    );
  },

  /**
   * Mesaji aliciya ait acik anahtarla sifrele.
   * Donus: { ciphertext, iv, encryptedKey } — hepsi base64.
   */
  async encryptMessage(plaintext, recipientPublicKeyB64) {
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
    const rsaPubKey = await this.importPublicKey(recipientPublicKeyB64);
    const encryptedKeyBuf = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      rsaPubKey,
      rawAesKey
    );

    return {
      ciphertext: this.bufToBase64(ciphertextBuf),
      iv: this.bufToBase64(iv),
      encryptedKey: this.bufToBase64(encryptedKeyBuf),
    };
  },

  /**
   * Sifreli paketi (ciphertext+iv+encryptedKey) kendi ozel anahtarinla coz.
   */
  async decryptMessage(payload, privateKeyB64) {
    const rsaPrivKey = await this.importPrivateKey(privateKeyB64);
    const rawAesKey = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      rsaPrivKey,
      this.base64ToBuf(payload.encryptedKey)
    );
    const aesKey = await crypto.subtle.importKey(
      'raw',
      rawAesKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const plaintextBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.base64ToBuf(payload.iv) },
      aesKey,
      this.base64ToBuf(payload.ciphertext)
    );
    return new TextDecoder().decode(plaintextBuf);
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
