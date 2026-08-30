// app.js — 人生目标具象画 v0.1 主逻辑
'use strict';

// ===== 状态 =====
var S = {
  profile: {},
  key: null,
  locked: false,
  tab: 'home',
  sceneFilter: 'all',
  wishFilter: 'all',
  journalDraft: { mood: 0, imageRef: null },
  rewardDraft: null
};

// ===== 初始化 =====
async function init() {
  await DB.open();
  S.profile = (await DB.metaGet('profile')) || {};
  var salt = await DB.metaGet('passSalt');
  S.locked = !!salt;
  if (S.locked) showLock();
  bindEvents();
  await renderHome();
  switchTab('home');
  registerSW();
}

function registerSW() {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
}

// ===== 视图切换 =====
function switchTab(tab) {
  S.tab = tab;
  $$('.view').forEach(function (v) { v.classList.remove('active'); });
  $$('#tabbar button').forEach(function (b) { b.classList.toggle('on', b.dataset.nav === tab); });
  var view = document.getElementById('view-' + tab);
  if (view) view.classList.add('active');
  if (tab === 'home') renderHome();
  else if (tab === 'identity') renderIdentity();
  else if (tab === 'vision') renderVision();
  else if (tab === 'mind') renderMind();
  else if (tab === 'wish') renderWish();
  else if (tab === 'record') renderRecord();
  else if (tab === 'settings') renderSettings();
}

// ===== 首页 =====
async function renderHome() {
  // 主形象
  var main = await DB.getMainImage('identity');
  var hero = document.getElementById('homeMainImg');
  var info = document.getElementById('homeMainInfo');
  if (main) {
    var blob = await DB.loadImageBlob(main.ref);
    if (blob) {
      var src = await blobToDataURL(blob);
      hero.innerHTML = '<img src="' + src + '" alt="未来形象">';
    } else {
      hero.innerHTML = '<span class="ph">未来形象</span>';
    }
    info.textContent = main.caption ? '『' + main.caption + '』' : '';
  } else {
    hero.innerHTML = '<span class="ph">未来形象将显示在这里<br>（去「形象」页创建）</span>';
    info.textContent = '';
  }

  // 今日正念
  var mind = await getTodayMind();
  document.getElementById('homeMindText').textContent = mind.text;
  document.getElementById('homeMindMoment').textContent = MIND_MOMENTS[mind.moment] || mind.moment;

  // 进度
  var scenes = (await DB.getImages('scene')).length;
  var doneWishes = (await decWishes(await DB.getWishes())).filter(function (w) { return w.done; }).length;
  var rewards = (await DB.getRewards()).length;
  var journals = await DB.getJournals();
  var streak = calcStreak(journals.map(function (j) { return j.date; }));
  document.getElementById('homeStats').innerHTML =
    statBox(scenes, '愿景场景') + statBox(doneWishes, '愿望实现') + statBox(rewards, '奖励打卡') + statBox(streak, '连续记录天');

  // 愿望回看
  var wishCard = document.getElementById('homeWishCard');
  var wishList = document.getElementById('homeWishList');
  var countEl = document.getElementById('wishReviewCount');
  if (S.locked) {
    wishCard.classList.add('hidden');
    return;
  }
  wishCard.classList.remove('hidden');
  var wishes = await decWishes(await DB.getWishes());
  var pending = wishes.filter(function (w) { return !w.done && !w.archived; });
  var toReview = pending.filter(function (w) { return (w.reviewDates || []).indexOf(todayStr()) < 0; });
  var reviewed = pending.length - toReview.length;
  countEl.textContent = '今日已默念 ' + reviewed + ' / ' + pending.length;
  var html = '';
  if (!toReview.length) {
    html = '<p class="muted">今天没有待回看的愿望，真棒！</p>';
  } else {
    toReview.slice(0, 5).forEach(function (w) {
      var typeLabel = WISH_TYPES.filter(function (t) { return t.key === w.type; })[0];
      html += '<div class="wish-review-item">' +
        '<input type="checkbox" data-review-wish="' + w.id + '">' +
        '<div><div>' + esc(w.text) + '</div><div class="muted">' + (typeLabel ? typeLabel.label : '') + '</div></div>' +
        '</div>';
    });
  }
  wishList.innerHTML = html;
}

function statBox(n, label) {
  return '<div class="stat"><b>' + n + '</b><span>' + label + '</span></div>';
}

function calcStreak(dates) {
  var set = {};
  dates.forEach(function (d) { set[d] = true; });
  function key(dt) {
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  var cur = new Date();
  if (!set[key(cur)]) cur.setDate(cur.getDate() - 1);
  var streak = 0;
  while (set[key(cur)]) { streak++; cur.setDate(cur.getDate() - 1); }
  return streak;
}

// ===== 今日正念选择 =====
async function getTodayMind(force) {
  var saved = await DB.metaGet('mindToday');
  var today = todayStr();
  if (saved && saved.date === today && !force) return saved;
  var custom = await DB.getCustomMind();
  var pool = DEFAULT_MIND.concat(custom.map(function (c) { return { moment: c.moment, text: c.text }; }));
  var pick = pool[Math.floor(Math.random() * pool.length)];
  if (saved && saved.text === pick.text && pool.length > 1) {
    var others = pool.filter(function (p) { return p.text !== saved.text; });
    pick = others[Math.floor(Math.random() * others.length)];
  }
  var entry = { date: today, moment: pick.moment, text: pick.text };
  await DB.metaSet('mindToday', entry);
  return entry;
}

// ===== 形象页 =====
async function renderIdentity() {
  // 表单
  var pf = document.getElementById('profileForm');
  pf.innerHTML = PROFILE_FIELDS.map(function (f) {
    return '<div class="field"><label>' + esc(f.label) + '</label>' +
      '<input type="text" id="pf-' + f.key + '" value="' + esc(S.profile[f.key] || '') + '" placeholder="' + esc(f.placeholder) + '"></div>';
  }).join('');
  document.getElementById('promptOut').value = buildIdentityPrompt(S.profile, '', S.modelRatio);

  // 真实照片
  renderImgCards(document.getElementById('photoGrid'), await DB.getImages('photo'), {
    buttons: [{ label: '删除', cls: 'del', fn: function (rec) { DB.deleteImage(rec.id).then(function () { renderIdentity(); }); } }]
  });

  // 榜样
  renderImgCards(document.getElementById('modelRow'), (await DB.getImages('model')).slice(0, 1), {
    buttons: [{ label: '删除', cls: 'del', fn: function (rec) { DB.deleteImage(rec.id).then(function () { renderIdentity(); }); } }]
  });
  var settings = (await DB.metaGet('settings')) || {};
  var ratio = settings.modelRatio == null ? 60 : settings.modelRatio;
  S.modelRatio = ratio;
  var ratioInput = document.getElementById('modelRatio');
  ratioInput.value = ratio;
  document.getElementById('modelRatioVal').textContent = '像你 ' + ratio + '% / 像榜样 ' + (100 - ratio) + '%';
  document.getElementById('promptOut').value = buildIdentityPrompt(S.profile, '', S.modelRatio);

  // 生成工坊（形象页）
  var genS = await GEN.loadSettings();
  var genModelSel = document.getElementById('genModel');
  if (genModelSel) {
    var models = genS.apiBase ? GEN.availableModels(genS.apiBase) : GEN.MODELS;
    genModelSel.innerHTML = models.map(function (m) {
      return '<option value="' + m.key + '"' + (genS.model === m.key ? ' selected' : '') + '>' + esc(m.label) + '</option>';
    }).join('');
    var hint = document.getElementById('genHint');
    if (hint) {
      if (!genS.apiKey) hint.textContent = '提示：先在「设置」页配置 API Key（cloud.siliconflow.com 手机号注册即可）';
      else if (genS.apiBase && genS.apiBase.indexOf('.com') >= 0) hint.textContent = '已连接' + GEN.siteLabel(genS.apiBase) + '：Qwen 系列仅国内站(.cn)可用，此处自动只显示 FLUX 系列。';
      else if (genS.apiBase) hint.textContent = '已连接' + GEN.siteLabel(genS.apiBase) + '，可直接生成（生成需联网）。';
      else hint.textContent = '已配置 Key，建议先在「设置」页点「测试连接」确认站点。';
    }
  }

  // 生成的形象图
  renderImgCards(document.getElementById('identityGrid'), await DB.getImages('identity'), {
    ratio: 'portrait',
    buttons: [
      { label: '设为主形象', fn: function (rec) { DB.setMainImage(rec.id, 'identity').then(function () { renderIdentity(); renderHome(); toast('已设为每日主形象'); }); } },
      { label: '删除', cls: 'del', fn: function (rec) { DB.deleteImage(rec.id).then(function () { renderIdentity(); renderHome(); }); } }
    ]
  });
}

async function renderImgCards(container, list, opts) {
  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = '<p class="muted">还没有图片</p>';
    return;
  }
  for (var i = 0; i < list.length; i++) {
    var rec = list[i];
    var card = document.createElement('div');
    card.className = 'img-card' + (rec.isMain ? ' main' : '') + (opts.ratio === 'portrait' ? ' portrait' : '');
    var img = document.createElement('img');
    var blob = await DB.loadImageBlob(rec.ref);
    img.src = blob ? await blobToDataURL(blob) : '';
    card.appendChild(img);
    if (rec.caption) {
      var c = document.createElement('div');
      c.className = 'cap';
      c.textContent = rec.caption;
      card.appendChild(c);
    }
    var acts = document.createElement('div');
    acts.className = 'acts';
    (opts.buttons || []).forEach(function (b) {
      var btn = document.createElement('button');
      btn.textContent = b.label;
      btn.className = b.cls || '';
      btn.onclick = function () { b.fn(rec); };
      acts.appendChild(btn);
    });
    card.appendChild(acts);
    container.appendChild(card);
  }
}

