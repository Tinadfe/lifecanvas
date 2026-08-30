// gen.js — v0.2 生图工坊：对接硅基流动 SiliconFlow 图像生成 API
// 文档：https://docs.siliconflow.cn/cn/api-reference/images/images-generations
// CORS 已开放，浏览器可直接调用。API Key 只保存在本机，仅生成时发送给服务商。
'use strict';

var GEN = (function () {
  // 硅基流动有国内站(.cn)与国际站(.com)，账号/Key 互不相通。
  // 自动逐个尝试，记住哪个端点接受你的 Key。
  var API_BASES = [
    'https://api.siliconflow.cn/v1/images/generations',
    'https://api.siliconflow.com/v1/images/generations'
  ];

  var MODELS = [
    { key: 'Qwen/Qwen-Image-Edit', label: '通义千问 Qwen-Image-Edit（传参考图·像你）', needRef: true, sites: ['cn'] },
    { key: 'Qwen/Qwen-Image', label: '通义千问 Qwen-Image（纯文生图·画质高）', needRef: false, sites: ['cn'] },
    { key: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1-schnell（快速）', needRef: false, sites: ['cn', 'com'] },
    { key: 'black-forest-labs/FLUX.1-dev', label: 'FLUX.1-dev（高画质）', needRef: false, sites: ['cn', 'com'] },
    { key: 'black-forest-labs/FLUX-1.1-pro', label: 'FLUX-1.1-pro（旗舰画质）', needRef: false, sites: ['cn', 'com'] }
  ];

  // 根据 Key 所在站点返回可用模型（.com 没有 Qwen 系列）
  function availableModels(apiBase) {
    var site = apiBase && apiBase.indexOf('.cn') >= 0 ? 'cn' : 'com';
    return MODELS.filter(function (m) { return m.sites.indexOf(site) >= 0; });
  }

  function siteLabel(apiBase) {
    return apiBase && apiBase.indexOf('.cn') >= 0 ? '国内站(.cn)' : '国际站(.com)';
  }

  async function loadSettings() { return (await DB.metaGet('genSettings')) || {}; }
  async function saveSettings(s) { await DB.metaSet('genSettings', s); }

  // 图片尺寸：Qwen 系用 3:4 人像；FLUX 用 768x1024
  function sizeFor(model, ratio) {
    if (ratio === 'square') {
      return model.indexOf('Qwen') === 0 ? '1328x1328' : '1024x1024';
    }
    return model.indexOf('Qwen') === 0 ? '1140x1472' : '768x1024';
  }

  // 单次请求（指定端点）
  async function callOnceAt(base, opts) {
    var body = {
      model: opts.model,
      prompt: opts.prompt,
      image_size: opts.size || sizeFor(opts.model, opts.ratio || 'portrait')
    };
    if (opts.imageDataUrl) body.image = opts.imageDataUrl;
    if (opts.batch) body.batch_size = opts.batch;
    if (opts.model.indexOf('FLUX.1-dev') >= 0) {
      body.num_inference_steps = 30; // FLUX.1-dev 必填参数，30 步画质更好
      body.guidance_scale = 3.5;
    }
    if (opts.model.indexOf('Qwen') === 0) {
      body.negative_prompt = '低质量，模糊，变形，多余的肢体或手指，文字，水印，衰老的皮肤，皱纹';
    }
    var res = await fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + opts.apiKey
      },
      body: JSON.stringify(body)
    });
    var data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) {
      var msg = (data && data.message) ? data.message : ('HTTP ' + res.status);
      var err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    var urls = [];
    if (data && data.images) {
      for (var i = 0; i < data.images.length; i++) {
        if (data.images[i] && data.images[i].url) urls.push(data.images[i].url);
      }
    }
    return urls;
  }

  // 智能端点：先试记住的端点，失败（401/网络/其他）时自动换另一个站
  async function callOnce(opts) {
    var settings = await loadSettings();
    var pref = settings.apiBase || API_BASES[0];
    var bases = [pref].concat(API_BASES.filter(function (b) { return b !== pref; }));
    var errors = [];
    for (var i = 0; i < bases.length; i++) {
      try {
        var urls = await callOnceAt(bases[i], opts);
        if (bases[i] !== settings.apiBase) {
          settings.apiBase = bases[i];
          await saveSettings(settings);
        }
        return urls;
      } catch (err) {
        errors.push({ base: bases[i], err: err });
      }
    }
    // 两个站都失败：优先抛非 401 错误（说明 Key 已被某站接受，是账号/模型问题，如 403/402）；
    // 全部是 401 才说明 Key 本身无效。附带每个站点的详细结果。
    var authOkErr = errors.filter(function (e) { return e.err.status !== 401; })[0];
    var finalErr = authOkErr || errors[0];
    if (finalErr) {
      finalErr.err.details = errors.map(function (e) {
        return {
          site: e.base.indexOf('.cn') >= 0 ? '国内站(.cn)' : '国际站(.com)',
          status: e.err.status,
          message: e.err.message
        };
      });
      throw finalErr.err;
    }
    throw new Error('两个站点都无法连接');
  }

  // 生成 4 张候选图：Qwen 系一次出 4 张；FLUX 并发 4 次各出 1 张
  async function generate(opts) {
    var isFlux = opts.model.indexOf('black-forest-labs') === 0;
    if (isFlux) {
      var results = await Promise.all([0, 1, 2, 3].map(function () {
        return callOnce(Object.assign({}, opts, { batch: 1 }));
      }));
      var urls = [];
      results.forEach(function (r) { urls = urls.concat(r); });
      return urls;
    }
    return callOnce(Object.assign({}, opts, { batch: 4 }));
  }

  // 下载生成的图片到本地 Blob（生成 URL 仅 1 小时有效，须立即保存）
  // 自动重试 2 次，并区分「跨域拦截」与「HTTP 错误」
  async function downloadToBlob(url) {
    var lastErr = null;
    for (var i = 0; i < 3; i++) {
      try {
        var res = await fetch(url);
        if (!res.ok) throw new Error('下载图片失败 (HTTP ' + res.status + ')');
        return await res.blob();
      } catch (err) {
        lastErr = err;
        await new Promise(function (r) { setTimeout(r, 600 * (i + 1)); });
      }
    }
    if (lastErr && lastErr.message && lastErr.message.indexOf('Failed to fetch') >= 0) {
      throw new Error('图片下载被浏览器跨域拦截（图片服务器未开放跨域权限）——请把完整提示发给我，我来处理');
    }
    throw lastErr;
  }

  // 测试 Key：用免费模型发一个最小请求
  async function testKey(apiKey) {
    var urls = await callOnce({
      apiKey: apiKey,
      model: 'black-forest-labs/FLUX.1-schnell',
      prompt: 'a small red apple on a white table, studio light',
      size: '1024x1024',
      ratio: 'square'
    });
    return urls.length > 0;
  }

  // 诊断：分模型、分站点发最小请求，返回详细结果
  async function diagnose(apiKey) {
    var results = [];
    for (var i = 0; i < API_BASES.length; i++) {
      var base = API_BASES[i];
      var site = base.indexOf('.cn') >= 0 ? '国内站(.cn)' : '国际站(.com)';
      var models = base.indexOf('.cn') >= 0
        ? ['black-forest-labs/FLUX.1-schnell', 'Qwen/Qwen-Image']
        : ['black-forest-labs/FLUX.1-schnell'];
      for (var m = 0; m < models.length; m++) {
        var modelShort = models[m].split('/')[1];
        try {
          await callOnceAt(base, {
            apiKey: apiKey,
            model: models[m],
            prompt: 'a small red apple on a white table, studio light',
            size: '1024x1024',
            ratio: 'square'
          });
          results.push({ site: site + ' · ' + modelShort, ok: true });
        } catch (err) {
          results.push({ site: site + ' · ' + modelShort, ok: false, status: err.status || 0, message: err.message });
        }
      }
    }
    return results;
  }

  return {
    MODELS: MODELS,
    availableModels: availableModels,
    siteLabel: siteLabel,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    sizeFor: sizeFor,
    generate: generate,
    downloadToBlob: downloadToBlob,
    testKey: testKey,
    diagnose: diagnose
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = GEN; }
