// backup.js — 备份与恢复（.lvpack 压缩包 / 自包含 HTML 快照）
'use strict';

var BACKUP = (function () {

  var META_KEYS = ['profile', 'passSalt', 'passVerifier', 'settings', 'mindToday', 'mindSeen'];

  // ---------- 导出 .lvpack ----------
  async function exportPack() {
    var data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      meta: {},
      images: [],
      wishes: await DB.getWishes(),
      rewards: await DB.getRewards(),
      journal: await DB.getJournals(),
      customMind: await DB.getCustomMind()
    };
    for (var i = 0; i < META_KEYS.length; i++) {
      data.meta[META_KEYS[i]] = await DB.metaGet(META_KEYS[i]);
    }

    var files = [];
    var allImages = await DB.getImages();
    for (var j = 0; j < allImages.length; j++) {
      var img = allImages[j];
      var blob = await DB.loadImageBlob(img.ref);
      if (!blob) continue;
      var rec = Object.assign({}, img);
      delete rec.ref;
      data.images.push(rec);
      files.push({ name: 'images/' + img.id + '.img', data: blob });
    }
    files.push({ name: 'data.json', data: JSON.stringify(data) });
    var zip = await zipWriter(files);
    var name = 'lifecanvas-' + todayStr().replace(/-/g, '') + '.lvpack';
    return { name: name, blob: zip };
  }

  // ---------- 从 .lvpack 恢复 ----------
  async function restorePack(blob) {
    var entries = await zipReader(blob);
    var dj = entries['data.json'];
    if (!dj) throw new Error('备份包内缺少 data.json');
    var data = JSON.parse(await dj.text());
    if (data.version !== 1) throw new Error('不支持的备份版本: ' + data.version);

    await DB.clearAll();

    // meta
    for (var k in data.meta) {
      if (data.meta[k] !== undefined) await DB.metaSet(k, data.meta[k]);
    }
    // images
    for (var i = 0; i < data.images.length; i++) {
      var rec = data.images[i];
      var imgBlob = entries['images/' + rec.id + '.img'];
      if (!imgBlob) continue;
      var ref = await DB.saveImageBlob(imgBlob);
      await DB.putImageRecord(Object.assign({}, rec, { ref: ref }));
    }
    // wishes
    for (var w = 0; w < data.wishes.length; w++) await DB.updateWish(data.wishes[w]);
    // rewards
    for (var r = 0; r < data.rewards.length; r++) await DB.addReward(data.rewards[r]);
    // journal
    for (var j = 0; j < data.journal.length; j++) await DB.saveJournal(data.journal[j]);
    // custom mind
    for (var m = 0; m < data.customMind.length; m++) await DB.addCustomMind(data.customMind[m]);
  }

  // ---------- 自包含 HTML 快照（任何浏览器离线可读） ----------
  async function exportSnapshot() {
    var profile = (await DB.metaGet('profile')) || {};
    var allImages = await DB.getImages();
    var identity = allImages.filter(function (i) { return i.kind === 'identity'; });
    var scenes = allImages.filter(function (i) { return i.kind === 'scene'; });
    var refs = allImages.filter(function (i) { return i.kind === 'photo' || i.kind === 'model'; });
    var wishes = await DB.getWishes();
    var journals = await DB.getJournals();

    async function rowHtml(img, extra) {
      var blob = await DB.loadImageBlob(img.ref);
      var src = blob ? await blobToDataURL(blob) : '';
      var cap = img.caption ? '<p class="cap">' + esc(img.caption) + '</p>' : '';
      var tag = extra || '';
      return '<figure>' + (src ? '<img src="' + src + '" alt="">' : '') + tag + cap + '</figure>';
    }

    var h = [];
    h.push('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">');
    h.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
    h.push('<title>人生目标具象画 · 快照 ' + todayStr() + '</title>');
    h.push('<style>body{font-family:Georgia,"Songti SC",serif;background:#f6efe3;color:#3d3a33;max-width:720px;margin:0 auto;padding:24px}h1{font-size:22px}h2{font-size:16px;border-bottom:1px solid #e7ddcc;padding-bottom:6px;margin-top:34px}p{line-height:1.7}figure{margin:12px 0}img{max-width:100%;border-radius:12px}.cap{color:#8a8378;font-size:13px;margin-top:6px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.muted{color:#8a8378}.wish{border-left:3px solid #c47b5a;padding-left:12px;margin:10px 0}.done{opacity:.6;text-decoration:line-through}</style></head><body>');
    h.push('<h1>人生目标具象画 · 快照</h1><p class="muted">生成于 ' + todayStr() + ' · 数据来自你的设备，请自行保管</p>');
    h.push('<p class="muted">「人生是一场体验，别忘了在体验中快乐地完成。」</p>');

    if (profile.hair || profile.temperament) {
      h.push('<h2>我的形象卡</h2><p>' + esc(buildIdentityPrompt(profile, '').replace(/\n/g, '<br>')) + '</p>');
    }

    if (identity.length) {
      h.push('<h2>未来形象</h2><div class="grid">');
      for (var i = 0; i < identity.length; i++) h.push(await rowHtml(identity[i], identity[i].isMain ? '<p class="muted">★ 每日主形象</p>' : ''));
      h.push('</div>');
    }

    if (refs.length) {
      h.push('<h2>真实照片与榜样参考</h2><div class="grid">');
      for (var r = 0; r < refs.length; r++) h.push(await rowHtml(refs[r], ''));
      h.push('</div>');
    }

    if (scenes.length) {
      h.push('<h2>愿景场景</h2><div class="grid">');
      for (var s = 0; s < scenes.length; s++) h.push(await rowHtml(scenes[s], ''));
      h.push('</div>');
    }

    if (wishes.length) {
      h.push('<h2>愿望清单</h2>');
      for (var w = 0; w < wishes.length; w++) {
        var wish = wishes[w];
        var txt = typeof wish.text === 'string' ? wish.text : (wish.text && wish.text.e ? '（已加密，解锁后可见）' : '');
        h.push('<div class="wish ' + (wish.done ? 'done' : '') + '">' + esc(txt) +
          (wish.done ? ' <span class="muted">· 已实现</span>' : '') + '</div>');
      }
    }

    if (journals.length) {
      h.push('<h2>最近的记录</h2>');
      var recent = journals.slice(0, 10);
      for (var j2 = 0; j2 < recent.length; j2++) {
        var jr = recent[j2];
        var body = jr.content;
        if (body && body.e) body = { experience: '（已加密，解锁后可见）', gratitude: [] };
        if (!body) body = {};
        h.push('<p><b>' + esc(fmtDate(jr.date)) + '</b> ' + esc(body.experience || '') + '</p>');
      }
    }

    h.push('<p class="muted" style="margin-top:40px">—— 人生目标具象画 v0.1 快照，离线可读 ——</p>');
    h.push('</body></html>');
    var name = 'lifecanvas-快照-' + todayStr().replace(/-/g, '') + '.html';
    return { name: name, blob: new Blob([h.join('')], { type: 'text/html;charset=utf-8' }) };
  }

  return {
    exportPack: exportPack,
    restorePack: restorePack,
    exportSnapshot: exportSnapshot
  };
})();