// ===== 愿景页 =====
async function renderVision() {
  var chips = document.getElementById('sceneChips');
  var all = '<button class="' + (S.sceneFilter === 'all' ? 'on' : '') + '" data-scene-filter="all">全部</button>';
  chips.innerHTML = all + SCENE_CATEGORIES.map(function (c) {
    return '<button class="' + (S.sceneFilter === c.key ? 'on' : '') + '" data-scene-filter="' + c.key + '">' + esc(c.label) + '</button>';
  }).join('');
  document.getElementById('sceneCat').innerHTML = SCENE_CATEGORIES.map(function (c) {
    return '<option value="' + c.key + '">' + esc(c.label) + '</option>';
  }).join('');

  var scenes = await DB.getImages('scene');
  var groups = document.getElementById('sceneGroups');
  groups.innerHTML = '';
  var shown = 0;
  for (var i = 0; i < SCENE_CATEGORIES.length; i++) {
    var cat = SCENE_CATEGORIES[i];
    if (S.sceneFilter !== 'all' && S.sceneFilter !== cat.key) continue;
    var list = scenes.filter(function (s) { return (s.meta && s.meta.category) === cat.key; });
    if (!list.length) continue;
    shown++;
    var sec = document.createElement('div');
    sec.className = 'card';
    var h = document.createElement('h3');
    h.textContent = cat.label + '（' + list.length + '）';
    sec.appendChild(h);
    var grid = document.createElement('div');
    grid.className = 'img-grid';
    sec.appendChild(grid);
    groups.appendChild(sec);
    renderImgCards(grid, list, {
      buttons: [{ label: '删除', cls: 'del', fn: function (rec) { DB.deleteImage(rec.id).then(function () { renderVision(); renderHome(); }); } }]
    });
  }
  // 未分类
  var un = scenes.filter(function (s) { return !s.meta || !s.meta.category; });
  if (S.sceneFilter === 'all' && un.length) {
    var sec2 = document.createElement('div');
    sec2.className = 'card';
    var h2 = document.createElement('h3');
    h2.textContent = '未分类（' + un.length + '）';
    sec2.appendChild(h2);
    var grid2 = document.createElement('div');
    grid2.className = 'img-grid';
    sec2.appendChild(grid2);
    groups.appendChild(sec2);
    renderImgCards(grid2, un, {
      buttons: [{ label: '删除', cls: 'del', fn: function (rec) { DB.deleteImage(rec.id).then(function () { renderVision(); renderHome(); }); } }]
    });
  }
  if (!shown && S.sceneFilter === 'all' && !un.length) {
    groups.innerHTML = '<div class="card"><p class="muted">还没有愿景场景。想象你理想的生活——家的样子、爱好的角落、父母的晚年……导入第一张场景图吧。</p></div>';
  }
}

// ===== 正念页 =====
async function renderMind() {
  var custom = await DB.getCustomMind();
  var groups = document.getElementById('mindGroups');
  groups.innerHTML = '';
  var keys = Object.keys(MIND_MOMENTS);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var builtin = DEFAULT_MIND.filter(function (m) { return m.moment === key; });
    var cust = custom.filter(function (c) { return c.moment === key; });
    if (!builtin.length && !cust.length) continue;
    var sec = document.createElement('div');
    sec.className = 'card';
    var h = document.createElement('h3');
    h.textContent = MIND_MOMENTS[key];
    sec.appendChild(h);
    builtin.concat(cust).forEach(function (m) {
      var item = document.createElement('div');
      item.className = 'mind-item';
      var t = document.createElement('div');
      t.className = 't';
      t.textContent = m.text;
      item.appendChild(t);
      var acts = document.createElement('div');
      acts.className = 'acts';
      var setBtn = document.createElement('button');
      setBtn.className = 'btn-mini';
      setBtn.textContent = '设为今日';
      setBtn.onclick = function () {
        DB.metaSet('mindToday', { date: todayStr(), moment: m.moment, text: m.text }).then(function () {
          toast('已设为今日正念');
          renderMind();
          renderHome();
        });
      };
      acts.appendChild(setBtn);
      if (m.id) {
        var delBtn = document.createElement('button');
        delBtn.className = 'btn-mini';
        delBtn.textContent = '删除';
        delBtn.onclick = function () { DB.deleteCustomMind(m.id).then(function () { renderMind(); }); };
        acts.appendChild(delBtn);
      }
      item.appendChild(acts);
      sec.appendChild(item);
    });
    groups.appendChild(sec);
  }
  // 选择器
  document.getElementById('mindMoment').innerHTML = keys.map(function (k) {
    return '<option value="' + k + '">' + esc(MIND_MOMENTS[k]) + '</option>';
  }).join('');
}

