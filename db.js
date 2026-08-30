// db.js — IndexedDB 数据层 + OPFS 图片存储（带 IDB 兜底）
'use strict';

var DB = (function () {
  var db = null;
  var opfsRoot = null;

  function open() {
    return new Promise(function (resolve, reject) {
      if (db) return resolve(db);
      var req = indexedDB.open('lifecanvas', 1);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('images')) d.createObjectStore('images', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('wishes')) d.createObjectStore('wishes', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('rewards')) d.createObjectStore('rewards', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('journal')) d.createObjectStore('journal', { keyPath: 'date' });
        if (!d.objectStoreNames.contains('customMind')) d.createObjectStore('customMind', { keyPath: 'id' });
      };
      req.onsuccess = function () { db = req.result; resolve(db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(store, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, mode);
      var req = fn(t.objectStore(store));
      t.oncomplete = function () { resolve(req ? req.result : undefined); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error); };
    });
  }
  function getOne(store, key) { return tx(store, 'readonly', function (s) { return s.get(key); }); }
  function getAll(store) { return tx(store, 'readonly', function (s) { return s.getAll(); }); }
  function put(store, val) { return tx(store, 'readwrite', function (s) { return s.put(val); }); }
  function del(store, key) { return tx(store, 'readwrite', function (s) { return s.delete(key); }); }
  function clearStore(store) { return tx(store, 'readwrite', function (s) { return s.clear(); }); }

  // ---------- meta ----------
  async function metaGet(key) { var r = await getOne('meta', key); return r ? r.value : null; }
  async function metaSet(key, value) { await put('meta', { key: key, value: value }); }
  async function metaDel(key) { await del('meta', key); }

  // ---------- OPFS ----------
  async function opfsInit() {
    if (opfsRoot) return opfsRoot;
    if (navigator.storage && navigator.storage.getDirectory) {
      opfsRoot = await navigator.storage.getDirectory();
    }
    return opfsRoot || null;
  }
  function opfsSupported() { return !!(navigator.storage && navigator.storage.getDirectory); }

  async function saveImageBlob(blob) {
    if (opfsSupported()) {
      var root = await opfsInit();
      var name = uid() + '.img';
      var fh = await root.getFileHandle(name, { create: true });
      var w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return { backend: 'opfs', name: name };
    }
    var key = await tx('blobs', 'readwrite', function (s) { return s.add(blob); });
    return { backend: 'idb', id: key };
  }

  async function loadImageBlob(ref) {
    if (!ref) return null;
    if (ref.backend === 'opfs') {
      try {
        var root = await opfsInit();
        var fh = await root.getFileHandle(ref.name);
        return fh.getFile();
      } catch (e) { return null; }
    }
    return (await getOne('blobs', ref.id)) || null;
  }

  async function deleteImageBlob(ref) {
    if (!ref) return;
    if (ref.backend === 'opfs') {
      try { var root = await opfsInit(); await root.removeEntry(ref.name); } catch (e) { /* ignore */ }
    } else { await del('blobs', ref.id); }
  }

  async function opfsClear() {
    if (!opfsSupported()) return;
    var root = await opfsInit();
    for await (var name of root.keys()) {
      try { await root.removeEntry(name); } catch (e) { /* ignore */ }
    }
  }

  // ---------- images ----------
  async function addImage(opts) {
    var id = uid();
    var ref = await saveImageBlob(opts.blob);
    await put('images', {
      id: id,
      kind: opts.kind,
      caption: opts.caption || '',
      ref: ref,
      isMain: !!opts.isMain,
      meta: opts.meta || {},
      createdAt: Date.now()
    });
    return id;
  }

  async function putImageRecord(rec) { await put('images', rec); }

  async function getImages(kind) {
    var all = await getAll('images');
    return all.filter(function (i) { return !kind || i.kind === kind; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  async function getImage(id) { return getOne('images', id); }

  async function deleteImage(id) {
    var rec = await getImage(id);
    if (rec) await deleteImageBlob(rec.ref);
    await del('images', id);
  }

  async function setMainImage(id, kind) {
    var all = await getImages(kind);
    for (var i = 0; i < all.length; i++) {
      await put('images', Object.assign({}, all[i], { isMain: all[i].id === id }));
    }
  }

  async function getMainImage(kind) {
    var all = await getImages(kind);
    var main = all.filter(function (i) { return i.isMain; })[0] || null;
    return main;
  }

  // ---------- wishes ----------
  async function getWishes() {
    var all = await getAll('wishes');
    return all.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }
  async function addWish(w) {
    var id = uid();
    await put('wishes', Object.assign({ id: id, createdAt: Date.now() }, w));
    return id;
  }
  async function updateWish(w) { await put('wishes', w); }
  async function deleteWish(id) { await del('wishes', id); }

  // ---------- rewards ----------
  async function getRewards() {
    var all = await getAll('rewards');
    return all.sort(function (a, b) { return (b.completedAt || 0) - (a.completedAt || 0); });
  }
  async function addReward(r) {
    var id = uid();
    await put('rewards', Object.assign({ id: id, createdAt: Date.now() }, r));
    return id;
  }
  async function deleteReward(id) { await del('rewards', id); }

  // ---------- journal ----------
  async function getJournal(date) { return getOne('journal', date); }
  async function getJournals() {
    var all = await getAll('journal');
    return all.sort(function (a, b) { return (a.date > b.date ? -1 : 1); });
  }
  async function saveJournal(entry) { await put('journal', entry); }
  async function deleteJournal(date) { await del('journal', date); }

  // ---------- custom mind ----------
  async function getCustomMind() { return getAll('customMind'); }
  async function addCustomMind(m) {
    var id = uid();
    await put('customMind', Object.assign({ id: id }, m));
    return id;
  }
  async function deleteCustomMind(id) { await del('customMind', id); }

  // ---------- storage / cleanup ----------
  async function estimate() {
    if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate();
    return { usage: null, quota: null };
  }

  async function clearAll() {
    var stores = ['meta', 'images', 'blobs', 'wishes', 'rewards', 'journal', 'customMind'];
    for (var i = 0; i < stores.length; i++) await clearStore(stores[i]);
    await opfsClear();
  }

  return {
    open: open,
    metaGet: metaGet, metaSet: metaSet, metaDel: metaDel,
    opfsSupported: opfsSupported,
    saveImageBlob: saveImageBlob, loadImageBlob: loadImageBlob, deleteImageBlob: deleteImageBlob, opfsClear: opfsClear,
    addImage: addImage, putImageRecord: putImageRecord, getImages: getImages, getImage: getImage,
    deleteImage: deleteImage, setMainImage: setMainImage, getMainImage: getMainImage,
    getWishes: getWishes, addWish: addWish, updateWish: updateWish, deleteWish: deleteWish,
    getRewards: getRewards, addReward: addReward, deleteReward: deleteReward,
    getJournal: getJournal, getJournals: getJournals, saveJournal: saveJournal, deleteJournal: deleteJournal,
    getCustomMind: getCustomMind, addCustomMind: addCustomMind, deleteCustomMind: deleteCustomMind,
    estimate: estimate, clearAll: clearAll
  };
})();
