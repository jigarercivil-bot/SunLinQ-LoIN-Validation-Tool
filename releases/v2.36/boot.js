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

/* Objects with no 3D representation (empty containers such as a Revit beam system exported as
   IfcElementAssembly, groups, objects with only data) cannot be seen in the model, so they get no LoIN
   requirements: they are left out of validation, Mapping, counts and reports, like excluded IFC classes.
   They still appear in the model tree, and parts can still take their owner from them. */
(function () {
  'use strict';
  var forMap = null, any = false;
  window.slqNoGeo = function (el) {
    if (!el || el.geo !== undefined) return false;
    var M = window.__irc && window.__irc.state && window.__irc.state.model, E = M && M.elements;
    if (!E) return false;
    if (forMap !== E) {                       // safety: only when this model records geometry at all
      forMap = E; any = false;
      for (var v of E.values()) { if (v.geo !== undefined) { any = true; break; } }
    }
    return any;
  };
})();

/* Colour by mapping group. Every mapping group (one row in the Mapping tab) gets its own colour, so the
   3D view shows how the model has been grouped. Colours are given in order of group size with the golden
   angle, so neighbouring groups in the list never share a hue. Objects not in Mapping (excluded classes,
   no 3D geometry) are drawn light grey. The same colour is shown as a dot on each Mapping row. */
(function () {
  'use strict';
  var cache = null;
  function rgb(h, s, l) {
    var a = s * Math.min(l, 1 - l), f = function (n) { var k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
  }
  function build() {
    var st = window.__irc && window.__irc.state;
    if (!st || !st.model || !st.schema || !window.slqBuildMappingRows) return null;
    // Groups depend only on the loaded model and the owner settings, so they are worked out once per model
    // (not once per Mapping row: that made every redraw of the Mapping list rebuild all groups again).
    var set = st.schema.settings || {};
    var sig = st.model.elements.size + '|' + JSON.stringify([set.ownerProp || '', set.ownerMap || null, set.anyPset || false]);
    if (cache && cache.model === st.model.elements && cache.sig === sig) return cache;
    var rows = window.slqBuildMappingRows(st.schema);
    var order = rows.slice().sort(function (a, b) { return b.count - a.count || (a.key < b.key ? -1 : 1); });
    var byKey = new Map(), byId = new Map(), list = [];
    order.forEach(function (r, i) {
      var c = rgb((i * 0.381966) % 1, 0.62, i % 3 === 1 ? 0.42 : i % 3 === 2 ? 0.66 : 0.54);
      var item = { key: r.key, label: r.label || r.basisValue || r.cls, cls: r.cls, count: r.count, color: c };
      byKey.set(r.key, item); list.push(item);
      (r.ids || []).forEach(function (id) { byId.set(id, c); });
    });
    cache = { model: st.model.elements, sig: sig, byKey: byKey, byId: byId, list: list };
    return cache;
  }
  window.slqMapGroupColours = build;
  window.slqMapGroupCss = function (c) { return 'rgb(' + c.map(function (v) { return Math.round(v * 255); }).join(',') + ')'; };
  window.slqMapGroupDot = function (key) {
    var m = build(), it = m && m.byKey.get(key);
    return it ? '<i class="dot slq-mapdot" title="Colour of this group in 3D (Colour: by mapping group)" style="background:' + window.slqMapGroupCss(it.color) + '"></i>' : '';
  };
})();