// ===== 愿望页 =====
async function renderWish() {
  var lockMsg = document.getElementById('wishLockMsg');
  var body = document.getElementById('wishBody');
  if (S.locked) {
    lockMsg.classList.remove('hidden');
    lockMsg.innerHTML = '<h3>🔒 愿望已加密</h3><p class="muted">输入口令解锁后查看与编辑</p><button class="btn" data-unlock-now>解锁</button>';
    body.classList.add('hidden');
    return;
  }
  lockMsg.classList.add('hidden');
  body.classList.remove('hidden');

  document.getElementById('wishType').innerHTML = WISH_TYPES.map(function (t) {
    return '<option value="' + t.key + '">' + esc(t.label) + '</option>';
  }).join('');
  document.getElementById('wishFilter').innerHTML = [{ key: 'all', label: '全部' }].concat(WISH_TYPES).map(function (t) {
    return '<button class="' + (S.wishFilter === t.key ? 'on' : '') + '" data-wish-filter="' + t.key + '">' + esc(t.label) + '</button>';
  }).join('');

  var wishes = await decWishes(await DB.getWishes());
  var pending = wishes.filter(function (w) { return !w.done && !w.archived; });
  var done = wishes.filter(function (w) { return w.done; });
  var list = S.wishFilter === 'all' ? pending : pending.filter(function (w) { return w.type === S.wishFilter; });
  var listEl = document.getElementById('wishList');
  var html = '';
  if (!list.length) html = '<div class="card"><p class="muted">还没有愿望。写下你想要的，哪怕很小——它会成为你每天的方向。</p></div>';
  list.forEach(function (w) {
    var typeLabel = WISH_TYPES.filter(function (t) { return t.key === w.type; })[0];
    var reviewed = (w.reviewDates || []).length;
    html += '<div class="card wish-card">' +
      '<div class="main"><div class="txt">' + esc(w.text) + '</div>' +
      '<div class="meta">' + (typeLabel ? typeLabel.label : '') + ' · 已回看 ' + reviewed + ' 天' +
      ((w.reviewDates || []).indexOf(todayStr()) >= 0 ? ' · <b>今日已默念 ✓</b>' : '') + '</div></div>' +
      '<div class="acts">' +
      '<button data-wish-review="' + w.id + '">今日已默念</button>' +
      '<button data-wish-done="' + w.id + '">已完成</button>' +
      '<button data-wish-del="' + w.id + '" style="color:#b0563f">删除</button>' +
      '</div></div>';
  });
  listEl.innerHTML = html;

  if (done.length) {
    var doneHtml = '<div class="card"><h3>已实现的愿望</h3>';
    done.slice(0, 20).forEach(function (w) {
      doneHtml += '<div class="wish-card done"><div class="main"><div class="txt">' + esc(w.text) + '</div>' +
        '<div class="meta">' + (w.doneAt ? '实现于 ' + fmtDate(w.doneAt) : '') +
        (w.feeling ? ' · 感受：' + esc(w.feeling) : '') + '</div></div>' +
        '<div class="acts"><button data-wish-del="' + w.id + '" style="color:#b0563f">删除</button></div></div>';
    });
    doneHtml += '</div>';
    listEl.innerHTML += doneHtml;
  }
}

// 解密愿望列表（含加密载荷）
async function decWishes(raw) {
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var w = raw[i];
    if (w.text && typeof w.text === 'object' && w.text.e) {
      if (!S.key) continue;
      try {
        var p = JSON.parse(await CRYPTO.decrypt(S.key, w.text.v));
        out.push(Object.assign({}, w, { text: p.t, feeling: p.f || '' }));
      } catch (e) { /* skip */ }
    } else {
      out.push(Object.assign({}, w, { feeling: w.feeling || '' }));
    }
  }
  return out;
}

// ===== 记录页 =====
async function renderRecord() {
  var lockMsg = document.getElementById('recordLockMsg');
  var body = document.getElementById('recordBody');
  if (S.locked) {
    lockMsg.classList.remove('hidden');
    lockMsg.innerHTML = '<h3>🔒 记录已加密</h3><p class="muted">输入口令解锁后查看与编辑</p><button class="btn" data-unlock-now>解锁</button>';
    body.classList.add('hidden');
    return;
  }
  lockMsg.classList.add('hidden');
  body.classList.remove('hidden');

  // 今日日记
  var entry = await DB.getJournal(todayStr());
  var content = null;
  if (entry) {
    if (entry.content && entry.content.e) {
      try { content = await CRYPTO.decPayload(S.key, entry.content.v); } catch (e) { content = null; }
    } else { content = entry.content; }
    S.journalDraft = { mood: entry.mood || 0, imageRef: entry.imageRef || null };
  } else {
    content = null;
    S.journalDraft = { mood: 0, imageRef: null };
  }
  document.getElementById('expText').value = (content && content.experience) || '';
  document.getElementById('grat1').value = (content && content.gratitude && content.gratitude[0]) || '';
  document.getElementById('grat2').value = (content && content.gratitude && content.gratitude[1]) || '';
  document.getElementById('grat3').value = (content && content.gratitude && content.gratitude[2]) || '';
  renderMoodStars(S.journalDraft.mood);
  var prev = document.getElementById('journalImgPrev');
  prev.innerHTML = '';
  if (S.journalDraft.imageRef) {
    var blob = await DB.loadImageBlob(S.journalDraft.imageRef);
    if (blob) prev.innerHTML = '<div class="img-card"><img src="' + (await blobToDataURL(blob)) + '" alt="配图"><div class="acts"><button data-journal-img-del style="color:#b0563f">移除配图</button></div></div>';
  }

  // 奖励打卡
  var rewards = await DB.getRewards();
  var rl = document.getElementById('rewardList');
  var rhtml = '';
  if (!rewards.length) rhtml = '<p class="muted">还没有打卡记录。完成一个小目标，给自己一个奖励吧。</p>';
  rewards.forEach(function (r) {
    rhtml += '<div class="reward-item"><div class="g">✓ ' + esc(r.goal) + '</div>' +
      '<div class="f">' + fmtDateTime(r.completedAt) + (r.rewardText ? ' · 奖励：' + esc(r.rewardText) : '') + '</div>' +
      (r.feeling ? '<div class="f">鲜花感：' + esc(r.feeling) + '</div>' : '') +
      (r.process ? '<div class="f">过程：' + esc(r.process) + '</div>' : '') +
      '<div><button class="btn-mini" data-reward-del="' + r.id + '" style="color:#b0563f">删除</button></div></div>';
  });
  rl.innerHTML = rhtml;

  // 成就
  var wishes = await decWishes(await DB.getWishes());
  var journals = await DB.getJournals();
  var scenes = (await DB.getImages('scene')).length;
  document.getElementById('achievements').innerHTML =
    '<div class="box"><b>' + (wishes.filter(function (w) { return w.done; }).length) + '</b><span class="muted">愿望实现</span></div>' +
    '<div class="box"><b>' + rewards.length + '</b><span class="muted">奖励打卡</span></div>' +
    '<div class="box"><b>' + calcStreak(journals.map(function (j) { return j.date; })) + '</b><span class="muted">连续记录天</span></div>' +
    '<div class="box"><b>' + scenes + '</b><span class="muted">愿景场景</span></div>';

  // 最近记录
  var rj = document.getElementById('recentJournal');
  var jhtml = '';
  if (!journals.length) {
    jhtml = '<p class="muted">还没有记录。今天开始写下第一条体验吧。</p>';
  } else {
    for (var ri = 0; ri < Math.min(7, journals.length); ri++) {
      var j2 = journals[ri];
      var body2 = j2.content;
      if (body2 && body2.e) { try { body2 = await CRYPTO.decPayload(S.key, body2.v); } catch (e) { body2 = null; } }
      jhtml += '<div class="mind-item"><b>' + fmtDate(j2.date) + '</b> · ' + esc((body2 && body2.experience) || '') +
        ' <span class="muted">' + (body2 && body2.gratitude ? '感恩 ' + body2.gratitude.filter(Boolean).length + ' 条' : '') + '</span></div>';
    }
  }
  rj.innerHTML = jhtml;
}

