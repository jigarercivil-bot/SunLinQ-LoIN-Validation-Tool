/* SunLinQ LoIN v2.36 — select objects in the model and allocate their owner category by right-click.
 * Select:   Ctrl/Shift-click objects in the structure tree or in 3D (adds to the selection);
 *           right-click a tree branch, a class or a storey to select everything under it.
 * Allocate: right-click -> "Allocate category…". The owner is read from each object's Returned Works Owner
 *           in the IFC; only that owner's categories are offered and objects without it are skipped.
 * Engine side: window.slqSelectionInfo / slqSelAllocate / slqSelClear (grouping.js). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var sel = new Set();
  var st = function () { return window.__irc && window.__irc.state; };
  var V = function () { return window.__irc && window.__irc.viewer; };
  var toast = function (m) { if (window.$s) window.$s(m); };
  var OWNER = { TMR: 'TMR', QRL: 'QR / QRL', SCC: 'SCC', NA: 'N.A. (project rules only)', OTHER: 'unrecognised owner value', '': 'with no owner' };

  function show() {
    var ids = Array.from(sel);
    if (window.slqHighlight) window.slqHighlight(ids);
    $('#slqSelBar') && ($('#slqSelBar').hidden = !ids.length);
    if ($('#slqSelBar')) $('#slqSelBar span').textContent = ids.length.toLocaleString() + ' object' + (ids.length === 1 ? '' : 's') + ' selected · right-click to allocate';
  }
  function setSel(ids, add) {
    if (!add) { sel.clear(); if (treeKeys) treeKeys.clear(); }
    (ids || []).forEach(function (i) { sel.add(i); });
    show();
  }
  function toggle(ids) {
    var all = (ids || []).every(function (i) { return sel.has(i); });
    (ids || []).forEach(function (i) { all ? sel.delete(i) : sel.add(i); });
    show();
  }
  function clearSel() { sel.clear(); if ($('#slqSelBar')) $('#slqSelBar').hidden = true; }
  window.slqSelection = { ids: function () { return Array.from(sel); }, set: setSel, clear: clearSel };

  /* ---- selection bar (top of the 3D view) ---- */
  function bar() {
    if ($('#slqSelBar')) return;
    var host = $('#viewer') || ($('#colorMode') && $('#colorMode').closest('div'));
    var b = document.createElement('div');
    b.id = 'slqSelBar'; b.className = 'slq-selbar'; b.hidden = true;
    b.innerHTML = '<span></span><button class="btn sm" data-a="alloc">Allocate category…</button><button class="btn sm" data-a="clear">Clear selection</button>';
    b.addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a;
      if (a === 'alloc') openDialog(Array.from(sel));
      if (a === 'clear') { clearSel(); if (V()) V().select([]); }
    });
    document.body.appendChild(b);
  }

  /* ---- context menu ---- */
  var menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function openMenu(x, y, ids, title) {
    closeMenu();
    if (!ids.length) return;
    var info = window.slqSelectionInfo ? window.slqSelectionInfo(ids) : { count: ids.length, allocated: 0 };
    menu = document.createElement('div');
    menu.className = 'slq-ctx';
    menu.innerHTML = '<div class="slq-ctx-h">' + esc(title || (ids.length.toLocaleString() + ' object' + (ids.length === 1 ? '' : 's'))) + '</div>' +
      '<button data-a="alloc">Allocate category…</button>' +
      (info.allocated ? '<button data-a="unalloc">Clear allocation (' + info.allocated.toLocaleString() + ')</button>' : '') +
      '<button data-a="iso">Isolate</button><button data-a="clear">Clear selection</button>';
    document.body.appendChild(menu);
    var w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.min(x, innerWidth - w - 8) + 'px';
    menu.style.top = Math.min(y, innerHeight - h - 8) + 'px';
    menu.addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a;
      if (!a) return;
      closeMenu();
      if (a === 'alloc') openDialog(ids);
      if (a === 'unalloc') { var n = window.slqSelClear(ids); toast(n.toLocaleString() + ' object' + (n === 1 ? '' : 's') + ' back to their group mapping'); afterChange(); }
      if (a === 'iso' && V()) { V().setVisible(ids); V().zoomTo(ids); }
      if (a === 'clear') { clearSel(); if (V()) V().select([]); }
    });
  }
  document.addEventListener('pointerdown', function (e) { if (menu && !menu.contains(e.target)) closeMenu(); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeMenu(); closeDialog(); } });

  /* ---- dialog ---- */
  var dlg = null;
  function closeDialog() { if (dlg) { dlg.remove(); dlg = null; } }
  function comps(owner) {
    var s = st() && st().schema;
    return ((s && s.components) || []).filter(function (c) { return String(c.kind || '').toUpperCase() === owner; });
  }
  function openDialog(ids) {
    closeDialog();
    if (!ids.length) return;
    var info = window.slqSelectionInfo(ids);
    var owners = ['TMR', 'QRL', 'SCC'].filter(function (o) { return info.owners[o] && comps(o).length; });
    var skipped = Object.keys(info.owners).filter(function (o) { return owners.indexOf(o) < 0; })
      .map(function (o) { return info.owners[o].toLocaleString() + ' ' + (OWNER[o] || o); });
    var clsKeys = Object.keys(info.classes);
    dlg = document.createElement('div');
    dlg.className = 'slq-dlg-wrap';
    var html = '<div class="slq-dlg" role="dialog" aria-label="Allocate category">' +
      '<h3>Allocate category</h3>' +
      '<div class="muted sm">' + info.count.toLocaleString() + ' selected · ' + esc(clsKeys.slice(0, 3).join(', ')) + (clsKeys.length > 3 ? ' +' + (clsKeys.length - 3) + ' classes' : '') +
      (info.allocated ? ' · ' + info.allocated.toLocaleString() + ' already allocated (will be replaced)' : '') + '</div>';
    if (!owners.length) {
      html += '<div class="slq-dlg-warn">None of the selected objects has a TMR, QR or SCC Returned Works Owner in the IFC, so no owner category can be allocated. Set the owner in the model and load the IFC again.' +
        (skipped.length ? '<br>Selected: ' + esc(skipped.join(' · ')) + '.' : '') + '</div>' +
        '<div class="slq-dlg-btns"><button class="btn sm" data-a="cancel">Close</button></div></div>';
      dlg.innerHTML = html;
    } else {
      html += '<label>Owner (from the IFC)<select class="inp sm" id="slqAOwner">' + owners.map(function (o) {
        return '<option value="' + o + '">' + esc(OWNER[o]) + ' · ' + info.owners[o].toLocaleString() + ' object' + (info.owners[o] === 1 ? '' : 's') + '</option>';
      }).join('') + '</select></label>' +
        '<label>Category<select class="inp sm" id="slqACat"></select></label>' +
        '<label>Sub-category<select class="inp sm" id="slqASub"></select></label>' +
        '<label class="check" id="slqAAllWrap"><input type="checkbox" id="slqAAll"> Show all categories (ignore IFC class)</label>' +
        '<div class="muted sm" id="slqANote"></div>' +
        (skipped.length ? '<div class="slq-dlg-warn">Will be skipped (Returned Works Owner in the IFC is not TMR, QR or SCC): ' + esc(skipped.join(' · ')) + '.</div>' : '') +
        '<div class="slq-dlg-btns"><button class="btn sm" data-a="cancel">Cancel</button><button class="btn sm primary" data-a="ok">Allocate</button></div></div>';
      dlg.innerHTML = html;
    }
    document.body.appendChild(dlg);
    var oSel = $('#slqAOwner', dlg), cSel = $('#slqACat', dlg), sSel = $('#slqASub', dlg), all = $('#slqAAll', dlg);
    var opt = function (a, ph) { return '<option value="">' + esc(ph) + '</option>' + a.map(function (v) { return '<option>' + esc(v) + '</option>'; }).join(''); };
    var cc = null;
    function fill() {
      var owner = oSel.value, list = comps(owner);
      cc = (clsKeys.length === 1 && window.slqClassCandidates) ? window.slqClassCandidates({ owner: owner, cls: clsKeys[0], ids: ids.filter(function (i) { var e = st().model.elements.get(i); return e && e.cls === clsKeys[0]; }) }) : null;
      var useCC = !!(cc && !cc.generic && cc.byKey && cc.byKey.size) && !all.checked;
      $('#slqAAllWrap', dlg).style.display = (cc && !cc.generic && cc.byKey && cc.byKey.size) ? '' : 'none';
      var cats = useCC ? cc.categories : Array.from(new Set(list.map(function (c) { return String(c.category || c.group || ''); }))).filter(Boolean).sort();
      cSel.innerHTML = opt(cats, 'Select category…');
      sSel.innerHTML = opt([], 'Select sub-category…');
      $('#slqANote', dlg).textContent = useCC ? 'Options limited to the ' + cc.byKey.size + ' that fit ' + cc.label + '.' : '';
      cSel.onchange = function () {
        var c = cSel.value;
        var subs = useCC ? cc.subsFor(c) : Array.from(new Set(list.filter(function (x) { return String(x.category || x.group || '') === c; }).map(function (x) { return String(x.subCategory || x.name || ''); }))).filter(Boolean).sort();
        sSel.innerHTML = opt(subs, 'Select sub-category…');
      };
    }
    if (oSel) { oSel.onchange = fill; all.onchange = fill; fill(); }
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) return closeDialog();
      var a = e.target.dataset && e.target.dataset.a;
      if (a === 'cancel') closeDialog();
      if (a === 'ok') {
        if (!cSel.value || !sSel.value) { $('#slqANote', dlg).textContent = 'Select a category and a sub-category first.'; $('#slqANote', dlg).classList.add('slq-err'); return; }
        var r = window.slqSelAllocate(ids, oSel.value, cSel.value, sSel.value);
        if (!r.ok) { $('#slqANote', dlg).textContent = r.reason; $('#slqANote', dlg).classList.add('slq-err'); return; }
        closeDialog();
        toast(r.allocated.toLocaleString() + ' object' + (r.allocated === 1 ? '' : 's') + ' allocated to ' + oSel.value + ' › ' + cSel.value + ' › ' + sSel.value + (r.skipped ? ' · ' + r.skipped.toLocaleString() + ' skipped (other owner or none)' : ''));
        afterChange();
      }
    });
  }
  function afterChange() {
    var q = $('#mapvSearch');
    if (q) q.dispatchEvent(new Event('input'));          // redraw the Mapping list if it is open
    var cm = $('#colorMode');
    if (cm && (cm.value === 'mapgroup' || cm.value === 'mapstatus')) cm.dispatchEvent(new Event('change'));
    show();
  }

  /* ---- hooks: 3D, tree, classes, storeys ---- */
  function hook3D() {
    var v = V();
    if (!v || v.__slqAllocHooked) return !!v;
    v.__slqAllocHooked = true;
    var orig = v.onPick;
    v.onPick = function (id, ev) {
      if (ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) { if (id != null) toggle([id]); return; }
      if (sel.size) clearSel();
      return orig && orig.apply(this, arguments);
    };
    var dom = v.renderer && v.renderer.domElement, down = null;
    if (dom) {
      dom.addEventListener('pointerdown', function (e) { if (e.button === 2) down = [e.clientX, e.clientY]; });
      dom.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;   // right-drag = pan
        var ids = sel.size ? Array.from(sel) : [];
        if (!ids.length) { var id = v.pickAt(e.clientX, e.clientY); if (id != null) { setSel([id]); ids = [id]; } }
        openMenu(e.clientX, e.clientY, ids);
      });
    }
    return true;
  }
  /* Structure tree multi-select: Ctrl/Cmd-click adds or removes a node (object, type group, storey...),
     Shift-click selects every visible node between the last clicked node and this one. Selected nodes stay
     highlighted when the tree is redrawn, and objects selected in 3D are highlighted in the tree too. */
  var treeKeys = new Set(), lastKey = null;
  function idsOfKey(k) { try { return window.slqTreeIds ? window.slqTreeIds(k) : []; } catch (e) { return []; } }
  function rebuildFromKeys(extra) {
    sel.clear();
    treeKeys.forEach(function (k) { idsOfKey(k).forEach(function (i) { sel.add(i); }); });
    (extra || []).forEach(function (i) { sel.add(i); });
    show(); markTree();
  }
  function markTree() {
    var tree = $('#tree'); if (!tree) return;
    tree.classList.toggle('slq-multi', sel.size > 0 || treeKeys.size > 0);
    tree.querySelectorAll('.tn[data-k]').forEach(function (n) {
      var k = n.dataset.k, on = treeKeys.has(k) || (k.indexOf('e:') === 0 && sel.has(+k.slice(2)));
      n.classList.toggle('slq-tsel', on);
    });
  }
  var _clear = clearSel;
  clearSel = function () { treeKeys.clear(); lastKey = null; _clear(); markTree(); };
  window.slqSelection.clear = clearSel;
  var _show = show;
  show = function () { _show(); markTree(); };
  function hookTree() {
    var tree = $('#tree');
    if (!tree || tree.__slqAlloc) return;
    tree.__slqAlloc = true;
    new MutationObserver(function () { if (treeKeys.size || sel.size) markTree(); }).observe(tree, { childList: true });
    tree.addEventListener('click', function (e) {
      var n = e.target.closest('.tn');
      if (!n || !n.dataset.k || n.dataset.k.indexOf('x:') === 0) return;
      if (e.target.classList.contains('tc')) return;                     // expand / collapse arrow
      var k = n.dataset.k, multi = e.ctrlKey || e.metaKey, range = e.shiftKey;
      if (!multi && !range) { if (sel.size || treeKeys.size) clearSel(); lastKey = k; return; }
      e.preventDefault(); e.stopPropagation();
      var loose = Array.from(sel).filter(function (i) { return !treeKeys.has('e:' + i); });   // e.g. picked in 3D
      if (range && lastKey) {
        var nodes = Array.from(tree.querySelectorAll('.tn[data-k]')).map(function (x) { return x.dataset.k; }).filter(function (x) { return x.indexOf('x:') !== 0; });
        var a = nodes.indexOf(lastKey), b = nodes.indexOf(k);
        if (a < 0) a = b;
        nodes.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(function (x) { treeKeys.add(x); });
      } else {
        if (treeKeys.has(k)) treeKeys.delete(k); else treeKeys.add(k);
        if (k.indexOf('e:') === 0 && !treeKeys.has(k)) loose = loose.filter(function (i) { return i !== +k.slice(2); });
        lastKey = k;
      }
      rebuildFromKeys(loose);
      if (sel.size && V() && V().zoomTo) V().zoomTo(Array.from(sel));      // tree selection brings the objects into view
    }, true);
    tree.addEventListener('contextmenu', function (e) {
      var n = e.target.closest('.tn'); if (!n || !n.dataset.k || n.dataset.k.indexOf('x:') === 0) return;
      e.preventDefault();
      var k = n.dataset.k, ids = idsOfKey(k);
      if (!ids.every(function (i) { return sel.has(i); })) { treeKeys.clear(); treeKeys.add(k); lastKey = k; rebuildFromKeys([]); if (V() && V().zoomTo) V().zoomTo(ids); }
      openMenu(e.clientX, e.clientY, Array.from(sel), treeKeys.size === 1 && treeKeys.has(k) ? (n.querySelector('.tl') || n).textContent + ' · ' + ids.length.toLocaleString() + ' object' + (ids.length === 1 ? '' : 's') : null);
    });
  }
  function hookLists() {
    [['#classList', 'cls'], ['#storeyList', 'st']].forEach(function (x) {
      var box = $(x[0]);
      if (!box || box.__slqAlloc) return;
      box.__slqAlloc = true;
      box.addEventListener('contextmenu', function (e) {
        var lab = e.target.closest('.vis-item'), inp = lab && lab.querySelector('input'); if (!inp || !st() || !st().model) return;
        e.preventDefault();
        var key = x[1] === 'cls' ? inp.dataset.cls : inp.dataset.st, ids = [];
        st().model.elements.forEach(function (el) {
          if (x[1] === 'cls' ? el.cls === key : String(el.props.get('Attr.Storey') || '(none)') === key) ids.push(el.id);
        });
        setSel(ids);
        openMenu(e.clientX, e.clientY, ids, key + ' · ' + ids.length.toLocaleString() + ' objects');
      });
    });
  }
  /* ---- Reset mapping (Mapping tab) ---- */
  var undo = null;
  function hookReset() {
    var exp = $('#mapvShowAllObjects') || $('#mapvIsolateUnmapped');
    // "Export unmapped CSV" is hidden by ui.css (16 Nov); the element stays because the Mapping tab code binds to it.
    if (!exp || $('#slqResetMap')) return;
    var b = document.createElement('button');
    b.className = 'btn sm'; b.id = 'slqResetMap'; b.type = 'button'; b.textContent = 'Reset mapping…';
    b.onclick = openReset;
    var u = document.createElement('button');
    u.className = 'btn sm'; u.id = 'slqUndoReset'; u.type = 'button'; u.textContent = 'Undo reset'; u.hidden = !undo;
    u.onclick = function () {
      if (!undo) return;
      window.slqRestoreMapping(undo.backup);
      var a = $('#mapvAuto'); if (a && a.checked !== undo.auto) { a.checked = undo.auto; a.dispatchEvent(new Event('change')); }
      undo = null; u.hidden = true; toast('Mapping restored'); afterChange();
    };
    exp.parentElement.appendChild(b); exp.parentElement.appendChild(u);
  }
  function openReset() {
    closeDialog();
    var s = st(); if (!s || !s.model || !window.slqBuildMappingRows) return toast('Open an IFC model first');
    var rows = window.slqBuildMappingRows(s.schema), groups = 0, objs = 0, alloc = 0;
    rows.forEach(function (r) { if (r.mapped && !r.notApplicable) { if (r.basis === 'selection') alloc += r.count; else { groups++; objs += r.count; } } });
    var total = ((s.schema.mapping && s.schema.mapping.rows) || []).length, auto = $('#mapvAuto');
    dlg = document.createElement('div');
    dlg.className = 'slq-dlg-wrap';
    dlg.innerHTML = '<div class="slq-dlg" role="dialog" aria-label="Reset mapping"><h3>Reset mapping</h3>' +
      '<div>Removes mappings so the objects can be mapped again.</div>' +
      '<div class="muted sm">This model: ' + groups.toLocaleString() + ' mapped group' + (groups === 1 ? '' : 's') + ' (' + objs.toLocaleString() + ' objects) and ' + alloc.toLocaleString() + ' object' + (alloc === 1 ? '' : 's') + ' allocated by selection. N.A. objects stay N.A. (that comes from the IFC).</div>' +
      '<label class="check"><input type="radio" name="slqRScope" value="model" checked> This model only (mappings used by its objects)</label>' +
      '<label class="check"><input type="radio" name="slqRScope" value="all"> Everything in the rule set (' + total.toLocaleString() + ' mapping row' + (total === 1 ? '' : 's') + ', all models)</label>' +
      '<label class="check"><input type="checkbox" id="slqRAuto"' + (auto && auto.checked ? ' checked' : ' disabled') + '> Turn off auto-apply, so rules and IFC-class matches do not map them again straight away</label>' +
      '<div class="muted sm">Saved mapping rules are kept. You can undo the reset until the page is reloaded.</div>' +
      '<div class="slq-dlg-btns"><button class="btn sm" data-a="cancel">Cancel</button><button class="btn sm slq-danger" data-a="ok">Reset mapping</button></div></div>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) return closeDialog();
      var a = e.target.dataset && e.target.dataset.a;
      if (a === 'cancel') closeDialog();
      if (a !== 'ok') return;
      var scope = ($('input[name="slqRScope"]:checked', dlg) || {}).value || 'model', offAuto = $('#slqRAuto', dlg).checked;
      var wasAuto = !!(auto && auto.checked);
      if (offAuto && auto && auto.checked) { auto.checked = false; auto.dispatchEvent(new Event('change')); }
      var r = window.slqResetMapping(scope);
      undo = { backup: r.backup, auto: wasAuto };
      closeDialog();
      var u = $('#slqUndoReset'); if (u) u.hidden = false;
      toast('Mapping reset: ' + r.removedRows.toLocaleString() + ' mapping row' + (r.removedRows === 1 ? '' : 's') + ' and ' + r.removedAlloc.toLocaleString() + ' allocation' + (r.removedAlloc === 1 ? '' : 's') + ' removed · Undo reset is in the Mapping tab');
      afterChange();
    });
  }

  /* ---- Results: hide n/a groups and rules (no applicable objects in this model) ---- */
  var showNA = false;
  function hookNA() {
    [['#groupBars', 'groups'], ['#ruleBars', 'rules']].forEach(function (x) {
      var box = $(x[0]);
      if (!box) return;
      box.classList.toggle('slq-hide-na', !showNA);
      var h4 = box.previousElementSibling;
      if (!h4 || h4.tagName !== 'H4') return;
      var t = h4.querySelector('.slq-natoggle');
      if (!t) {
        t = document.createElement('button');
        t.type = 'button'; t.className = 'slq-natoggle';
        t.onclick = function (e) { e.stopPropagation(); showNA = !showNA; hookNA(); };
        h4.appendChild(t);
      }
      var n = box.querySelectorAll('.bar.slq-na').length;
      t.hidden = !n;
      t.textContent = showNA ? 'Hide n/a' : 'Show n/a (' + n + ')';
      t.title = 'n/a = active at this stage, but no object in this model needs it (e.g. owner rules with no mapped objects)';
      if (!box.__slqNA) { box.__slqNA = true; new MutationObserver(function () { hookNA(); }).observe(box, { childList: true }); }
    });
  }

  function boot() { bar(); hookTree(); hookLists(); hookReset(); hookNA(); if (!hook3D()) setTimeout(boot, 300); }
  boot();
  setInterval(function () { hookTree(); hookLists(); hook3D(); hookReset(); hookNA(); }, 2000);   // panels are re-rendered on model load
})();
