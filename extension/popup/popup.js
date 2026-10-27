/**
 * 篝火采集 — 弹窗脚本
 * 查询后台状态 → 在商品页点「采集」→ 把页面里的内容提取出来 → 交给后台发到本机应用。
 */
'use strict';

(function () {
  var APP = 'http://127.0.0.1:48765';
  var $ = function (id) { return document.getElementById(id); };
  var statusDot = $('statusDot'), statusLabel = $('statusLabel'), currentUrl = $('currentUrl');
  var lastProductArea = $('lastProductArea'), feedback = $('feedback');
  var btnCollect = $('btnCollect'), btnOpenApp = $('btnOpenApp'), btnFlush = $('btnFlush');

  function setStatus(mode, text) { statusDot.className = 'dot ' + mode; statusLabel.textContent = text; }
  function showFeedback(msg, type) {
    feedback.textContent = msg;
    feedback.className = type || '';
    if (type !== 'loading') {
      setTimeout(function () { if (feedback.textContent === msg) { feedback.textContent = ' '; feedback.className = ''; } }, 6000);
    }
  }
  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderLastProduct(product) {
    if (!product || !product.productName) { lastProductArea.innerHTML = '<div class="empty">暂无采集记录</div>'; return; }
    var warnings = [];
    if (!(product.images && product.images.length > 0)) warnings.push('缺少图片');
    if ((product.skuList || []).length === 0) warnings.push('缺少价格/规格');
    lastProductArea.innerHTML =
      '<div class="name">' + escapeHtml(product.productName) + '</div>' +
      '<div class="url">' + (product.skuList || []).length + ' 个规格 · ' + (product.images || []).length + ' 张主图</div>' +
      warnings.map(function (w) { return '<span class="warn-tag">' + w + '</span>'; }).join('');
  }

  function refreshState() {
    chrome.runtime.sendMessage({ action: 'getState' }, function (response) {
      if (chrome.runtime.lastError || !response || !response.state) { setStatus('error', '后台服务未响应'); return; }
      var s = response.state;
      currentUrl.textContent = s.currentTabUrl ? (s.currentTabUrl.length > 60 ? s.currentTabUrl.substring(0, 60) + '…' : s.currentTabUrl) : '—';
      var label = s.platform === 'taobao' ? '淘宝' : s.platform === 'tmall' ? '天猫' : '1688';
      if (s.pageBlockReason) { setStatus('warning', s.pageBlockReason); btnCollect.disabled = !s.isProductPage; }
      else if (s.isProductPage) { setStatus('active', label + ' 商品详情页'); btnCollect.disabled = false; }
      else if (s.isOn1688 || s.isTaobao) { setStatus('', label + ' 网站（不是商品详情页）'); btnCollect.disabled = true; }
      else { setStatus('', '不是 1688 / 淘宝 / 天猫页面'); btnCollect.disabled = true; }
      renderLastProduct(s.lastCollectedProduct);
    });
  }

  function refreshPending() {
    chrome.storage.local.get('pendingSaves', function (result) {
      var n = ((result && result.pendingSaves) || []).length;
      btnFlush.style.display = n > 0 ? 'block' : 'none';
      btnFlush.textContent = '重新发送暂存（' + n + '）';
    });
  }

  function collectProduct() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || tabs.length === 0) { showFeedback('未找到当前标签页', 'error'); return; }
      var tabId = tabs[0].id;
      btnCollect.disabled = true;
      btnCollect.textContent = '采集中…';
      showFeedback('正在读取商品数据…', 'loading');

      function done() { btnCollect.disabled = false; btnCollect.textContent = '采集当前商品'; }

      function onExtract(response, retried) {
        if (chrome.runtime.lastError || !response) {
          if (retried) { done(); showFeedback('读取失败，请刷新页面后重试', 'error'); return; }
          chrome.runtime.sendMessage({ action: 'injectContentScript' }, function (inj) {
            if (chrome.runtime.lastError || !inj || !inj.success) { done(); showFeedback('注入采集脚本失败，请刷新页面', 'error'); return; }
            setTimeout(function () { chrome.tabs.sendMessage(tabId, { action: 'extract' }, function (r) { onExtract(r, true); }); }, 300);
          });
          return;
        }
        done();
        if (!response.success) { showFeedback('读取失败：' + (response.error || '未知错误'), 'error'); return; }
        handleExtracted(response.data);
      }
      chrome.tabs.sendMessage(tabId, { action: 'extract' }, function (r) { onExtract(r, false); });
    });
  }

  function handleExtracted(data) {
    if (!data || !data.productName) { showFeedback('没读到商品名称，请确认页面已加载完', 'error'); return; }
    renderLastProduct(data);
    showFeedback('正在发送给桌面应用…', 'loading');
    chrome.runtime.sendMessage({ action: 'saveProduct', data: data }, function (res) {
      if (chrome.runtime.lastError || !res || !res.success) {
        showFeedback('发送失败：' + ((res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || '未知'), 'error');
        return;
      }
      if (res.savedTo === 'bridge') showFeedback('已发送到桌面应用的产品库', 'success');
      else if (res.savedTo === 'storage') showFeedback('桌面应用没开：已暂存 ' + (res.pendingCount || '?') + ' 条，打开应用后点「重新发送暂存」', 'warning');
      else showFeedback('保存失败', 'error');
      refreshPending();
    });
  }

  btnCollect.addEventListener('click', collectProduct);
  btnOpenApp.addEventListener('click', function () {
    fetch(APP + '/focus', { headers: { 'X-Campfire-Collector': '1' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); showFeedback('已把桌面应用带到前面', 'success'); })
      .catch(function () { showFeedback('桌面应用没有运行，请先打开「1688→拼多多上架」', 'error'); });
  });
  btnFlush.addEventListener('click', function () {
    showFeedback('正在重新发送…', 'loading');
    chrome.runtime.sendMessage({ action: 'flushPending' }, function (res) {
      if (chrome.runtime.lastError || !res || !res.success) { showFeedback('重新发送失败', 'error'); return; }
      showFeedback('已发送 ' + res.sent + ' 条' + (res.left ? '，还有 ' + res.left + ' 条没发出去（应用没开？）' : ''), res.left ? 'warning' : 'success');
      refreshPending();
    });
  });

  refreshPending();
  refreshState();
})();
