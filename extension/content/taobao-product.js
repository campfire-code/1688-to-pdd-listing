/**
 * 淘宝 / 天猫 商品提取 (ISOLATED world)
 *
 * 策略：DOM 提取为主（最稳）——淘宝数据多是 mtop 异步加载、页面 window 上不全，
 *      class 名还带 hash 经常变，所以从"你眼睛看到的已渲染页面"上抓最可靠；
 *      辅以 MAIN world 通过 tb-req/tb-res 桥拿到的 window 数据。
 *
 * 统一输出和 1688 一样的字段，直接进同一个产品库：
 *   productName / images / detailImages / skuList[{name,specDesc,purchasePrice}]
 *   / sourceUrl / description
 *
 * ⚠️ 第一版：DOM 选择器是按淘宝常见结构写的，可能不全。
 *    配套的「诊断」会 dump 真实页面结构，据此再把字段调准。
 */
(function () {
  'use strict';

  function abs(u) { try { return new URL(u, location.origin).href; } catch (e) { return u; } }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function txt(sel) { var el = document.querySelector(sel); return el ? clean(el.textContent) : ''; }
  function attr(sel, a) { var el = document.querySelector(sel); return el ? (el.getAttribute(a) || '') : ''; }
  function qsa(sel) { try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { return []; } }
  function metaC(p) { var el = document.querySelector('meta[property="' + p + '"]'); return el ? (el.getAttribute('content') || '') : ''; }
  function uniqPush(out, seen, url) {
    url = normImg(url);
    if (!url || !isGoodImage(url)) return;
    var key = url.split('?')[0];
    if (!seen[key]) { seen[key] = 1; out.push(url); }
  }
  function isGoodImage(s) {
    return !!(s && (/\.(jpe?g|png|webp)(?:$|[?_])/i.test(s) || /alicdn\.com|tbcdn|taobaocdn|gtimg/i.test(s))
      && !/(spacer|blank|1x1|placeholder|loading|\.gif|grey\.gif|transparent)/i.test(s));
  }

  // 向 MAIN world 要 window 数据（拿不到 1.2s 后超时返回空）
  function getWindowData(cb) {
    var done = false;
    function onRes(e) { if (done) return; done = true; document.removeEventListener('tb-res', onRes); cb(e.detail || {}); }
    document.addEventListener('tb-res', onRes);
    document.dispatchEvent(new CustomEvent('tb-req', { detail: { action: 'getWindowData' } }));
    setTimeout(function () { if (!done) { done = true; document.removeEventListener('tb-res', onRes); cb({}); } }, 1200);
  }

  function offerId() { var m = location.href.match(/[?&]id=(\d+)/); return m ? m[1] : ''; }

  // ── 标题 ──
  function extractTitle() {
    return txt('h1')
        || txt('[class*="mainTitle"]') || txt('[class*="ItemTitle"]') || txt('[class*="itemTitle"]')
        || txt('[class*="title--"]')
        || metaC('og:title')
        || clean(document.title.replace(/[-_]\s*淘宝(网)?\s*$/, '').replace(/[-_]\s*天猫.*$/, ''));
  }

  // ── 主图 ──（去掉淘宝图片尺寸后缀拿大图）
  function normImg(s) {
    if (!s) return '';
    s = s.replace(/^\/\//, 'https://');
    s = s.replace(/_\d+x\d+(q\d+)?(\.\w+)?\.(jpg|png|webp)/i, '.$3'); // _400x400.jpg_ → .jpg
    s = s.replace(/\.(jpg|png|webp)_\.webp$/i, '.$1');
    return abs(s);
  }
  function collectImagesFromHtml(html) {
    var out = [], seen = {};
    html = String(html || '')
      .replace(/\\u002F/g, '/')
      .replace(/\\\//g, '/')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    var attrRe = /\b(?:src|data-src|data-ks-lazyload|data-lazy-src)\s*=\s*["']([^"']+)["']/ig;
    var m;
    while ((m = attrRe.exec(html))) uniqPush(out, seen, m[1]);
    var urlRe = /(?:https?:)?\/\/[^"'\\\s<>]+(?:alicdn|tbcdn|taobaocdn)[^"'\\\s<>]*/ig;
    while ((m = urlRe.exec(html))) uniqPush(out, seen, m[0]);
    return out;
  }
  function extractImages() {
    var out = [], seen = {};
    qsa('[class*="thumbnail"] img, [class*="Thumbnail"] img, [class*="PicGallery"] img, ul[class*="thumbnails"] img, [class*="mainPic"] img').forEach(function (im) {
      var s = im.getAttribute('src') || im.getAttribute('data-src') || im.getAttribute('data-ks-lazyload') || '';
      s = normImg(s);
      if (s) { var key = s.split('?')[0]; if (!seen[key]) { seen[key] = 1; out.push(s); } }
    });
    if (out.length === 0) { var og = normImg(metaC('og:image')); if (og) out.push(og); }
    return out.slice(0, 15);
  }

  // ── 价格 ──
  function extractPrice() {
    var cand = txt('[class*="Price--priceText"]') || txt('[class*="priceText"]')
            || txt('[class*="Price--"]') || txt('[class*="price--"]')
            || txt('.tm-price') || txt('#J_StrPrice') || txt('[class*="price"]');
    // 文本常是"店铺优惠后￥99优惠前￥199"，取所有金额里最小的（= 优惠后实际售价）
    var nums = (cand || '').match(/\d+(\.\d+)?/g);
    if (!nums || !nums.length) return null;
    var vals = nums.map(parseFloat).filter(function (v) { return v > 0; });
    return vals.length ? Math.min.apply(null, vals) : null;
  }

  // ── SKU ──
  function extractSku() {
    var out = [], seen = {};
    var noise = /切换|大图|模式|^颜色分类|^尺[码寸]|近期|热销|^请选择|查看|付款/;
    qsa('[class*="valueItem"], [class*="SkuItem"], [class*="skuItem"], [class*="sku"] [data-value]').forEach(function (el) {
      // 优先取 title / data-value / 图片 alt，避免抓到容器整块脏文本
      var name = clean(el.getAttribute('title') || el.getAttribute('data-value') || '');
      if (!name) {
        if (el.children.length === 0) name = clean(el.textContent);
        else { var img = el.querySelector('img'); name = img ? clean(img.getAttribute('alt') || '') : ''; }
      }
      if (name && name.length <= 14 && !noise.test(name) && !seen[name]) {
        seen[name] = 1; out.push({ name: name, specDesc: name, purchasePrice: 0 });
      }
    });
    return out;
  }

  // ── 详情图 ──
  function extractDetailImages() {
    var out = [], seen = {};
    qsa('[class*="descV8"] img, [class*="Description"] img, #description img, [class*="detail-desc"] img, [id*="desc"] img, [class*="detail"] img').forEach(function (im) {
      // 淘宝详情图懒加载：真实地址多在 data-src / data-ks-lazyload，src 常是占位图 → 优先取懒加载属性
      var s = im.getAttribute('data-src') || im.getAttribute('data-ks-lazyload') || im.getAttribute('data-lazy-src') || im.getAttribute('src') || '';
      uniqPush(out, seen, s);
    });
    return out.slice(0, 40);
  }

  function collectDescHints(winData) {
    var urls = [], htmls = [];
    var seenUrl = {}, seenHtml = {};
    function addUrl(u) {
      if (!u) return;
      u = String(u).replace(/^\/\//, 'https://').replace(/\\\//g, '/').replace(/\\u002F/g, '/');
      if (!/^https?:\/\//.test(u)) return;
      if (!/(desc|apiItemDesc|description|taobaocdn|alicdn|tbcdn|itemcdn|dsc)/i.test(u)) return;
      if (!seenUrl[u]) { seenUrl[u] = 1; urls.push(u); }
    }
    function addHtml(h) {
      h = String(h || '');
      if (h.length < 20 || !/<img/i.test(h)) return;
      if (!seenHtml[h]) { seenHtml[h] = 1; htmls.push(h); }
    }
    function walk(v, depth, key) {
      if (depth > 5 || v == null) return;
      if (typeof v === 'string') {
        if (/desc|apiItemDesc|description|html/i.test(key || '')) addHtml(v);
        var re = /(?:https?:)?\/\/[^"'\\\s<>]+/ig, m;
        while ((m = re.exec(v))) addUrl(m[0]);
        addHtml(v);
        return;
      }
      if (typeof v !== 'object') return;
      if (Array.isArray(v)) { v.slice(0, 80).forEach(function (x) { walk(x, depth + 1, key); }); return; }
      Object.keys(v).slice(0, 120).forEach(function (k) {
        if (/desc|apiItemDesc|description|itemDesc|detail|html/i.test(k)) {
          if (typeof v[k] === 'string') { addUrl(v[k]); addHtml(v[k]); }
        }
        walk(v[k], depth + 1, k);
      });
    }
    walk(winData && winData.raw, 0, '');
    return { urls: urls.slice(0, 4), htmls: htmls.slice(0, 8) };
  }

  function mergeDetailImages(product, imgs) {
    var out = [], seen = {};
    (product.detailImages || []).concat(imgs || []).forEach(function (u) { uniqPush(out, seen, u); });
    product.detailImages = out.slice(0, 40);
  }

  function buildProduct(winData) {
    var price = extractPrice();
    var sku = extractSku();
    if (price != null && sku.length) sku.forEach(function (s) { if (!s.purchasePrice) s.purchasePrice = price; });
    if (price != null && !sku.length) sku = [{ name: '默认', specDesc: '默认规格', purchasePrice: price }];
    var detailImages = extractDetailImages();
    var hints = collectDescHints(winData || {});
    hints.htmls.forEach(function (h) { detailImages = detailImages.concat(collectImagesFromHtml(h)); });
    var deduped = [], seen = {};
    detailImages.forEach(function (u) { uniqPush(deduped, seen, u); });
    return {
      productName: extractTitle(),
      images: extractImages(),
      detailImages: deduped.slice(0, 40),
      skuList: sku,
      sourceUrl: location.href.replace(/(&|\?)(mi_id|pvid|scm|spm|utparam|xxc|skuId)=[^&]*/g, ''),
      description: '',
      detailHtml: hints.htmls[0] || '',
      _descFetchUrls: hints.urls,
      // 给后端区分平台 / 取 id 用
      platform: /tmall\.com/.test(location.host) ? 'tmall' : 'taobao',
      taobaoId: offerId(),
      timestamp: Date.now()
    };
  }

  function fetchDescHtml(url, cb) {
    if (!url || typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return cb('');
    try {
      chrome.runtime.sendMessage({ action: 'fetchTaobaoDesc', url: url }, function (resp) {
        cb((resp && resp.html) || '');
      });
    } catch (e) { cb(''); }
  }

  function doExtract(cb) {
    getWindowData(function (winData) {
      var product = buildProduct(winData);
      var urls = product._descFetchUrls || [];
      function finish() {
        delete product._descFetchUrls;
        cb(product);
      }
      if (!urls.length || product.detailImages.length >= 5) {
        finish(); return;
      }
      var idx = 0;
      function next() {
        if (idx >= urls.length || product.detailImages.length >= 5) {
          finish(); return;
        }
        fetchDescHtml(urls[idx++], function (html) {
          if (html) {
            product.detailHtml = product.detailHtml || html;
            mergeDetailImages(product, collectImagesFromHtml(html));
          }
          next();
        });
      }
      next();
    });
  }

  function isProductPageUrl(url) {
    url = String(url || '');
    return /\/item\.htm(?:$|[?#])|\/item\/[^/?#]+|\/awp\/core\/detail\.htm|\/security-h5-detail\/home|[?&](id|itemId|item_id|item_num_id)=\d+/i.test(url);
  }

  function detectPageBlock() {
    var url = location.href;
    var title = clean(document.title);
    var text = qsa('body *')
      .filter(function (el) { return el.children.length === 0; })
      .map(function (el) { return clean(el.textContent); })
      .filter(Boolean)
      .slice(0, 140)
      .join(' ');
    var hasLoginUi = /登录|立即登录|扫码登录|密码登录|手机登录|淘宝账号登录|账号登录/.test(text) ||
      !!document.querySelector('input[type="password"], iframe[src*="login"], iframe[src*="passport"], [class*="login"], [id*="login"], [class*="Login"], [id*="Login"], [class*="notLogin"], [class*="NotLogin"]');
    if (/login|passport/i.test(url) || hasLoginUi) {
      return '页面需要登录：请先在浏览器里完成淘宝/天猫登录，然后刷新商品页再采集';
    }
    var hasCaptchaUi = /真人验证|人机验证|安全验证|请完成验证|验证码|滑块|拖动滑块|向右滑动|验证后继续|baxia|punish|captcha/i.test(text + ' ' + title) ||
      !!document.querySelector('iframe[src*="captcha"], iframe[src*="baxia"], iframe[src*="punish"], [class*="captcha"], [class*="baxia"], [class*="punish"], #nc, .nc-container');
    if (hasCaptchaUi) {
      return '页面出现真人验证：请先在浏览器里完成验证，然后刷新商品页再采集';
    }
    return '';
  }

  // 诊断：dump 真实页面结构（标题/价格/图/sku 候选 + class 名采样），发给开发者据此调字段
  function doDebug(cb) {
    getWindowData(function (winData) {
      cb({
        url: location.href,
        host: location.host,
        title_h1: txt('h1'),
        title_og: metaC('og:title'),
        doc_title: document.title,
        price_candidates: ['[class*="priceText"]', '[class*="Price--"]', '.tm-price', '[class*="price"]'].map(function (s) { return s + ' => ' + txt(s); }),
        img_thumb_count: qsa('[class*="thumbnail"] img,[class*="PicGallery"] img,[class*="mainPic"] img').length,
        og_image: metaC('og:image'),
        sku_candidates: qsa('[class*="valueItem"],[class*="SkuItem"],[class*="skuItem"]').slice(0, 10).map(function (e) { return clean(e.textContent).slice(0, 30); }),
        detail_img_count: qsa('[class*="descV8"] img,[class*="Description"] img,[id*="desc"] img').length,
        win_source: winData.source || null,
        win_found: winData.found || {},
        win_scanKeys: winData.scanKeys || [],
        sample_classes: qsa('[class]').slice(0, 80).map(function (e) { return typeof e.className === 'string' ? e.className : ''; }).filter(Boolean).slice(0, 50)
      });
    });
  }

  // 上报：当前是淘宝商品页 → 让 background/popup 启用采集按钮
  try {
    var initialBlockReason = detectPageBlock();
    chrome.runtime.sendMessage({
      action: 'pageReady',
      url: location.href,
      isProductPage: isProductPageUrl(location.href),
      platform: /tmall\.(com|hk)/.test(location.host) ? 'tmall' : 'taobao',
      pageBlockReason: initialBlockReason
    });
  } catch (e) {}

  chrome.runtime.onMessage.addListener(function (req, sender, sendResponse) {
    if (req.action === 'ping') { sendResponse({ online: true, isProductPage: true, platform: 'taobao' }); return false; }
    if (req.action === 'extract') {
      var blockReason = detectPageBlock();
      if (blockReason) { sendResponse({ success: false, error: blockReason, pageBlockReason: blockReason }); return false; }
      doExtract(function (p) { sendResponse({ success: true, data: p }); });
      return true;
    }
    if (req.action === 'debug') { doDebug(function (d) { sendResponse({ success: true, debug: d }); }); return true; }
    sendResponse({ success: false, error: 'unknown action: ' + req.action }); return false;
  });
})();