function renderMoodStars(mood) {
  var s = '';
  for (var i = 1; i <= 5; i++) s += '<button data-mood="' + i + '" class="' + (i <= mood ? 'on' : '') + '">★</button>';
  document.getElementById('moodStars').innerHTML = s;
}

// ===== 设置页 =====
async function renderSettings() {
  var area = document.getElementById('passArea');
  var salt = await DB.metaGet('passSalt');
  var html = '';
  if (!CRYPTO.supported()) {
    html = '<p class="muted">⚠️ 当前环境不支持加密（需通过 http(s) 或 localhost 访问，file:// 可能不可用）。<br>离线部署后即可启用口令加密。</p>';
  } else if (!salt) {
    html = '<label>设置口令</label><input type="password" id="passNew1" placeholder="新口令">' +
      '<input type="password" id="passNew2" placeholder="再输一次">' +
      '<button class="btn" data-set-pass>启用加密</button>';
  } else {
    html = '<p class="muted">✅ 已启用加密（愿望与日记已加密存储）</p>' +
      '<label>修改口令</label><input type="password" id="passCur" placeholder="当前口令">' +
      '<input type="password" id="passNewA" placeholder="新口令"><input type="password" id="passNewB" placeholder="再输一次">' +
      '<button class="btn-ghost" data-change-pass>修改口令</button>' +
      '<label>清除口令（解密所有内容）</label><input type="password" id="passCur2" placeholder="当前口令">' +
      '<button class="btn-ghost" data-clear-pass>清除口令</button>' +
      '<button class="btn" data-lock-now>🔒 立即锁定</button>';
  }
  area.innerHTML = html;

  var est = await DB.estimate();
  document.getElementById('storageInfo').innerHTML =
    '<p class="muted">已用 ' + formatBytes(est.usage) + ' / ' + formatBytes(est.quota) +
    (DB.opfsSupported() ? '<br>图片存储：OPFS（大文件）' : '<br>图片存储：IndexedDB（兜底）') + '</p>';

  var genS2 = await GEN.loadSettings();
  var genKeyInput = document.getElementById('genKey');
  if (genKeyInput) genKeyInput.value = genS2.apiKey || '';
}

// ===== 图片上传与压缩 =====
async function downscaleImage(file, maxSide, quality) {
  var url = URL.createObjectURL(file);
  var img = await new Promise(function (resolve, reject) {
    var im = new Image();
    im.onload = function () { resolve(im); };
    im.onerror = reject;
    im.src = url;
  });
  var w = img.width, h = img.height;
  var scale = Math.min(1, maxSide / Math.max(w, h));
  w = Math.round(w * scale); h = Math.round(h * scale);
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  return new Promise(function (resolve) {
    c.toBlob(function (b) { resolve(b); }, 'image/webp', quality || 0.82);
  });
}

async function handleFiles(fileList, kind, captionFn) {
  var files = Array.from(fileList);
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!f.type || f.type.indexOf('image/') !== 0) { toast('只支持图片文件'); continue; }
    var blob = await downscaleImage(f, 1400, 0.82);
    var meta = {};
    if (captionFn) meta = captionFn();
    await DB.addImage({ kind: kind, blob: blob, caption: meta.caption || '', meta: meta });
  }
}

