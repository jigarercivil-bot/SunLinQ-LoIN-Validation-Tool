/* SunLinQ LoIN v2.39 — Search tab: find objects by property value.
 * Property + condition + value, with the values found in the model and their counts (the old free-text
 * search box is hidden). "Select in model" puts the results in the normal selection, so Allocate category… works
 * exactly as it does from the tree or 3D. Nothing here changes mapping. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var st = function () { return window.__irc && window.__irc.state; };
  var V = function () { return window.__irc && window.__irc.viewer; };
  var toast = function (m) { if (window.$s) window.$s(m); };
  var CLASS_KEY = 'IFC class';
  var str = function (v) { return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(+v.toFixed(6))) : typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v == null ? '' : v); };
  var isEmpty = function (v) { var t = str(v).trim(); return t === '' || /^not\s*set$/i.test(t) || /^t\.?\s*b\.?\s*c\.?$/i.test(t); };
  var BLANK = '(blank)', MISSING = '(missing)';

  /* ---- property index, built once per model ---- */
  var idx = null;
  function index() {
    var s = st(), M = s && s.model;
    if (!M) return null;
    if (idx && idx.model === M) return idx;
    var keys = new Map(), cls = new Map();
    M.elements.forEach(function (el) {
      el.props.forEach(function (v, k) {
        keys.set(k, (keys.get(k) || 0) + 1);
        var c = cls.get(k); if (!c) cls.set(k, c = new Set()); c.add(el.cls);
      });
    });
    keys.set(CLASS_KEY, M.elements.size);
    idx = { model: M, keys: keys, cls: cls, values: new Map() };
    idx.sorted = Array.from(keys.keys()).sort(function (a, b) { return a === CLASS_KEY ? -1 : b === CLASS_KEY ? 1 : keys.get(b) - keys.get(a) || a.localeCompare(b); });
    fillKeys();
    return idx;
  }
  /* The suggestion list holds at most 150 names (12d models can carry tens of thousands): the ones
     containing what has been typed, most common first. */
  function fillKeys() {
    var dl = $('#slqPsKeys'), I = idx; if (!dl || !I) return;
    var t = ($('#slqPsProp') && $('#slqPsProp').value || '').trim().toLowerCase(), out = [];
    for (var i = 0; i < I.sorted.length && out.length < 150; i++) { var k = I.sorted[i]; if (!t || k.toLowerCase().indexOf(t) >= 0) out.push(k); }
    dl.innerHTML = out.map(function (k) { return '<option value="' + esc(k) + '" label="' + I.keys.get(k).toLocaleString() + ' objects"></option>'; }).join('');
  }
  function valueOf(el, key) { return key === CLASS_KEY ? el.cls : el.props.get(key); }
  /* An object is in scope for a property when it has it, or when other objects of its IFC class have it.
     Those without it are listed as (missing); those with a blank, Not Set or TBC value as (blank). */
  function inScope(el, key, I) {
    if (key === CLASS_KEY || el.props.has(key)) return true;
    var c = I.cls.get(key); return !!(c && c.has(el.cls));
  }
  function valueCounts(key) {
    var I = index(); if (!I || !I.keys.has(key)) return null;
    if (I.values.has(key)) return I.values.get(key);
    var m = new Map();
    I.model.elements.forEach(function (el) {
      if (!inScope(el, key, I)) return;
      var has = key === CLASS_KEY || el.props.has(key), v = valueOf(el, key), t = !has ? MISSING : isEmpty(v) ? BLANK : str(v).trim();
      m.set(t, (m.get(t) || 0) + 1);
    });
    var arr = Array.from(m, function (x) { return { v: x[0], n: x[1] }; }).sort(function (a, b) { return b.n - a.n || a.v.localeCompare(b.v); });
    I.values.set(key, arr);
    return arr;
  }

  /* ---- search ---- */
  function test(op, v, want, has) {
    if (op === 'missing') return !has;
    if (op === 'empty') return has && isEmpty(v);
    if (op === 'notempty') return has && !isEmpty(v);
    var t = str(v).trim().toLowerCase();
    if (op === 'equals') return t === want;
    if (op === 'starts') return t.indexOf(want) === 0;
    return t.indexOf(want) >= 0;
  }
  var timer = null;
  function later() { clearTimeout(timer); timer = setTimeout(run, 180); }
  function hits() { var s = st(); return (s && s.searchHits) || []; }
  var ICON = {
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>'
  };
  /* "12d Model.Pit/pit type" -> group "12d Model › Pit", name "pit type" */
  function split(k) {
    if (k === CLASS_KEY) return { g: 'Object', n: 'IFC class' };
    var d = k.indexOf('.'), g = d > 0 ? k.slice(0, d) : '', r = d > 0 ? k.slice(d + 1) : k, parts = r.split('/');
    var n = parts.pop(); if (parts.length) g = (g ? g + ' › ' : '') + parts.join(' › ');
    if (g === 'Attr') g = 'IFC attribute';
    return { g: g, n: n };
  }
  function setCount(n, text) {
    var c = $('#slqPsCount'), head = $('#slqPsRes');
    if (!c) return;
    if (text != null) { head.classList.add('idle'); c.innerHTML = '<span class="slq-ps-hint">' + esc(text) + '</span>'; }
    else { head.classList.remove('idle'); c.innerHTML = '<b>' + n.toLocaleString() + '</b> object' + (n === 1 ? '' : 's'); }
    $('#slqPsSelect').disabled = !n; $('#slqPsIso').disabled = !n;
    $('#slqPsSelect').lastChild.textContent = n ? 'Select ' + n.toLocaleString() : 'Select';
  }

  function run() {
    var s = st(), list = $('#searchList');
    if (!list || !$('#slqPs')) return;
    var key = $('#slqPsProp').value.trim(), op = $('#slqPsOp').value, want = $('#slqPsVal').value.trim().toLowerCase();
    var needVal = op === 'contains' || op === 'equals' || op === 'starts';
    $('#slqPsVal').disabled = !needVal;
    $('#slqPsVal').placeholder = needVal ? 'Type a value or pick one below' : 'No value needed';
    $('#slqPsPropClear').hidden = !key;
    if (!s || !s.model) { s && (s.searchHits = []); list.innerHTML = ''; renderMeta(null); renderValues(null); setCount(0, 'Load a model to search it.'); return; }
    var I = index();
    var known = !!key && I.keys.has(key);
    renderMeta(known ? key : null);
    renderValues(known ? key : null, op, want);
    renderSuggest(!key);
    if (key && !known) { s.searchHits = []; list.innerHTML = ''; setCount(0, 'No property called “' + key + '”. Pick one from the list.'); return; }
    if (!key) { s.searchHits = []; list.innerHTML = ''; setCount(0, 'Choose a property to start.'); return; }
    if (needVal && !want) { s.searchHits = []; list.innerHTML = ''; setCount(0, 'Pick a value, or type one.'); return; }
    var out = [];
    s.model.elements.forEach(function (el) {
      if (!inScope(el, key, I)) return;
      var has = key === CLASS_KEY || el.props.has(key), v = valueOf(el, key);
      if (!test(op, v, want, has)) return;
      out.push({ el: el, v: v == null ? '' : str(v), miss: !has });
    });
    s.searchHits = out.map(function (u) { return { el: u.el, k: key, v: u.v }; });
    setCount(out.length);
    var mark = function (t) {
      var d = needVal && op !== 'equals' ? t.toLowerCase().indexOf(want) : -1;
      return d < 0 ? esc(t) : esc(t.slice(0, d)) + '<mark>' + esc(t.slice(d, d + want.length)) + '</mark>' + esc(t.slice(d + want.length));
    };
    list.innerHTML = out.slice(0, 500).map(function (u) {
      var val = u.miss ? '<em>missing</em>' : isEmpty(u.v) ? '<em>' + (u.v.trim() ? esc(u.v) : 'blank') + '</em>' : mark(u.v);
      return '<div class="item slq-ps-item' + (s.selected === u.el.id ? ' sel' : '') + '" data-id="' + u.el.id + '">' +
        '<div class="t">' + esc(u.el.props.get('Attr.Name') || '#' + u.el.id) + '</div>' +
        '<div class="slq-ps-row2"><span class="slq-ps-cls">' + esc(String(u.el.cls).replace(/^Ifc/, '')) + '</span>' +
        (key === CLASS_KEY ? '' : '<span class="slq-ps-chip' + (u.miss || isEmpty(u.v) ? ' empty' : '') + '">' + val + '</span>') + '</div></div>';
    }).join('') + (out.length > 500 ? '<div class="slq-ps-more">Showing the first 500 · Select and Isolate use all ' + out.length.toLocaleString() + '</div>' : '');
  }

  function renderMeta(key) {
    var m = $('#slqPsMeta'); if (!m) return;
    if (!key) { m.hidden = true; return; }
    var I = index(), p = split(key), arr = valueCounts(key) || [];
    var nv = arr.filter(function (x) { return x.v !== BLANK && x.v !== MISSING; }).length;
    m.hidden = false;
    m.innerHTML = '<span class="slq-ps-grp">' + esc(p.g) + '</span><span class="slq-ps-dot"></span>' + I.keys.get(key).toLocaleString() + ' objects · ' + nv.toLocaleString() + ' value' + (nv === 1 ? '' : 's');
  }

  function renderSuggest(show) {
    var box = $('#slqPsSuggest'), I = idx; if (!box) return;
    if (!show || !I) { box.hidden = true; return; }
    var pri = [/return.*owner|owner/i, /uniclass/i, /pit type|pipe type|family|type name/i, /material/i, /status|stage/i];
    var pick = [CLASS_KEY];
    pri.forEach(function (re) { for (var i = 0; i < I.sorted.length; i++) { var k = I.sorted[i]; if (re.test(k) && pick.indexOf(k) < 0) { pick.push(k); break; } } });
    if (pick.indexOf('Attr.Name') < 0 && I.keys.has('Attr.Name')) pick.push('Attr.Name');
    box.hidden = false;
    box.innerHTML = '<div class="slq-ps-cap">Common properties</div><div class="slq-ps-sugs">' + pick.slice(0, 6).map(function (k) {
      return '<button type="button" class="slq-ps-sug" data-k="' + esc(k) + '" title="' + esc(k) + '">' + esc(split(k).n) + '</button>';
    }).join('') + '</div>';
  }

  function renderValues(key, op, want) {
    var box = $('#slqPsVals'); if (!box) return;
    var arr = key ? valueCounts(key) : null;
    if (!arr) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    var N = 60, real = arr.filter(function (x) { return x.v !== BLANK && x.v !== MISSING; }), spec = arr.filter(function (x) { return x.v === BLANK || x.v === MISSING; });
    var max = arr.reduce(function (a, x) { return Math.max(a, x.n); }, 1);
    var row = function (x) {
      var sp = x.v === BLANK || x.v === MISSING, on = x.v === BLANK ? op === 'empty' : x.v === MISSING ? op === 'missing' : op === 'equals' && x.v.toLowerCase() === want;
      var lab = x.v === BLANK ? 'Blank, Not Set or TBC' : x.v === MISSING ? 'Property missing' : x.v;
      return '<button type="button" class="slq-ps-v' + (on ? ' on' : '') + (sp ? ' special' : '') + '" data-v="' + esc(x.v) + '" title="' + esc(lab) + '">' +
        '<i style="width:' + Math.max(2, Math.round(x.n / max * 100)) + '%"></i><span>' + esc(lab) + '</span><b>' + x.n.toLocaleString() + '</b></button>';
    };
    box.innerHTML = '<div class="slq-ps-cap">Values <span>click to filter</span></div>' + real.slice(0, N).map(row).join('') +
      (real.length > N ? '<div class="slq-ps-more">+' + (real.length - N).toLocaleString() + ' more · type above to narrow</div>' : '') +
      (spec.length ? '<div class="slq-ps-sep"></div>' + spec.map(row).join('') : '');
  }

  /* ---- UI ---- */
  function build() {
    var tab = $('#tab-search'), inp = $('#searchInput'), list = $('#searchList');
    if (!tab || !inp || !list) return false;
    if ($('#slqPs')) return true;
    tab.classList.add('slq-ps-tab');
    var row = inp.closest('.row'); if (row) row.style.display = 'none';
    var keysLab = $('#searchKeys') && $('#searchKeys').closest('label'); if (keysLab) keysLab.style.display = 'none';
    var btnRow = $('#btnIsolateSearch') && $('#btnIsolateSearch').closest('.row'); if (btnRow) btnRow.style.display = 'none';
    if ($('#searchCount')) $('#searchCount').style.display = 'none';

    var box = document.createElement('div');
    box.id = 'slqPs'; box.className = 'slq-ps';
    box.innerHTML =
      '<div class="slq-ps-card">' +
        '<label class="slq-ps-lab" for="slqPsProp">Property</label>' +
        '<div class="slq-ps-in">' + ICON.search + '<input id="slqPsProp" list="slqPsKeys" placeholder="Search property names…" autocomplete="off" spellcheck="false">' +
          '<button type="button" class="slq-ps-x" id="slqPsPropClear" aria-label="Clear property" hidden>' + ICON.x + '</button></div>' +
        '<datalist id="slqPsKeys"></datalist>' +
        '<div class="slq-ps-meta" id="slqPsMeta" hidden></div>' +
        '<div id="slqPsSuggest" hidden></div>' +
        '<label class="slq-ps-lab" for="slqPsVal">Condition</label>' +
        '<div class="slq-ps-cond"><select id="slqPsOp" aria-label="Condition">' +
          '<option value="equals">equals</option><option value="contains">contains</option><option value="starts">starts with</option>' +
          '<option value="empty">is blank</option><option value="missing">is missing</option><option value="notempty">has a value</option></select>' +
          '<input id="slqPsVal" autocomplete="off" spellcheck="false"></div>' +
        '<div class="slq-ps-vals" id="slqPsVals" hidden></div>' +
      '</div>' +
      '<div class="slq-ps-res idle" id="slqPsRes"><div class="slq-ps-count" id="slqPsCount"></div>' +
        '<div class="slq-ps-acts">' +
          '<button type="button" class="slq-ps-btn ghost" id="slqPsIso" title="Show only the objects found">' + ICON.eye + '<span>Isolate</span></button>' +
          '<button type="button" class="slq-ps-btn primary" id="slqPsSelect" title="Select every object found, then right-click or use Allocate category… in the bar">' + ICON.target + '<span>Select</span></button>' +
        '</div></div>';
    list.parentNode.insertBefore(box, list);
    list.classList.add('slq-ps-list');

    var P = $('#slqPsProp'), O = $('#slqPsOp'), Vl = $('#slqPsVal');
    P.addEventListener('focus', function () { if (index()) fillKeys(); });
    P.addEventListener('input', function () { if (index()) fillKeys(); later(); });
    P.addEventListener('change', function () { O.value = 'equals'; Vl.value = ''; run(); });
    O.addEventListener('change', run);
    Vl.addEventListener('input', later);
    $('#slqPsPropClear').onclick = function () { P.value = ''; O.value = 'equals'; Vl.value = ''; run(); if (V()) V().setVisible(null); P.focus(); };
    box.addEventListener('click', function (e) {
      var sg = e.target.closest('.slq-ps-sug');
      if (sg) { P.value = sg.dataset.k; O.value = 'equals'; Vl.value = ''; run(); return; }
      var b = e.target.closest('.slq-ps-v'); if (!b) return;
      var v = b.dataset.v;
      if (b.classList.contains('on')) { O.value = 'equals'; Vl.value = ''; }
      else if (v === BLANK) { O.value = 'empty'; Vl.value = ''; }
      else if (v === MISSING) { O.value = 'missing'; Vl.value = ''; }
      else { O.value = 'equals'; Vl.value = v; }
      run();
    });
    $('#slqPsSelect').onclick = function () {
      var ids = hits().map(function (h) { return h.el.id; });
      if (!ids.length) return;
      if (window.slqSelection) window.slqSelection.set(ids);
      if (V()) V().zoomTo(ids);
      toast(ids.length.toLocaleString() + ' object' + (ids.length === 1 ? '' : 's') + ' selected · right-click or use Allocate category…');
    };
    $('#slqPsIso').onclick = function () {
      var ids = hits().map(function (h) { return h.el.id; });
      if (!ids.length || !V()) return;
      V().setVisible(ids); V().zoomTo(ids);
    };
    list.addEventListener('click', function (e) {
      var it = e.target.closest('.item'); if (!it || !window.slqPick) return;
      e.stopPropagation(); window.slqPick(+it.dataset.id, true);
    }, true);
    window.slqSearchRun = run;
    /* refresh when a model is loaded or the tab is opened */
    var seen = null;
    setInterval(function () { var m = st() && st().model; if (m !== seen) { seen = m; idx = null; run(); } }, 1000);
    run();
    return true;
  }
  function boot() { if (!build()) setTimeout(boot, 300); }
  boot();
})();
