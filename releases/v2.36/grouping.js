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
  if (SLQ_GEO.test(tn)) tn = ""; if (SLQ_GEO.test(ot)) ot = ""; if (SLQ_GEO.test(nm)) nm = "";
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
function slqKindOf(el) {
  let prof = slqGroupProfile(), hit = prof.kinds.get(el.id);
  if (hit) return hit;
  let k = slqPrimaryKind(el, prof.profile);
  if (!k) { let f = slqFinder(prof), v = f ? slqPV(el, f) : ""; k = v ? { basis: "prop", prop: f, value: v, found: true } : { basis: "class", value: "" }; }
  prof.kinds.set(el.id, k);
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