// ===== 事件绑定 =====
function bindEvents() {
  // 导航
  document.addEventListener('click', function (e) {
    var nav = e.target.closest('[data-nav]');
    if (nav) { switchTab(nav.dataset.nav); return; }
    var pick = e.target.closest('[data-pick]');
    if (pick) { var inp = document.getElementById(pick.dataset.pick); if (inp) inp.click(); return; }
    var unf = e.target.closest('[data-unlock-now]');
    if (unf) { showLock(); return; }
    var sceneFilter = e.target.closest('[data-scene-filter]');
    if (sceneFilter) { S.sceneFilter = sceneFilter.dataset.sceneFilter; renderVision(); return; }
    var wishFilter = e.target.closest('[data-wish-filter]');
    if (wishFilter) { S.wishFilter = wishFilter.dataset.wishFilter; renderWish(); return; }
    var moodBtn = e.target.closest('[data-mood]');
    if (moodBtn) { S.journalDraft.mood = parseInt(moodBtn.dataset.mood, 10); renderMoodStars(S.journalDraft.mood); return; }
    var reviewWish = e.target.closest('[data-review-wish]');
    if (reviewWish) { doReviewWish(reviewWish.dataset.reviewWish); return; }
    var wishReview = e.target.closest('[data-wish-review]');
    if (wishReview) { doReviewWish(wishReview.dataset.wishReview); return; }
    var wishDone = e.target.closest('[data-wish-done]');
    if (wishDone) { doWishDone(wishDone.dataset.wishDone); return; }
    var wishDel = e.target.closest('[data-wish-del]');
    if (wishDel) { doWishDelete(wishDel.dataset.wishDel); return; }
    var rewardDel = e.target.closest('[data-reward-del]');
    if (rewardDel) { doRewardDelete(rewardDel.dataset.rewardDel); return; }
    var jImgDel = e.target.closest('[data-journal-img-del]');
    if (jImgDel) { doJournalImgDel(); return; }
    var saveReward = e.target.closest('[data-save-reward]');
    if (saveReward) { doSaveReward(); return; }
    var cancelReward = e.target.closest('[data-cancel-reward]');
    if (cancelReward) { hideRewardForm(); return; }
    var saveGenKey = e.target.closest('[data-save-gen-key]');
    if (saveGenKey) { doSaveGenKey(); return; }
    var testGenKey = e.target.closest('[data-test-gen-key]');
    if (testGenKey) { doTestGenKey(); return; }
  });

  // 顶部/表单按钮
  document.getElementById('mindShuffle').addEventListener('click', async function () {
    await getTodayMind(true);
    await renderHome();
    toast('已换一句');
  });
  document.getElementById('saveProfile').addEventListener('click', async function () {
    var p = {};
    PROFILE_FIELDS.forEach(function (f) { p[f.key] = document.getElementById('pf-' + f.key).value.trim(); });
    S.profile = p;
    await DB.metaSet('profile', p);
    document.getElementById('promptOut').value = buildIdentityPrompt(p, '', S.modelRatio);
    await renderHome();
    var ageWarn = /(老|年后|岁|中年|成熟)/.test(p.ageFeel || '');
    toast(ageWarn ? '⚠️ 已保存，但「年龄感」含显老词（' + p.ageFeel + '），AI 会把人画老——建议改为「保持年轻」或清空' : '形象卡已保存');
  });
  document.getElementById('copyPrompt').addEventListener('click', async function () {
    var ok = await copyText(document.getElementById('promptOut').value);
    toast(ok ? '提示词已复制，去生图工具粘贴使用' : '复制失败');
  });
  document.getElementById('addMind').addEventListener('click', async function () {
    var moment = document.getElementById('mindMoment').value;
    var text = document.getElementById('mindText').value.trim();
    if (!text) { toast('请先写下正念内容'); return; }
    await DB.addCustomMind({ moment: moment, text: text });
    document.getElementById('mindText').value = '';
    await renderMind();
    toast('已添加自定义正念');
  });
  document.getElementById('addWish').addEventListener('click', async function () {
    var text = document.getElementById('wishText').value.trim();
    if (!text) { toast('请先写下愿望'); return; }
    var type = document.getElementById('wishType').value;
    var w = { text: text, type: type, done: false, archived: false, reviewDates: [], createdAt: Date.now() };
    if (S.key) {
      w.text = { e: true, v: await CRYPTO.encrypt(S.key, JSON.stringify({ t: text, f: '' })) };
    }
    await DB.addWish(w);
    document.getElementById('wishText').value = '';
    await renderWish();
    await renderHome();
    toast('愿望已写下，每天记得回看');
  });
  document.getElementById('addReward').addEventListener('click', function () {
    var goal = document.getElementById('rewardGoal').value.trim();
    showRewardForm(goal);
  });
  document.getElementById('saveJournal').addEventListener('click', doSaveJournal);
  document.getElementById('genRun').addEventListener('click', runIdentityGen);
  document.getElementById('btnGenScene').addEventListener('click', runSceneGen);
  document.getElementById('lockSubmit').addEventListener('click', doUnlock);
  document.getElementById('lockInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') doUnlock(); });

  document.getElementById('btnExportPack').addEventListener('click', async function () {
    toast('正在打包…');
    var r = await BACKUP.exportPack();
    downloadBlob(r.name, r.blob);
    toast('备份包已导出');
  });
  document.getElementById('btnExportSnap').addEventListener('click', async function () {
    if (S.locked) { toast('请先解锁再导出快照'); return; }
    toast('正在生成快照…');
    var r = await BACKUP.exportSnapshot();
    downloadBlob(r.name, r.blob);
    toast('HTML 快照已导出，任何浏览器离线可读');
  });

  // 文件输入
  document.getElementById('photoInput').addEventListener('change', async function (e) {
    await handleFiles(e.target.files, 'photo');
    e.target.value = '';
    await renderIdentity();
    toast('已添加真实照片');
  });
  document.getElementById('modelInput').addEventListener('change', async function (e) {
    await handleFiles(e.target.files, 'model');
    e.target.value = '';
    await renderIdentity();
    toast('已添加榜样参考图');
  });
  document.getElementById('identityInput').addEventListener('change', async function (e) {
    await handleFiles(e.target.files, 'identity');
    e.target.value = '';
    await renderIdentity();
    await renderHome();
    toast('已导入形象图，可设为主形象');
  });
  document.getElementById('sceneInput').addEventListener('change', async function (e) {
    var cat = document.getElementById('sceneCat').value;
    var cap = document.getElementById('sceneCaption').value.trim();
    await handleFiles(e.target.files, 'scene', function () { return { category: cat, caption: cap }; });
    e.target.value = '';
    document.getElementById('sceneCaption').value = '';
    await renderVision();
    await renderHome();
    toast('已添加愿景场景');
  });
  document.getElementById('journalImg').addEventListener('change', async function (e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (S.journalDraft.imageRef) await DB.deleteImageBlob(S.journalDraft.imageRef);
    var blob = await downscaleImage(f, 1200, 0.8);
    S.journalDraft.imageRef = await DB.saveImageBlob(blob);
    await renderRecord();
  });
  document.getElementById('restoreInput').addEventListener('change', async function (e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!confirm('恢复将覆盖当前全部数据，确定继续？')) return;
    try {
      await BACKUP.restorePack(f);
      S.profile = (await DB.metaGet('profile')) || {};
      var salt = await DB.metaGet('passSalt');
      S.locked = !!salt;
      S.key = null;
      if (S.locked) showLock(); else hideLock();
      await renderHome();
      switchTab('settings');
      toast('恢复完成');
    } catch (err) {
      toast('恢复失败：' + err.message);
    }
  });

  // 融合比例
  document.getElementById('modelRatio').addEventListener('input', async function (e) {
    var v = parseInt(e.target.value, 10);
    S.modelRatio = v;
    document.getElementById('modelRatioVal').textContent = '像你 ' + v + '% / 像榜样 ' + (100 - v) + '%';
    var settings = (await DB.metaGet('settings')) || {};
    settings.modelRatio = v;
    await DB.metaSet('settings', settings);
    document.getElementById('promptOut').value = buildIdentityPrompt(S.profile, '', v);
  });

  // 显示/隐藏 API Key
  document.getElementById('genKeyToggle').addEventListener('click', function () {
    var inp = document.getElementById('genKey');
    var isPass = inp.type === 'password';
    inp.type = isPass ? 'text' : 'password';
    this.textContent = isPass ? '🙈 隐藏 Key' : '👁 显示 Key';
  });

  // 口令相关（事件委托到 passArea）
  document.getElementById('passArea').addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-set-pass]');
    if (btn) { doSetPass(); return; }
    btn = e.target.closest('[data-change-pass]');
    if (btn) { doChangePass(); return; }
    btn = e.target.closest('[data-clear-pass]');
    if (btn) { doClearPass(); return; }
    btn = e.target.closest('[data-lock-now]');
    if (btn) { doLockNow(); return; }
  });
}

// ===== 动作 =====
function showLock() {
  document.getElementById('lockOverlay').classList.remove('hidden');
  var inp = document.getElementById('lockInput');
  inp.value = '';
  setTimeout(function () { inp.focus(); }, 100);
}
function hideLock() { document.getElementById('lockOverlay').classList.add('hidden'); }

async function doUnlock() {
  var pass = document.getElementById('lockInput').value;
  if (!pass) return;
  var salt = await DB.metaGet('passSalt');
  if (!salt) { hideLock(); S.locked = false; return; }
  var key = await CRYPTO.deriveKey(pass, salt);
  var ok = await CRYPTO.checkVerifier(key, await DB.metaGet('passVerifier'));
  if (!ok) { toast('口令不正确'); return; }
  S.key = key;
  S.locked = false;
  hideLock();
  await renderHome();
  if (S.tab === 'wish') await renderWish();
  if (S.tab === 'record') await renderRecord();
  toast('已解锁');
}

