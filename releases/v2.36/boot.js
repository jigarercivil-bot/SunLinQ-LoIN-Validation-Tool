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
