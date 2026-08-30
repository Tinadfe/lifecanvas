// tools/smoke.cjs — 冒烟测试：ZIP 打包/解包 + 口令加密/解密（Node 环境）
'use strict';
const assert = require('node:assert');
const { zipWriter, zipReader } = require('../js/util.js');
const CRYPTO = require('../js/crypto.js');

(async () => {
  // ---- ZIP 往返 ----
  const text = '人生目标具象画，离线可用，数据只在本机 🎨';
  const bin = new Uint8Array([0, 1, 2, 3, 255, 254, 128, 7]);
  const blob1 = new Blob([new TextEncoder().encode(text)]);
  const blob2 = new Blob([bin]);
  const zip = await zipWriter([
    { name: 'data.json', data: JSON.stringify({ a: 1, s: text }) },
    { name: 'images/x.img', data: blob1 },
    { name: 'images/y.img', data: blob2 }
  ]);
  const entries = await zipReader(zip);
  assert.ok(entries['data.json'], 'data.json 缺失');
  assert.deepStrictEqual(JSON.parse(await entries['data.json'].text()), { a: 1, s: text }, 'data.json 内容不符');
  assert.strictEqual(await entries['images/x.img'].text(), text, '文本图片内容不符');
  const y = new Uint8Array(await entries['images/y.img'].arrayBuffer());
  assert.deepStrictEqual(Array.from(y), Array.from(bin), '二进制图片内容不符');
  console.log('✓ ZIP 打包/解包 往返一致');

  // ---- 加密往返 ----
  assert.ok(CRYPTO.supported(), 'WebCrypto 不可用');
  const salt = CRYPTO.toB64(CRYPTO.randBytes(16));
  const key = await CRYPTO.deriveKey('我的口令123', salt);
  const verifier = await CRYPTO.makeVerifier(key);
  assert.ok(await CRYPTO.checkVerifier(key, verifier), '口令验证失败');
  const bad = await CRYPTO.deriveKey('错误口令', salt);
  assert.ok(!(await CRYPTO.checkVerifier(bad, verifier)), '错误口令不应通过');
  const token = await CRYPTO.encPayload(key, { t: '愿望：和家人在海边看一次日出', f: '温暖' });
  const back = await CRYPTO.decPayload(key, token);
  assert.strictEqual(back.t, '愿望：和家人在海边看一次日出');
  assert.strictEqual(back.f, '温暖');
  assert.notStrictEqual(token, JSON.stringify({ t: '愿望：和家人在海边看一次日出', f: '温暖' }), '密文不应等于明文');
  console.log('✓ AES-GCM + PBKDF2 加密/解密 往返一致，密文非明文');

  // ---- 提示词模板 ----
  const { buildIdentityPrompt, PROFILE_FIELDS } = require('../js/data.js');
  const p = { hair: '利落齐肩短发', manner: '端庄、从容', temperament: '知性', outfit: '米色亚麻衬衫', ageFeel: '五年后', accessory: '细金链' };
  const prompt = buildIdentityPrompt(p, '清晨窗边的书桌');
  assert.ok(prompt.includes('[人物]') && prompt.includes('利落齐肩短发') && prompt.includes('清晨窗边的书桌'));
  console.log('✓ 提示词模板正常\n\n全部冒烟测试通过 ✅');
})().catch((e) => { console.error('冒烟测试失败:', e); process.exit(1); });
