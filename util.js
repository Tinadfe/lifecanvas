// util.js — 通用工具 + 极简 ZIP（store 模式，无压缩）
'use strict';

// ---------- DOM ----------
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtDate(s) {
  if (!s) return '';
  var p = String(s).split('-');
  return parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
}
function fmtDateTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function blobToDataURL(blob) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function downloadBlob(name, blob) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}

// ---------- Toast ----------
var toastTimer = null;
function toast(msg, ms) {
  var el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2200);
}

// ---------- 极简 ZIP（store 模式） ----------
var CRC_TABLE = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function textBytes(s) { return new TextEncoder().encode(s); }
function concatBytes(arrs) {
  var total = 0, i;
  for (i = 0; i < arrs.length; i++) total += arrs[i].length;
  var out = new Uint8Array(total);
  var o = 0;
  for (i = 0; i < arrs.length; i++) { out.set(arrs[i], o); o += arrs[i].length; }
  return out;
}

// files: [{name: string, data: Uint8Array|Blob|string}]
async function zipWriter(files) {
  var parts = [], central = [], offset = 0, i;
  for (i = 0; i < files.length; i++) {
    var f = files[i];
    var bytes;
    if (typeof f.data === 'string') bytes = textBytes(f.data);
    else if (f.data instanceof Uint8Array) bytes = f.data;
    else bytes = new Uint8Array(await f.data.arrayBuffer());
    var nameB = textBytes(f.name);
    var crc = crc32(bytes);
    var sz = bytes.length;

    var lh = new Uint8Array(30 + nameB.length);
    var dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);       // version needed
    dv.setUint16(6, 0x0800, true);   // utf-8 flag
    dv.setUint16(8, 0, true);        // method: store
    dv.setUint32(14, crc, true);
    dv.setUint32(18, sz, true);
    dv.setUint32(22, sz, true);
    dv.setUint16(26, nameB.length, true);
    dv.setUint16(28, 0, true);
    lh.set(nameB, 30);
    parts.push(lh, bytes);

    var ch = new Uint8Array(46 + nameB.length);
    var cd = new DataView(ch.buffer);
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(18, crc, true);
    cd.setUint32(22, sz, true);
    cd.setUint32(26, sz, true);
    cd.setUint16(30, nameB.length, true);
    cd.setUint32(42, offset, true);
    ch.set(nameB, 46);
    central.push(ch);
    offset += lh.length + sz;
  }
  var cdStart = offset;
  var centralBytes = concatBytes(central);
  var eocd = new Uint8Array(22);
  var ed = new DataView(eocd.buffer);
  ed.setUint32(0, 0x06054b50, true);
  ed.setUint16(8, files.length, true);
  ed.setUint16(10, files.length, true);
  ed.setUint32(12, centralBytes.length, true);
  ed.setUint32(16, cdStart, true);
  parts.push(centralBytes, eocd);
  return new Blob(parts, { type: 'application/zip' });
}

// 解析 ZIP（仅 store 模式），返回 {name: Blob}
async function zipReader(blob) {
  var buf = new Uint8Array(await blob.arrayBuffer());
  var eocd = -1;
  for (var i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 .lvpack 备份文件');
  var dv = new DataView(buf.buffer);
  var count = dv.getUint16(eocd + 10, true);
  var cdStart = dv.getUint32(eocd + 16, true);
  var entries = {};
  var p = cdStart;
  for (var n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    var nameLen = dv.getUint16(p + 30, true);
    var extraLen = dv.getUint16(p + 32, true);
    var commentLen = dv.getUint16(p + 34, true);
    var compSize = dv.getUint32(p + 22, true);
    var localOffset = dv.getUint32(p + 42, true);
    var name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    var lNameLen = dv.getUint16(localOffset + 26, true);
    var lExtraLen = dv.getUint16(localOffset + 28, true);
    var dataStart = localOffset + 30 + lNameLen + lExtraLen;
    entries[name] = new Blob([buf.slice(dataStart, dataStart + compSize)]);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Node 冒烟测试导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { zipWriter: zipWriter, zipReader: zipReader, crc32: crc32, uid: uid, todayStr: todayStr };
}
