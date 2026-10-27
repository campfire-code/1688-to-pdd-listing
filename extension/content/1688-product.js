/**
 * 1688 Product Page Content Script — v0.5.6
 *
 * Extracts product data from detail.1688.com/offer/* pages.
 * v0.5: globalDataModel + tmall CDN desc
 * v0.5.1: fix duplicate finalizeWithDesc + image extraction fallbacks
 * v0.5.2: template detection + patchImages + DOM image fallback
 * v0.5.3: fix imageList (fullPathImageURI) + skuProps fallback for modern_basic
 * v0.5.5: pieceWeightScaleInfo extraction for per-SKU packaging dimensions & weight
 * v0.5.6: fix tmall CDN desc parsing (var desc='...' format) + host_permissions + bypass CORS fetch
 *
 * Strategy from dxm_crawl 2.7.91:
 *   - Modern 1688 template: window.context.result.global.globalData.model
 *   - __INIT_DATA in ISOLATED world (direct access, no bridge needed)
 *   - Data not instant-ready; poll until modules populated
 *   - DOM fallback with broad selectors
 */

(function () {
  'use strict';

  var href = window.location.href;
  if (!/^https:\/\/detail\.1688\.com\/offer\//.test(href)) return;
  var offerId = (href.match(/offer\/(\d+)\.html/) || [])[1] || '';

  var MAX_POLL_TIME = 5000;
  var POLL_INTERVAL = 300;
  var MAX_POLLS = Math.ceil(MAX_POLL_TIME / POLL_INTERVAL);

  function toAbsolute(url) {
    if (!url) return '';
    try { return new URL(url, window.location.origin).href; } catch(e) { return url; }
  }

  function isValidImage(url) {
    if (!url || url.startsWith('data:')) return false;
    var L = url.toLowerCase();
    if (L.endsWith('.svg')) return false;
    var bad = ['transparent','spacer','blank','1x1','placeholder','avatar','logo','icon','-tps-','_sum','gg_dtc','-gg_'];
    for (var i = 0; i < bad.length; i++) { if (L.indexOf(bad[i]) !== -1) return false; }
    return true;
  }

  // ── Template detection (v0.5.2) ──
  // Detects which 1688 template the current page uses
  function detectTemplate() {
    var model = null;
    try {
      model = window.context && window.context.result &&
              window.context.result.global && window.context.result.global.globalData &&
              window.context.result.global.globalData.model;
    } catch(e) {}

    if (model && model.offerDetail && model.offerDetail.subject) {
      // Modern template detected — check SKU sub-type
      var hasNySku = !!(model.customizedProcessingModel &&
                        model.customizedProcessingModel.nySkuModel &&
                        model.customizedProcessingModel.nySkuModel.skuInfoMap);
      var hasSkuModel = !!(model.customizedProcessingModel &&
                           model.customizedProcessingModel.skuModel);
      if (hasNySku) {
        console.log('[篝火采集] Template: modern_nySku (A)');
        return 'modern_nySku';
      }
      if (hasSkuModel) {
        console.log('[篝火采集] Template: modern_skuModel (B)');
        return 'modern_skuModel';
      }
      console.log('[篝火采集] Template: modern_basic (C) — no structured SKU');
      return 'modern_basic';
    }

    // Check for old __INIT_DATA template
    var init = window.__INIT_DATA || window.__detail_data__;
    if (init && init.result && init.result.data && init.result.data.productTitle) {
      console.log('[篝火采集] Template: old_initData (D)');
      return 'old_initData';
    }

    console.log('[篝火采集] Template: dom_only (E)');
    return 'dom_only';
  }

  // ── Patch images from multiple sources (v0.5.2: enhanced) ──
  function patchImages(result) {
    var found = 0;

    // Path 1: __INIT_DATA.result.data.gallery.fields.offerImgList
    try {
      var init = window.__INIT_DATA || window.__detail_data__;
      if (init) {
        var rd = init.result && init.result.data;
        if (rd && rd.gallery && rd.gallery.fields && rd.gallery.fields.offerImgList) {
          var list = rd.gallery.fields.offerImgList;
          for (var i = 0; i < list.length; i++) {
            var src = String(list[i]).trim();
            if (src && src.startsWith('http') && isValidImage(src)) {
              result.images.push(toAbsolute(src)); found++;
            }
          }
          console.log('[篝火采集] patchImages: path1 (offerImgList) → ' + found + ' imgs');
        }
      }
    } catch(e) {}

    // Path 2: __INIT_DATA.result.global.offerDetail.images
    if (found === 0) try {
      var init2 = window.__INIT_DATA || window.__detail_data__;
      if (init2) {
        var gl = init2.result && init2.result.global;
        if (gl && gl.offerDetail) {
          var odImages = gl.offerDetail.images || gl.offerDetail.imageList || [];
          for (var j = 0; j < odImages.length; j++) {
            var s = typeof odImages[j] === 'string' ? odImages[j] : (odImages[j].fullPathImageURI || odImages[j].url || odImages[j].src || odImages[j].summImageURI || '');
            if (s && s.startsWith('http') && isValidImage(s)) {
              result.images.push(toAbsolute(s)); found++;
            }
          }
          console.log('[篝火采集] patchImages: path2 (global.offerDetail) → ' + found + ' imgs');
        }
      }
    } catch(e) {}

    // Path 5 (v0.5.3): window.context.result.global.globalData.model.offerDetail.imageList
    if (found === 0) try {
      var ctxModel = window.context && window.context.result && window.context.result.global &&
                     window.context.result.global.globalData && window.context.result.global.globalData.model;
      if (ctxModel && ctxModel.offerDetail) {
        var ctxImgs = ctxModel.offerDetail.imageList || ctxModel.offerDetail.images || [];
        for (var ci = 0; ci < ctxImgs.length; ci++) {
          var cs = '';
          if (typeof ctxImgs[ci] === 'string') {
            cs = ctxImgs[ci];
          } else if (ctxImgs[ci] && typeof ctxImgs[ci] === 'object') {
            cs = ctxImgs[ci].fullPathImageURI || ctxImgs[ci].url || ctxImgs[ci].src || ctxImgs[ci].summImageURI || '';
          }
          if (cs && cs.startsWith('http') && isValidImage(cs)) {
            result.images.push(toAbsolute(cs)); found++;
          }
        }
        console.log('[篝火采集] patchImages: path5 (window.context.model.imageList) → ' + found + ' imgs');
      }
    } catch(e) {}

    // Path 3: DOM extraction (modern selectors)
    if (found === 0) {
      try {
        var domImgs = extractDomImages();
        for (var k = 0; k < domImgs.length; k++) {
          if (result.images.indexOf(domImgs[k]) === -1) {
            result.images.push(domImgs[k]); found++;
          }
        }
        console.log('[篝火采集] patchImages: path3 (DOM) → ' + found + ' imgs');
      } catch(e) {}
    }

    // Path 4: Use first N detailImages as main images
    if (found === 0 && result.detailImages && result.detailImages.length > 0) {
      var maxFromDetail = Math.min(10, result.detailImages.length);
      for (var d = 0; d < maxFromDetail; d++) {
        result.images.push(result.detailImages[d]); found++;
      }
      console.log('[篝火采集] patchImages: path4 (detailImages fallback) → ' + found + ' imgs');
    }
  }

  // Quick DOM image grab (used by patchImages)
  function extractDomImages() {
    var urls = [];
    var seen = {};
    // Modern template selectors + classic
    var sels = [
      'img[src*="cbu01.alicdn.com"]', 'img[src*="img.alicdn.com/imgextra"]',
      'img[data-src*="alicdn.com"]', 'img[src*="alicdn.com/img/ibank"]',
      '.mod-detail-gallery img', '.detail-gallery img',
      '.od-pc-offer-main-image img', '[class*="gallery"] img:not([class*="lazy"])',
    ];
    for (var is = 0; is < sels.length; is++) {
      var els = document.querySelectorAll(sels[is]);
      for (var ii = 0; ii < els.length; ii++) {
        var src = els[ii].getAttribute('src') || els[ii].getAttribute('data-src') || '';
        var clean = src.split('?')[0].split('_').slice(0, -1).join('_') || clean;
        if (src && src.startsWith('http') && isValidImage(src) && !seen[clean]) {
          seen[clean] = true;
          urls.push(toAbsolute(src));
        }
      }
      if (urls.length >= 10) break;
    }
    return urls;
  }

  // ── parseGlobalDataModel: Modern 1688 template (2025-2026) ──
  // Verified via opencli-browser: model.offerDetail has ALL structured data
  //   subject, imageList, featureAttributes, detailUrl, leafCategoryId
  // model.customizedProcessingModel.nySkuModel has SKU names + prices + stock
  // model.detailDescription.freightInfo has unitWeight (g), location
  // model.tradeModel has minPrice, maxPrice, beginAmount

  function parseGlobalDataModel(windowCtx) {
    try {
      var model = windowCtx.result && windowCtx.result.global &&
                  windowCtx.result.global.globalData &&
                  windowCtx.result.global.globalData.model;
      if (!model) return null;
      var od = model.offerDetail;
      if (!od) return null;

      var result = {
        productName: '',
        images: [],
        skuList: [],
        description: '',
        weight_g: 0,
        packageSize: '',
        detailUrl: '',
        categoryId: 0,
        categoryName: '',
      };

      // Title
      result.productName = String(od.subject || '').trim();

      // Images — try multiple property names (1688 template variations)
      var imgSources = od.imageList || od.images || od.mainImageList || [];
      console.log('[篝火采集] globalDataModel images: imageList=' + (od.imageList ? od.imageList.length : 'undefined') +
        ', images=' + (od.images ? od.images.length : 'undefined') +
        ', mainImageList=' + (od.mainImageList ? od.mainImageList.length : 'undefined'));
      for (var i = 0; i < imgSources.length; i++) {
        var src = '';
        if (typeof imgSources[i] === 'string') {
          src = imgSources[i];
        } else if (imgSources[i] && typeof imgSources[i] === 'object') {
          src = imgSources[i].fullPathImageURI || imgSources[i].url || imgSources[i].src || imgSources[i].original || imgSources[i].imgUrl || imgSources[i].summImageURI || '';
        }
        if (src && src.startsWith('http') && isValidImage(src)) {
          result.images.push(toAbsolute(src));
        }
      }
      console.log('[篝火采集] globalDataModel images extracted: ' + result.images.length + ' from ' + imgSources.length + ' sources');

      // Attributes from featureAttributes[]
      var fas = od.featureAttributes || [];
      if (Array.isArray(fas) && fas.length > 0) {
        var parts = [];
        for (var ai = 0; ai < fas.length; ai++) {
          var fa = fas[ai];
          if (fa && fa.name) {
            parts.push(fa.name + ': ' + (Array.isArray(fa.value) ? fa.value.join(', ') : fa.value || ''));
          }
        }
        if (parts.length > 0) result.description = parts.join('\n');
      }

      // Category
      result.categoryId = od.leafCategoryId || 0;
      result.categoryName = od.leafCategoryName || '';

      // Detail CDN URL (tmall CDN, returns var offer_details={content:"<HTML>"})
      result.detailUrl = od.detailUrl || '';

      // Weight from detailDescription.freightInfo (in grams / kg)
      try {
        var dd = model.detailDescription;
        if (dd && dd.freightInfo) {
          var fi = dd.freightInfo;
          var uw = fi.unitWeight;
          if (uw !== undefined && uw !== null) {
            var uwNum = parseFloat(String(uw).replace(/[^0-9.]/g, ''));
            if (!isNaN(uwNum) && uwNum > 0) {
              // unitWeight may be in kg (e.g. 2) or g (e.g. 2000); normalize to g
              result.weight_g = uwNum < 100 ? Math.round(uwNum * 1000) : uwNum;
            }
          }
          // Fallback: use first skuWeight value as overall weight (convert kg→g)
          if (!result.weight_g && fi.skuWeight) {
            var skuWtKeys = Object.keys(fi.skuWeight);
            if (skuWtKeys.length > 0) {
              var firstWt = parseFloat(String(fi.skuWeight[skuWtKeys[0]]));
              if (!isNaN(firstWt) && firstWt > 0) {
                // skuWeight is in kg, convert to g if value < 100 (heuristic)
                result.weight_g = firstWt < 100 ? Math.round(firstWt * 1000) : firstWt;
              }
            }
          }
          if (fi.location) result._location = fi.location;
        }
      } catch(e) {}

      // v0.5.5: Packaging dimensions from detailDescription.pieceWeightScale.pieceWeightScaleInfo[]
      // Each entry: { length, width, height, volume (cm), weight (g), skuId (number), sku1 (name) }
      var _pieceWeightMap = null;
      try {
        var dd2 = model.detailDescription;
        if (dd2 && dd2.pieceWeightScale && dd2.pieceWeightScale.pieceWeightScaleInfo) {
          var pwsInfo = dd2.pieceWeightScale.pieceWeightScaleInfo;
          if (Array.isArray(pwsInfo) && pwsInfo.length > 0) {
            _pieceWeightMap = {};
            var _globalDims = null;
            for (var pi = 0; pi < pwsInfo.length; pi++) {
              var pw = pwsInfo[pi];
              var pwEntry = {
                weight_g: pw.weight || 0,
                length_cm: pw.length || 0,
                width_cm: pw.width || 0,
                height_cm: pw.height || 0,
                volume: pw.volume || 0,
                skuName: pw.sku1 || '',
              };
              var skuIdKey = String(pw.skuId || '');
              if (skuIdKey) _pieceWeightMap[skuIdKey] = pwEntry;
              if (pwEntry.skuName) _pieceWeightMap['_name:' + pwEntry.skuName] = pwEntry;
              // Use first valid dimensions for top-level packageSize
              if (!_globalDims && pw.length > 0 && pw.width > 0 && pw.height > 0) {
                _globalDims = pw.length + '*' + pw.width + '*' + pw.height;
              }
              // Top-level weight from pieceWeightScale (grams, authoritative source)
              if (pw.weight > 0 && !result._pwWeightSet) {
                result.weight_g = pw.weight;
                result._pwWeightSet = true;
              }
            }
            if (_globalDims) result.packageSize = _globalDims;
            result._pieceWeightMap = _pieceWeightMap;
            console.log('[篝火采集] pieceWeightScaleInfo: ' + pwsInfo.length + ' entries, globalDims=' + (_globalDims || 'none'));
          }
        }
      } catch(e) { console.log('[篝火采集] pieceWeightScale parse error:', e.message); }

      // SKU from customizedProcessingModel.nySkuModel
      try {
        var nysm = model.customizedProcessingModel && model.customizedProcessingModel.nySkuModel;
        if (nysm) {
          var skuInfoMap = nysm.skuInfoMap || {};
          var skuProps = nysm.skuProps || [];
          var skuNames = [];
          if (skuProps.length > 0 && skuProps[0].value && Array.isArray(skuProps[0].value)) {
            skuNames = skuProps[0].value;
          }
          if (skuNames.length === 0 && Object.keys(skuInfoMap).length > 0) {
            skuNames = Object.keys(skuInfoMap).map(function(k) { return { name: k }; });
          }
          for (var si = 0; si < skuNames.length; si++) {
            var sn = skuNames[si];
            var skuName = sn.name || '';
            if (!skuName) continue;
            var info = skuInfoMap[skuName] || {};
            // 价格多字段兜底：不同店铺装修字段名不同，单认 info.price 会漏价（采到 ¥0）
            var skuPrice = parseFloat(String(
              info.price || info.discountPrice || info.salePrice || info.saleprice ||
              info.currentPrice || info.actPrice || info.priceText || info.beginAmount ||
              (info.skuPrice && (info.skuPrice.price || info.skuPrice.discountPrice)) || '0'
            ).replace(/[^0-9.]/g, ''));
            result.skuList.push({
              name: skuName,
              specDesc: skuName,
              purchasePrice: skuPrice || 0,
              stock: info.canBookCount || 0,
              specId: info.specId || '',
            });
          }
        }
      } catch(e) {}

      // v0.5.2: SKU fallback for Template B — customizedProcessingModel.skuModel
      if (result.skuList.length === 0) try {
        var skum = model.customizedProcessingModel && model.customizedProcessingModel.skuModel;
        if (skum) {
          var skuMap = skum.skuMapOriginal || skum.skuMap || null;
          if (!skuMap || !skuMap.length) {
            var sim = skum.skuInfoMap;
            if (sim) { skuMap = []; for (var simK in sim) { if (sim.hasOwnProperty(simK)) skuMap.push(sim[simK]); } }
          }
          if (!skuMap || !skuMap.length) {
            var pm = skum.priceMap;
            if (pm) { skuMap = []; for (var pmK in pm) { if (pm.hasOwnProperty(pmK)) { var entry = pm[pmK]; entry._skuId = pmK; skuMap.push(entry); } } }
          }
          if (!skuMap || !skuMap.length) {
            var sp = skum.skuProps;
            if (sp && sp.length) skuMap = sp;
          }
          if (skuMap && skuMap.length > 0) {
            for (var si = 0; si < skuMap.length; si++) {
              var se = skuMap[si];
              if (!se || typeof se !== 'object') continue;
              var sname = (se.skuName || se.name || se.specId || se._skuId || 'SKU-' + (si + 1)).trim();
              var sprice = parseFloat(String(se.price || se.discountPrice || se.salePrice || '0').replace(/[^0-9.]/g, ''));
              result.skuList.push({ name: sname, specDesc: sname, purchasePrice: sprice || 0, stock: se.quantity || se.canBookCount || se.stock || 0, specId: se.specId || '' });
            }
            console.log('[篝火采集] parseGlobalDataModel: skuModel fallback → ' + result.skuList.length + ' SKU');
          }
        }
      } catch(e) {}

      // v0.5.4: SKU fallback for modern_basic — tradeModel.skuMap (prices+stock) → offerDetail.skuProps
      if (result.skuList.length === 0) try {
        var tm = model.tradeModel;
        var skuWeightMap = null;
        try {
          var dd = model.detailDescription;
          if (dd && dd.freightInfo && dd.freightInfo.skuWeight) {
            skuWeightMap = dd.freightInfo.skuWeight;
          }
        } catch(e) {}

        // Path A: tradeModel.skuMap has full data (price, stock, skuId, specAttrs)
        var skuMapArr = null;
        if (tm) {
          skuMapArr = tm.skuMap;
          if (!skuMapArr || !skuMapArr.length) {
            // skuMap might be an object keyed by skuId
            if (tm.skuMap && typeof tm.skuMap === 'object') {
              skuMapArr = [];
              for (var sk in tm.skuMap) { if (tm.skuMap.hasOwnProperty(sk)) { var e = tm.skuMap[sk]; e._skuId = sk; skuMapArr.push(e); } }
            }
          }
        }
        if (skuMapArr && skuMapArr.length > 0) {
          for (var si = 0; si < skuMapArr.length; si++) {
            var se = skuMapArr[si];
            if (!se || typeof se !== 'object') continue;
            var sname = (se.specAttrs || se.skuName || se.name || se.specId || se._skuId || ('SKU-' + (si + 1))).trim();
            var sprice = parseFloat(String(se.price || se.discountPrice || se.salePrice || '0').replace(/[^0-9.]/g, ''));
            var sstock = parseInt(se.canBookCount, 10) || 0;
            var skuId = String(se.skuId || se._skuId || '');
            var skuWeight = 0;
            if (skuWeightMap && skuId) {
              var sw = skuWeightMap[skuId];
              if (sw !== undefined) skuWeight = parseFloat(String(sw));
            }
            result.skuList.push({
              name: sname,
              specDesc: sname,
              purchasePrice: sprice || 0,
              stock: sstock,
              specId: se.specId || '',
              _skuId: skuId,
              _weight_kg: skuWeight || 0,
            });
          }
          if (result.skuList.length > 0) {
            console.log('[篝火采集] parseGlobalDataModel: skuMap fallback → ' + result.skuList.length + ' SKU (with prices)');
          }
        }

        // Path B: offerDetail.skuProps[0].value (names + images, no individual prices)
        if (result.skuList.length === 0) {
          var odSkuProps = od.skuProps;
          if (odSkuProps && Array.isArray(odSkuProps) && odSkuProps.length > 0) {
            var skuValues = odSkuProps[0].value;
            if (skuValues && Array.isArray(skuValues) && skuValues.length > 0) {
              var minPrice = 0, maxPrice = 0;
              if (tm) {
                minPrice = parseFloat(String(tm.minPrice || '0').replace(/[^0-9.]/g, ''));
                maxPrice = parseFloat(String(tm.maxPrice || '0').replace(/[^0-9.]/g, ''));
              }
              for (var svi = 0; svi < skuValues.length; svi++) {
                var sv = skuValues[svi];
                var svName = sv.name || '';
                if (!svName) continue;
                result.skuList.push({
                  name: svName,
                  specDesc: svName,
                  purchasePrice: minPrice || 0,
                  stock: 0,
                  specId: '',
                  _skuImage: sv.imageUrl || '',
                });
              }
              if (result.skuList.length > 0) {
                if (minPrice > 0 && maxPrice > 0) {
                  result._priceRange = String(minPrice) + '-' + String(maxPrice);
                }
                console.log('[篝火采集] parseGlobalDataModel: od.skuProps fallback → ' + result.skuList.length + ' SKU, price range ' + (result._priceRange || 'N/A'));
              }
            }
          }
        }
      } catch(e) { console.log('[篝火采集] SKU fallback error:', e.message); }

      // Trade/pricing metadata
      try {
        var tm2 = model.tradeModel;
        if (tm2) {
          if (tm2.beginAmount) result._beginAmount = tm2.beginAmount;
          if (tm2.minPrice && !result._priceRange) result._priceRange = String(tm2.minPrice) + '-' + String(tm2.maxPrice || tm2.minPrice);
          if (tm2.canBookedAmount) result._stockTotal = tm2.canBookedAmount;
        }
      } catch(e) {}

      // v0.5.5: Apply pieceWeightScaleInfo to SKU entries (match by skuId or name)
      if (_pieceWeightMap && result.skuList.length > 0) {
        for (var si = 0; si < result.skuList.length; si++) {
          var sku = result.skuList[si];
          var matchKey = sku._skuId || '';
          var pw = _pieceWeightMap[matchKey];
          if (!pw && sku.name) pw = _pieceWeightMap['_name:' + sku.name];
          if (!pw) continue;
          if (pw.weight_g > 0) sku._weight_g = pw.weight_g;
          if (pw.weight_g > 0 && !sku._weight_kg) sku._weight_kg = pw.weight_g / 1000;
          if (pw.length_cm > 0 || pw.width_cm > 0 || pw.height_cm > 0) {
            sku._dimensions = { length_cm: pw.length_cm, width_cm: pw.width_cm, height_cm: pw.height_cm };
            if (!sku.packageSize) sku.packageSize = pw.length_cm + '*' + pw.width_cm + '*' + pw.height_cm;
          }
        }
      }

      // v0.5.6: SKU images from offerDetail.skuProps (high-quality, not thumbnails)
      if (result.skuList.length > 0) try {
        var odSp = od.skuProps;
        if (odSp && Array.isArray(odSp) && odSp.length > 0) {
          var spValues = odSp[0].value || [];
          var skuImgMap = {};
          for (var spi = 0; spi < spValues.length; spi++) {
            var sv = spValues[spi];
            if (sv && sv.name && sv.imageUrl) {
              skuImgMap[sv.name.trim()] = sv.imageUrl;
            }
          }
          if (Object.keys(skuImgMap).length > 0) {
            var matchedImgs = 0;
            for (var si = 0; si < result.skuList.length; si++) {
              var skuName = (result.skuList[si].name || '').trim();
              var imgUrl = skuImgMap[skuName];
              if (imgUrl) {
                result.skuList[si]._skuImage = imgUrl;
                matchedImgs++;
              }
            }
            console.log('[篝火采集] parseGlobalDataModel: skuImages matched ' + matchedImgs + '/' + result.skuList.length + ' SKU from skuProps');
          }
        }
      } catch(e) {}

      if (!result.productName && result.images.length === 0 && result.skuList.length === 0) return null;
      console.log('[篝火采集] Extracted from globalDataModel: ' + result.productName.substring(0,40) +
        ' (' + result.skuList.length + ' SKU, ' + result.images.length + ' imgs, ' + result.weight_g + 'g)');
      return result;
    } catch(e) {
      console.log('[篝火采集] parseGlobalDataModel error:', e.message);
      return null;
    }
  }

  // Fetch desc HTML from tmall CDN (modern 1688 template)
  // Returns JS wrapper: var offer_details={content:"<img src=...>"}
  function fetchTmallDescHtml(detailUrl, callback) {
    if (!detailUrl) { callback(null); return; }
    // Always use background proxy — direct fetch blocked by CORS from 1688.com to itemcdn.tmall.com
    tryBackgroundTmallFetch(detailUrl, callback);
  }

  function parseTmallResponse(text) {
    var html = '';
    // Format 1: var offer_details={content:"<HTML>"}
    var contentMatch = text.match(/"content"\s*:\s*"([\s\S]*?)(?:"\s*\}|"\s*,)/);
    if (contentMatch) {
      html = contentMatch[1];
      html = html.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
    } else {
      var m2 = text.match(/"content"\s*:\s*"([^"]+(?:\\"[^"]+)*)"\s*\}/);
      if (m2) html = m2[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    }
    // Format 2: var desc='<HTML>' (newer tmall CDN format)
    if (!html || html.length <= 10) {
      var descMatch = text.match(/var desc='([\s\S]*)'\s*;?\s*$/);
      if (descMatch && descMatch[1]) {
        html = descMatch[1];
        html = html.replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
      }
    }
    return html && html.length > 10 ? html : '';
  }

  function tryBackgroundTmallFetch(detailUrl, callback) {
    try {
      chrome.runtime.sendMessage({ action: 'fetchTmallDesc', url: detailUrl }, function(response) {
        if (chrome.runtime.lastError) {
          console.log('[篝火采集] tmall CDN background proxy error:', chrome.runtime.lastError.message);
          callback(null);
          return;
        }
        if (!response || !response.html) {
          console.log('[篝火采集] tmall CDN background proxy returned empty html. response:', JSON.stringify(response));
          // Fallback: try alibaba desc API as last resort
          if (offerId) {
            fetchDescHtml(offerId, callback);
          } else {
            callback(null);
          }
          return;
        }
        var html = response.html;
        if (html) html = html.replace(/data-src=/gi, 'src=');
        console.log('[篝火采集] tmall CDN background proxy OK, html len=' + html.length);
        callback(html || null);
      });
    } catch(e) {
      console.log('[篝火采集] tmall background send exception:', e.message);
      callback(null);
    }
  }

  // Package size parser (DXM: unitSize "30X20X15" -> structured dimensions)
  function parsePackageSize(raw) {
    if (!raw || typeof raw !== 'string') return null;
    var cleaned = raw.replace(/CM|cm|mm|MM/gi, '').trim();
    var parts = cleaned.split(/[*xX]/);
    if (parts.length < 3) return null;
    var l = parseFloat(parts[0]);
    var w = parseFloat(parts[1]);
    var h = parseFloat(parts[2]);
    if (isNaN(l) || isNaN(w) || isNaN(h) || l <= 0 || w <= 0 || h <= 0) return null;
    return { length_cm: l, width_cm: w, height_cm: h };
  }

  // Desc HTML fetch (DXM primary: alibaba.com desc API)
  function fetchDescHtml(offerId, callback) {
    if (!offerId) { callback(null); return; }
    var descUrl = 'https://www.alibaba.com/event/app/mainAction/desc.htm?detailId=' + offerId;

    function tryDirectFetch() {
      if (typeof fetch === 'undefined') return false;
      fetch(descUrl, { method: 'GET', signal: AbortSignal.timeout(8000) })
        .then(function(resp) {
          if (!resp.ok) throw new Error('desc API returned ' + resp.status);
          return resp.json();
        })
        .then(function(json) {
          var html = (json.data && json.data.productHtmlDescription) || '';
          if (html) html = html.replace(/data-src=/gi, 'src=');
          callback(html);
        })
        .catch(function(err) {
          console.log('[篝火采集] desc API direct fetch failed:', err.message);
          tryBackgroundFallback();
        });
      return true;
    }

    function tryBackgroundFallback() {
      var done = false;
      var safety = setTimeout(function() {
        if (!done) { done = true; callback(null); }
      }, 10000);
      try {
        chrome.runtime.sendMessage({ action: 'fetchDescApi', offerId: offerId }, function(response) {
          if (done) return;
          clearTimeout(safety);
          done = true;
          if (chrome.runtime.lastError || !response || !response.html) {
            callback(null);
            return;
          }
          callback(response.html);
        });
      } catch(e) {
        if (!done) { clearTimeout(safety); done = true; callback(null); }
      }
    }

    if (!tryDirectFetch()) tryBackgroundFallback();
  }

  // Extract image URLs from HTML string
  function extractImagesFromHtml(html) {
    if (!html) return [];
    var images = [];
    var re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var src = m[1];
      if (src && src.startsWith('http') && isValidImage(src)) {
        images.push(toAbsolute(src));
      }
    }
    return images;
  }

  // Build HTML from nodeMap details array (DXM fallback)
  function buildDescFromNodeMap(details) {
    if (!details || !details.length) return '';
    var html = '';
    for (var i = 0; i < details.length; i++) {
      var item = details[i];
      if (!item || !item.type) continue;
      if (item.type === 'text' && item.text) {
        html += '<p>' + item.text + '</p>';
      } else if (item.type === 'image' && item.url) {
        html += '<img src="' + item.url + '" />';
      }
    }
    return html;
  }

  // ── MAIN world bridge ──
  var _mainWorldData = null;
  var _mainWorldNodeMapDesc = null;
  var _mainWorldDone = false;

  function fetchFromMainWorld(callback) {
    if (_mainWorldDone) { callback(_mainWorldData); return; }

    var timeout = setTimeout(function() {
      document.removeEventListener('ext-res', onResponse);
      _mainWorldDone = true;
      _mainWorldData = null;
      console.log('[篝火采集] MAIN world timeout');
      callback(null);
    }, 5000);

    function onResponse(e) {
      if (!e.detail || e.detail.action !== 'getWindowData') return;
      document.removeEventListener('ext-res', onResponse);
      clearTimeout(timeout);
      _mainWorldDone = true;
      _mainWorldData = e.detail.success ? e.detail.data : null;
      _mainWorldNodeMapDesc = e.detail.nodeMapDesc || null;
      if (_mainWorldData) console.log('[篝火采集] MAIN world got data, nodeMapDesc=' + !!_mainWorldNodeMapDesc);
      callback(_mainWorldData);
    }

    document.addEventListener('ext-res', onResponse);
    document.dispatchEvent(new CustomEvent('ext-req', { detail: { action: 'getWindowData' } }));
  }

  // ── ISOLATED world direct read ──
  function tryIsolatedInitData() {
    try {
      var init = window.__INIT_DATA || window.__detail_data__;
      if (!init) return null;
      var rd = init.result && init.result.data;
      if (!rd || !rd.productTitle) return null;
      var title = rd.productTitle.fields && rd.productTitle.fields.title || '';
      if (title && title.length > 2) { console.log('[篝火采集] ISOLATED world has data'); return init; }
      return null;
    } catch(e) { return null; }
  }

  function tryReadInitData() {
    try {
      var init = window.__INIT_DATA || window.__detail_data__;
      if (!init) return null;
      var rd = init.result && init.result.data;
      if (!rd) return null;

      try {
        var rg = init.result && init.result.global;
        if (rg) {
          console.log('[篝火采集 调试] global keys:', Object.keys(rg));
          if (rg.offerDetail) {
            var od2 = rg.offerDetail;
            console.log('[篝火采集 调试] offerDetail keys:', Object.keys(od2));
            console.log('[篝火采集 调试] offerDetail.subject:', od2.subject ? String(od2.subject).substring(0,60) : '(none)');
            console.log('[篝火采集 调试] offerDetail.imageList:', od2.imageList ? (Array.isArray(od2.imageList) ? od2.imageList.length : typeof od2.imageList) : '(none)');
          }
        }
      } catch(e) {}

      var title = '';
      try { title = rd.productTitle && rd.productTitle.fields && rd.productTitle.fields.title || ''; } catch(e) {}
      if (!title || title.length < 2) return null;

      var images = [];
      try { images = rd.gallery && rd.gallery.fields && rd.gallery.fields.offerImgList || []; } catch(e) {}
      if (!title && images.length === 0) return null;

      return init;
    } catch(e) { return null; }
  }

  // ── Parse __INIT_DATA (old template) ──
  function parseInitData(init) {
    if (!init) return null;
    var result = { productName: '', images: [], skuList: [], description: '', weight_g: 0, packageSize: '' };
    var rd = init.result && init.result.data;
    if (!rd) return null;

    try {
      var ptf = rd.productTitle && rd.productTitle.fields;
      if (ptf) result.productName = String(ptf.title || ptf.subject || '').trim();

      var gf = rd.gallery && rd.gallery.fields;
      if (gf && gf.offerImgList) {
        for (var gi = 0; gi < gf.offerImgList.length; gi++) {
          var u = String(gf.offerImgList[gi]).trim();
          if (u && u.startsWith('http') && isValidImage(u)) result.images.push(toAbsolute(u));
        }
      }
      if (result.images.length === 0 && gf && gf.mainImage && Array.isArray(gf.mainImage)) {
        for (var mii = 0; mii < gf.mainImage.length; mii++) {
          var mu = String(gf.mainImage[mii]).trim();
          if (mu && mu.startsWith('http')) result.images.push(toAbsolute(mu));
        }
      }

      var skuSource = null;
      try {
        var fpm = rd.mainPrice && rd.mainPrice.fields && rd.mainPrice.fields.finalPriceModel;
        if (fpm && fpm.tradeWithoutPromotion && fpm.tradeWithoutPromotion.skuMapOriginal) {
          skuSource = fpm.tradeWithoutPromotion.skuMapOriginal;
        }
      } catch(e) {}

      if (skuSource && skuSource.length > 0) {
        for (var si = 0; si < skuSource.length; si++) {
          var entry = skuSource[si];
          var attrs = entry.specAttrs || [];
          var parts = [];
          for (var sa = 0; sa < attrs.length; sa++) {
            if (attrs[sa].value) parts.push(attrs[sa].value);
          }
          var skuName = parts.join(' > ') || 'SKU-' + (si + 1);
          var skuPrice = parseFloat(
            String(entry.price || entry.discountPrice || '0').replace(/[^0-9.]/g, '')
          );
          result.skuList.push({
            name: skuName,
            specDesc: skuName,
            purchasePrice: skuPrice || 0,
            stock: entry.quantity || entry.stock || 0,
          });
        }
      }

      var parts2 = [];
      try {
        var productParams = rd.productParams && rd.productParams.fields;
        if (productParams && productParams.attributes && Array.isArray(productParams.attributes)) {
          for (var ai = 0; ai < productParams.attributes.length; ai++) {
            var attr = productParams.attributes[ai];
            if (attr.name && attr.value) {
              parts2.push(attr.name + ': ' + attr.value);
            }
          }
        }
      } catch(e) {}

      var offerDetail = null;
      try {
        offerDetail = init.result && init.result.global && init.result.global.offerDetail;
        if (offerDetail) {
          var attrs2 = offerDetail.attributes || {};
          for (var ak in attrs2) {
            var av = attrs2[ak];
            if (av !== null && av !== undefined && String(av).trim()) {
              parts2.push(ak + ': ' + String(av).trim());
            }
          }
          var detailKeys = ['material','brand','placeOfOrigin','style','function','color','size','weight',
                           'packageSize','packageWeight','model','productionDate','usage'];
          var labels = { material:'材质', brand:'品牌', placeOfOrigin:'产地', style:'风格', function:'功能',
                         color:'颜色', size:'尺寸', weight:'重量', packageSize:'包装尺寸',
                         packageWeight:'包装重量', model:'型号', productionDate:'上市时间', usage:'适用场景' };
          for (var dk = 0; dk < detailKeys.length; dk++) {
            var k = detailKeys[dk];
            var v = offerDetail[k];
            if (v !== undefined && v !== null && String(v).trim()) {
              parts2.push((labels[k] || k) + ': ' + String(v).trim());
            }
          }
        }
      } catch(e) {}
      if (parts2.length > 0) result.description = parts2.join('\n');

      if (offerDetail) {
        try {
          var w = offerDetail.weight || offerDetail.packageWeight;
          if (w !== undefined && w !== null) {
            var wNum = parseFloat(String(w).replace(/[^0-9.]/g, ''));
            if (!isNaN(wNum) && wNum > 0) result.weight_g = wNum;
          }
          if (offerDetail.packageSize) {
            result.packageSize = String(offerDetail.packageSize).trim();
          }
        } catch(e) {}
      }

    } catch(e) {}

    if (!result.productName && result.images.length === 0 && result.skuList.length === 0) return null;

    try {
      var pageOfferId = (href.match(/offer\/(\d+)/) || [])[1] || '';
      if (pageOfferId) {
        var dataOfferId = '';
        try { dataOfferId = rd.product && rd.product.fields && rd.product.fields.offerId || ''; } catch(e) {}
        if (!dataOfferId) try { dataOfferId = rd.gallery && rd.gallery.fields && rd.gallery.fields.offerId || ''; } catch(e) {}
        if (!dataOfferId) try { dataOfferId = init.result && init.result.global && init.result.global.offerId || ''; } catch(e) {}
        if (!dataOfferId) try { dataOfferId = init.result && init.result.module && init.result.module.id || ''; } catch(e) {}
        if (dataOfferId && dataOfferId !== pageOfferId) {
          console.log('[篝火采集] offerId mismatch: page=' + pageOfferId + ' data=' + dataOfferId + ', skipping __INIT_DATA');
          return null;
        }
      }
    } catch(e) {}

    return result;
  }

  // ── Tier 2: DOM fallback ──
  function extractDom() {
    var data = { productName: '', images: [], skuList: [], description: '' };

    var docTitle = (document.title || '').replace(/\s*[-—|｜]\s*1688.*$/, '').replace(/\s*[-—|｜]\s*阿里巴巴.*$/, '').trim();

    var titleSelectors = [
      '.d-title', '.detail-title', 'h1.d-title', '.mod-detail-title h1',
      '[data-trace="title"]', '.offer-title', '#mod-detail-title h1',
      '.title-content', '.product-title', '.main-title',
    ];
    var bodyTitle = '';
    for (var ts = 0; ts < titleSelectors.length; ts++) {
      var el = document.querySelector(titleSelectors[ts]);
      if (el && el.textContent.trim().length > 5) {
        bodyTitle = el.textContent.trim();
        break;
      }
    }

    if (bodyTitle && docTitle) {
      var bodyWords = bodyTitle.replace(/\s+/g, '');
      var docWords = docTitle.replace(/\s+/g, '');
      if (docWords.indexOf(bodyWords) !== -1 || bodyWords.indexOf(docWords) !== -1 ||
          docWords.indexOf(bodyWords.substring(0, 4)) !== -1) {
        data.productName = bodyTitle;
      } else {
        data.productName = docTitle;
        console.log('[篝火采集] title mismatch — body="' + bodyTitle.substring(0,30) + '" doc="' + docTitle.substring(0,30) + '", using doc');
      }
    } else if (bodyTitle) {
      data.productName = bodyTitle;
    } else if (docTitle) {
      data.productName = docTitle;
    }

    // Images — broad + modern template selectors
    var imgSelectors = [
      '.mod-detail-gallery img', '.detail-gallery img',
      '.mod-detail-preview img', '.detail-preview img',
      '.mod-detail-main-img img', '.detail-main-img img',
      '#J_ImgBooth img', '.tab-gallery img',
      '.main-img-box img', '.detail-gallery-item img',
      '.offer-img img', '.od-pc-offer-main-image img',
      '.ant-image img', '.v-image-wrap img',
      'img[src*="cbu01.alicdn.com"]', 'img[src*="img.alicdn.com/imgextra"]',
      'img[src*="alicdn.com"]', 'img[data-src*="alicdn.com"]',
    ];
    var seen = {};
    for (var is = 0; is < imgSelectors.length; is++) {
      var els = document.querySelectorAll(imgSelectors[is]);
      for (var ii = 0; ii < els.length; ii++) {
        var src = els[ii].getAttribute('src') || els[ii].getAttribute('data-src') ||
                  els[ii].getAttribute('data-original') || els[ii].getAttribute('data-lazy') || '';
        var clean = src.split('?')[0];
        if (src && !seen[clean] && isValidImage(src)) {
          seen[clean] = true;
          data.images.push(toAbsolute(src));
        }
      }
      if (data.images.length >= 10) break;
    }

    // SKU
    var skuRows = document.querySelectorAll(
      '.sku-item, [data-role="sku-item"], .variation-item, ' +
      '.sku-row, .spec-item, .mod-sku-item, ' +
      '.js-sku-item, [class*="sku-item"], [class*="variation"]:not([class*="gallery"])'
    );
    if (skuRows.length > 0) {
      for (var sr = 0; sr < skuRows.length; sr++) {
        var el2 = skuRows[sr];
        var nameEl = el2.querySelector('.sku-name, .spec-name, .name, dt');
        var name = nameEl ? (nameEl.textContent || '').trim() : (el2.textContent || '').trim();
        if (!name) continue;
        var priceEl = el2.querySelector('.sku-price, .spec-price, .price, dd');
        var priceText = priceEl ? (priceEl.textContent || '') : (el2.textContent || '');
        var pr = parseFloat(priceText.replace(/[^0-9.]/g, ''));
        data.skuList.push({ name: name, specDesc: name, purchasePrice: isNaN(pr) ? 0 : pr });
      }
    }

    if (data.skuList.length === 0) {
      var skuBtns = document.querySelectorAll('.sku-filter-button, .module-od-sku-selection button, .module-od-sku-selection .v-flex');
      var freeSpecs = [];
      var pricedSpecs = [];
      for (var sb = 0; sb < skuBtns.length; sb++) {
        var btn = skuBtns[sb];
        var btnText = (btn.textContent || '').trim();
        if (!btnText || btnText.length > 60) continue;
        var priceMatch = btnText.match(/[¥￥]([\d.]+)/);
        if (priceMatch) {
          var btnPrice = parseFloat(priceMatch[1]);
          var btnName = btnText.replace(/[¥￥][\d.]+.*$/, '').trim();
          if (btnName && btnPrice > 0) pricedSpecs.push({ name: btnName, price: btnPrice });
        } else {
          freeSpecs.push(btnText);
        }
      }
      var pricedNames = {};
      for (var pni = 0; pni < pricedSpecs.length; pni++) {
        pricedNames[pricedSpecs[pni].name] = true;
      }
      freeSpecs = freeSpecs.filter(function(fs) { return !pricedNames[fs]; });
      var freeSeen = {};
      freeSpecs = freeSpecs.filter(function(fs) { if (freeSeen[fs]) return false; freeSeen[fs] = true; return true; });

      if (pricedSpecs.length > 0 && freeSpecs.length > 0) {
        for (var psi = 0; psi < pricedSpecs.length; psi++) {
          for (var fsi = 0; fsi < freeSpecs.length; fsi++) {
            var combinedName = freeSpecs[fsi] + ' > ' + pricedSpecs[psi].name;
            data.skuList.push({ name: combinedName, specDesc: combinedName, purchasePrice: pricedSpecs[psi].price });
          }
        }
      } else if (pricedSpecs.length > 0) {
        for (var psi2 = 0; psi2 < pricedSpecs.length; psi2++) {
          data.skuList.push({ name: pricedSpecs[psi2].name, specDesc: pricedSpecs[psi2].name, purchasePrice: pricedSpecs[psi2].price });
        }
      } else if (freeSpecs.length > 0) {
        var domPrice = 0;
        var priceEls = document.querySelectorAll('.price-info, .price-current, .sale-price, .od-price-container .price-info');
        for (var pi = 0; pi < priceEls.length; pi++) {
          var pt = (priceEls[pi].textContent || '').replace(/[^0-9.]/g, '');
          var pv = parseFloat(pt);
          if (!isNaN(pv) && pv > 0) { domPrice = pv; break; }
        }
        for (var fsi2 = 0; fsi2 < freeSpecs.length; fsi2++) {
          data.skuList.push({ name: freeSpecs[fsi2], specDesc: freeSpecs[fsi2], purchasePrice: domPrice });
        }
      }
    }

    if (data.skuList.length === 0) {
      var priceSel = ['.mod-detail-price .price-text', '.offer-price .value',
                      '.price-current', '.sale-price', '.price .price-text',
                      '#J_Price', '.mod-detail-price .detail-price-num', '.offer-price',
                      '.price-info', '.od-price-container .price-info', '[class*="price"]'];
      var pText = '';
      for (var ps = 0; ps < priceSel.length; ps++) {
        var pEl = document.querySelector(priceSel[ps]);
        if (pEl) { pText = pEl.textContent.trim(); if (pText) break; }
      }
      var pVal = parseFloat(pText.replace(/[^0-9.]/g, ''));
      data.skuList.push({ name: '默认', specDesc: '默认规格', purchasePrice: isNaN(pVal) ? 0 : pVal });
    }

    // Description
    var descTables = ['.mod-detail-attributes', '.detail-attributes', '[class*="attributes"] table',
                      '.attributes-table', '#attributes', '[class*="params"]', '[class*="specs"]',
                      '.module-od-attributes', '.product-attributes', '.detail-params',
                      '.mod-detail-params', '[class*="detail-att"]', '[class*="product-att"]',
                      '.od-attributes', '.offer-attributes', '[class*="property"]'];
    var parts3 = [];
    for (var dt2 = 0; dt2 < descTables.length; dt2++) {
      var table = document.querySelector(descTables[dt2]);
      if (!table) continue;
      var rows = table.querySelectorAll('tr, .attr-item, li');
      for (var dr = 0; dr < rows.length; dr++) {
        var label = rows[dr].querySelector('th, .attr-name, .label, dt, .field-name');
        var value = rows[dr].querySelector('td, .attr-value, .value, dd, .field-value');
        if (label && value) {
          parts3.push((label.textContent || '').trim() + ': ' + (value.textContent || '').trim());
        }
      }
      if (parts3.length > 0) break;
    }
    if (parts3.length === 0) {
      var fieldNames = document.querySelectorAll('.field-name, .prop-name, [class*="field-name"]');
      for (var fn = 0; fn < fieldNames.length; fn++) {
        var fnEl = fieldNames[fn];
        var fvEl = fnEl.nextElementSibling;
        if (!fvEl) fvEl = fnEl.parentElement && fnEl.parentElement.querySelector('.field-value, .prop-value');
        if (fvEl) {
          parts3.push((fnEl.textContent || '').trim() + ': ' + (fvEl.textContent || '').trim());
        }
      }
    }
    if (parts3.length === 0 && !data.description) {
      var descContainers = document.querySelectorAll(
        '.mod-detail-description, .detail-description, .description-content, ' +
        '#J_Detail, .mod-detail-detail, [class*="desc-content"], ' +
        '[class*="detail-content"], .offer-desc, .product-desc, ' +
        '[data-module="description"], [class*="od-product-desc"]'
      );
      for (var dci = 0; dci < descContainers.length; dci++) {
        var dcEl = descContainers[dci];
        var dcText = (dcEl.textContent || '').trim();
        if (dcText.length > 20) {
          data.description = dcText.substring(0, 3000);
          break;
        }
      }
    }
    if (parts3.length > 0) data.description = parts3.join('\n');

    return data;
  }

  // ── Parse window.context.result.data (new 2026 template) ──
  function parseContextResultData(windowCtx) {
    var rd = windowCtx.result && windowCtx.result.data;
    if (!rd) return null;
    var result = { productName: '', images: [], skuList: [], description: '', weight_g: 0, packageSize: '' };

    try {
      var ppi = rd.productPackInfo;
      if (ppi && ppi.fields) {
        var uw = ppi.fields.unitWeight;
        if (uw !== undefined && uw !== null) {
          var uwNum = parseFloat(String(uw).replace(/[^0-9.]/g, ''));
          if (!isNaN(uwNum) && uwNum > 0) {
            result.weight_g = Math.round(uwNum * 1000);
            console.log('[篝火采集] weight from productPackInfo.unitWeight: ' + uwNum + 'kg -> ' + result.weight_g + 'g');
          }
        }
        if (ppi.fields.packageSize || ppi.fields.unitSize) {
          result.packageSize = String(ppi.fields.packageSize || ppi.fields.unitSize || '').trim();
        }
        var dims = ppi.fields.dimensions || ppi.fields.packageDimensions;
        if (dims && typeof dims === 'object') {
          result.packageSize = [dims.length || dims.l, dims.width || dims.w, dims.height || dims.h]
            .filter(Boolean).join('x');
        }
      }
    } catch(e) {}

    try {
      var descModule = rd.description;
      if (descModule && descModule.fields) {
        var df = descModule.fields;
        if (df.htmlContent || df.html || df.content) {
          result._descHtml = df.htmlContent || df.html || df.content;
        }
        if (df.text || df.detailText || df.summary) {
          var txt = df.text || df.detailText || df.summary;
          if (!result.description) result.description = String(txt);
        }
        if (df.images && Array.isArray(df.images)) {
          for (var i = 0; i < df.images.length; i++) {
            var imgUrl = typeof df.images[i] === 'string' ? df.images[i] : df.images[i].url || df.images[i].src || '';
            if (imgUrl && imgUrl.startsWith('http') && isValidImage(imgUrl)) {
              result.images.push(toAbsolute(imgUrl));
            }
          }
        }
      }
    } catch(e) {}

    try {
      var gl = windowCtx.result && windowCtx.result.global;
      if (gl && gl.globalData) {
        var gd = gl.globalData;
        if (gd.tempModel && gd.tempModel.offerDetail) {
          var od = gd.tempModel.offerDetail;
          result.productName = result.productName || od.subject || od.title || '';
          if (od.images && Array.isArray(od.images) && result.images.length === 0) {
            for (var j = 0; j < od.images.length; j++) {
              var oi = typeof od.images[j] === 'string' ? od.images[j] : od.images[j].url || '';
              if (oi && oi.startsWith('http') && isValidImage(oi)) result.images.push(toAbsolute(oi));
            }
          }
        }
      }
    } catch(e) {}

    try {
      var mod = windowCtx.module;
      if (mod) {
        for (var mk in mod) {
          if (!mod.hasOwnProperty(mk) || typeof mod[mk] !== 'object') continue;
          var comp = mod[mk];
          if (comp.offerDetail && !result.productName) {
            result.productName = comp.offerDetail.subject || comp.offerDetail.title || '';
          }
          if (comp.fields && comp.fields.offerImgList && result.images.length === 0) {
            for (var k = 0; k < comp.fields.offerImgList.length; k++) {
              var u = String(comp.fields.offerImgList[k]);
              if (u && u.startsWith('http') && isValidImage(u)) result.images.push(toAbsolute(u));
            }
          }
        }
      }
    } catch(e) {}

    if (!result.productName && !result.weight_g && !result.description && !result._descHtml) return null;
    return result;
  }

  // ── Parse window.context (old template) ──
  function parseWindowContext(ctx) {
    if (!ctx) return null;
    var result = { productName: '', images: [], skuList: [], description: '', weight_g: 0, packageSize: '' };
    try {
      var od = ctx.global && ctx.global.offerDetail;
      if (od) {
        result.productName = (od.subject || od.title || '').trim();
        try {
          var rawImages = od.images || od.imageList || [];
          if (rawImages && rawImages.length) {
            for (var imgI = 0; imgI < rawImages.length; imgI++) {
              var imgSrc = '';
              if (typeof rawImages[imgI] === 'string') {
                imgSrc = rawImages[imgI];
              } else if (rawImages[imgI] && typeof rawImages[imgI] === 'object') {
                imgSrc = rawImages[imgI].url || rawImages[imgI].src || rawImages[imgI].original || '';
              }
              if (imgSrc && imgSrc.startsWith('http') && isValidImage(imgSrc)) {
                result.images.push(toAbsolute(imgSrc));
              }
            }
          }
        } catch(e) {}
        var parts = [];
        var keys = ['material','brand','placeOfOrigin','style','function','color','size','weight',
                    'packageSize','model','productionDate','usage'];
        var labels = { material:'材质', brand:'品牌', placeOfOrigin:'产地', style:'风格', function:'功能',
                      color:'颜色', size:'尺寸', weight:'重量', packageSize:'包装尺寸',
                      model:'型号', productionDate:'上市时间', usage:'适用场景' };
        for (var dk = 0; dk < keys.length; dk++) {
          var k = keys[dk];
          var v = od[k];
          if (v !== undefined && v !== null && String(v).trim()) {
            parts.push((labels[k] || k) + ': ' + String(v).trim());
          }
        }
        if (parts.length > 0) result.description = parts.join('\n');
      }
      try {
        var ppi = ctx.productPackInfo && ctx.productPackInfo.fields &&
                  ctx.productPackInfo.fields.pieceWeightScale &&
                  ctx.productPackInfo.fields.pieceWeightScale.pieceWeightScaleInfo;
        if (ppi && ppi.weight) {
          result.weight_g = parseFloat(ppi.weight) || 0;
        }
      } catch(e) {}
      if (!result.weight_g && od) {
        var w = od.weight || od.packageWeight;
        if (w !== undefined && w !== null) {
          var wNum = parseFloat(String(w).replace(/[^0-9.]/g, ''));
          if (!isNaN(wNum) && wNum > 0) result.weight_g = wNum;
        }
      }
      if (od && od.packageSize) {
        result.packageSize = String(od.packageSize).trim();
      }
      try {
        if (ctx.skuModel) console.log('[篝火采集] skuModel keys:', Object.keys(ctx.skuModel));
        var skuMap = null;
        try { skuMap = ctx.skuModel && ctx.skuModel.skuMapOriginal; } catch(e) {}
        if (!skuMap || !skuMap.length) try { skuMap = ctx.skuModel && ctx.skuModel.skuMap; } catch(e) {}
        if (!skuMap || !skuMap.length) try {
          var sim = ctx.skuModel && ctx.skuModel.skuInfoMap;
          if (sim) { skuMap = []; for (var simK in sim) { if (sim.hasOwnProperty(simK)) skuMap.push(sim[simK]); } }
        } catch(e) {}
        if (!skuMap || !skuMap.length) try {
          var pm = ctx.skuModel && ctx.skuModel.priceMap;
          if (pm) { skuMap = []; for (var pmK in pm) { if (pm.hasOwnProperty(pmK)) { var entry = pm[pmK]; entry._skuId = pmK; skuMap.push(entry); } } }
        } catch(e) {}
        if (!skuMap || !skuMap.length) try {
          var sp = ctx.skuModel && ctx.skuModel.skuProps;
          if (sp && sp.length) { skuMap = sp; }
        } catch(e) {}

        if (skuMap && skuMap.length > 0) {
          for (var si = 0; si < skuMap.length; si++) {
            var skuEntry = skuMap[si];
            if (!skuEntry || typeof skuEntry !== 'object') continue;
            var name = (skuEntry.skuName || skuEntry.name || skuEntry.specId || skuEntry._skuId || 'SKU-' + (si + 1)).trim();
            var skuPrice = parseFloat(
              String(skuEntry.price || skuEntry.discountPrice || skuEntry.salePrice || '0').replace(/[^0-9.]/g, '')
            );
            result.skuList.push({
              name: name,
              specDesc: name,
              purchasePrice: skuPrice || 0,
              stock: skuEntry.quantity || skuEntry.canBookCount || skuEntry.stock || 0,
            });
          }
        } else {
          console.log('[篝火采集] skuMap not found via any path, skuModel:', ctx.skuModel ? 'present' : 'absent');
        }
      } catch(e) {}
    } catch(e) {}
    if (!result.productName && !result.skuList.length) return null;
    return result;
  }

  // ── tryWindowContext: Main data extraction hub ──
  function tryWindowContext() {
    var logisticInfo = null;
    try {
      if (window.globalData && window.globalData.trade && window.globalData.trade.logisticInfo) {
        logisticInfo = window.globalData.trade.logisticInfo;
        if (logisticInfo) console.log('[篝火采集] globalData.trade.logisticInfo found');
      }
    } catch(e) {}

    try {
      var result = null;

      // v0.5.2: Detect template first, then extract accordingly
      var template = detectTemplate();

      // TIER 0b (HIGHEST): window.context.result.global.globalData.model
      if (!result && window.context && (template === 'modern_nySku' || template === 'modern_skuModel' || template === 'modern_basic')) {
        result = parseGlobalDataModel(window.context);
        if (result) {
          console.log('[篝火采集] Tier 0b (' + template + '): ' + result.productName.substring(0,30) +
            ' (' + result.skuList.length + ' SKU, ' + result.images.length + ' imgs)');
          // v0.5.2: Patch images from all available sources
          if (result.images.length === 0) {
            patchImages(result);
          }
          // v0.5.2: For modern_skuModel / modern_basic, try DOM SKU fallback
          if (result.skuList.length === 0 && (template === 'modern_skuModel' || template === 'modern_basic')) {
            var domSkus = extractDom().skuList;
            if (domSkus.length > 0) {
              result.skuList = domSkus;
              console.log('[篝火采集] SKU from DOM fallback: ' + domSkus.length + ' items');
            }
          }
        }
      }

      // NEW PATH (2026 template): window.context.result.data.*
      if (!result && window.context) {
        var rd = window.context.result && window.context.result.data;
        if (rd && (rd.productPackInfo || rd.description || rd.screen)) {
          console.log('[篝火采集] new template: window.context.result.data detected, keys=' +
            Object.keys(rd).slice(0, 8).join(','));
          result = parseContextResultData(window.context);
        }
      }

      // OLD PATHS
      if (!result && window.__NUXT__) {
        console.log('[篝火采集] window.__NUXT__ found');
        result = parseWindowContext(window.__NUXT__);
      }
      if (!result && window.__INITIAL_STATE__) {
        console.log('[篝火采集] window.__INITIAL_STATE__ found');
        result = parseWindowContext(window.__INITIAL_STATE__);
      }
      if (!result && window.context) {
        console.log('[篝火采集] window.context found (old template)');
        result = parseWindowContext(window.context);
      }

      // Try extracting from <script> tags (SSR pages)
      if (!result) {
        var scripts = document.querySelectorAll('script:not([src])');
        for (var si = 0; si < scripts.length; si++) {
          var text = scripts[si].textContent || '';
          var match = text.match(/window\.context\s*=\s*\{/);
          if (match) {
            var start = match.index + 'window.context = '.length;
            try {
              var jsonStr = text.substring(start);
              var depth = 0, end = -1;
              for (var ci = 0; ci < jsonStr.length; ci++) {
                if (jsonStr[ci] === '{') depth++;
                else if (jsonStr[ci] === '}') { depth--; if (depth === 0) { end = ci + 1; break; } }
              }
              if (end > 0) {
                var ctx = JSON.parse(jsonStr.substring(0, end));
                console.log('[篝火采集] window.context extracted from script tag');
                result = parseWindowContext(ctx);
                break;
              }
            } catch(e) {}
          }
          var nordicIdx = text.indexOf('#__NORDIC_RENDERING_CTX__');
          if (nordicIdx !== -1) {
            try {
              var ctxStart = text.indexOf('_n.ctx.r=', nordicIdx);
              if (ctxStart > 0) {
                var ctxJson = text.substring(ctxStart + '_n.ctx.r='.length);
                var depth2 = 0, end2 = -1;
                for (var cj = 0; cj < ctxJson.length; cj++) {
                  if (ctxJson[cj] === '{') depth2++;
                  else if (ctxJson[cj] === '}') { depth2--; if (depth2 === 0) { end2 = cj + 1; break; } }
                }
                if (end2 > 0) {
                  var nordicCtx = JSON.parse(ctxJson.substring(0, end2));
                  console.log('[篝火采集] __NORDIC_RENDERING_CTX__ extracted');
                  result = parseWindowContext(nordicCtx);
                  break;
                }
              }
            } catch(e) {}
          }
          var nuxtMatch = text.match(/window\.__NUXT__\s*=\s*(\{)/);
          if (!nuxtMatch) nuxtMatch = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{)/);
          if (nuxtMatch) {
            try {
              var nuxtStart = nuxtMatch.index + nuxtMatch[0].length - 1;
              var nuxtJson = text.substring(nuxtStart);
              var nd = 0, ne = -1;
              for (var nj = 0; nj < nuxtJson.length; nj++) {
                if (nuxtJson[nj] === '{') nd++;
                else if (nuxtJson[nj] === '}') { nd--; if (nd === 0) { ne = nj + 1; break; } }
              }
              if (ne > 0 && ne < 500000) {
                var nuxtData = JSON.parse(nuxtJson.substring(0, ne));
                console.log('[篝火采集] Nuxt/Vue SSR data extracted from script tag');
                if (nuxtData) result = parseWindowContext(nuxtData);
                if (result) break;
              }
            } catch(e) {}
          }
        }
      }

      if (result && logisticInfo) {
        if (logisticInfo.unitSize && !result.packageSize) {
          result.packageSize = String(logisticInfo.unitSize).trim();
        }
        if (logisticInfo.unitWeight && (!result.weight_g || result.weight_g === 0)) {
          var uwNum = parseFloat(String(logisticInfo.unitWeight).replace(/[^0-9.]/g, ''));
          if (!isNaN(uwNum) && uwNum > 0) {
            // unitWeight may be in kg (e.g. 2) or g (e.g. 2000); normalize to g
            result.weight_g = uwNum < 100 ? Math.round(uwNum * 1000) : uwNum;
          }
        }
      }
      return result;
    } catch(e) {}
    return null;
  }

  // ── finalizeWithDesc: Add detail HTML + format result ──
  // v0.5.1: SINGLE definition — tmall CDN primary, alibaba API fallback, nodeMap last resort
  function finalizeWithDesc(baseData, callback) {
    // Primary: tmall CDN desc URL from modern template model
    if (baseData.detailUrl && baseData.detailUrl.indexOf('itemcdn.tmall.com') !== -1) {
      fetchTmallDescHtml(baseData.detailUrl, function(descHtml) {
        if (descHtml) {
          baseData.detailHtml = descHtml;
          baseData.detailImages = extractImagesFromHtml(descHtml);
          console.log('[篝火采集] desc detail from tmall CDN (' + baseData.detailImages.length + ' imgs)');
        }
        doneWithDesc();
      });
    } else {
      // Fallback: alibaba.com desc API (old template)
      fetchDescHtml(offerId, function(descHtml) {
        if (descHtml) {
          baseData.detailHtml = descHtml;
          baseData.detailImages = extractImagesFromHtml(descHtml);
          console.log('[篝火采集] desc detail from alibaba API (' + baseData.detailImages.length + ' imgs)');
        }
        doneWithDesc();
      });
    }

    function doneWithDesc() {
      if (!baseData.detailHtml && _mainWorldNodeMapDesc && _mainWorldNodeMapDesc.length) {
        baseData.detailHtml = buildDescFromNodeMap(_mainWorldNodeMapDesc);
        baseData.detailImages = extractImagesFromHtml(baseData.detailHtml);
        console.log('[篝火采集] desc detail from nodeMap fallback (' + baseData.detailImages.length + ' imgs)');
      }
      callback(formatResult(baseData));
    }
  }

  function finalizeWithoutDesc(baseData, callback) {
    if (baseData.detailUrl && baseData.detailUrl.indexOf('itemcdn.tmall.com') !== -1) {
      fetchTmallDescHtml(baseData.detailUrl, function(descHtml) {
        if (descHtml) {
          baseData.detailHtml = descHtml;
          baseData.detailImages = extractImagesFromHtml(descHtml);
          console.log('[篝火采集] desc detail from tmall CDN (noDesc path, ' + baseData.detailImages.length + ' imgs)');
        }
        doneNoDesc();
      });
      return;
    }
    doneNoDesc();

    function doneNoDesc() {
      if (!baseData.detailHtml && _mainWorldNodeMapDesc && _mainWorldNodeMapDesc.length) {
        baseData.detailHtml = buildDescFromNodeMap(_mainWorldNodeMapDesc);
        baseData.detailImages = extractImagesFromHtml(baseData.detailHtml);
        console.log('[篝火采集] desc detail from nodeMap (' + baseData.detailImages.length + ' imgs)');
      }
      if (!baseData.detailHtml) {
        fetchDescHtml(offerId, function(descHtml) {
          if (descHtml) {
            baseData.detailHtml = descHtml;
            baseData.detailImages = extractImagesFromHtml(descHtml);
          }
          callback(formatResult(baseData));
        });
      } else {
        callback(formatResult(baseData));
      }
    }
  }

  // ── Main extraction ──
  function extractProductData(callback) {
    var ctxResult = tryWindowContext();
    if (ctxResult && ctxResult.productName) {
      if (ctxResult.images.length === 0 || ctxResult.skuList.length === 0) {
        console.log('[篝火采集] Tier 0 gaps — images:' + ctxResult.images.length + ' sku:' + ctxResult.skuList.length + ' — trying DOM');
        var domFill = extractDom();
        if (ctxResult.images.length === 0) ctxResult.images = domFill.images;
        if (ctxResult.skuList.length === 0) ctxResult.skuList = domFill.skuList;
        if (!ctxResult.description) ctxResult.description = domFill.description;
      }
      console.log('[篝火采集] Extracted from window.context: ' + ctxResult.productName.substring(0,40) + ' (' + ctxResult.skuList.length + ' SKU, ' + ctxResult.images.length + ' imgs)');
      finalizeWithDesc(ctxResult, callback);
      return;
    }

    fetchFromMainWorld(function(mainData) {
      if (mainData) {
        var parsed = parseInitData(mainData);
        if (parsed && parsed.productName) {
          if (parsed.images.length === 0 || !parsed.description || parsed.skuList.length === 0) {
            var domData = extractDom();
            if (parsed.images.length === 0) parsed.images = domData.images;
            if (!parsed.description) parsed.description = domData.description;
            if (parsed.skuList.length === 0) parsed.skuList = domData.skuList;
          }
          console.log('[篝火采集] Extracted from MAIN world (initData): ' + parsed.productName.substring(0,40) + ' (' + parsed.skuList.length + ' SKU, ' + parsed.images.length + ' imgs)');
          finalizeWithDesc(parsed, callback);
          return;
        }
        var modelParsed = parseGlobalDataModel(mainData);
        if (modelParsed && modelParsed.productName) {
          console.log('[篝火采集] Extracted from MAIN world (globalDataModel): ' + modelParsed.productName.substring(0,40) + ' (' + modelParsed.skuList.length + ' SKU, ' + modelParsed.images.length + ' imgs)');
          finalizeWithDesc(modelParsed, callback);
          return;
        }
        var ctxParsed = parseContextResultData(mainData);
        if (ctxParsed && (ctxParsed.productName || ctxParsed.images.length > 0 || ctxParsed.skuList.length > 0)) {
          if (ctxParsed.images.length === 0 || ctxParsed.skuList.length === 0) {
            var domDataCtx = extractDom();
            if (ctxParsed.images.length === 0) ctxParsed.images = domDataCtx.images;
            if (ctxParsed.skuList.length === 0) ctxParsed.skuList = domDataCtx.skuList;
            if (!ctxParsed.description && !ctxParsed._descHtml) ctxParsed.description = domDataCtx.description;
          }
          console.log('[篝火采集] Extracted from MAIN world (context): ' + (ctxParsed.productName || '(from DOM)').substring(0,40) + ' (' + ctxParsed.skuList.length + ' SKU, ' + ctxParsed.images.length + ' imgs, ' + ctxParsed.weight_g + 'g)');
          finalizeWithDesc(ctxParsed, callback);
          return;
        }
      }

      var isolated = tryIsolatedInitData();
      if (isolated) {
        var parsed2 = parseInitData(isolated);
        if (parsed2 && parsed2.productName) {
          if (parsed2.images.length === 0 || !parsed2.description || parsed2.skuList.length === 0) {
            var domData2 = extractDom();
            if (parsed2.images.length === 0) parsed2.images = domData2.images;
            if (!parsed2.description) parsed2.description = domData2.description;
            if (parsed2.skuList.length === 0) parsed2.skuList = domData2.skuList;
          }
          console.log('[篝火采集] Extracted from ISOLATED world: ' + parsed2.productName.substring(0,40));
          finalizeWithoutDesc(parsed2, callback);
          return;
        }
      }

      console.log('[篝火采集] __INIT_DATA unavailable, using DOM');
      var domResult = extractDom();
      finalizeWithoutDesc(domResult, callback);
    });
  }

  function formatResult(data) {
    var seen = {};
    data.images = (data.images || []).filter(function(u) {
      var c = u.split('?')[0]
        .replace(/\.jpg_\.\w+$/i, '.jpg')
        .replace(/\.jpeg_\.\w+$/i, '.jpeg')
        .replace(/\.png_\.\w+$/i, '.png');
      if (seen[c]) return false; seen[c] = true; return true;
    }).slice(0, 30);
    var detailSeen = {};
    data.detailImages = (data.detailImages || []).filter(function(u) {
      var c = u.split('?')[0];
      if (detailSeen[c] || seen[c]) return false; detailSeen[c] = true; return true;
    }).slice(0, 30);
    data.description = (data.description || '').trim();
    return {
      productName: data.productName || '',
      description: data.description || '',
      images: data.images || [],
      skuList: data.skuList || [],
      sourceUrl: href,
      timestamp: new Date().toISOString(),
      weight_g: data.weight_g || 0,
      packageSize: data.packageSize || '',
      packageDimensions: parsePackageSize(data.packageSize) || undefined,
      detailHtml: data.detailHtml || data._descHtml || '',
      detailImages: data.detailImages || [],
    };
  }

  function detectPageBlock() {
    function cleanBlockText(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
    var title = cleanBlockText(document.title);
    var text = '';
    try {
      var nodes = Array.prototype.slice.call(document.querySelectorAll('body *')).filter(function (el) {
        return el.children.length === 0;
      }).slice(0, 160);
      text = nodes.map(function (el) { return cleanBlockText(el.textContent); }).filter(Boolean).join(' ');
    } catch (e) {}
    var hasLoginUi = /登录|立即登录|扫码登录|密码登录|手机登录|账号登录|请登录/.test(text) ||
      !!document.querySelector('input[type="password"], iframe[src*="login"], iframe[src*="passport"], [class*="login"], [id*="login"], [class*="Login"], [id*="Login"], [class*="notLogin"], [class*="NotLogin"]');
    if (/login|passport/i.test(location.href) || hasLoginUi) {
      return '页面需要登录：请先在浏览器里完成 1688 登录，然后刷新商品页再采集';
    }
    var hasCaptchaUi = /真人验证|人机验证|安全验证|请完成验证|验证码|滑块|拖动滑块|向右滑动|验证后继续|baxia|punish|captcha/i.test(text + ' ' + title) ||
      !!document.querySelector('iframe[src*="captcha"], iframe[src*="baxia"], iframe[src*="punish"], [class*="captcha"], [class*="baxia"], [class*="punish"], #nc, .nc-container, .react-component-baxia');
    if (hasCaptchaUi) {
      return '页面出现真人验证：请先在浏览器里完成验证，然后刷新商品页再采集';
    }
    return '';
  }

  // ── Message handler ──
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'ping') { sendResponse({ online: true, isProductPage: true }); return false; }
    if (request.action === 'extract') {
      var blockReason = detectPageBlock();
      if (blockReason) { sendResponse({ success: false, error: blockReason, pageBlockReason: blockReason }); return false; }
      extractProductData(function(data) {
        console.log('[篝火采集] Extracted:', data.productName, '(' + data.skuList.length + ' SKU, ' + data.images.length + ' imgs)');
        sendResponse({ success: true, data: data });
      });
      return true;
    }
    if (request.action === 'debug') {
      // Collect ISOLATED world debug first
      var debugInfo = { offerId: offerId, pageUrl: href, timestamp: new Date().toISOString() };
      debugInfo.template = detectTemplate();

      // ISOLATED: window.context structure
      try {
        if (window.context) {
          var ctx = window.context;
          var ctxRes = ctx.result;
          var ctxGlobal = ctxRes && ctxRes.global;
          var ctxGlobalData = ctxGlobal && ctxGlobal.globalData;
          var ctxModel = ctxGlobalData && ctxGlobalData.model;
          debugInfo.windowContext = {
            topKeys: Object.keys(ctx).slice(0, 20),
            resultKeys: ctxRes ? Object.keys(ctxRes).slice(0, 20) : [],
            globalKeys: ctxGlobal ? Object.keys(ctxGlobal).slice(0, 20) : [],
            globalDataKeys: ctxGlobalData ? Object.keys(ctxGlobalData).slice(0, 20) : [],
            modelKeys: ctxModel ? Object.keys(ctxModel).slice(0, 20) : [],
          };
          if (ctxModel) {
            var od = ctxModel.offerDetail;
            debugInfo.model_offerDetail = od ? {
              keys: Object.keys(od).slice(0, 20),
              subject: String(od.subject || '').substring(0, 80),
              hasImages: !!(od.images || od.imageList || od.mainImageList),
              imageKeys: (od.images || od.imageList || od.mainImageList || []).length + ' items',
              featureAttributesCount: (od.featureAttributes || []).length,
              detailUrl: String(od.detailUrl || '').substring(0, 120),
              leafCategoryId: od.leafCategoryId,
            } : '(no offerDetail)';
            var cpm = ctxModel.customizedProcessingModel;
            debugInfo.model_skuModel = cpm ? {
              keys: Object.keys(cpm).slice(0, 15),
              hasNySkuModel: !!(cpm.nySkuModel),
              hasSkuModel: !!(cpm.skuModel),
              nySkuModelKeys: cpm.nySkuModel ? Object.keys(cpm.nySkuModel).slice(0, 10) : [],
              skuModelKeys: cpm.skuModel ? Object.keys(cpm.skuModel).slice(0, 10) : [],
              nySkuInfoMapSize: (cpm.nySkuModel && cpm.nySkuModel.skuInfoMap) ? Object.keys(cpm.nySkuModel.skuInfoMap).length : 0,
            } : '(no customizedProcessingModel)';
            var dd = ctxModel.detailDescription;
            debugInfo.model_detailDescription = dd ? {
              keys: Object.keys(dd).slice(0, 10),
              freightInfoKeys: dd.freightInfo ? Object.keys(dd.freightInfo).slice(0, 10) : [],
              unitWeight: dd.freightInfo ? dd.freightInfo.unitWeight : undefined,
            } : '(no detailDescription)';
          }
        } else {
          debugInfo.windowContext = '(missing)';
        }
      } catch(e) { debugInfo.windowContext = 'error: ' + e.message; }

      // ISOLATED: __INIT_DATA
      try {
        var init = window.__INIT_DATA || window.__detail_data__;
        if (init) {
          var rd = init.result && init.result.data;
          var rg = init.result && init.result.global;
          debugInfo.initData = {
            topKeys: Object.keys(init).slice(0, 15),
            resultInnerKeys: init.result ? Object.keys(init.result).slice(0, 15) : [],
            dataKeys: rd ? Object.keys(rd).slice(0, 30) : [],
            globalKeys: rg ? Object.keys(rg).slice(0, 15) : [],
            hasGallery: !!(rd && rd.gallery),
            galleryKeys: (rd && rd.gallery && rd.gallery.fields) ? Object.keys(rd.gallery.fields).slice(0, 10) : [],
            hasGlobalOfferDetail: !!(rg && rg.offerDetail),
          };
        } else { debugInfo.initData = '(missing)'; }
      } catch(e) { debugInfo.initData = 'error: ' + e.message; }

      // ISOLATED: globalData
      try {
        if (window.globalData) {
          debugInfo.globalData = {
            keys: Object.keys(window.globalData).slice(0, 15),
            tradeKeys: window.globalData.trade ? Object.keys(window.globalData.trade).slice(0, 10) : [],
            logisticInfo: window.globalData.trade && window.globalData.trade.logisticInfo ?
              JSON.stringify(window.globalData.trade.logisticInfo) : '(none)',
          };
        } else { debugInfo.globalData = '(missing)'; }
      } catch(e) { debugInfo.globalData = 'error: ' + e.message; }

      // ISOLATED: DOM overview
      try {
        var allImgs = document.querySelectorAll('img');
        var cdnImgs = document.querySelectorAll('img[src*="alicdn"], img[src*="alibaba"], img[src*="1688"]');
        var skuEls = document.querySelectorAll('[class*="sku"], [class*="variation"], [class*="spec"]');
        var galleryEls = document.querySelectorAll('.mod-detail-gallery, .detail-gallery, [class*="gallery"], [class*="od-pc-offer"]');
        debugInfo.domOverview = {
          title: document.title ? document.title.substring(0, 100) : '',
          totalImgs: allImgs.length,
          cdnImgs: cdnImgs.length,
          skuElements: skuEls.length,
          galleryContainers: galleryEls.length,
        };
      } catch(e) { debugInfo.domOverview = 'error: ' + e.message; }

      debugInfo.nodeMapAvailable = _mainWorldNodeMapDesc ? (_mainWorldNodeMapDesc.length + ' items') : 'no';

      // Now fetch MAIN world data (async)
      fetchFromMainWorld(function(mainData) {
        try {
          if (mainData) {
            var mainKeys = Object.keys(mainData);
            debugInfo.mainWorld = {
              source: 'MAIN world via CustomEvent bridge',
              topKeys: mainKeys.slice(0, 25),
              dataSize: JSON.stringify(mainData).length,
            };
            // If it has result.data (__INIT_DATA pattern)
            if (mainData.result) {
              var mrd = mainData.result.data;
              var mrg = mainData.result.global;
              debugInfo.mainWorld.resultKeys = Object.keys(mainData.result).slice(0, 15);
              debugInfo.mainWorld.dataKeys = mrd ? Object.keys(mrd).slice(0, 30) : [];
              debugInfo.mainWorld.globalKeys = mrg ? Object.keys(mrg).slice(0, 20) : [];
              if (mrd && mrd.gallery && mrd.gallery.fields) {
                debugInfo.mainWorld.galleryOfferImgList = (mrd.gallery.fields.offerImgList || []).length + ' imgs';
              }
            }
            // If it has result.global.globalData.model (window.context pattern)
            if (mainData.result && mainData.result.global && mainData.result.global.globalData && mainData.result.global.globalData.model) {
              var mm = mainData.result.global.globalData.model;
              debugInfo.mainWorld.modelKeys = Object.keys(mm).slice(0, 20);
              if (mm.customizedProcessingModel) {
                var mcpm = mm.customizedProcessingModel;
                debugInfo.mainWorld.skuModelType = mcpm.nySkuModel ? 'nySkuModel' : (mcpm.skuModel ? 'skuModel' : 'none');
              }
            }
          } else {
            debugInfo.mainWorld = '(timeout or unavailable)';
          }
        } catch(e) { debugInfo.mainWorld = 'error: ' + e.message; }

        sendResponse({ success: true, debug: debugInfo });
      });

      return true; // async response
    }
    sendResponse({ success: false, error: 'unknown action: ' + request.action });
    return false;
  });

  chrome.runtime.sendMessage({
    action: 'pageReady',
    url: href,
    isProductPage: true,
    platform: '1688',
    pageBlockReason: detectPageBlock()
  }, function() {});
})();
