/**
 * 篝火采集插件 — 后台脚本（Manifest V3 service worker）
 *
 * 1. 接收弹窗里采集到的商品数据；
 * 2. 通过本机回环地址（127.0.0.1）发给桌面应用，不经过任何外部服务器；
 * 3. 应用没开时，先暂存在浏览器本地，等应用开了再点「重新发送」。
 */

'use strict';

const CONFIG = {
  appUrl: 'http://127.0.0.1:48765',
  bridgeEndpoint: '/collect',
};

const state = {
  lastCollectedProduct: null,
  lastCollectedTime: null,
  lastCollectedName: '',
  lastSaveStatus: null,
  lastSavedFilename: '',
  currentTabUrl: '',
  isOn1688: false,
  isTaobao: false,
  platform: '',
  isProductPage: false,
  pageBlockReason: '',
};

function saveState() {
  chrome.storage.local.set({ extensionState: state }).catch(function (err) {
    console.warn('[篝火采集] 保存状态失败:', err.message);
  });
}

function parsePageInfo(url) {
  url = String(url || '');
  var host = '';
  var path = '';
  try {
    var u = new URL(url);
    host = u.hostname;
    path = u.pathname || '';
  } catch (e) {
    host = (url.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || '';
    path = (url.match(/^https?:\/\/[^/?#]+([^?#]*)/i) || [])[1] || '';
  }
  var isOn1688 = /(^|\.)1688\.com$/i.test(host);
  var isTaobaoHost = (
    /(^|\.)taobao\.com$/i.test(host) || /(^|\.)tmall\.com$/i.test(host) || /(^|\.)tmall\.hk$/i.test(host)
  );
  var isTmall = /(^|\.)tmall\.(com|hk)$/i.test(host);
  var isTaobaoProduct = isTaobaoHost && (
    /\/item\.htm$/i.test(path) ||
    /\/item\/[^/?#]+/i.test(path) ||
    /\/awp\/core\/detail\.htm$/i.test(path) ||
    /\/security-h5-detail\/home$/i.test(path) ||
    /\/h5\/mtop\.taobao\.detail\.getdetail/i.test(path) ||
    /[?&](id|itemId|item_id|item_num_id)=\d+/i.test(url)
  );
  var is1688Product = isOn1688 && (/\/offer\//i.test(path) || /\/offer\/\d+\.html/i.test(url));
  return {
    currentTabUrl: url,
    isOn1688: isOn1688,
    isTaobao: isTaobaoHost,
    platform: isOn1688 ? '1688' : isTaobaoHost ? (isTmall ? 'tmall' : 'taobao') : '',
    isProductPage: is1688Product || isTaobaoProduct,
    pageBlockReason: ''
  };
}

function applyPageInfo(url, overrides) {
  var info = parsePageInfo(url);
  overrides = overrides || {};
  var previousUrl = state.currentTabUrl || '';
  var nextUrl = overrides.url || info.currentTabUrl;
  state.currentTabUrl = nextUrl;
  state.isOn1688 = info.isOn1688;
  state.isTaobao = info.isTaobao;
  state.platform = overrides.platform || info.platform;
  state.isProductPage = info.isProductPage || overrides.isProductPage === true;
  if (Object.prototype.hasOwnProperty.call(overrides, 'pageBlockReason')) {
    state.pageBlockReason = overrides.pageBlockReason || '';
  } else if (info.pageBlockReason) {
    state.pageBlockReason = info.pageBlockReason;
  } else if (nextUrl !== previousUrl) {
    state.pageBlockReason = '';
  }
}

function isTaobaoProductUrl(url) {
  var info = parsePageInfo(url);
  return info.isTaobao && info.isProductPage;
}

function parseDescResponseText(text) {
  text = String(text || '');
  var html = '';
  var contentMatch = text.match(/"content"\s*:\s*"([\s\S]*?)(?:"\s*\}|"\s*,)/);
  if (contentMatch) {
    html = contentMatch[1];
  } else {
    var descMatch = text.match(/var\s+desc\s*=\s*'([\s\S]*)'\s*;?\s*$/) ||
                    text.match(/desc\s*:\s*'([\s\S]*?)'\s*(?:,|\})/);
    if (descMatch) html = descMatch[1];
  }
  if (!html && /^\s*</.test(text)) html = text;
  if (!html) {
    var jsonp = text.match(/^[^(]+\(([\s\S]+)\)\s*;?$/);
    if (jsonp) {
      try {
        var parsed = JSON.parse(jsonp[1]);
        html = (parsed && (parsed.content || parsed.desc || parsed.html ||
               (parsed.data && (parsed.data.content || parsed.data.desc || parsed.data.html)))) || '';
      } catch (e) {}
    }
  }
  if (!html) return '';
  return String(html)
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .replace(/\\u003C/g, '<')
    .replace(/\\u003E/g, '>')
    .replace(/\\u002F/g, '/')
    .replace(/data-src=/gi, 'src=');
}

// ── Save via Web App Bridge (with retry + fallback) ──────

/**
 * Retry pattern: up to 3 attempts with exponential backoff (1s → 2s → 4s)
 */
async function saveWithRetry(data, tryTimes) {
  var url = CONFIG.appUrl + CONFIG.bridgeEndpoint;
  var maxRetries = 3 - (tryTimes || 0);
  var lastError = null;

  for (var attempt = 0; attempt < maxRetries; attempt++) {
    try {
      var response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Campfire-Collector': '1' },
        body: JSON.stringify({ data: data }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        var errText = await response.text().catch(function () { return ''; });
        throw new Error('服务器返回 ' + response.status + ': ' + errText);
      }

      var result = await response.json();
      console.log('[篝火采集] 已交给桌面应用:', result.filename);
      return { success: true, savedTo: 'bridge', filename: result.filename, path: result.path };
    } catch (err) {
      lastError = err;
      console.warn('[篝火采集] 保存尝试 ' + (attempt + 1) + '/' + maxRetries + ' 失败:', err.message);
      if (attempt < maxRetries - 1) {
        await new Promise(function (r) { setTimeout(r, 1000 * Math.pow(2, attempt)); });
      }
    }
  }

  // Bridge unreachable → fallback to chrome.storage.local
  console.warn('[篝火采集] 桥接保存全部失败，fallback 到 chrome.storage.local');
  return await saveToLocalStorage(data, lastError);
}

async function saveToLocalStorage(data, originalError) {
  try {
    var stored = await chrome.storage.local.get('pendingSaves');
    var pending = stored.pendingSaves || [];
    pending.push({
      productName: data.productName,
      data: data,
      savedAt: new Date().toISOString(),
      error: originalError ? originalError.message : '桥接不可达',
    });
    if (pending.length > 20) pending = pending.slice(-20);
    await chrome.storage.local.set({ pendingSaves: pending });
    console.log('[篝火采集] 数据已存到本地缓存（' + pending.length + ' 条待同步）');
    return { success: true, savedTo: 'storage', pendingCount: pending.length };
  } catch (e) {
    console.error('[篝火采集] 本地缓存也失败了:', e.message);
    return { success: false, savedTo: 'none', error: originalError ? originalError.message : e.message };
  }
}

// ── Message handlers ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === 'pageReady') {
    applyPageInfo(request.url || (sender && sender.tab && sender.tab.url) || '', {
      platform: request.platform,
      isProductPage: request.isProductPage,
      pageBlockReason: request.pageBlockReason || ''
    });
    saveState();
    sendResponse({ received: true });
    return false;
  }

  if (request.action === 'saveProduct') {
    const data = request.data;
    if (!data || !data.productName) {
      sendResponse({ success: false, error: '无效的商品数据' });
      return false;
    }

    state.lastCollectedProduct = data;
    state.lastCollectedName = data.productName;
    state.lastCollectedTime = new Date().toISOString();

    saveWithRetry(data, 0)
      .then(function (result) {
        state.lastSaveStatus = result.savedTo === 'bridge' ? 'saved' :
                               result.savedTo === 'storage' ? 'cached' : 'save_failed';
        state.lastSavedFilename = result.filename || '';
        saveState();
        sendResponse({
          success: true,
          saveSuccess: result.savedTo === 'bridge',
          savedTo: result.savedTo,
          filename: result.filename || '',
          pendingCount: result.pendingCount || 0,
          productName: data.productName,
        });
      })
      .catch(function (err) {
        state.lastSaveStatus = 'save_failed';
        state.lastSavedFilename = '';
        saveState();
        sendResponse({
          success: false,
          saveSuccess: false,
          savedTo: 'none',
          error: err.message,
          productName: data.productName,
        });
      });

    return true;
  }

  // 应用没开时暂存的商品：应用打开后重新发送，成功的从暂存里去掉
  if (request.action === 'flushPending') {
    chrome.storage.local.get('pendingSaves').then(async function (stored) {
      var pending = stored.pendingSaves || [];
      var left = [];
      var sent = 0;
      for (var i = 0; i < pending.length; i++) {
        try {
          var resp = await fetch(CONFIG.appUrl + CONFIG.bridgeEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Campfire-Collector': '1' },
            body: JSON.stringify({ data: pending[i].data }),
            signal: AbortSignal.timeout(8000),
          });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          sent++;
        } catch (e) {
          left.push(pending[i]);
        }
      }
      await chrome.storage.local.set({ pendingSaves: left });
      sendResponse({ success: true, sent: sent, left: left.length });
    }).catch(function (err) {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (request.action === 'getState') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs[0]) {
        applyPageInfo(tabs[0].url || tabs[0].pendingUrl || state.currentTabUrl || '');
        saveState();
      }
      sendResponse({ state: state });
    });
    return true;
  }

  if (request.action === 'injectContentScript') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || tabs.length === 0) {
        sendResponse({ success: false, error: '未找到活动标签页' });
        return;
      }
      const tabId = tabs[0].id;
      const url = tabs[0].url || '';
      var pageInfo = parsePageInfo(url);
      var file = pageInfo.isOn1688 ? 'content/1688-product.js'
               : pageInfo.isTaobao ? 'content/taobao-product.js'
               : null;
      if (!file) {
        sendResponse({ success: false, error: '当前页面不是 1688 / 淘宝 / 天猫' });
        return;
      }
      chrome.scripting.executeScript(
        { target: { tabId: tabId }, files: [file] },
        function () {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse({ success: true, message: '采集脚本已注入' });
        }
      );
    });
    return true;
  }

  // Fetch desc API (CORS-free proxy for content script)
  if (request.action === 'fetchDescApi') {
    var descUrl = 'https://www.alibaba.com/event/app/mainAction/desc.htm?detailId=' + (request.offerId || '');
    fetch(descUrl, { method: 'GET', signal: AbortSignal.timeout(8000) })
      .then(function(resp) {
        if (!resp.ok) throw new Error('desc API returned ' + resp.status);
        return resp.json();
      })
      .then(function(json) {
        var html = (json.data && json.data.productHtmlDescription) || '';
        if (html) html = html.replace(/data-src=/gi, 'src=');
        sendResponse({ html: html });
      })
      .catch(function(err) {
        console.warn('[篝火采集] desc API proxy failed:', err.message);
        sendResponse({ html: '' });
      });
    return true;
  }

  // Fetch tmall CDN desc (CORS-free proxy)
  if (request.action === "fetchTmallDesc") {
    var tmallUrl = request.url || "";
    if (!tmallUrl) { sendResponse({ html: "" }); return false; }
    fetch(tmallUrl, { method: "GET", signal: AbortSignal.timeout(10000) })
      .then(function(resp) {
        if (!resp.ok) throw new Error("tmall CDN returned " + resp.status);
        return resp.text();
      })
      .then(function(text) {
        var html = parseDescResponseText(text);
        sendResponse({ html: html || "" });
      })
      .catch(function(err) {
        console.warn("[篝火采集] tmall CDN proxy failed:", err.message);
        sendResponse({ html: "" });
      });
    return true;
  }

  if (request.action === 'fetchTaobaoDesc') {
    var taobaoUrl = request.url || '';
    if (!/^https?:\/\//.test(taobaoUrl)) { sendResponse({ html: '' }); return false; }
    fetch(taobaoUrl, {
      method: 'GET',
      headers: { 'Referer': state.currentTabUrl || 'https://item.taobao.com/' },
      signal: AbortSignal.timeout(10000)
    })
      .then(function(resp) {
        if (!resp.ok) throw new Error('taobao desc returned ' + resp.status);
        return resp.text();
      })
      .then(function(text) {
        sendResponse({ html: parseDescResponseText(text) || '' });
      })
      .catch(function(err) {
        console.warn('[篝火采集] taobao desc proxy failed:', err.message);
        sendResponse({ html: '' });
      });
    return true;
  }

  sendResponse({ success: false, error: '未知后台操作: ' + request.action });
  return false;
});

chrome.storage.local.get('extensionState').then(function (result) {
  if (result.extensionState) {
    Object.assign(state, result.extensionState);
    console.log('[篝火采集] 状态已恢复，上次采集:', state.lastCollectedName || '(无)');
  }
}).catch(function () {
  console.log('[篝火采集] 首次启动');
});

chrome.tabs.onActivated.addListener(function (activeInfo) {
  chrome.tabs.get(activeInfo.tabId, function (tab) {
    if (chrome.runtime.lastError || !tab) return;
    const url = tab.url || tab.pendingUrl || '';
    applyPageInfo(url);
    saveState();
  });
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete' && tab.active) {
    const url = tab.url || tab.pendingUrl || '';
    applyPageInfo(url);
    saveState();
  }
});

console.log('[篝火采集] 后台服务已启动 v0.1.0');