async function doSetPass() {
  var p1 = document.getElementById('passNew1').value;
  var p2 = document.getElementById('passNew2').value;
  if (!p1 || p1.length < 4) { toast('口令至少 4 位'); return; }
  if (p1 !== p2) { toast('两次输入不一致'); return; }
  var salt = CRYPTO.toB64(CRYPTO.randBytes(16));
  var key = await CRYPTO.deriveKey(p1, salt);
  var verifier = await CRYPTO.makeVerifier(key);
  // 加密已有明文愿望
  var wishes = await DB.getWishes();
  for (var i = 0; i < wishes.length; i++) {
    var w = wishes[i];
    if (typeof w.text === 'string') {
      w.text = { e: true, v: await CRYPTO.encrypt(key, JSON.stringify({ t: w.text, f: w.feeling || '' })) };
      delete w.feeling;
      await DB.updateWish(w);
    }
  }
  var journals = await DB.getJournals();
  for (var j = 0; j < journals.length; j++) {
    if (journals[j].content && !journals[j].content.e) {
      journals[j].content = { e: true, v: await CRYPTO.encPayload(key, journals[j].content) };
      await DB.saveJournal(journals[j]);
    }
  }
  await DB.metaSet('passSalt', salt);
  await DB.metaSet('passVerifier', verifier);
  S.key = key;
  S.locked = false;
  await renderSettings();
  toast('加密已启用');
}

async function doChangePass() {
  var cur = document.getElementById('passCur').value;
  var n1 = document.getElementById('passNewA').value;
  var n2 = document.getElementById('passNewB').value;
  if (!cur) { toast('请输入当前口令'); return; }
  if (!n1 || n1.length < 4) { toast('新口令至少 4 位'); return; }
  if (n1 !== n2) { toast('新口令两次输入不一致'); return; }
  var salt = await DB.metaGet('passSalt');
  var oldKey = await CRYPTO.deriveKey(cur, salt);
  if (!(await CRYPTO.checkVerifier(oldKey, await DB.metaGet('passVerifier')))) { toast('当前口令不正确'); return; }
  var newSalt = CRYPTO.toB64(CRYPTO.randBytes(16));
  var newKey = await CRYPTO.deriveKey(n1, newSalt);
  var wishes = await DB.getWishes();
  for (var i = 0; i < wishes.length; i++) {
    var w = wishes[i];
    if (w.text && w.text.e) {
      var p = JSON.parse(await CRYPTO.decrypt(oldKey, w.text.v));
      w.text = { e: true, v: await CRYPTO.encrypt(newKey, JSON.stringify({ t: p.t, f: p.f || '' })) };
      await DB.updateWish(w);
    }
  }
  var journals = await DB.getJournals();
  for (var j = 0; j < journals.length; j++) {
    if (journals[j].content && journals[j].content.e) {
      var c = await CRYPTO.decPayload(oldKey, journals[j].content.v);
      journals[j].content = { e: true, v: await CRYPTO.encPayload(newKey, c) };
      await DB.saveJournal(journals[j]);
    }
  }
  await DB.metaSet('passSalt', newSalt);
  await DB.metaSet('passVerifier', await CRYPTO.makeVerifier(newKey));
  S.key = newKey;
  await renderSettings();
  toast('口令已修改');
}

async function doClearPass() {
  var cur = document.getElementById('passCur2').value;
  if (!cur) { toast('请输入当前口令'); return; }
  var salt = await DB.metaGet('passSalt');
  var key = await CRYPTO.deriveKey(cur, salt);
  if (!(await CRYPTO.checkVerifier(key, await DB.metaGet('passVerifier')))) { toast('口令不正确'); return; }
  var wishes = await DB.getWishes();
  for (var i = 0; i < wishes.length; i++) {
    var w = wishes[i];
    if (w.text && w.text.e) {
      var p = JSON.parse(await CRYPTO.decrypt(key, w.text.v));
      w.text = p.t;
      w.feeling = p.f || '';
      await DB.updateWish(w);
    }
  }
  var journals = await DB.getJournals();
  for (var j = 0; j < journals.length; j++) {
    if (journals[j].content && journals[j].content.e) {
      journals[j].content = await CRYPTO.decPayload(key, journals[j].content.v);
      await DB.saveJournal(journals[j]);
    }
  }
  await DB.metaDel('passSalt');
  await DB.metaDel('passVerifier');
  S.key = null;
  S.locked = false;
  await renderSettings();
  toast('已清除口令，内容已解密');
}

async function doLockNow() {
  S.key = null;
  S.locked = true;
  await renderHome();
  showLock();
  toast('已锁定');
}

async function doReviewWish(id) {
  var wishes = await DB.getWishes();
  var w = wishes.filter(function (x) { return x.id === id; })[0];
  if (!w) return;
  var dates = w.reviewDates || [];
  if (dates.indexOf(todayStr()) < 0) dates.push(todayStr());
  w.reviewDates = dates;
  await DB.updateWish(w);
  await renderHome();
  await renderWish();
  toast('今日已默念 ✓');
}

async function doWishDone(id) {
  var wishes = await DB.getWishes();
  var w = wishes.filter(function (x) { return x.id === id; })[0];
  if (!w) return;
  var feeling = prompt('🎉 愿望实现！写下「鲜花之后的感受」：');
  if (feeling === null) return;
  if (S.key && w.text && w.text.e) {
    var p = JSON.parse(await CRYPTO.decrypt(S.key, w.text.v));
    w.text = { e: true, v: await CRYPTO.encrypt(S.key, JSON.stringify({ t: p.t, f: feeling })) };
  } else {
    w.feeling = feeling;
  }
  w.done = true;
  w.doneAt = todayStr();
  await DB.updateWish(w);
  await renderWish();
  await renderHome();
  toast('太棒了！愿望实现了 🌸');
}

async function doWishDelete(id) {
  if (!confirm('删除这条愿望？')) return;
  await DB.deleteWish(id);
  await renderWish();
  await renderHome();
  toast('已删除');
}

async function doRewardDelete(id) {
  await DB.deleteReward(id);
  await renderRecord();
  await renderHome();
  toast('已删除打卡');
}

async function doJournalImgDel() {
  if (S.journalDraft.imageRef) await DB.deleteImageBlob(S.journalDraft.imageRef);
  S.journalDraft.imageRef = null;
  await renderRecord();
}

function showRewardForm(goal) {
  var f = document.getElementById('rewardForm');
  f.classList.remove('hidden');
  f.innerHTML =
    '<div class="field"><label>完成的小目标</label><input type="text" id="rfGoal" value="' + esc(goal || '') + '"></div>' +
    '<div class="field"><label>给自己的奖励（可选）</label><input type="text" id="rfReward" placeholder="如：一杯好咖啡 / 一束花 / 一部电影"></div>' +
    '<div class="field"><label>此刻的感受（鲜花之后的感受）</label><textarea id="rfFeeling" rows="2" placeholder="闭上眼睛感受一下：现在心里是什么感觉？"></textarea></div>' +
    '<div class="field"><label>这一路的过程（可选）</label><textarea id="rfProcess" rows="2" placeholder="你是怎么一步步做到的？"></textarea></div>' +
    '<div class="row"><button class="btn" data-save-reward>保存打卡</button><button class="btn-ghost" data-cancel-reward>取消</button></div>';
  document.getElementById('rewardGoal').value = '';
}

