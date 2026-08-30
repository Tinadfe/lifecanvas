// crypto.js — 口令加密（WebCrypto AES-GCM + PBKDF2，密钥永不出设备）
'use strict';

var CRYPTO = (function () {
  var subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  var enc = new TextEncoder();
  var dec = new TextDecoder();
  var VERIFY_TEXT = 'lifecanvas-verify';

  function supported() { return !!subtle; }

  function toB64(buf) {
    var u = new Uint8Array(buf);
    var bin = '';
    for (var i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    return btoa(bin);
  }
  function fromB64(s) {
    var bin = atob(s);
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function randBytes(n) {
    var u = new Uint8Array(n);
    crypto.getRandomValues(u);
    return u;
  }

  async function deriveKey(pass, saltB64) {
    var salt = fromB64(saltB64);
    var km = await subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
      km,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encrypt(key, plain) {
    var iv = randBytes(12);
    var ct = await subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(plain));
    return toB64(iv) + '.' + toB64(ct);
  }

  async function decrypt(key, token) {
    var parts = String(token).split('.');
    var iv = fromB64(parts[0]);
    var ct = fromB64(parts[1]);
    var pt = await subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    return dec.decode(pt);
  }

  async function encPayload(key, obj) { return encrypt(key, JSON.stringify(obj)); }
  async function decPayload(key, token) { return JSON.parse(await decrypt(key, token)); }

  async function makeVerifier(key) { return encrypt(key, VERIFY_TEXT); }
  async function checkVerifier(key, token) {
    try { return (await decrypt(key, token)) === VERIFY_TEXT; } catch (e) { return false; }
  }

  return {
    supported: supported,
    deriveKey: deriveKey,
    encrypt: encrypt,
    decrypt: decrypt,
    encPayload: encPayload,
    decPayload: decPayload,
    makeVerifier: makeVerifier,
    checkVerifier: checkVerifier,
    randBytes: randBytes,
    toB64: toB64,
    fromB64: fromB64
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = CRYPTO; }
