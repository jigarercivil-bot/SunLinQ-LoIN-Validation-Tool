/* SunLinQ LoIN v2.39 — Search tab: find objects by property value.
 * Quick text (any value) as before, plus Property + test + Value with the list of values found in the model
 * and their counts. "Select in model" puts the results in the normal selection, so Allocate category… works
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
  function later() { clearTimeout(timer); timer = setTimeout(run, 200); }
  function hits() { var s = st(); return (s && s.searchHits) || []; }

  function run() {
    var s = st(), list = $('#searchList'), count = $('#searchCount');
    if (!list || !count) return;
    var q = $('#searchInput').value.trim().toLowerCase();
    var key = $('#slqPsProp').value.trim(), op = $('#slqPsOp').value, want = $('#slqPsVal').value.trim().toLowerCase();
    var needVal = op === 'contains' || op === 'equals' || op === 'starts';
    $('#slqPsVal').disabled = !needVal;
    renderValues(key, op, want);
    if (q.length < 2) q = '';
    var usingProp = !!key && (!needVal || want !== '');
    if (!s || !s.model) { s && (s.searchHits = []); list.innerHTML = ''; count.textContent = (q || key) ? 'Load a model first.' : ''; return; }
    var I = index();
    if (key && !I.keys.has(key)) { s.searchHits = []; list.innerHTML = ''; count.textContent = 'No property called “' + key + '” in this model.'; return; }
    if (!q && !usingProp) { s.searchHits = []; list.innerHTML = ''; count.textContent = key ? 'Enter a value or pick one above.' : ''; return; }
    var out = [];
    s.model.elements.forEach(function (el) {
      var k = null, v = null;
      if (usingProp) {
        if (!inScope(el, key, I)) return;
        v = valueOf(el, key);
        if (!test(op, v, want, key === CLASS_KEY || el.props.has(key))) return;
        k = key;
      }
      if (q) {
        var found = false;
        el.props.forEach(function (pv, pk) { if (!found && str(pv).toLowerCase().indexOf(q) >= 0) { found = true; if (!k) { k = pk; v = pv; } } });
        if (!found && !usingProp) return;
        if (!found) return;
      }
      out.push({ el: el, k: k, v: v == null ? '' : str(v), miss: usingProp && k === key && key !== CLASS_KEY && !el.props.has(key) });
    });
    s.searchHits = out;
    count.textContent = out.length.toLocaleString() + ' object' + (out.length === 1 ? '' : 's') + ' found';
    var mark = function (u) {
      var t = String(u), d = q ? t.toLowerCase().indexOf(q) : -1;
      return d < 0 ? esc(t) : esc(t.slice(0, d)) + '<mark>' + esc(t.slice(d, d + q.length)) + '</mark>' + esc(t.slice(d + q.length));
    };
    list.innerHTML = out.slice(0, 500).map(function (u) {
      return '<div class="item ' + (s.selected === u.el.id ? 'sel' : '') + '" data-id="' + u.el.id + '"><div class="t">' + esc(u.el.props.get('Attr.Name') || '#' + u.el.id) +
        '</div><div class="s">' + esc(u.el.cls) + '</div><div class="s">' + mark(u.k) + ' = ' + (u.miss ? '<i class="muted">(missing)</i>' : u.v === '' ? '<i class="muted">(blank)</i>' : mark(u.v)) + '</div></div>';
    }).join('') + (out.length > 500 ? '<div class="muted sm">Showing the first 500. Select in model and Isolate use all ' + out.length.toLocaleString() + '.</div>' : '');
    $('#slqPsSelect').textContent = out.length ? 'Select ' + out.length.toLocaleString() + ' in model' : 'Select in model';
  }

  function renderValues(key, op, want) {
    var box = $('#slqPsVals'); if (!box) return;
    var arr = key ? valueCounts(key) : null;
    if (!arr) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    var N = 40;
    box.innerHTML = '<div class="muted sm">Values in this model</div>' + arr.slice(0, N).map(function (x) {
      var sp = x.v === BLANK || x.v === MISSING, on = x.v === BLANK ? op === 'empty' : x.v === MISSING ? op === 'missing' : op === 'equals' && x.v.toLowerCase() === want;
      return '<button type="button" class="slq-ps-v' + (on ? ' on' : '') + (sp ? ' blank' : '') + '" data-v="' + esc(x.v) + '"><span>' + esc(x.v) + '</span><b>' + x.n.toLocaleString() + '</b></button>';
    }).join('') + (arr.length > N ? '<div class="muted sm">+' + (arr.length - N).toLocaleString() + ' more values · type to narrow</div>' : '');
  }

  /* ---- UI ---- */
  function build() {
    var tab = $('#tab-search'), inp = $('#searchInput');
    if (!tab || !inp || $('#slqPs')) return !!$('#slqPs');
    var keysLab = $('#searchKeys') && $('#searchKeys').closest('label');
    if (keysLab) keysLab.style.display = 'none';
    inp.placeholder = 'Quick search: any text or value…';
    var box = document.createElement('div');
    box.id = 'slqPs'; box.className = 'slq-ps';
    box.innerHTML = '<div class="slq-ps-h">Find by property</div>' +
      '<label class="slq-ps-l" for="slqPsProp">Property</label>' +
      '<input class="inp" id="slqPsProp" list="slqPsKeys" placeholder="Start typing a property name…" autocomplete="off"><datalist id="slqPsKeys"></datalist>' +
      '<div class="row"><select class="inp sm" id="slqPsOp" aria-label="Test">' +
      '<option value="contains">contains</option><option value="equals">equals</option><option value="starts">starts with</option>' +
      '<option value="empty">is empty</option><option value="missing">is missing</option><option value="notempty">has a value</option></select>' +
      '<input class="inp grow" id="slqPsVal" placeholder="Value" autocomplete="off"></div>' +
      '<div class="slq-ps-vals" id="slqPsVals" hidden></div>';
    var row = inp.closest('.row') || inp;
    row.parentNode.insertBefore(box, row.nextSibling);

    var iso = $('#btnIsolateSearch');
    if (iso) {
      var b = document.createElement('button');
      b.className = 'btn sm primary'; b.id = 'slqPsSelect'; b.textContent = 'Select in model';
      b.title = 'Select every object found, then right-click or use Allocate category… in the bar';
      iso.parentNode.insertBefore(b, iso);
      b.onclick = function () {
        var ids = hits().map(function (h) { return h.el.id; });
        if (!ids.length) return toast('No search results');
        if (window.slqSelection) window.slqSelection.set(ids);
        if (V()) V().zoomTo(ids);
        toast(ids.length.toLocaleString() + ' object' + (ids.length === 1 ? '' : 's') + ' selected · right-click or use Allocate category…');
      };
    }
    inp.oninput = later;
    $('#slqPsProp').addEventListener('focus', index);
    $('#slqPsProp').addEventListener('input', function () { if (index()) fillKeys(); later(); });
    $('#slqPsProp').addEventListener('change', run);
    $('#slqPsOp').addEventListener('change', run);
    $('#slqPsVal').addEventListener('input', later);
    $('#slqPsVals').addEventListener('click', function (e) {
      var b = e.target.closest('.slq-ps-v'); if (!b) return;
      var v = b.dataset.v;
      if (b.classList.contains('on')) { $('#slqPsOp').value = 'contains'; $('#slqPsVal').value = ''; }
      else if (v === BLANK) { $('#slqPsOp').value = 'empty'; $('#slqPsVal').value = ''; }
      else if (v === MISSING) { $('#slqPsOp').value = 'missing'; $('#slqPsVal').value = ''; }
      else { $('#slqPsOp').value = 'equals'; $('#slqPsVal').value = v; }
      run();
    });
    $('#searchList').addEventListener('click', function (e) {
      var it = e.target.closest('.item'); if (!it || !window.slqPick) return;
      e.stopPropagation(); window.slqPick(+it.dataset.id, true);
    }, true);
    var clr = $('#btnClearSearch');
    if (clr) clr.onclick = function () {
      inp.value = ''; $('#slqPsProp').value = ''; $('#slqPsOp').value = 'contains'; $('#slqPsVal').value = '';
      run(); if (V()) V().setVisible(null);
    };
    window.slqSearchRun = run;
    return true;
  }
  function boot() { if (!build()) setTimeout(boot, 300); }
  boot();
})();
