/* SunLinQ LoIN v2.36 — 3D strings (curves) in the 3D viewer.
 *
 * web-ifc only returns triangle meshes, so objects whose geometry is a curve (12d / Civil 3D strings,
 * setout lines, survey strings ...) were loaded and validated but never drawn. While the IFC is still open,
 * window.slqLoadCurves() reads the curve geometry of every element that produced no mesh and adds it to the
 * viewer as line segments that take part in colouring, selection, picking, isolate / show all, fit / zoom and
 * the section box. Validation, exports and the MVC are not touched.
 *
 * Supported curve items: IfcPolyline, IfcIndexedPolyCurve (with or without segments), IfcCompositeCurve(+Segment),
 * IfcGeometricCurveSet / IfcGeometricSet, IfcTrimmedCurve over a polyline, IfcMappedItem. Arcs in indexed
 * poly curves are drawn through their three points (no densification).
 */
(function () {
  'use strict';
  var STRING_RGB = [0.16, 0.24, 0.33];          // default string colour (slate) when not coloured by validation
  var SELECT_RGB = [0.08, 0.78, 0.7];           // same teal as the viewer's selection

  function val(v) { return v && typeof v === 'object' && 'value' in v ? v.value : v; }
  function ref(v) { v = val(v); return typeof v === 'number' ? v : null; }

  /* 4x4 column-major helpers (same layout as three.js / web-ifc) */
  function mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function apply(m, p) {
    var x = p[0], y = p[1], z = p[2] || 0;
    return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
  }
  var IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  function reader(api, mid) {
    var cache = new Map();
    function line(id) {
      if (id == null) return null;
      if (cache.has(id)) return cache.get(id);
      var l = null;
      try { l = api.GetLine(mid, id, false); } catch (e) { l = null; }
      if (l) l.__name = String(api.GetNameFromTypeCode(l.type) || '').toUpperCase();
      cache.set(id, l);
      return l;
    }
    return line;
  }

  /* Collect polylines (arrays of [x,y,z] in the item's local coordinates) from a representation item. */
  function curvesOf(line, itemId, depth, out, warn) {
    if (depth > 12) return;
    var it = line(itemId);
    if (!it) return;
    var n = it.__name;
    if (n === 'IFCPOLYLINE') {
      var pts = (it.Points || []).map(function (h) { var p = line(ref(h)); return p ? (p.Coordinates || []).map(val) : null; }).filter(Boolean);
      if (pts.length > 1) out.push(pts);
    } else if (n === 'IFCINDEXEDPOLYCURVE') {
      var list = line(ref(it.Points));
      var coords = list ? (list.CoordList || []).map(function (c) { return (c || []).map(val); }) : [];
      if (!it.Segments || !it.Segments.length) {
        if (coords.length > 1) out.push(coords);
      } else {
        var run = [];
        it.Segments.forEach(function (seg) {
          var idx = (val(seg) || seg.value || []).map(val);
          if (!Array.isArray(idx)) idx = [];
          idx.forEach(function (i, k) { var p = coords[i - 1]; if (p && !(k === 0 && run.length)) run.push(p); });
        });
        if (run.length > 1) out.push(run);
      }
    } else if (n === 'IFCGEOMETRICCURVESET' || n === 'IFCGEOMETRICSET') {
      (it.Elements || []).forEach(function (h) { curvesOf(line, ref(h), depth + 1, out, warn); });
    } else if (n === 'IFCCOMPOSITECURVE' || n === 'IFCCOMPOSITECURVEONSURFACE') {
      (it.Segments || []).forEach(function (h) { var s = line(ref(h)); if (s) curvesOf(line, ref(s.ParentCurve), depth + 1, out, warn); });
    } else if (n === 'IFCCOMPOSITECURVESEGMENT') {
      curvesOf(line, ref(it.ParentCurve), depth + 1, out, warn);
    } else if (n === 'IFCTRIMMEDCURVE') {
      curvesOf(line, ref(it.BasisCurve), depth + 1, out, warn);
    } else if (n === 'IFCMAPPEDITEM') {
      var src = line(ref(it.MappingSource));
      var rep = src && line(ref(src.MappedRepresentation));
      (rep && rep.Items || []).forEach(function (h) { curvesOf(line, ref(h), depth + 1, out, warn); });
    } else if (n.indexOf('CURVE') >= 0 || n.indexOf('LINE') >= 0) {
      warn[n] = (warn[n] || 0) + 1;
    }
  }

  function lengthScale(api, mid, line) {
    try {
      var ids = api.GetLineIDsWithType(mid, api.GetTypeCodeFromName('IFCPROJECT'));
      var proj = ids && ids.size && ids.size() ? line(ids.get(0)) : null;
      var ua = proj && line(ref(proj.UnitsInContext));
      var units = ua ? (ua.Units || []).map(function (h) { return line(ref(h)); }) : [];
      for (var i = 0; i < units.length; i++) {
        var u = units[i];
        if (!u || val(u.UnitType) !== 'LENGTHUNIT') continue;
        if (u.__name === 'IFCSIUNIT') {
          var p = val(u.Prefix);
          return p === 'MILLI' ? 0.001 : p === 'CENTI' ? 0.01 : p === 'DECI' ? 0.1 : p === 'KILO' ? 1000 : 1;
        }
        if (u.__name === 'IFCCONVERSIONBASEDUNIT') {
          var f = line(ref(u.ConversionFactor));
          var vc = f && val(f.ValueComponent);
          if (typeof vc === 'number' && vc > 0) return vc;
        }
      }
    } catch (e) { /* default below */ }
    return 1;
  }

  /* Placement -> world matrix (metres, after the viewer's coordinate shift), from web-ifc when possible. */
  function placementMatrix(api, mid, placementId, scale, coord) {
    if (placementId == null) return [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1];
    var w = null;
    try { w = api.GetWorldTransformMatrix(mid, placementId); } catch (e) { w = null; }
    if (w && w.length === 16) {
      // web-ifc returns the placement in metres (IFC Z-up); local point coordinates still need the unit scale.
      return mul(w, [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1]);
    }
    return null;
  }

  window.slqLoadCurves = function (api, mid, model, meshIds) {
    var V = window.__irc && window.__irc.viewer;
    if (!V || !model || !model.elements) return;
    var three = kit(V);
    if (!three) return;
    var line = reader(api, mid);
    var hasMesh = new Set(meshIds || []);
    var scale = lengthScale(api, mid, line);
    var coord = IDENT;
    try { var cm = api.GetCoordinationMatrix(mid); if (cm && cm.length === 16) coord = Array.from(cm); } catch (e) {}
    // Same chain as the meshes: IFC Z-up -> viewer Y-up, then web-ifc's coordinate shift (a translation in
    // Y-up space), then the viewer's re-centring offset recorded in loadFromIfc.
    var off = V.slqOffset || null;
    function toViewer(p) {
      var q = apply(coord, [p[0], p[2], -p[1]]);
      return off ? [q[0] - off[0], q[1] - off[1], q[2] - off[2]] : q;
    }
    var pos = [], vids = [], warn = {}, count = 0, skipped = 0;
    model.elements.forEach(function (el) {
      if (hasMesh.has(el.id)) return;
      var prod = line(el.id);
      var pds = prod && line(ref(prod.Representation));
      if (!pds || !pds.Representations) return;
      var curves = [];
      pds.Representations.forEach(function (h) {
        var rep = line(ref(h));
        (rep && rep.Items || []).forEach(function (ih) { curvesOf(line, ref(ih), 0, curves, warn); });
      });
      if (!curves.length) return;
      var M = placementMatrix(api, mid, ref(prod.ObjectPlacement), scale, coord);
      if (!M) { skipped++; return; }
      curves.forEach(function (pts) {
        for (var i = 1; i < pts.length; i++) {
          var a = toViewer(apply(M, pts[i - 1])), b = toViewer(apply(M, pts[i]));
          pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
          vids.push(el.id, el.id);
        }
      });
      count++;
    });
    if (!pos.length) return;
    if (!off) {
      // Strings only (no meshes to align to): centre them like the viewer centres meshes, for float precision.
      var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (var q = 0; q < pos.length; q += 3) for (var k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[q + k]); mx[k] = Math.max(mx[k], pos[q + k]); }
      var c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
      for (q = 0; q < pos.length; q += 3) { pos[q] -= c[0]; pos[q + 1] -= c[1]; pos[q + 2] -= c[2]; }
      V.slqOffset = c;
    }
    addLines(V, three, new Float32Array(pos), Uint32Array.from(vids));
    V.slqStrings = { count: count, skipped: skipped, unsupported: warn };
    if (window.console) console.info('SunLinQ: drew 3D strings for ' + count + ' objects' + (skipped ? ', ' + skipped + ' skipped (placement)' : ''), warn);
  };

  /* three.js constructors taken from objects the viewer already owns (the bundle does not export them). */
  function kit(V) {
    try {
      var seg = V._secEdges;
      var LineSegments = seg.constructor, LineMaterial = seg.material.constructor;
      var Geometry = Object.getPrototypeOf(seg.geometry.constructor);
      if (!Geometry || !Geometry.prototype || !Geometry.prototype.setAttribute) Geometry = seg.geometry.constructor;
      var Attr = seg.geometry.attributes.position.constructor;          // Float32BufferAttribute
      var Index = Object.getPrototypeOf(Attr);                             // BufferAttribute (keeps Uint32 for indices)
      if (!Index || !Index.prototype || !Index.prototype.setUsage) Index = Attr;
      var Box3 = V.section.box.constructor, Vec3 = V.controls.target.constructor;
      return { LineSegments: LineSegments, LineMaterial: LineMaterial, Geometry: Geometry, Attr: Attr, Index: Index, Box3: Box3, Vec3: Vec3 };
    } catch (e) { return null; }
  }

  function addLines(V, T, pos, ids) {
    var n = ids.length;
    var geo = new T.Geometry();
    geo.setAttribute('position', new T.Attr(pos, 3));
    var col = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) { col[i * 3] = STRING_RGB[0]; col[i * 3 + 1] = STRING_RGB[1]; col[i * 3 + 2] = STRING_RGB[2]; }
    geo.setAttribute('color', new T.Attr(col, 3));
    var full = new Uint32Array(n);
    for (i = 0; i < n; i++) full[i] = i;
    geo.setIndex(new T.Index(full.slice(), 1));
    var mat = new T.LineMaterial({ vertexColors: true, clippingPlanes: V.clipPlanes });
    var obj = new T.LineSegments(geo, mat);
    obj.renderOrder = 2;
    V.group.add(obj);
    var ranges = new Map();
    for (i = 0; i < n; i++) { var r = ranges.get(ids[i]); if (!r) ranges.set(ids[i], r = []); r.push(i); }
    V.slqLine = { obj: obj, ids: ids, full: full, original: col.slice(), ranges: ranges, T: T };
    V.colorize(V._colorFn);
    if (V.visible) V.setVisible(Array.from(V.visible));
    // The loader fitted the camera before strings existed; refit once loading has finished and the 3D area has its size.
    setTimeout(function () { if (V.slqLine) { V.resize && V.resize(); V.fitAll(); } }, 60);
    V.dirty = true;
  }

  /* ---- hook the viewer once ---- */
  function patch(V) {
    if (!V || V.__slqPatched) return;
    V.__slqPatched = true;
    var o = {
      fitBox: V.fitBox,
      clear: V.clear, colorize: V.colorize, setVisible: V.setVisible, boxOf: V.boxOf, fitAll: V.fitAll,
      pickAt: V.pickAt, resetSection: V.resetSection, applyClip: V._applyClip
    };
    // Fit also when the 3D area is taller than wide (the original fit only allowed for the vertical field of view).
    V.fitBox = function (box, margin) {
      var m = margin == null ? 1.05 : margin, aspect = this.camera.aspect || 1;
      return o.fitBox.call(this, box, aspect < 1 ? m / aspect : m);
    };
    V.clear = function () {
      var L = this.slqLine;
      if (L) { this.group.remove(L.obj); L.obj.geometry.dispose(); L.obj.material.dispose(); this.slqLine = null; this.slqStrings = null; }
      return o.clear.apply(this, arguments);
    };
    V.colorize = function (fn) {
      var r = o.colorize.apply(this, arguments);
      var L = this.slqLine;
      if (L) {
        var attr = L.obj.geometry.attributes.color, a = attr.array, last = -1, c = null;
        for (var i = 0; i < L.ids.length; i++) {
          var id = L.ids[i];
          if (id !== last) { last = id; c = this.selected.has(id) ? SELECT_RGB : fn ? fn(id) : null; }
          var k = i * 3;
          if (c) { a[k] = c[0]; a[k + 1] = c[1]; a[k + 2] = c[2]; } else { a[k] = L.original[k]; a[k + 1] = L.original[k + 1]; a[k + 2] = L.original[k + 2]; }
        }
        attr.needsUpdate = true;
        this.dirty = true;
      }
      return r;
    };
    V.setVisible = function (ids) {
      var r = o.setVisible.apply(this, arguments);
      var L = this.slqLine;
      if (L) {
        var idx;
        if (!this.visible) idx = L.full.slice();
        else {
          var list = [];
          this.visible.forEach(function (id) { (L.ranges.get(id) || []).forEach(function (v) { list.push(v); }); });
          idx = Uint32Array.from(list);
        }
        L.obj.geometry.setIndex(new L.T.Index(idx, 1));
        this.dirty = true;
      }
      return r;
    };
    V.boxOf = function (ids) {
      var b = o.boxOf.apply(this, arguments);
      var L = this.slqLine;
      if (L && ids) {
        var p = L.obj.geometry.attributes.position, v = new L.T.Vec3();
        for (var id of ids) (L.ranges.get(id) || []).forEach(function (i) { v.fromBufferAttribute(p, i); b.expandByPoint(v); });
      }
      return b;
    };
    V.fitAll = function () {
      var L = this.slqLine;
      if (!L) return o.fitAll.apply(this, arguments);
      var b = new L.T.Box3();
      this.parts.forEach(function (pt) { if (pt) { pt.mesh.geometry.computeBoundingBox(); b.union(pt.mesh.geometry.boundingBox); } });
      L.obj.geometry.computeBoundingBox(); b.union(L.obj.geometry.boundingBox);
      if (this.visible) { var vb = this.boxOf(Array.from(this.visible)); if (!vb.isEmpty()) return this.fitBox(vb); }
      return this.fitBox(b);
    };
    V.resetSection = function (ids) {
      var L = this.slqLine;
      if (L && !(ids && ids.length) && !this.parts.length) {
        L.obj.geometry.computeBoundingBox();
        return o.resetSection.call(this, Array.from(L.ranges.keys()));
      }
      return o.resetSection.apply(this, arguments);
    };
    V.pickAt = function (x, y) {
      var L = this.slqLine;
      if (L) {
        var rect = this.renderer.domElement.getBoundingClientRect();
        var ndc = { x: (x - rect.left) / rect.width * 2 - 1, y: -((y - rect.top) / rect.height) * 2 + 1 };
        this.raycaster.setFromCamera(ndc, this.camera);
        var dist = this.camera.position.distanceTo(this.controls.target);
        var prev = this.raycaster.params.Line ? this.raycaster.params.Line.threshold : 1;
        this.raycaster.params.Line = { threshold: Math.max(dist * 0.004, 0.01) };
        var hits = this.raycaster.intersectObject(L.obj, false);
        this.raycaster.params.Line.threshold = prev;
        // Parallel strings are common: take the segment closest to the cursor ray, not the first along it.
        var ray = this.raycaster.ray, sec = this.section, self = this, best = null, bestMiss = Infinity;
        hits.forEach(function (h) {
          if (h.index == null || L.ids[h.index] == null) return;
          if (sec.on && !self._inBox(h.point)) return;
          var miss = ray.distanceSqToPoint(h.point) / Math.max(h.distance * h.distance, 1e-9);
          if (miss < bestMiss) { bestMiss = miss; best = h; }
        });
        if (best) {
          var meshId = o.pickAt.call(this, x, y);
          return meshId != null && meshId !== L.ids[best.index] && this._slqMeshCloser(x, y, best.distance) ? meshId : L.ids[best.index];
        }
      }
      return o.pickAt.apply(this, arguments);
    };
    V._slqMeshCloser = function (x, y, lineDist) {
      var hits = this.raycaster.intersectObjects(this.parts.filter(Boolean).map(function (p) { return p.mesh; }), false);
      return hits.length && hits[0].distance < lineDist * 0.98;
    };
  }

  function waitForViewer() {
    var V = window.__irc && window.__irc.viewer;
    if (V) patch(V); else setTimeout(waitForViewer, 50);
  }
  waitForViewer();
})();
