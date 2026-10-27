/**
 * 淘宝 / 天猫 MAIN World Script
 *
 * 跑在 MAIN world（不是 ISOLATED），能访问页面 window 上的数据
 * （ISOLATED content script 被 Chrome 世界隔离挡住，读不到页面 window）。
 * 通过 CustomEvent 桥（tb-req / tb-res）把数据回传给 ISOLATED 的 taobao-product.js。
 *
 * 淘宝数据很多是 mtop 接口异步加载，页面 window 上不一定有全；
 * 这里尽量把常见入口都试一遍 + 扫描 window 上含 item/sku/price 的全局对象，
 * 拿不到也没关系——ISOLATED 那边以 DOM 提取为主。
 */
(function () {
  'use strict';

  document.addEventListener('tb-req', function (event) {
    if (!event.detail || event.detail.action !== 'getWindowData') return;

    var out = { found: {}, raw: null, source: null, scanKeys: [] };

    function pick(getter) {
      try { var v = getter(); return (v !== undefined && v !== null) ? v : undefined; }
      catch (e) { return undefined; }
    }

    // 淘宝 / 天猫常见的数据入口（不同模板各异）
    var candidates = {
      'runParams':       function () { return window.runParams; },          // 天猫/淘宝详情常见
      '__INIT_DATA__':   function () { return window.__INIT_DATA__; },
      '__GLOBAL_DATA':   function () { return window.__GLOBAL_DATA; },
      'g_config':        function () { return window.g_config; },
      'g_page_config':   function () { return window.g_page_config; },
      'TShop':           function () { return window.TShop && window.TShop.Setup; },
      '__NEXT_DATA__':   function () { return window.__NEXT_DATA__; },
      'Hub':             function () { return window.Hub && window.Hub.config; }
    };

    var picked = null, pickedKey = null;
    for (var k in candidates) {
      if (!candidates.hasOwnProperty(k)) continue;
      var v = pick(candidates[k]);
      if (v !== undefined) {
        out.found[k] = true;
        if (!picked && typeof v === 'object') { picked = v; pickedKey = k; }
      }
    }

    // 兜底：扫描 window 上含关键字的全局对象（帮后续认数据藏哪）
    try {
      for (var wk in window) {
        if (/item|sku|price|detail|mainData|valItem|apiStack/i.test(wk)) {
          var t = typeof window[wk];
          if (t === 'object' || t === 'function') out.scanKeys.push(wk);
        }
      }
    } catch (e) {}
    out.scanKeys = out.scanKeys.slice(0, 50);
    out.source = pickedKey;

    // raw 只在能 JSON 序列化时带回（避免循环引用炸掉桥）
    try { out.raw = picked ? JSON.parse(JSON.stringify(picked)) : null; }
    catch (e) { out.raw = null; out.rawError = 'not serializable'; }

    document.dispatchEvent(new CustomEvent('tb-res', { detail: out }));
  });
})();
