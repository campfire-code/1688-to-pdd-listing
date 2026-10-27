// 注入到「拼多多商家后台」窗口的脚本。
// 只做两类事：
// 1. 提供 window.__campfire 里的几个函数，由应用按步骤调用（搜类目、填标题、传主图、填规格和价格、点保存草稿等）；
// 2. 每个函数的结果和页面状态，只通过 Tauri 事件发回应用主窗口（pdd-result / pdd-status）。
// 不读取、不转发 Cookie 和账号信息，不修改页面发出的请求；不伪装环境、不模拟人类轨迹。
// 遇到登录、扫码、滑块、真人验证，只上报「需要你自己处理」，由用户在窗口里完成。
// 页面选择器按页面文字和输入框提示语定位，页面改版后可能失效，失效时会如实上报而不是硬点。
(function () {
  if (window.__campfire) return;

  function emit(event, payload) {
    try {
      window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: event, payload: payload });
    } catch (e) {}
  }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function shown(el) { return !!el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0)); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function textOf(el) { return ((el && (el.innerText || el.textContent)) || '').trim(); }
  function bodyText() { return document.body ? document.body.innerText || '' : ''; }

  // React 受控输入框要用原生 setter 赋值再触发事件，页面才认
  function setValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function click(el) {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    el.click();
  }
  function findInput(placeholders) {
    for (var i = 0; i < placeholders.length; i++) {
      var el = all('input[placeholder*="' + placeholders[i] + '"]').filter(shown)[0];
      if (el) return el;
    }
    return null;
  }
  // 按文字找可点击元素：优先「整段文字完全相等」，其次「包含」，只在可见元素里找，取最深的一层
  function findByText(text, scope, selectors) {
    var sel = selectors || 'button, a, li, label, span, div, p';
    var nodes = Array.prototype.slice.call((scope || document).querySelectorAll(sel)).filter(shown);
    var exact = nodes.filter(function (e) { return textOf(e) === text; });
    var pool = exact.length ? exact : nodes.filter(function (e) { return textOf(e).indexOf(text) >= 0 && textOf(e).length < text.length + 30; });
    if (!pool.length) return null;
    return pool.sort(function (a, b) { return a.querySelectorAll('*').length - b.querySelectorAll('*').length; })[0];
  }
  function findButton(texts) {
    var btns = all('button').filter(shown);
    for (var i = 0; i < texts.length; i++) {
      var b = btns.filter(function (x) { return textOf(x).replace(/\s+/g, '') === texts[i]; })[0] ||
        btns.filter(function (x) { return textOf(x).indexOf(texts[i]) >= 0; })[0];
      if (b) return b;
    }
    return null;
  }

  // ---------------- 页面状态 ----------------
  function probeFn() {
    var text = bodyText();
    var url = location.href;
    var blocked = '';
    if (/login|passport/i.test(url) || (all('input[type="password"]').filter(shown).length > 0)) blocked = 'login';
    else if (/验证码|滑块|拖动滑块|真人验证|安全验证|人机验证|请完成验证/.test(text) && !/保存草稿/.test(text)) blocked = 'captcha';
    var hasFileInput = !!document.querySelector('input[type=file][accept*=image]');
    var hasTitle = !!findInput(['商品标题组成']);
    var hasNext = all('button').some(function (b) { return textOf(b).indexOf('下一步') >= 0; });
    var hasCategorySearch = !!findInput(['搜索分类', '搜索类目', '关键词搜索']);
    var hasGoodsAdd = url.indexOf('/goods/goods_add/') >= 0;
    var hasSkuArea = /保存草稿|提交并上架|拼单价|价格及库存/.test(text) || hasGoodsAdd;
    var cards = all('[class*=cateItemCard]').length;
    var kind = 'other';
    if (blocked) kind = blocked;
    else if (hasCategorySearch) kind = 'category_search';
    else if (hasFileInput && hasTitle && hasNext && !hasSkuArea) kind = 'step1';
    else if (hasTitle && hasSkuArea) kind = 'form';
    return { url: url, kind: kind, blocked: blocked, hasTitle: hasTitle, hasFileInput: hasFileInput, cards: cards, hasSkuArea: hasSkuArea };
  }

  // ---------------- 类目 ----------------
  function candidateTexts() {
    var seen = {}, out = [];
    all('div, li, a, p, span').forEach(function (e) {
      if (!shown(e)) return;
      var t = textOf(e);
      if (!t || t.length < 5 || t.length > 120 || t.indexOf('>') < 0 || t.indexOf('\n') >= 0 || !/[一-龥]/.test(t)) return;
      if (!seen[t]) { seen[t] = 1; out.push(t); }
    });
    return out;
  }
  async function searchCategory(a) {
    var kw = String(a.keyword || '');
    var tab = findByText('搜索发品');
    if (tab) { click(tab); await sleep(1200); }
    var input = findInput(['请输入关键词搜索分类', '关键词搜索分类', '搜索分类', '搜索类目', '类目']);
    if (!input) throw new Error('找不到类目搜索框，页面可能改版了，请自己在窗口里选好类目');
    click(input);
    setValue(input, kw);
    var last = [], lastChange = Date.now(), deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      await sleep(700);
      var cur = candidateTexts();
      if (JSON.stringify(cur) !== JSON.stringify(last)) { last = cur; lastChange = Date.now(); continue; }
      if (cur.length && Date.now() - lastChange >= 2000) break;
    }
    return { candidates: last };
  }
  async function pickCategory(a) {
    var el = findByText(String(a.text));
    if (!el) throw new Error('没找到类目：' + a.text);
    click(el);
    await sleep(1200);
    return { clicked: true };
  }
  function recommendCards() {
    var cards = all('[class*=cateItemCard][class*=chooseCategory]');
    if (!cards.length) cards = all('[class*=cateItemCard]');
    return cards.filter(shown);
  }
  async function listRecommended() {
    return { cards: recommendCards().map(function (c) { return { text: textOf(c).replace(/\s+/g, ' ').slice(0, 120), checked: /checked/i.test(c.className || '') }; }) };
  }
  async function clickRecommended(a) {
    var cards = recommendCards();
    var c = cards[Number(a.index) || 0];
    if (!c) throw new Error('没有这个推荐类目');
    if (!/checked/i.test(c.className || '')) { click(c); await sleep(800); }
    return { text: textOf(c).replace(/\s+/g, ' ').slice(0, 120) };
  }
  async function clickNext() {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(400);
    var b = findButton(['下一步']);
    if (!b) throw new Error('没找到「下一步」按钮');
    click(b);
    return { clicked: true };
  }

  // ---------------- 基本信息 ----------------
  async function fillTitle(a) {
    var el = findInput(['商品标题组成']);
    if (!el) throw new Error('没找到商品标题输入框');
    click(el);
    setValue(el, String(a.title));
    return { filled: true };
  }
  async function fillBrand(a) {
    var el = findInput(['品牌名称搜索']);
    if (!el) return { filled: false, note: '页面上没有品牌输入框，已跳过' };
    click(el);
    setValue(el, String(a.brand));
    await sleep(800);
    var opt = findByText(String(a.brand), null, 'li, div[class*=option], div[class*=Option]');
    if (opt && opt !== el) { click(opt); return { filled: true, picked: true }; }
    return { filled: true, picked: false, note: '没有匹配的下拉项，只填了搜索框' };
  }

  // ---------------- 主图：应用把图片分块发进来，在页面里拼成文件，再交给页面自己的上传框 ----------------
  var imgStore = {};
  async function imgBegin(a) { imgStore[a.key] = { name: a.name, mime: a.mime || 'image/jpeg', parts: [] }; return { ok: true }; }
  async function imgChunk(a) { var s = imgStore[a.key]; if (!s) throw new Error('图片没有开始'); s.parts.push(a.data); return { ok: true }; }
  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function imgsAttach(a) {
    var input = all('input[type=file][accept*=image]')[0];
    if (!input) throw new Error('找不到图片上传框');
    var dt = new DataTransfer();
    (a.keys || []).forEach(function (k) {
      var s = imgStore[k];
      if (!s) return;
      var bytes = b64ToBytes(s.parts.join(''));
      dt.items.add(new File([bytes], s.name, { type: s.mime }));
    });
    if (!dt.files.length) throw new Error('没有可上传的图片');
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { count: dt.files.length };
  }
  async function imgsClear() { imgStore = {}; return { ok: true }; }

  // ---------------- 商品属性 ----------------
  function attrCells() {
    return all('[class*=property-item]').filter(shown).map(function (cell) {
      var label = (textOf(cell).split('\n')[0] || '').trim().replace(/^(重要|预填|必填)\s*/, '').trim();
      return {
        cell: cell, label: label,
        trigger: cell.querySelector('input[placeholder="请选择"]'),
        box: cell.querySelector('input[type="text"]:not([placeholder="请选择"])'),
      };
    }).filter(function (c) { return c.label; });
  }
  async function listAttrs() {
    all('[class*=property-item]').forEach(function (el) { try { el.scrollIntoView({ block: 'center' }); } catch (e) {} });
    await sleep(1200);
    return { labels: attrCells().map(function (c) { return c.label; }) };
  }
  async function fillAttr(a) {
    var c = attrCells().filter(function (x) { return x.label === a.label; })[0];
    if (!c) return { ok: false, note: '页面上没有「' + a.label + '」' };
    if (c.trigger) {
      click(c.trigger);
      await sleep(800);
      var opt = findByText(String(a.value), null, 'li, div[class*=option], div[class*=Option], span');
      if (!opt) { document.body.click(); return { ok: false, note: '「' + a.label + '」没有选项「' + a.value + '」' }; }
      click(opt);
      await sleep(400);
      return { ok: true };
    }
    if (c.box) { setValue(c.box, String(a.value)); return { ok: true }; }
    return { ok: false, note: '「' + a.label + '」不是可填的类型' };
  }

  // ---------------- 规格与 SKU ----------------
  async function specSlots() {
    var b = findButton(['添加规格类型']);
    if (!b) return { used: 0, found: false };
    var m = /\((\d+)\/2\)/.exec(textOf(b));
    return { used: m ? Number(m[1]) : 0, found: true };
  }
  function blurCommit(el) {
    ['keydown', 'keyup'].forEach(function (t) {
      el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    });
    el.blur();
    var anchor = findByText('基本信息');
    if (anchor) anchor.click();
  }
  async function addSpecType(a) {
    var b = findButton(['添加规格类型']);
    if (!b) throw new Error('没找到「添加规格类型」');
    click(b);
    await sleep(1500);
    var typeInputs = all('input[placeholder*="规格类型"]').filter(shown);
    if (!typeInputs.length) throw new Error('没找到规格类型选择框');
    click(typeInputs[typeInputs.length - 1]);
    await sleep(1000);
    var opt = findByText(String(a.name), null, 'li, div[class*=option], div[class*=Option], span');
    if (!opt) throw new Error('规格类型里没有「' + a.name + '」，请换一个规格名称');
    click(opt);
    await sleep(1200);
    var inputs = all('input[placeholder*="自定义' + a.name + '"], input[placeholder*="请输入规格名称"], input[placeholder*="规格名称"], input[placeholder*="规格值"]').filter(shown);
    var added = 0;
    for (var i = 0; i < a.values.length; i++) {
      var target = all('input[placeholder*="自定义' + a.name + '"], input[placeholder*="请输入规格名称"], input[placeholder*="规格名称"], input[placeholder*="规格值"]')
        .filter(function (x) { return shown(x) && !x.value; })[0];
      if (!target) break;
      click(target);
      setValue(target, a.values[i]);
      await sleep(300);
      blurCommit(target);
      await sleep(1000);
      added++;
    }
    return { added: added, total: a.values.length, inputs: inputs.length };
  }
  function skuTable() {
    return all('table').filter(function (t) { var s = textOf(t); return s.indexOf('库存') >= 0 && s.indexOf('拼单价') >= 0; })[0] || null;
  }
  async function readSkuRows() {
    var t = skuTable();
    if (!t) return { rows: [] };
    return { rows: Array.prototype.slice.call(t.querySelectorAll('tbody tr')).map(function (r, idx) { return { idx: idx, text: textOf(r).replace(/\s+/g, ' ') }; }) };
  }
  async function fillSkuRow(a) {
    var t = skuTable();
    if (!t) throw new Error('没找到价格库存表');
    var row = t.querySelectorAll('tbody tr')[a.idx];
    if (!row) throw new Error('没有第 ' + a.idx + ' 行');
    var inputs = Array.prototype.slice.call(row.querySelectorAll('input[placeholder="请输入"]'));
    if (inputs.length < 3) return { ok: false, note: '第 ' + a.idx + ' 行只有 ' + inputs.length + ' 个输入框' };
    // 顺序：库存、拼单价、单买价、规格编码、商品编码
    var vals = [a.stock, a.group, a.single, a.specCode, a.goodsCode];
    vals.forEach(function (v, i) {
      if (v === null || v === undefined || v === '' || i >= inputs.length) return;
      click(inputs[i]);
      setValue(inputs[i], v);
    });
    return { ok: true };
  }

  // ---------------- 发货、承诺、按钮 ----------------
  async function chooseText(a) {
    var el = findByText(String(a.text));
    if (!el) return { ok: false, note: '没找到「' + a.text + '」' };
    click(el);
    await sleep(300);
    return { ok: true };
  }
  async function tickCheckbox(a) {
    var wrappers = all('label, [class*=CBX_outerWrapper]');
    for (var i = 0; i < wrappers.length; i++) {
      var w = wrappers[i];
      if (textOf(w).indexOf(a.text) < 0) continue;
      var cb = w.querySelector('input[type="checkbox"]');
      if (cb) { if (!cb.checked) { try { cb.scrollIntoView({ block: 'center' }); } catch (e) {} cb.click(); } return { ok: true }; }
      click(w);
      return { ok: true };
    }
    return { ok: false, note: '没找到「' + a.text + '」' };
  }
  async function clickButtonByText(a) {
    var b = findButton(a.texts);
    if (!b) return { ok: false, note: '没找到按钮：' + a.texts.join(' / ') };
    click(b);
    return { ok: true, clicked: textOf(b).slice(0, 20) };
  }
  async function waitText(a) {
    var deadline = Date.now() + (a.ms || 5000);
    while (Date.now() < deadline) {
      var t = bodyText();
      for (var i = 0; i < a.texts.length; i++) if (t.indexOf(a.texts[i]) >= 0) return { found: a.texts[i], url: location.href };
      await sleep(500);
    }
    return { found: '', url: location.href };
  }
  async function pageErrors() {
    var t = bodyText();
    var hit = /错误项未处理[^\n]*/.exec(t);
    return { error: hit ? hit[0] : '', tail: t.slice(-300), url: location.href };
  }
  async function pageTail(a) { return { tail: bodyText().slice(-(a.n || 800)), url: location.href }; }
  async function scrollBottom() { window.scrollTo(0, document.body.scrollHeight); return { ok: true }; }

  // 只会跳到类目选择页这一个固定地址；先回报结果，再跳转（跳转后页面会重新载入）
  async function gotoCategory() {
    setTimeout(function () { location.href = 'https://mms.pinduoduo.com/goods/category'; }, 200);
    return { navigating: true };
  }

  var FUNCS = {
    gotoCategory: gotoCategory,
    probe: probeFn, searchCategory: searchCategory, pickCategory: pickCategory, listRecommended: listRecommended,
    clickRecommended: clickRecommended, clickNext: clickNext, fillTitle: fillTitle, fillBrand: fillBrand,
    imgBegin: imgBegin, imgChunk: imgChunk, imgsAttach: imgsAttach, imgsClear: imgsClear,
    listAttrs: listAttrs, fillAttr: fillAttr, specSlots: specSlots, addSpecType: addSpecType,
    readSkuRows: readSkuRows, fillSkuRow: fillSkuRow, chooseText: chooseText, tickCheckbox: tickCheckbox,
    clickButtonByText: clickButtonByText, waitText: waitText, pageErrors: pageErrors, pageTail: pageTail,
    scrollBottom: scrollBottom,
  };

  window.__campfire = {
    /** 应用调用入口：执行一个函数，把结果（或错误）用事件发回 */
    dispatch: async function (id, fn, args) {
      try {
        if (!FUNCS[fn]) throw new Error('未知函数 ' + fn);
        var data = await FUNCS[fn](args || {});
        emit('pdd-result', { id: id, ok: true, data: data });
      } catch (e) {
        emit('pdd-result', { id: id, ok: false, error: String((e && e.message) || e) });
      }
    },
  };
  emit('pdd-status', { step: 'injected', url: location.href });
})();
