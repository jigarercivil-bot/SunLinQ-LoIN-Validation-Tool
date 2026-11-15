/* SunLinQ LoIN — mapping groups (inserted into the engine scope before slqBuildMappingRows).
   A mapping group is: owner + IFC class + the object's "kind". How the kind is found depends on the
   program that wrote the IFC, detected from the file header and its property sets:
     Revit    family (from "Family:Type") -> type name -> name
     12d      pit type / pipe type + size / Vertex-Segment Type / model name -> link name
              (3D strings: name with the trailing number or chainage removed)
     Civil 3D Corridor Shape Information.CodeName
     other    type name -> ObjectType -> name
   Geometry words that some programs write as a type or name ("Segment", "3D Tri-mesh", "Super", "Tin",
   "3D Solid"...) never count as a kind. When nothing above has a value, a property is picked automatically
   for those objects: one that most of them have, with few different values, that is not a number, ID,
   chainage, date or size (e.g. Civil 3D rock bolts -> CPB_BOQ_TUN_SUPPORT.Bolt Type).
   Saved Mapping rows are matched to objects by this same group key during validation. */
var slqGK = { prof: null };
var SLQ_GEO = /^(segment|3d ?tri-?mesh|tri-?mesh|trimesh|super|tin|mesh|brep|3d ?solid|solid|region|subentity|surface|face|body|polyline|string|line|element|object|proxy|default|notdefined|userdefined|none|n\/a)$/i;
var SLQ_IDLIKE = v => /^#?\d{3,}$/.test(v) || /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(v) || (/^[0-9A-Za-z_$]{22}$/.test(v) && /\d/.test(v) && /[A-Z]/.test(v) && /[a-z]/.test(v));
function slqPV(el, k) {
  let v = el.props.get(k);
  if (v && typeof v === "object" && "value" in v) v = v.value;
  return v == null || lS(v) ? "" : String(v).trim();
}
function slqPropShort(k) { return String(k).split(/[./]/).pop().trim(); }
function slqGroupProfile() {
  let M = tt.model.elements;
  if (slqGK.prof && slqGK.prof.els === M) return slqGK.prof;
  let src = String(tt.ifcSourceText || "").toUpperCase(), has12 = false, hasC3 = false, colon = 0, typed = 0, n = 0;
  for (let el of M.values()) {
    if (n++ > 5000) break;
    if (!has12 || !hasC3) for (let k of el.props.keys()) {
      if (!has12 && /^12d Model\./.test(k)) has12 = true;
      else if (!hasC3 && /^Corridor (Shape|Model) Information\./.test(k)) hasC3 = true;
    }
    let t = slqPV(el, "Attr.TypeName");
    if (t) { typed++; if (t.indexOf(":") > 0) colon++; }
  }
  let p = /12D/.test(src) || has12 ? "12d"
        : /CIVIL\s*3D|CIVIL3D/.test(src) || hasC3 ? "civil3d"
        : /REVIT/.test(src) || (typed && colon / typed > 0.3) ? "revit" : "other";
  slqGK.prof = { els: M, profile: p, kinds: new Map(), finder: undefined };
  return slqGK.prof;
}
const SLQ_PROFILE_LABEL = { revit: "Revit", "12d": "12d", civil3d: "Civil 3D", other: "Other" };
function slqPrimaryKind(el, P) {
  let otRaw = slqPV(el, "Attr.ObjectType"), tn = slqPV(el, "Attr.TypeName"), ot = otRaw, nm = slqPV(el, "Attr.Name");
  if (SLQ_GEO.test(tn) || SLQ_IDLIKE(tn)) tn = ""; if (SLQ_GEO.test(ot) || SLQ_IDLIKE(ot)) ot = ""; if (SLQ_GEO.test(nm) || SLQ_IDLIKE(nm)) nm = "";
  if (P === "12d") {
    for (let k of ["12d Model.Pit/pit type", "12d Model.Vertex-Segment Type"]) { let v = slqPV(el, k); if (v) return { basis: "prop", prop: k, value: v }; }
    let pp = slqPV(el, "12d Model.Pipe/pipe type");
    if (pp) { let sz = slqPV(el, "12d Model.Pipe/pipe size"); return { basis: "prop", prop: "12d Model.Pipe/pipe type", value: pp + (sz ? " · " + sz : "") }; }
    let mn = slqPV(el, "12d Model.model name"); if (mn) return { basis: "prop", prop: "12d Model.model name", value: mn };
    if (nm) {
      if (/^super$/i.test(otRaw) || /curve/i.test(slqPV(el, "Geometry.Representation"))) {
        let c = nm.replace(/[\s_\-]*\d+(?:\.\d+)?$/, "").trim();
        if (c) return { basis: "string", value: c };
      }
      return { basis: "name", value: nm };
    }
  } else if (P === "civil3d") {
    let cn = slqPV(el, "Corridor Shape Information.CodeName"); if (cn) return { basis: "prop", prop: "Corridor Shape Information.CodeName", value: cn };
  }
  let t = tn || ot;
  if (t) { let fm = t.match(/^([^:]+?)\s*:\s*(\S.*)$/); return fm ? { basis: "family", value: fm[1].trim(), fullType: t } : { basis: "type", value: t }; }
  if (nm && P !== "12d") return { basis: "name", value: nm };
  return null;
}
const SLQ_FINDER_SKIP = /(guid|globalid|handle|(^|\s)id$|station|chainage|^ch(\s|$)|length|volume|area|elevation|level|^[xyz]$|coordinate|date|time|number|index|count|offset|width|height|depth|diameter|radius|angle|duration|ratio|quantity|\((m|kg|mm|m2|m3)\)|description|comment)/i;
function slqFinder(prof) {
  if (prof.finder !== undefined) return prof.finder;
  let stats = new Map(), n = 0, ex = tt.excl;
  for (let el of prof.els.values()) {
    if ((ex && ex(el.cls)) || (window.slqNoGeo && window.slqNoGeo(el))) continue;
    if (slqPrimaryKind(el, prof.profile)) continue;
    if (++n > 30000) break;
    for (let [k, raw] of el.props) {
      if (/^(Attr|Item|Geometry)\./.test(k) || SLQ_FINDER_SKIP.test(slqPropShort(k))) continue;
      let v = slqPV(el, k);
      if (!v || /^-?\d+(\.\d+)?\s*(m|mm)?$/i.test(v)) continue;
      let s = stats.get(k); if (!s) stats.set(k, s = { c: 0, vals: new Set() });
      s.c++; if (s.vals.size <= 50) s.vals.add(v);
    }
  }
  let best = "", bestScore = -1;
  for (let [k, s] of stats) {
    if (!n || s.c / n < 0.6 || s.vals.size > 50) continue;
    let score = (s.c / n) * 100 + (/(type|kind|class|categ|code)/i.test(slqPropShort(k)) ? 5 : 0) - s.vals.size * 0.05;
    if (score > bestScore) { bestScore = score; best = k; }
  }
  prof.finder = best;
  return best;
}
/* Last resort: objects with identical geometry (same number of triangles, surface area and volume) are the
   same kind, e.g. tunnel rings exported with only their element ID as name and type. Read from the 3D model
   the viewer has built; not available in data-only mode. */
