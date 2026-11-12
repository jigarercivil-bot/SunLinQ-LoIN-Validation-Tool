/* SunLinQ LoIN v2.36 — clean layout layer.
 * Rearranges existing elements (keeping their ids and engine bindings), adds the stage switcher,
 * built-in rules card, results verdict, Help tab and maintainer mode. No validation logic lives here.
 */
(function () {
  'use strict';
  var VERSION = '2.36';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var state = function () { return window.__irc && window.__irc.state; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var el = function (tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (html != null) n.innerHTML = html;
    return n;
  };

  var ICONS = {
    rules: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    mapping: '<path d="M7 7h10M7 7l3-3M7 7l3 3M17 17H7M17 17l-3-3M17 17l-3 3"/>',
    results: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    comps: '<path d="M12 3l8 9-8 9-8-9z"/>',
    model: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    schema: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.01"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>'
  };
  var icon = function (name, size) {
    size = size || 18;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  };
  var STAGE_SHORT = { TDS: 'TDS', CDS: 'CDS', PDS: 'PDS', FDS: 'FDS', PTU: 'PTU / IFC', ASC: 'ASC' };
  var OWNER_LABEL = { PROJECT: 'Project', TMR: 'TMR', QRL: 'QR', SCC: 'SCC' };

  var body = document.body;
  body.classList.add('slq3');
  function setAdmin(on) {
    body.classList.toggle('slq-admin', !!on);
    store.set('slq.admin', on ? '1' : '0');
    var cb = $('#slqAdmin');
    if (cb) cb.checked = !!on;
  }
  body.classList.toggle('slq-admin', store.get('slq.admin') === '1' || /[?&]admin=1\b/.test(location.search));

  /* ---------- Header ---------- */
  var top = $('header.top');
  var sub = $('.brand-sub', top);
  if (sub) sub.textContent = 'LoIN Validation · v' + VERSION;
  var chip = el('div', { 'class': 'slq-chip', id: 'slqRulesChip' });
  var stages = el('div', { 'class': 'slq-stages', role: 'group', 'aria-label': 'Check at stage', id: 'slqStages' });
  var exportBtn = $('#btnExport');
  if (exportBtn) exportBtn.innerHTML = icon('download', 16) + ' Export';
  var themeBtn = $('#btnTheme');
  if (themeBtn) { themeBtn.innerHTML = icon('moon', 16); themeBtn.setAttribute('aria-label', 'Toggle theme'); }
  [ $('.brand', top), $('.top-sep', top), chip, stages, $('.spacer', top), $('#modelStatus'), $('#modelInfo'),
    $('#btnOpen'), $('#fileInput'), $('#dataOnly') && $('#dataOnly').closest('label'), $('.menu', top), themeBtn
  ].forEach(function (n) { if (n) top.appendChild(n); });

  function renderStages() {
    var sel = $('#stageSel');
    if (!sel) return;
    var sig = sel.value + '|' + $$('option', sel).map(function (o) { return o.value; }).join(',');
    if (stages.dataset.sig === sig) return;
    stages.dataset.sig = sig;
    stages.innerHTML = '';
    stages.hidden = !sel.options.length;
    $$('option', sel).forEach(function (o) {
      var b = el('button', { type: 'button', title: o.textContent, 'aria-pressed': String(o.value === sel.value) });
      b.textContent = STAGE_SHORT[o.value] || o.value;
      b.onclick = function () {
        if (sel.value === o.value) return;
        sel.value = o.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        renderStages();
      };
      stages.appendChild(b);
    });
  }

  function ruleCounts(schema) {
    var c = { PROJECT: 0, TMR: 0, QRL: 0, SCC: 0 };
    (schema.rules || []).forEach(function (r) {
      if (r.enabled === false) return;
      var o = String(r.owner || 'PROJECT').toUpperCase();
      c[o] = (c[o] || 0) + 1;
    });
    return c;
  }
  function renderChip() {
    var s = state();
    if (!s || !s.schema) return;
    var b = s.schema.builtin;
    var sig = (b ? b.id : 'custom') + '|' + (s.schema.rules || []).length;
    if (chip.dataset.sig === sig) return;
    chip.dataset.sig = sig;
    chip.classList.toggle('custom', !b);
    chip.innerHTML = b
      ? icon('check', 14) + '<b>' + esc(b.name) + '</b><span>· built-in</span>'
      : icon('alert', 14) + '<b>Custom rules</b><span>· not the built-in set</span>';
    chip.title = (b ? 'Revision: ' + b.rev + ' · ' : '') + (s.schema.rules || []).length + ' rules';
  }

  /* ---------- Left rail ---------- */
  var nav = $('nav.tabs');
  nav.classList.add('slq-rail');
  $$('button', nav).forEach(function (b) {
    var ico = $('.tab-ico', b);
    if (ico && ICONS[b.dataset.tab]) ico.innerHTML = icon(b.dataset.tab, 20);
  });
  // Schema: its own rail item directly below Mapping. It opens the Schema window
  // (mapping table, selectors, attributes, values, alias) using the engine's own button.
  var schemaBtn = $('#btnSchemaView');
  var mappingBtn = $('button[data-tab="mapping"]', nav);
  if (schemaBtn && mappingBtn) {
    schemaBtn.hidden = true;
    var schemaRail = el('button', { type: 'button', 'data-rail': 'schema', title: 'Schema window: IFC mapping, selectors, attributes, values and alias' },
      '<span class="tab-ico">' + icon('schema', 20) + '</span><span>Schema</span>');
    schemaRail.addEventListener('click', openSchema);
    mappingBtn.insertAdjacentElement('afterend', schemaRail);
  }
  nav.appendChild(el('div', { 'class': 'slq-rail-spacer' }));
  var helpBtn = el('button', { type: 'button', 'data-tab': 'help' }, '<span class="tab-ico">' + icon('help', 20) + '</span><span>Help</span>');
  nav.appendChild(helpBtn);
  helpBtn.addEventListener('click', function () {
    $$('button', nav).forEach(function (x) { x.classList.toggle('on', x === helpBtn); });
    $$('.left > .tab').forEach(function (x) { x.classList.toggle('on', x.id === 'tab-help'); });
    renderHelp();
  });

  /* ---------- Schema window: owner attributes and their possible values ----------
   * Mapping (IFC object -> owner category) lives only in the Mapping tab, so the Schema
   * window's Mapping and Selectors tabs are maintainer-only and it opens on Attributes. */
  function openSchema() {
    var admin = body.classList.contains('slq-admin');
    var current = ($('#svTabs button.on') || {}).dataset;
    var tab = current && current.t;
    if (!admin && (!tab || tab === 'mapping' || tab === 'selectors')) tab = 'attributes';
    if (typeof window.Eme === 'function') window.Eme(tab); else if (schemaBtn) schemaBtn.click();
  }
  (function () {
    var modal = $('#svModal');
    if (!modal) return;
    var title = $('.sv-top b', modal);
    if (title) title.textContent = 'Schema · owner attributes and possible values';
    $$('#svTabs button', modal).forEach(function (b) {
      if (b.dataset.t === 'mapping' || b.dataset.t === 'selectors') b.classList.add('slq-maint-only');
    });
    var card = $('.sv-card', modal);
    var tpl = $('#btnValuesTpl'), imp = $('#btnValues');
    if (card && tpl && imp) {
      var row = el('div', { 'class': 'slq-sv-values' },
        '<span class="muted sm">Possible values per attribute:</span>');
      tpl.textContent = 'Download values sheet';
      imp.textContent = 'Import allowed values';
      imp.classList.add('slq-maint-only');
      row.appendChild(tpl); row.appendChild(imp);
      card.insertAdjacentElement('afterend', row);
    }
  })();

  function tabHead(section, title, text) {
    var h = el('div', { 'class': 'slq-tabhead' }, '<h2>' + esc(title) + '</h2>' + (text ? '<p>' + esc(text) + '</p>' : ''));
    section.insertBefore(h, section.firstChild);
    return h;
  }

  /* ---------- Rules tab ---------- */
  var rulesTab = $('#tab-rules');
  var ruleCard = el('div', { 'class': 'slq-card slq-rulecard', id: 'slqRuleCard' });
  var maint = el('details', { 'class': 'slq-maint', id: 'slqMaint' },
    '<summary>Maintainer tools</summary><p class="muted sm">Change or replace the rule set. Changes stay in this browser until the rules file is updated and a new release is published.</p>');
  var resetRow = el('div', { 'class': 'row wrap' });
  var resetBtn = el('button', { type: 'button', 'class': 'btn sm' }, 'Reset to built-in rules');
  resetBtn.onclick = resetToBuiltin;
  resetRow.appendChild(resetBtn);
  [ $('#schemaName') && $('#schemaName').closest('.row'), $('#btnLoi') && $('#btnLoi').closest('.row'), resetRow, $('#settingsBox'), $('#loiNotes') ]
    .forEach(function (n) { if (n) maint.appendChild(n); });
  var stageBox = $('#stageBox');
  rulesTab.insertBefore(ruleCard, rulesTab.firstChild);
  if (stageBox) rulesTab.insertBefore(stageBox, ruleCard.nextSibling);
  rulesTab.insertBefore(maint, (stageBox || ruleCard).nextSibling);
  tabHead(rulesTab, 'Rules', 'The requirements every model is checked against at the selected stage.');

  /* Two collapsible sections: Owner property sets (which TMR / QR Psets are due at this stage)
     and Attributes (every rule). The engine keeps rendering into its own elements inside them. */
  function section(id, title, openByDefault) {
    var saved = store.get('slq.sec.' + id);
    var d = el('details', { 'class': 'slq-section', id: id });
    if (saved === null ? openByDefault : saved === '1') d.open = true;
    d.innerHTML = '<summary><span class="slq-sec-title">' + esc(title) + '</span><span class="slq-sec-meta"></span>' + icon('chevron', 16) + '</summary><div class="slq-sec-body"></div>';
    d.addEventListener('toggle', function () { store.set('slq.sec.' + id, d.open ? '1' : '0'); });
    return d;
  }
  var stageInfo = $('#stageInfo'), scope = $('#slqStageScope');
  var secPsets = section('slqSecPsets', 'Owner property sets', true);
  var secAttrs = section('slqSecAttrs', 'Attributes', true);
  if (stageInfo) { stageInfo.classList.add('slq-stageinfo'); rulesTab.insertBefore(stageInfo, ruleCard.nextSibling); }
  if (stageBox) stageBox.classList.add('slq-emptied');
  if (scope) $('.slq-sec-body', secPsets).appendChild(scope);
  var ruleSearchRow = $('#ruleSearch') && $('#ruleSearch').closest('.row');
  [ruleSearchRow, $('#ruleList')].forEach(function (n) { if (n) $('.slq-sec-body', secAttrs).appendChild(n); });
  rulesTab.appendChild(secPsets);
  rulesTab.appendChild(secAttrs);
  function renderSections() {
    var s = state();
    if (!s || !s.schema) return;
    var gate = ($('#stageSel') || {}).value || (s.schema.settings || {}).stage || '';
    var meta = '';
    if (window.slqPsetScope && gate) {
      var items = window.slqPsetScope.listForStage(s.schema, gate);
      var due = items.filter(function (x) { return x.applicable; });
      var deferred = due.filter(function (x) { return !x.enabled; }).length;
      meta = due.length + ' of ' + items.length + ' due at ' + (STAGE_SHORT[gate] || gate) + (deferred ? ' · ' + deferred + ' deferred' : '');
      secPsets.hidden = !items.length;
    }
    $('.slq-sec-meta', secPsets).textContent = meta;
    var n = (s.schema.rules || []).filter(function (r) { return r.enabled !== false; }).length;
    $('.slq-sec-meta', secAttrs).textContent = n + ' rules';
  }

  function resetToBuiltin() {
    if (!window.__SLQ_BUILTIN__) return;
    if (!confirm('Replace the current rules with the built-in DSCRLP rules? Mapping work for matching categories is kept.')) return;
    var s = state();
    var cur = s && s.schema;
    store.set('irc.schema', JSON.stringify({ rules: [], mapping: cur && cur.mapping, builtin: { id: 'reset' } }));
    location.reload();
  }
  function renderRuleCard() {
    var s = state();
    if (!s || !s.schema) return;
    var sc = s.schema, b = sc.builtin;
    var sig = (b ? b.id : 'custom') + '|' + (sc.rules || []).length + '|' + body.classList.contains('slq-admin');
    if (ruleCard.dataset.sig === sig) return;
    ruleCard.dataset.sig = sig;
    var c = ruleCounts(sc);
    var tags = Object.keys(c).filter(function (k) { return c[k]; })
      .map(function (k) { return '<span>' + esc(OWNER_LABEL[k] || k) + ' ' + c[k] + '</span>'; }).join('');
    ruleCard.classList.toggle('custom', !b);
    ruleCard.innerHTML =
      '<div class="slq-rc-head"><span class="slq-ico">' + icon(b ? 'lock' : 'alert', 16) + '</span><div>' +
      '<b>' + (b ? esc(b.name) : 'Custom rules in use') + '</b>' +
      '<span class="sub">' + (b ? 'Built in · ' + esc(b.rev) + ' · ' : 'Not the built-in DSCRLP set · ') + (sc.rules || []).length + ' rules</span>' +
      '</div></div><div class="slq-tags">' + tags + '</div>';
    if (!b && window.__SLQ_BUILTIN__) {
      var rb = el('button', { type: 'button', 'class': 'btn sm primary' }, 'Reset to built-in rules');
      rb.onclick = resetToBuiltin;
      ruleCard.appendChild(rb);
    }
  }

  /* ---------- Mapping tab ---------- */
  var comps = $('#tab-comps');
  if (comps) tabHead(comps, 'Components (advanced)', 'Keyword-based matching and bulk classification from Excel. For normal work use Mapping.');

  /* ---------- Results tab ---------- */
  var resultsBody = $('#resultsBody');
  var verdict = el('div', { 'class': 'slq-verdict', id: 'slqVerdict', role: 'status' });
  if (resultsBody) resultsBody.insertBefore(verdict, resultsBody.firstChild);
  tabHead($('#tab-results'), 'Validation results', '');
  var lastResults = null;
  function renderVerdict() {
    var s = state();
    var R = s && s.results;
    if (R === lastResults) return;
    lastResults = R;
    if (!R || !R.totals) { verdict.hidden = true; return; }
    verdict.hidden = false;
    var t = R.totals, stage = STAGE_SHORT[R.stage] || R.stage || '';
    var n = function (x) { return Number(x || 0).toLocaleString(); };
    var cls, title, text;
    if (!t.all) { cls = ''; title = 'Nothing checked yet'; text = 'No objects are covered by rules at ' + stage + '.'; }
    else if (t.fail) { cls = 'fail'; title = 'Errors to fix at ' + stage; text = n(t.fail) + ' of ' + n(t.all) + ' objects have errors' + (t.warn ? ', ' + n(t.warn) + ' have warnings only.' : '.'); }
    else if (t.warn) { cls = 'warn'; title = 'No errors at ' + stage; text = n(t.warn) + ' of ' + n(t.all) + ' objects have warnings. Warnings don’t block the gate.'; }
    else { cls = 'pass'; title = 'No errors at ' + stage; text = 'All ' + n(t.all) + ' checked objects pass.'; }
    if (t.na) text += ' ' + n(t.na) + ' not checked.';
    verdict.className = 'slq-verdict ' + cls;
    verdict.innerHTML = '<i class="dot"></i><div><b>' + esc(title) + '</b><span>' + esc(text) + '</span></div>';
  }

  /* ---------- Model tab ---------- */
  var modelBody = $('#modelBody');
  if (modelBody && $('#tree') && $('#classList') && $('#storeyList')) {
    var group = function (key, nodes) {
      var g = el('div', { 'class': 'slq-mgroup', 'data-g': key });
      nodes.forEach(function (n) { if (n) g.appendChild(n); });
      return g;
    };
    var prevH4 = function (n) { var p = n && n.previousElementSibling; return p && p.tagName === 'H4' ? p : null; };
    var treeRow = $('#btnTreeCollapse') && $('#btnTreeCollapse').closest('.row');
    var visRow = $('#btnAllOff') && $('#btnAllOff').closest('.row');
    var gS = group('structure', [prevH4(treeRow), treeRow, $('#tree')]);
    var gC = group('classes', [prevH4($('#classList')), visRow, $('#classList')]);
    var gY = group('storeys', [prevH4($('#storeyList')), $('#storeyList')]);
    var seg = el('div', { 'class': 'slq-seg', role: 'group', 'aria-label': 'View model by' });
    [['structure', 'Structure'], ['classes', 'Classes'], ['storeys', 'Storeys']].forEach(function (x) {
      var b = el('button', { type: 'button', 'aria-pressed': String(x[0] === 'structure') }, x[1]);
      b.onclick = function () {
        $$('button', seg).forEach(function (y) { y.setAttribute('aria-pressed', String(y === b)); });
        [gS, gC, gY].forEach(function (g) { g.hidden = g.dataset.g !== x[0]; });
      };
      seg.appendChild(b);
    });
    gC.hidden = gY.hidden = true;
    modelBody.appendChild(seg);
    modelBody.appendChild(gS); modelBody.appendChild(gC); modelBody.appendChild(gY);
  }
  tabHead($('#tab-model'), 'Model', '');
  tabHead($('#tab-search'), 'Search', 'Find objects by name, class or property value.');
  tabHead($('#tab-mapping'), 'Asset mapping', 'Tell the tool what each object is, so the right owner rules apply.');
  var oldMapHead = $('#tab-mapping .mapv-head > div');
  if (oldMapHead) oldMapHead.style.display = 'none';

  /* ---------- Welcome ---------- */
  var hero = $('#welcome .hero');
  if (hero) {
    var h2 = $('h2', hero), p = $('p', hero);
    if (h2) h2.textContent = 'Check a model against the DSCRLP LoIN';
    if (p) p.textContent = 'Project rules are built in. Pick the stage at the top, drop in an IFC and get a gate-ready report. Your model never leaves this computer.';
    var drop = $('.drop', hero);
    if (drop) {
      drop.setAttribute('role', 'button');
      drop.setAttribute('tabindex', '0');
      drop.setAttribute('aria-label', 'Choose an IFC file');
      var ico = $('.drop-ico', drop);
      if (ico) ico.innerHTML = icon('upload', 26);
      var open = function () { $('#fileInput').click(); };
      drop.addEventListener('click', open);
      drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      var txt = $('div:not(.drop-ico)', drop);
      if (txt) txt.innerHTML = '<b>Drop an IFC model here, or click to choose</b><div class="muted sm">Large models (over 200 MB) can be opened in data-only mode</div>';
    }
  }
  function renderSteps() {
    var steps = $$('#welcome .qstep');
    if (steps.length !== 4) return;
    var s = state();
    var rules = s && s.schema ? (s.schema.rules || []).length : 0;
    var hasModel = !!(s && s.model);
    var defs = [
      ['Rules ready', rules ? rules + ' rules built in' : 'No rules loaded', rules ? 'done' : 'current'],
      ['Choose stage', 'Stage switcher, top bar', rules ? (hasModel ? 'done' : 'current') : ''],
      ['Load the IFC', 'Checks run straight away', hasModel ? 'done' : ''],
      ['Review & export', 'Excel report · MVC', '']
    ];
    steps.forEach(function (st, i) {
      var d = defs[i];
      var sig = d.join('|');
      if (st.dataset.sig === sig) return;
      st.dataset.sig = sig;
      st.className = 'qstep ' + d[2];
      st.innerHTML = '<i>' + (d[2] === 'done' ? icon('check', 12) : (i + 1)) + '</i><strong>' + esc(d[0]) + '</strong><small>' + esc(d[1]) + '</small>';
      if (d[2] === 'current') st.setAttribute('aria-current', 'step'); else st.removeAttribute('aria-current');
    });
  }

  /* ---------- Help tab ---------- */
  var helpTab = el('section', { 'class': 'tab slq-help', id: 'tab-help' });
  var left = $('.left');
  if (left) left.appendChild(helpTab);
  function renderHelp() {
    var s = state();
    var sc = s && s.schema, b = sc && sc.builtin;
    helpTab.innerHTML =
      '<div class="slq-tabhead"><h2>Help</h2></div>' +
      '<h3>Quick start</h3><ol>' +
      '<li><i>1</i><div><b>Pick the stage</b><span>Use the stage switcher in the top bar (PDS, FDS, PTU / IFC, ASC …).</span></div></li>' +
      '<li><i>2</i><div><b>Open the IFC</b><span>Drop the file anywhere or use Open IFC. The checks run on this computer.</span></div></li>' +
      '<li><i>3</i><div><b>Map anything unknown</b><span>Mapping lists object groups that still need an owner category and sub-category.</span></div></li>' +
      '<li><i>4</i><div><b>Review and export</b><span>Results shows what fails and why. Export gives the Excel report and the MVC.</span></div></li>' +
      '</ol>' +
      '<h3>What the terms mean</h3><dl>' +
      '<dt>Mapping</dt><dd>Links each IFC object group to its owner category and sub-category.</dd>' +
      '<dt>Schema</dt><dd>Lists the attributes each owner requires and the values they accept.</dd>' +
      '<dt>Returned works owner</dt><dd>Who takes the asset over: TMR, QR or SCC. Read from “Project - Returned Works Owner” and decides which owner rules apply.</dd>' +
      '<dt>N.A. owner</dt><dd>Returned Works Owner is NA / N.A. / N/A. TMR and QR owner rules are skipped; the DSCRLP project attributes are still required.</dd>' +
      '<dt>Progressive stages</dt><dd>Anything required at an earlier stage is still required later.</dd>' +
      '<dt>T.B.C placeholder</dt><dd>Accepted only at stages where the LoIN allows a placeholder.</dd>' +
      '<dt>Data-only mode</dt><dd>Skips the 3D view so very large models still open. Checks and exports work as normal.</dd>' +
      '</dl>' +
      '<h3>About</h3><div class="slq-about">' +
      '<span>Tool version</span><b>' + VERSION + '</b>' +
      '<span>Rule set</span><b>' + (b ? esc(b.name) : 'Custom rules') + '</b>' +
      '<span>Revision</span><b>' + (b ? esc(b.rev) : '—') + '</b>' +
      '<span>Rules</span><b>' + (sc ? (sc.rules || []).length : 0) + '</b>' +
      '</div>' +
      '<label class="check"><input type="checkbox" id="slqAdmin"' + (body.classList.contains('slq-admin') ? ' checked' : '') + '> Maintainer mode (show tools to change the rule set)</label>';
    $('#slqAdmin').onchange = function (e) { setAdmin(e.target.checked); renderRuleCard(); };
  }

  /* ---------- Keep the new pieces in sync with the engine ---------- */
  function tick() {
    try {
      var s = state();
      body.classList.toggle('slq-nomodel', !(s && s.model));
      var mi = $('#modelInfo'); if (mi && mi.title !== mi.textContent) mi.title = mi.textContent;
      renderStages(); renderChip(); renderRuleCard(); renderSections(); renderVerdict(); renderSteps();
    } catch (e) { /* never break the app */ }
  }
  var sel = $('#stageSel');
  if (sel) {
    sel.addEventListener('change', function () { setTimeout(tick, 0); });
    new MutationObserver(function () { setTimeout(tick, 0); }).observe(sel, { childList: true });
  }
  tick();
  setInterval(tick, 700);
  // New layout is in place: show the page (see boot.js).
  requestAnimationFrame(function () { if (window.__slqReveal) window.__slqReveal(); });
})();