function hideRewardForm() {
  document.getElementById('rewardForm').classList.add('hidden');
  document.getElementById('rewardForm').innerHTML = '';
}

async function doSaveReward() {
  var goal = document.getElementById('rfGoal').value.trim();
  if (!goal) { toast('请填写完成的小目标'); return; }
  var rewardText = document.getElementById('rfReward').value.trim();
  var feeling = document.getElementById('rfFeeling').value.trim();
  var process = document.getElementById('rfProcess').value.trim();
  await DB.addReward({ goal: goal, rewardText: rewardText, feeling: feeling, process: process, completedAt: Date.now() });
  hideRewardForm();
  await renderRecord();
  await renderHome();
  toast('打卡成功，记得善待自己 🌸');
}

async function doSaveJournal() {
  var experience = document.getElementById('expText').value.trim();
  var g = [
    document.getElementById('grat1').value.trim(),
    document.getElementById('grat2').value.trim(),
    document.getElementById('grat3').value.trim()
  ];
  if (!experience && !g.filter(Boolean).length) { toast('写点什么再保存吧'); return; }
  var content = { experience: experience, gratitude: g };
  var stored;
  if (S.key) stored = { e: true, v: await CRYPTO.encPayload(S.key, content) };
  else stored = content;
  var entry = {
    date: todayStr(),
    content: stored,
    mood: S.journalDraft.mood || 0,
    imageRef: S.journalDraft.imageRef || null,
    createdAt: Date.now()
  };
  await DB.saveJournal(entry);
  await renderRecord();
  await renderHome();
  toast('今日记录已保存');
}

async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch (e) {
    var ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); return true; } catch (e2) { return false; } finally { ta.remove(); }
  }
}

// ===== v0.2 生图工坊 =====
function genErrMsg(err) {
  if (err.status === 401) {
    var d = (err.details || []).map(function (x) {
      return x.site + '：' + (x.status || '网络') + ' ' + x.message;
    }).join('；');
    return 'Key 被拒绝（' + (d || '两个站点都拒绝') + '）。请确认：①Key 复制完整（sk- 开头）②是硅基流动的 Key ③当前设备上重新粘贴并点「保存+测试连接」';
  }
  if (err.status === 400 || err.status === 404) {
    var lm = (err.message || '').toLowerCase();
    if (lm.indexOf('model') >= 0 || lm.indexOf('not found') >= 0 || lm.indexOf('不存在') >= 0) {
      return '模型在当前站点不可用（' + esc(err.message) + '）。Qwen 系列仅国内站(.cn)有，国际站(.com)请用 FLUX 系列——模型列表已按你的站点自动过滤，刷新后重选即可。';
    }
  }
  if (err.status === 403) {
    var dm = (err.message || '').toLowerCase();
    if (dm.indexOf('disabled') >= 0) {
      return '模型被禁用（403 Model disabled）：最常见原因是账号未完成实名认证——请登录 cloud.siliconflow.cn → 右上角头像 → 实名认证（身份证+人脸，几分钟生效）。若已认证仍提示，可能是境外 IP 限制，回内地后自动恢复。';
    }
    return '权限不足（403 ' + esc(err.message) + '）。若提示需实名认证，请到 cloud.siliconflow.cn 完成认证后重试。';
  }
  if (err.status === 402) return '余额不足：生图按量计费，额度已用完。两条出路：①想立刻出图 → 模型换成 FLUX.1-schnell（国内站免费）②想用 Qwen 生成像你的形象 → 国内站 cloud.siliconflow.cn「计费管理」充值 ¥10 起（支付宝/微信），国际站需美元充值';
  if (err.status === 429) return '请求太频繁，稍等片刻再试';
  if (err.status === 503) return '生图服务繁忙，请稍后再试';
  if (err.message && err.message.indexOf('fetch') >= 0) return '网络异常，请确认联网后重试';
  return '生成失败：' + (err.message || err);
}

async function renderCandidates(container, items, opts) {
  // items: [{url, blob}]（blob 为生成后立即缓存的本地副本，可为 null）
  container.innerHTML = '';
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var card = document.createElement('div');
    card.className = 'img-card portrait';
    var img = document.createElement('img');
    img.src = item.url;
    card.appendChild(img);
    var acts = document.createElement('div');
    acts.className = 'acts';
    (opts.buttons || []).forEach(function (b) {
      var btn = document.createElement('button');
      btn.textContent = b.label;
      btn.onclick = function () { b.fn(i, item); };
      acts.appendChild(btn);
    });
    card.appendChild(acts);
    // 兜底：自动保存失败时，可新窗口打开原图手动保存（长按/右键另存为 → 再导入）
    var link = document.createElement('a');
    link.textContent = '↗ 打开原图';
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.cssText = 'display:block;font-size:11px;color:var(--muted);text-align:center;padding:6px 0;text-decoration:none';
    card.appendChild(link);
    container.appendChild(card);
  }
}

async function doSaveGenKey() {
  var key = document.getElementById('genKey').value.trim();
  if (!key) { toast('请先粘贴 API Key'); return; }
  var s = await GEN.loadSettings();
  s.apiKey = key;
  await GEN.saveSettings(s);
  await renderSettings();
  await renderIdentity();
  toast('API Key 已保存（仅存本机）');
}

async function doTestGenKey() {
  var key = document.getElementById('genKey').value.trim() || (await GEN.loadSettings()).apiKey;
  var diag = document.getElementById('genDiag');
  if (!key) { toast('请先填写 API Key'); return; }
  diag.innerHTML = '<p class="muted">正在测试…</p>';
  toast('正在测试连接…');
  var masked = key.length <= 8 ? '****' : key.slice(0, 4) + '•••' + key.slice(-4);
  var html = '<div style="font-size:12px;line-height:1.8">' +
    'Key：' + esc(masked) + '（共 ' + key.length + ' 位，' +
    (key.indexOf('sk-') === 0 ? 'sk- 开头 ✓' : '⚠️ 不是 sk- 开头') + '）';
  try {
    var results = await GEN.diagnose(key);
    var okSite = null;
    results.forEach(function (r) {
      if (r.ok) okSite = r.site;
      html += '<br>' + r.site + '：' + (r.ok ? '✅ 接受此 Key' : '❌ ' + (r.status || '网络错误') + ' ' + esc(r.message));
    });
    if (okSite) {
      var s = await GEN.loadSettings();
      var base = okSite.indexOf('.cn') >= 0 ? 'https://api.siliconflow.cn/v1/images/generations' : 'https://api.siliconflow.com/v1/images/generations';
      if (s.apiKey !== key) s.apiKey = key;
      s.apiBase = base;
      await GEN.saveSettings(s);
      html += '<br><b style="color:var(--accent)">🎉 ' + okSite + ' 接受此 Key，可以生成图片了！</b>';
    } else {
      html += '<br><b style="color:#b0563f">两个站都不接受这个 Key。</b> 对照下面检查：<br>' +
        '① 是否复制完整（sk- 开头、没漏字符）<br>' +
        '② 是否在硅基流动（siliconflow）创建，而非阿里百炼/即梦等其他平台<br>' +
        '③ 实在不行：去 cloud.siliconflow.cn 重新创建一个 Key';
    }
  } catch (err) {
    html += '<br>诊断失败：' + esc(err.message);
  }
  html += '</div>';
  diag.innerHTML = html;
}