function slqShapeSig(el) {
  let V = window.__irc && window.__irc.viewer, rs = V && V.ranges ? V.ranges.get(el.id) : null;
  if (!V || !V.ranges) return null;
  if (!rs || !rs.length) return "";
  let n = 0, A = 0, Vol = 0;
  for (let r of rs) {
    let p = r.part, pos = p && p.mesh && p.mesh.geometry.attributes.position, F = p && p.fullIndex;
    if (!pos || !F) continue;
    let P = pos.array;
    for (let k = r.start; k + 2 < r.start + r.count; k += 3) {
      let i = F[k] * 3, j = F[k + 1] * 3, l = F[k + 2] * 3;
      let ax = P[i], ay = P[i + 1], az = P[i + 2], bx = P[j], by = P[j + 1], bz = P[j + 2], cx = P[l], cy = P[l + 1], cz = P[l + 2];
      let ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      A += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
      Vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      n++;
    }
  }
  return n ? { tri: n, area: Math.round(A * 10) / 10, vol: Math.round(Math.abs(Vol) * 100) / 100 } : "";
}
function slqKindOf(el) {
  let prof = slqGroupProfile(), hit = prof.kinds.get(el.id);
  if (hit) return hit;
  let k = slqPrimaryKind(el, prof.profile), cache = true;
  if (!k) { let f = slqFinder(prof), v = f ? slqPV(el, f) : ""; if (v) k = { basis: "prop", prop: f, value: v, found: true }; }
  if (!k) {
    let sg = slqShapeSig(el);
    if (sg === null) cache = false;                     // 3D not built yet: decide again later
    k = sg ? { basis: "shape", value: "volume " + sg.vol + " · area " + sg.area + " · " + sg.tri + " triangles" } : { basis: "class", value: "" };
  }
  if (cache) prof.kinds.set(el.id, k);
  return k;
}
function slqGroupKey(owner, cls, kd) {
  return [owner, cls, kd.basis === "prop" ? "prop:" + kd.prop : kd.basis, kd.value || ""].map(v => encodeURIComponent(String(v || ""))).join("|");
}
function slqGroupKeysOf(el, settings) {
  let own = slqMapOwnerOf(el, settings), kd = slqKindOf(el), k = slqGroupKey(own.owner, el.cls, kd), out = [k, k + "|parent"];
  if (kd.basis === "family" && kd.fullType) { let t = slqGroupKey(own.owner, el.cls, { basis: "type", value: kd.fullType }); out.push(t, t + "|parent"); }
  return out;
}
window.slqGroupProfileName = function () { try { return tt.model ? SLQ_PROFILE_LABEL[slqGroupProfile().profile] : ""; } catch (e) { return ""; } };
