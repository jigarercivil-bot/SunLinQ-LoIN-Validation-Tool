/* SunLinQ LoIN v2.36 — built-in DSCRLP rules bootstrap.
 * Runs in <head>, before the validation engine reads its saved rule set.
 * - First run, or a new built-in revision: the built-in rules become the active rule set.
 * - Same revision already active: kept as-is, so mapping work and the last stage survive a reload.
 * - Maintainer mode with a custom rule set: left alone until "Reset to built-in rules".
 */
/* Hide the page until the v2.36 layout has been applied, so the old layout never flashes.
 * Safety nets: reveal on any script error, and after 5 seconds regardless. */
(function () {
  var root = document.documentElement;
  var reveal = function () { root.classList.remove('slq-preload'); };
  root.classList.add('slq-preload');
  window.__slqReveal = reveal;
  window.addEventListener('error', reveal);
  setTimeout(reveal, 5000);
  try { if (localStorage.getItem('irc.theme') === 'dark') root.setAttribute('data-theme', 'dark'); } catch (e) {}
})();

(function () {
  var el = document.getElementById('slq-builtin-rules');
  if (!el) return;
  var builtin;
  try { builtin = JSON.parse(el.textContent); } catch (e) { return; }
  builtin.builtin = { id: el.getAttribute('data-id'), name: el.getAttribute('data-name'), rev: el.getAttribute('data-rev') };
  window.__SLQ_BUILTIN__ = builtin;

  var get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var set = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  var admin = get('slq.admin') === '1' || /[?&]admin=1\b/.test(location.search);

  var current = null;
  try { current = JSON.parse(get('irc.schema') || 'null'); } catch (e) { current = null; }
  if (current && current.builtin && current.builtin.id === builtin.builtin.id) return;
  if (current && !current.builtin && admin) return;

  var next = JSON.parse(JSON.stringify(builtin));
  if (current) {
    // Carry existing mapping work across, but only rows whose components still exist
    // in the built-in rules with the same category and sub-category.
    if (current.mapping && Array.isArray(current.mapping.rows)) {
      var comps = {};
      (next.components || []).forEach(function (c) { comps[c.id] = c; });
      var rows = current.mapping.rows.filter(function (r) {
        var ids = r.components || [];
        return ids.length && ids.every(function (id) {
          var c = comps[id];
          if (!c) return false;
          if (r.uiCategory && String(c.category || c.group || '') !== String(r.uiCategory)) return false;
          if (r.uiSubCategory && String(c.subCategory || c.name || '') !== String(r.uiSubCategory)) return false;
          return true;
        });
      });
      if (rows.length) next.mapping = Object.assign({}, current.mapping, { rows: rows });
    }
    if (current.builtin && current.settings && current.settings.stage) next.settings.stage = current.settings.stage;
  }
  set('irc.schema', JSON.stringify(next));
})();

/* IFC class -> TMR / QR category candidates (rules/ifc-class-map.json, built from the reviewed Excel).
 * window.slqClassCandidates(row) returns the categories / sub-categories that fit a Mapping row's
 * IFC class and predefined type for its owner, or null when the map has nothing to say. */
(function () {
  var el = document.getElementById('slq-class-map');
  if (!el) return;
  var map;
  try { map = JSON.parse(el.textContent); } catch (e) { return; }
  window.__SLQ_CLASSMAP__ = map;
  var idx = {};
  (map.rows || []).forEach(function (r) { var k = r.k + '|' + r.c; (idx[k] = idx[k] || []).push(r); });
  function predefinedType(row) {
    try {
      var st = window.__irc && window.__irc.state;
      var e = st && st.model && row.ids && st.model.elements.get(row.ids[0]);
      var v = e && e.props.get('Attr.PredefinedType');
      if (v && typeof v === 'object' && 'value' in v) v = v.value;
      v = String(v || '').toUpperCase();
      return /^(USERDEFINED|NOTDEFINED)$/.test(v) ? '' : v;
    } catch (x) { return ''; }
  }
  window.slqClassCandidates = function (row) {
    if (!row || !row.cls) return null;
    var owner = String(row.owner || '').toUpperCase();
    if (owner !== 'TMR' && owner !== 'QRL') return null;
    if (((map.generic || {})[owner] || []).indexOf(row.cls) >= 0) return { generic: true, label: row.cls };
    var all = idx[owner + '|' + row.cls] || [];
    if (!all.length) return null;
    var pdt = predefinedType(row);
    var exact = all.filter(function (r) { return pdt && r.t === pdt; });
    // An exact predefined-type match decides the list. Class-only entries for the same sub-category can
    // raise it to primary; class-only entries for other sub-categories are kept as "possible" only.
    var byKey = new Map();
    var put = function (r, m) { var k = r.cat + '||' + r.sub; if (!byKey.has(k) || m === 'P') byKey.set(k, m); };
    if (exact.length) {
      exact.forEach(function (r) { put(r, r.m); });
      all.filter(function (r) { return !r.t; }).forEach(function (r) { put(r, byKey.has(r.cat + '||' + r.sub) ? r.m : 'A'); });
    } else {
      all.forEach(function (r) { put(r, r.m); });
    }
    var keys = Array.from(byKey.keys());
    return {
      generic: false,
      label: row.cls + (pdt ? ' (' + pdt + ')' : ''),
      byKey: byKey,
      primaryCount: keys.filter(function (k) { return byKey.get(k) === 'P'; }).length,
      categories: Array.from(new Set(keys.map(function (k) { return k.split('||')[0]; }))).sort(),
      subsFor: function (cat) { return keys.filter(function (k) { return k.split('||')[0] === cat; }).map(function (k) { return k.split('||')[1]; }).sort(); }
    };
  };
})();

/* Owner from parent object. Some authoring tools export one designed object as several IFC elements
   (e.g. a Revit family with a nested shared family: pile cap + pile). The parts are linked to their parent
   with IfcRelAggregates. When a part has no Returned Works Owner, the owner of the nearest parent that has
   one is used to pick the owner rules. The part's own "Project - Returned Works Owner" check still fails,
   so the missing value stays visible in the results. */
(function () {
  'use strict';
  window.slqParentElement = function (el) {
    var P = window.__slqParentOf, M = window.__irc && window.__irc.state && window.__irc.state.model;
    if (!P || !M || !el) return null;
    var id = el.id, n = 0;
    while (n++ < 12) {
      id = P.get(id);
      if (id == null) return null;
      var pe = M.elements.get(id);
      if (pe) return pe;
    }
    return null;
  };
  window.slqParentOwnerHit = function (el, get) {
    var pe = el, n = 0;
    while (n++ < 8) {
      pe = window.slqParentElement(pe);
      if (!pe) return null;
      var h = get(pe.props);
      if (h && h.value != null && String(h.value).trim() !== '') return { key: h.key, value: h.value, inheritedFrom: pe.id };
    }
    return null;
  };
})();