// 参考图：取最近的一张真实照片，转成 PNG Data URL（硅基流动要求 data:image/png;base64, 格式）
async function getRefPhotoDataUrl() {
  var photos = await DB.getImages('photo');
  if (!photos.length) return null;
  var blob = await DB.loadImageBlob(photos[0].ref);
  return blob ? blobToPngDataUrl(blob, 1024) : null;
}

// 把任意图片转成 PNG Data URL（API 只认 png/jpeg 前缀，不认 webp）
async function blobToPngDataUrl(blob, maxSide) {
  var url = URL.createObjectURL(blob);
  try {
    var img = await new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = reject;
      im.src = url;
    });
    var w = img.naturalWidth, h = img.naturalHeight;
    var scale = Math.min(1, (maxSide || 1024) / Math.max(w, h));
    w = Math.round(w * scale); h = Math.round(h * scale);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function runIdentityGen() {
  var genS = await GEN.loadSettings();
  if (!genS.apiKey) { toast('请先在「设置」页配置 API Key'); switchTab('settings'); return; }
  var model = document.getElementById('genModel').value;
  var sceneText = document.getElementById('genScene').value.trim();
  var modelInfo = GEN.MODELS.filter(function (m) { return m.key === model; })[0];
  var refUrl = null;
  if (modelInfo && modelInfo.needRef) {
    refUrl = await getRefPhotoDataUrl();
    if (!refUrl) {
      toast('该模型需要真实照片做参考：请先上传照片，或改用「纯文生图」模型');
      return;
    }
  }
  var prompt = buildIdentityPrompt(S.profile, sceneText, S.modelRatio);
  var btn = document.getElementById('genRun');
  var hint = document.getElementById('genHint');
  btn.disabled = true;
  btn.textContent = '⏳ 生成中（约 10-60 秒）…';
  hint.textContent = '正在生成，请稍候…';
  var area = document.getElementById('genCandidates');
  area.innerHTML = '<p class="muted">生成中…（此过程需联网）</p>';
  try {
    var urls = await GEN.generate({ apiKey: genS.apiKey, model: model, prompt: prompt, imageDataUrl: refUrl, ratio: 'portrait' });
    if (!urls.length) { toast('没有返回图片，请重试'); area.innerHTML = ''; hint.textContent = ''; return; }
    // 立即下载缓存，趁图片链接最新鲜（链接有效期短，尤其免费模型）
    hint.textContent = '已生成 ' + urls.length + ' 张，正在保存到本机…';
    var items = await Promise.all(urls.map(async function (u) {
      try { return { url: u, blob: await GEN.downloadToBlob(u) }; }
      catch (e) { return { url: u, blob: null }; }
    }));
    var okCount = items.filter(function (x) { return x.blob; }).length;
    hint.textContent = '生成了 ' + urls.length + ' 张（' + okCount + ' 张已缓存到本机），点「保存」加入形象图库。';
    renderCandidates(area, items, {
      buttons: [
        {
          label: '保存为形象图',
          fn: async function (i, item) {
            try {
              var b = item.blob || await GEN.downloadToBlob(item.url);
              await DB.addImage({ kind: 'identity', blob: b, caption: sceneText || 'AI 生成', meta: {} });
              area.innerHTML = '';
              hint.textContent = '';
              await renderIdentity();
              toast('已保存 ✓ 可设为主形象');
            } catch (e) { toast('保存失败：' + e.message + '（可点「↗ 打开原图」手动保存后导入）'); }
          }
        },
        {
          label: '保存并设为主形象',
          fn: async function (i, item) {
            try {
              var b = item.blob || await GEN.downloadToBlob(item.url);
              var id = await DB.addImage({ kind: 'identity', blob: b, caption: sceneText || 'AI 生成', meta: {} });
              await DB.setMainImage(id, 'identity');
              area.innerHTML = '';
              hint.textContent = '';
              await renderIdentity();
              await renderHome();
              toast('已设为每日主形象 🌸');
            } catch (e) { toast('保存失败：' + e.message + '（可点「↗ 打开原图」手动保存后导入）'); }
          }
        }
      ]
    });
  } catch (err) {
    toast(genErrMsg(err));
    hint.textContent = genErrMsg(err);
    area.innerHTML = '';
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ 生成 4 张';
  }
}

async function runSceneGen() {
  var genS = await GEN.loadSettings();
  if (!genS.apiKey) { toast('请先在「设置」页配置 API Key'); switchTab('settings'); return; }
  var model = document.getElementById('genModel').value;
  var cat = document.getElementById('sceneCat').value;
  var caption = document.getElementById('sceneCaption').value.trim();
  if (!caption) {
    var catInfo = SCENE_CATEGORIES.filter(function (c) { return c.key === cat; })[0];
    caption = catInfo ? catInfo.label : '理想的生活场景';
  }
  var modelInfo = GEN.MODELS.filter(function (m) { return m.key === model; })[0];
  var refUrl = null;
  if (modelInfo && modelInfo.needRef) {
    // 优先用「未来形象」作参考，让场景里的人是你
    var ref = (await DB.getMainImage('identity')) || null;
    var blob = ref ? await DB.loadImageBlob(ref.ref) : null;
    if (!blob) refUrl = await getRefPhotoDataUrl();
    else refUrl = await blobToPngDataUrl(blob, 1024);
    if (!refUrl) {
      toast('该模型需要参考图：请先创建未来形象或上传真实照片');
      return;
    }
  }
  var prompt = buildIdentityPrompt(S.profile, caption, S.modelRatio);
  var btn = document.getElementById('btnGenScene');
  var area = document.getElementById('sceneCandidates');
  btn.disabled = true;
  btn.textContent = '⏳ 生成中（约 10-60 秒）…';
  area.innerHTML = '<p class="muted">正在生成，请稍候…（此过程需联网）</p>';
  try {
    var urls = await GEN.generate({ apiKey: genS.apiKey, model: model, prompt: prompt, imageDataUrl: refUrl, ratio: 'square' });
    if (!urls.length) { toast('没有返回图片，请重试'); area.innerHTML = ''; return; }
    // 立即下载缓存，趁图片链接最新鲜
    area.innerHTML = '<p class="muted">已生成，正在保存到本机…</p>';
    var items = await Promise.all(urls.map(async function (u) {
      try { return { url: u, blob: await GEN.downloadToBlob(u) }; }
      catch (e) { return { url: u, blob: null }; }
    }));
    renderCandidates(area, items, {
      buttons: [
        {
          label: '保存为愿景场景',
          fn: async function (i, item) {
            try {
              var b = item.blob || await GEN.downloadToBlob(item.url);
              await DB.addImage({ kind: 'scene', blob: b, caption: caption, meta: { category: cat } });
              area.innerHTML = '';
              await renderVision();
              await renderHome();
              toast('已保存到愿景画廊 ✓');
            } catch (e) { toast('保存失败：' + e.message + '（可点「↗ 打开原图」手动保存后导入）'); }
          }
        }
      ]
    });
  } catch (err) {
    toast(genErrMsg(err));
    area.innerHTML = '';
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ AI 生成场景图';
  }
}

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', init);
