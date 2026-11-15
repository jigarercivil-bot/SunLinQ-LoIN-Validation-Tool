#!/usr/bin/env python3
"""Build SunLinQ LoIN v2.36 on top of the v2.35 HTML.

Run after scripts/apply_release.py (which produces v2.35 in index.html):

    python3 scripts/apply_release.py && python3 scripts/build_release.py

Adds, without touching the validation engine:
  * the built-in DSCRLP rule set (rules/dscrlp-ruleset.json + rules/ruleset.meta.json)
  * the v2.36 layout layer (releases/v2.36/ui.css, boot.js, ui.js)

Optional arguments: [input_html] [output_html] (both default to index.html).
"""
import hashlib
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
src = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "index.html"
dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src
rel = root / "releases" / "v2.36"

html = src.read_text(encoding="utf-8")
if "btnRestoreDscrlp" not in html or "mvcSignatureApply" not in html:
    raise SystemExit("Input is not the v2.35 build: run scripts/apply_release.py first")
if "slq-builtin-rules" in html:
    raise SystemExit("Input already contains the v2.36 layer")

rules = json.loads((root / "rules" / "dscrlp-ruleset.json").read_text(encoding="utf-8"))
meta = json.loads((root / "rules" / "ruleset.meta.json").read_text(encoding="utf-8"))
if not isinstance(rules.get("rules"), list) or not rules["rules"]:
    raise SystemExit("rules/dscrlp-ruleset.json has no rules")
rules.pop("builtin", None)
rules_json = json.dumps(rules, ensure_ascii=False, separators=(",", ":"))
rules_id = hashlib.sha256(rules_json.encode("utf-8")).hexdigest()[:12]
rules_json = rules_json.replace("<", "\\u003c")  # safe inside <script>


def attr(s):
    return (str(s).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;"))


class_map = json.loads((root / "rules" / "ifc-class-map.json").read_text(encoding="utf-8"))
if not class_map.get("rows"):
    raise SystemExit("rules/ifc-class-map.json has no rows")
class_map_json = json.dumps(class_map, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
css = (rel / "ui.css").read_text(encoding="utf-8")
boot = (rel / "boot.js").read_text(encoding="utf-8")
ui = (rel / "ui.js").read_text(encoding="utf-8")
# Build stamp (commit time in Sydney time + short commit), shown in the header so users can see which version is loaded.
import subprocess
from datetime import datetime
from zoneinfo import ZoneInfo
try:
    _sha, _when = subprocess.run(["git", "log", "-1", "--format=%h %cI"], cwd=root, capture_output=True, text=True, check=True).stdout.split()
    _t = datetime.fromisoformat(_when).astimezone(ZoneInfo("Australia/Sydney"))
    build_stamp = f"{_t.day} {_t:%b %H:%M} · {_sha}"
except Exception:
    build_stamp = "local build"
_vold = "var VERSION = '2.36';"
if ui.count(_vold) != 1:
    raise SystemExit("ui.js VERSION line not found")
ui = ui.replace(_vold, _vold + " var BUILD = " + json.dumps(build_stamp) + ";")
strings_js = (rel / "strings.js").read_text(encoding="utf-8")
allocate_js = (rel / "allocate.js").read_text(encoding="utf-8")
for name, text in (("ui.css", css), ("boot.js", boot), ("ui.js", ui), ("strings.js", strings_js), ("allocate.js", allocate_js)):
    if "</script" in text.lower() or "</style" in text.lower():
        raise SystemExit(f"{name} must not contain closing script/style tags")

# 1. Title
html, n = re.subn(r"<title>[^<]*</title>", "<title>SunLinQ LoIN Validation Tool V2.36</title>", html, count=1)
if n != 1:
    raise SystemExit("Could not find the page title")

# 2. Head: styles, built-in rules and the bootstrap (must run before the engine reads its rule set)
head_end = html.find("</head>")
if head_end < 0:
    raise SystemExit("No </head> found")
head_add = (
    f'<style id="slq-v236-css">\n{css}\n</style>\n'
    f'<script type="application/json" id="slq-builtin-rules" data-id="{rules_id}" '
    f'data-name="{attr(meta.get("name", "DSCRLP LoIN rules"))}" data-rev="{attr(meta.get("revision", ""))}">'
    f"{rules_json}</script>\n"
    f'<script type="application/json" id="slq-class-map">{class_map_json}</script>\n'
    f'<script id="slq-v236-boot">\n{boot}\n</script>\n'
)
html = html[:head_end] + head_add + html[head_end:]

# 3. Rule-set loader (dme, as patched in v2.35):
#    - an active built-in rule set always wins over the v2.35 per-browser "DSCRLP default";
#    - with no stored rules (first run, or browser storage blocked) start from the built-in rules,
#      not the example set.
old_head = ('function dme(){let active=slqReadStoredSchema("irc.schema"),'
            'saved=slqReadStoredSchema("irc.dscrlp.defaultSchema");')
old_tail = 'return active||E$()}'
if html.count(old_head) != 1:
    raise SystemExit("Expected exactly one v2.35 rule-set loader (dme) in the engine")
start = html.index(old_head)
tail = html.index(old_tail, start)
if tail - start > 600:
    raise SystemExit("Rule-set loader is not in the expected v2.35 shape")
html = (html[:start] + old_head + "if(active&&active.builtin)return active;"
        + html[start + len(old_head):tail]
        + "return active||(window.__SLQ_BUILTIN__?JSON.parse(JSON.stringify(window.__SLQ_BUILTIN__)):E$())}"
        + html[tail + len(old_tail):])

# 4. MVC sign-off: one name only. The typed signature uses the reviewer Name on the left of the
#    Model Reviewer table; the separate name box above the signature is removed (kept as a hidden field
#    so the existing signing script keeps working).
mvc_edits = [
    ('\'<input type="text" id="mvcSignatureName" aria-label="Typed electronic signature" placeholder="Type your full name" autocomplete="name" />\'+',
     '\'<input type="hidden" id="mvcSignatureName" />\'+'),
    ('"  reviewer.addEventListener(\'input\',function(){if(!signatureName.value.trim())signatureName.value=reviewer.value;});\\n"+',
     '"  reviewer.addEventListener(\'input\',function(){signatureName.value=reviewer.value;});\\n"+'),
    ('"    var name=signatureName.value.trim()||reviewer.value.trim();\\n"+',
     '"    var name=reviewer.value.trim();\\n"+'),
    ('"    if(!name){alert(\'Enter the full name of the reviewer to sign.\');signatureName.focus();return;}\\n"+',
     '"    if(!name){alert(\'Enter the reviewer full name in the Name column to sign.\');reviewer.focus();return;}\\n"+'),
]
for old, new in mvc_edits:
    if html.count(old) != 1:
        raise SystemExit("MVC sign-off code is not in the expected v2.35 shape: " + old[:60])
    html = html.replace(old, new, 1)

# 5. DSCRLP project-controlled values agreed on 12 Nov 2026 (exact-match edits; the build stops if the
#    engine text has moved): Project - Name = THE WAVE (RAIL) STAGE 2 GREENFIELD; Project - Suitability =
#    S2 or S4; Project - Package Number = 044-<package ID>, matching the IFC filename's package ID when it
#    has one. (Objects with Returned Works Owner N.A. / NA keep the DSCRLP project checks and skip the
#    TMR / QR owner rules: unchanged engine behaviour.)
rule_edits = [
    # b) project-controlled values
    ('"project - name":{type:"fixed",value:"The Wave (Rail) Stage 2 Greenfield Package",label:"The Wave (Rail) Stage 2 Greenfield Package"}',
     '"project - name":{type:"fixed",value:"THE WAVE (RAIL) STAGE 2 GREENFIELD",label:"THE WAVE (RAIL) STAGE 2 GREENFIELD"}', 1),
    ('"project - package number":{type:"package",label:"Package ID from IFC filename"}',
     '"project - package number":{type:"package",label:"044-XXXXX (package ID from IFC filename)"}', 1),
    ('"project - suitability":{type:"fixed",value:"S4",label:"S4"}',
     '"project - suitability":{type:"allowed",value:"S2\\nS4",label:"S2 or S4"}', 1),
    ('if(o.type==="fixed")i.check={type:"fixed",value:o.value,caseSensitive:!1};else i.check={type:o.type};',
     'if(o.type==="fixed")i.check={type:"fixed",value:o.value,caseSensitive:!1};else if(o.type==="allowed")i.check={type:"allowed",values:o.value,caseSensitive:!1};else i.check={type:o.type};', 1),
    ('case"package":{let d=slqPackageIdFromFileName(typeof tt!=="undefined"&&tt?tt.fileName:"");return d?i.toUpperCase()===d.toUpperCase()?null:`Package Number is "${i}" but the IFC filename resolves to Package ID ${d}`:"Package ID could not be determined from the IFC filename"}',
     'case"package":{let m=/^044-([A-Z0-9]+)$/i.exec(String(i).trim());if(!m)return`Package Number "${i}" must be 044-XXXXX (044- followed by the package ID)`;let d=slqPackageIdFromFileName(typeof tt!=="undefined"&&tt?tt.fileName:"");return d&&m[1].toUpperCase()!==d.toUpperCase()?`Package Number is "${i}" but the IFC filename resolves to Package ID ${d} (expected 044-${d})`:null}', 1),
    ('value="${Ti(p||"Package ID will be detected from IFC filename")}"', 'value="${Ti(p?"044-"+p:"044-XXXXX (package ID from IFC filename)")}"', 1),
]
for old, new, n in rule_edits:
    if html.count(old) != n:
        raise SystemExit(f"Rule edit anchor found {html.count(old)}x (expected {n}): {old[:70]}")
    html = html.replace(old, new)

# 6. Mapping tab uses the IFC class map (rules/ifc-class-map.json):
#    - suggestions only consider the TMR / QR categories that fit the object's IFC class (+ predefined type);
#    - one primary match for that class -> auto-mapped (when Auto-apply is on) and labelled "Mapped · IFC class",
#      unless the object's name clearly points to an asset the class does not allow (then: review);
#    - the Category / Sub-category lists are filtered the same way, with "Show all categories" to override;
#    - generic classes (IfcBuildingElementProxy, IfcBuiltElement) and classes with no entry behave as before.
map_edits = [
    ("if(!comps.length)return null;\n    const d=detect(row)",
     "if(!comps.length)return null;\n    const cc=(!arguments[1]&&window.slqClassCandidates)?window.slqClassCandidates(row):null,ccOn=!!(cc&&!cc.generic&&cc.byKey&&cc.byKey.size);let strongAlt=0;\n    const d=detect(row)"),
    # Name evidence must come from the object's own name/type, not from the IFC class fallback of detect().
    ("const d=detect(row),asset=norm(d.name)",
     "const d0=detect(row),d=(((cc&&!cc.generic&&cc.byKey&&cc.byKey.size)||arguments[1])&&d0.confidence<=72)?{name:'',confidence:0}:d0,asset=norm(d.name)"),
    ("let k=category+'||'+subCategory;if(uniq.has(k))continue;",
     "let k=category+'||'+subCategory;if(uniq.has(k))continue;let cm=ccOn?cc.byKey.get(k):null;if(ccOn&&!cm)continue;"),
    ("uniq.set(k,{owner:row.owner,category,subCategory,score:Math.min(100,score),reasons});",
     "if(cm==='A'&&score>=85)strongAlt=Math.max(strongAlt,score);if(cm==='P'){score=cc.primaryCount===1?Math.max(97,score):Math.min(96,80+Math.round(score*0.15));reasons.unshift('IFC class '+cc.label+(cc.primaryCount===1?' → only primary match':' → primary match'))}else if(cm==='A'){score=Math.min(95,60+Math.round(score*0.35));reasons.unshift('IFC class '+cc.label+' → possible match')}\n      uniq.set(k,{owner:row.owner,category,subCategory,score:Math.min(100,score),reasons});"),
    ("best.margin=best.score-(arr[1]?.score||0);best.auto=best.score>=92&&best.margin>=6;return best;",
     "best.margin=best.score-(arr[1]?.score||0);best.auto=best.score>=92&&best.margin>=6;best.top=arr.filter(x=>x.score>=best.score-5);if(ccOn&&best.auto&&strongAlt&&cc.byKey.get(best.category+'||'+best.subCategory)==='P'){best.auto=false;best.reasons.push('name matches another sub-category that IFC class '+cc.label+' can also represent — confirm which')}if(ccOn&&best.auto){const nb=taxonomySuggestion(row,true);if(nb&&nb.score>=90&&(nb.top||[nb]).every(x=>!cc.byKey.has(x.category+'||'+x.subCategory))){best.auto=false;best.reasons.push('name suggests '+nb.subCategory+', which IFC class '+cc.label+' does not normally represent — check the class')}}return best;"),
    ("if(row.map?.slqTaxonomyAuto)return{key:'mapped',label:'Mapped · taxonomy',cls:'auto'};",
     "if(row.map?.slqTaxonomyAuto)return{key:'mapped',label:/^IFC class/.test(row.map?.slqTaxonomyReason||'')?'Mapped · IFC class':'Mapped · taxonomy',cls:'auto'};"),
    ("let cats=categories(row.owner),curCat=row.category||rule?.category||tx?.category||'',curSub=row.subCategory||rule?.subCategory||tx?.subCategory||'';cat.innerHTML=options(cats,curCat,'Select category…');sub.innerHTML=options(curCat?subcats(row.owner,curCat):[],curSub,'Select sub-category…');cat.onchange=()=>{sub.innerHTML=options(subcats(row.owner,cat.value),'','Select sub-category…')};",
     "let cc=window.slqClassCandidates?window.slqClassCandidates(row):null,ccHas=!!(cc&&!cc.generic&&cc.byKey&&cc.byKey.size),useCC=ccHas&&!S.showAllCats,curCat=row.category||rule?.category||tx?.category||'',curSub=row.subCategory||rule?.subCategory||tx?.subCategory||'',withCur=(a,v)=>v&&!a.includes(v)?[v,...a]:a,subList=c=>useCC?cc.subsFor(c):subcats(row.owner,c);let cats=withCur(useCC?cc.categories:categories(row.owner),curCat);cat.innerHTML=options(cats,curCat,'Select category…');sub.innerHTML=options(curCat?withCur(subList(curCat),curSub):[],curSub,'Select sub-category…');cat.onchange=()=>{sub.innerHTML=options(subList(cat.value),'','Select sub-category…')};\n    let sa=$('#mapvShowAllCats');if(!sa){const lab=document.createElement('label');lab.className='check';lab.style.margin='4px 0';lab.innerHTML='<input type=\"checkbox\" id=\"mapvShowAllCats\"> Show all categories (ignore IFC class)';sub.parentElement.after(lab);sa=lab.querySelector('input')}sa.checked=!!S.showAllCats;sa.parentElement.style.display=ccHas?'':'none';sa.onchange=()=>{S.showAllCats=sa.checked;renderEditor(row)};"),
    ("    cat.disabled=!!row.notApplicable;sub.disabled=!!row.notApplicable;",
     "    if(useCC&&!row.mapped&&!row.notApplicable)note.textContent=note.textContent.replace(/\\.?$/,'.')+' Options limited to '+cc.byKey.size+' that fit '+cc.label+'.';\n    if(tx&&!row.mapped){const cf=(tx.reasons||[]).find(x=>/^name (suggests|matches)/.test(x));if(cf)note.textContent+=' ⚠ The '+cf+'.'}\n    cat.disabled=!!row.notApplicable;sub.disabled=!!row.notApplicable;"),
    # Closing the open row clears the highlight and greyed-out model.
    ("      S.selected=null;\n      render(null,false);",
     "      S.selected=null;try{window.nL&&window.nL(null)}catch(e){}\n      render(null,false);"),
    # Picking an object in 3D while the Mapping tab is open opens that object's mapping group (window.slqMapRevealObject).
    ("  function reviewMapping(key){",
     "  window.slqMapRevealObject=function(id){const rows=getRows(),row=rows.find(r=>(r.ids||[]).includes(id));if(!row)return null;const card=()=>$('#mapvList')?.querySelector(`[data-mapv-key=\\\"${CSS.escape(row.key)}\\\"]`);if(S.selected!==row.key||!card()){if(S.q||S.status){render(rows,false)}if(!card()&&(S.q||S.status)){S.q='';S.status='';const q=$('#mapvSearch'),st=$('#mapvStatus');if(q)q.value='';if(st)st.value=''}S.selected=row.key;render(rows,false);renderEditor(row)}requestAnimationFrame(()=>{const c=card();if(c){c.scrollIntoView({behavior:'smooth',block:'center'});c.classList.add('mapv-review-focus');setTimeout(()=>c.classList.remove('mapv-review-focus'),1400)}});return row};\n  function reviewMapping(key){"),
    # Clicking a mapping row highlights ALL of its objects (not just the first) and fits the view to them;
    # the properties panel still shows the first object.
    ("if(row?.ids?.length&&window.nL){try{window.nL(row.ids[0]);if(window.Ln?.zoomTo)window.Ln.zoomTo([row.ids[0]])}catch(e){}}",
     "if(row?.ids?.length&&window.nL){try{window.nL(row.ids[0]);if(window.slqHighlight)window.slqHighlight(row.ids);else if(window.Ln?.select)window.Ln.select(row.ids);if(window.Ln?.zoomTo)window.Ln.zoomTo(row.ids);const shown=window.Ln?.selected?.size||0;if(shown>row.ids.length)window.$s?.(row.ids.length===1?'Assembly with no geometry of its own · showing its '+(shown-1)+' parts':row.ids.length+' objects highlighted, including assembly parts');else if(row.ids.length>1)window.$s?.(row.ids.length+' objects highlighted · properties show the first')}catch(e){}}"),
]
for old, new in map_edits:
    if html.count(old) != 1:
        raise SystemExit(f"Mapping edit anchor found {html.count(old)}x (expected 1): {old[:70]}")
    html = html.replace(old, new)

# 6b. Owner from parent object (see releases/v2.36/boot.js): expose the IfcRelAggregates child -> parent map,
#     and when an element has no Returned Works Owner use its nearest parent's owner for owner rules and mapping.
#     The element's own "Project - Returned Works Owner" rule is unchanged, so it still reports the gap.
owner_edits = [
    ("let J=new Map;for(let Ze of d(i.IFCRELAGGREGATES)){let st=u(Ze);if(!st)continue;let wt=eL(st.RelatingObject);for(let gt of oS(st.RelatedObjects))J.set(gt,wt)}",
     "let J=new Map;for(let Ze of d(i.IFCRELAGGREGATES)){let st=u(Ze);if(!st)continue;let wt=eL(st.RelatingObject);for(let gt of oS(st.RelatedObjects))J.set(gt,wt)}window.__slqParentOf=J;"),
    ("let de=h(Ee.props);",
     "let de=h(Ee.props);if((!de||lS(de.value))&&window.slqParentOwnerHit)de=window.slqParentOwnerHit(Ee,h)||de;"),
    ('  if(!raw)return{owner:"",raw:"",source:""};',
     '  if(!raw&&window.slqParentElement){let pe=window.slqParentElement(el),dp=slqMapOwnerOf.__d||0;if(pe&&dp<8){let po;slqMapOwnerOf.__d=dp+1;try{po=slqMapOwnerOf(pe,settings)}finally{slqMapOwnerOf.__d=dp}if(po&&po.owner)return{...po,source:"Parent "+(pe.props.get("Attr.Name")||("#"+pe.id))+" · "+po.source,inherited:true,parentId:pe.id}}}\n  if(!raw)return{owner:"",raw:"",source:""};'),
    ('let key=[own.owner,el.cls,basis,basisValue].map(v=>encodeURIComponent(String(v||""))).join("|"),g=groups.get(key);',
     'let key=[own.owner,el.cls,basis,basisValue].map(v=>encodeURIComponent(String(v||""))).join("|")+(own.inherited?"|parent":""),g=groups.get(key);'),
    ("(row.ownerSource?' · IFC':'')", "(row.ownerSource?(/^Parent /.test(row.ownerSource)?' · from parent':' · IFC'):'')"),
    ("(r.ownerSource?' · IFC':'')", "(r.ownerSource?(/^Parent /.test(r.ownerSource)?' · from parent':' · IFC'):'')"),
]
for old, new in owner_edits:
    if html.count(old) != 1:
        raise SystemExit(f"Owner-from-parent anchor found {html.count(old)}x (expected 1): {old[:70]}")
    html = html.replace(old, new)

# 6c. Mapping groups Revit-style "Family:Type" type names by FAMILY (all sizes of one family -> one row),
#     still split by owner and IFC class. A family mapping is saved as type pattern "Family:*", so validation
#     applies it to every type of the family. Earlier per-type mappings carry over when all types of the family
#     agree, and are replaced when the family row is mapped. Type names without ":" (12d, Civil 3D...) are unchanged.
family_edits = [
    ('if(!basisValue){basis="class";basisValue=""}',
     'if(!basisValue){basis="class";basisValue=""}\n    let fullType=basis==="type"?basisValue:"",fm=fullType.match(/^([^:]+?)\\s*:\\s*(\\S.*)$/);if(fm){basis="family";basisValue=fm[1].trim()}'),
    ('type:basis==="type"?basisValue:"",name:basis==="name"?basisValue:"",basis,basisValue,count:0,ids:[]};groups.set(key,g)}',
     'type:basis==="type"||basis==="family"?basisValue:"",name:basis==="name"?basisValue:"",basis,basisValue,count:0,ids:[]};groups.set(key,g)}'),
    ('g.count++;if(g.ids.length<10000)g.ids.push(el.id);',
     'if(basis==="family"){g.types||(g.types=[]);g.types.includes(fullType)||g.types.push(fullType)}g.count++;if(g.ids.length<10000)g.ids.push(el.id);'),
    ('let map=isNA?null:(uiByKey.get(g.key)||null)',
     'let legacyKeys=(g.types||[]).map(t=>[g.owner,g.cls,"type",t].map(v=>encodeURIComponent(String(v||""))).join("|")+(/\\|parent$/.test(g.key)?"|parent":"")),legacyMap=(()=>{let ms=legacyKeys.map(k=>uiByKey.get(k));if(!ms.length||ms.some(m=>!m||!m.components?.length))return null;let c=JSON.stringify([...ms[0].components].sort());return ms.every(m=>JSON.stringify([...m.components].sort())===c)?ms[0]:null})();\n    let map=isNA?null:(uiByKey.get(g.key)||legacyMap||null)'),
    ('return{...g,map,category,subCategory,req,notApplicable:isNA',
     'return{...g,legacyKeys,map,category,subCategory,req,notApplicable:isNA'),
    ("type:row.basis==='type'?row.basisValue:''",
     "type:row.basis==='type'?row.basisValue:row.basis==='family'?row.basisValue+':*':''"),
    ('type:item.basis==="type"?item.basisValue:""',
     'type:item.basis==="type"?item.basisValue:item.basis==="family"?item.basisValue+":*":""'),
    ("const all=(schema.mapping?.rows||[]).filter(r=>!(r.uiMapping&&r.mapKey===row.key));",
     "const all=(schema.mapping?.rows||[]).filter(r=>!(r.uiMapping&&(r.mapKey===row.key||(row.legacyKeys||[]).includes(r.mapKey))));"),
    ("if(rule.basis&&rule.basis!==row.basis)return false;let v=norm(row.basisValue),p=norm(rule.pattern);return !!p && (rule.mode==='contains'?v.includes(p):v===p)}",
     "if(rule.basis&&rule.basis!==row.basis&&!(rule.basis==='type'&&row.basis==='family'))return false;let v=norm(row.basisValue),p=norm(rule.pattern),m=x=>rule.mode==='contains'?x.includes(p):x===p;return !!p && (m(v)||(row.types||[]).some(t=>m(norm(t))))}"),
    ("<span class=\"mapv-ifc\">${esc(r.cls)} · ${esc(r.basisValue||'class only')}</span>",
     "<span class=\"mapv-ifc\" title=\"${esc((r.types||[]).join('\\n'))}\">${esc(r.cls)} · ${esc(r.basisValue||'class only')}${r.types&&r.types.length>1?' · '+r.types.length+' types':''}</span>"),
]
for old, new in family_edits:
    if html.count(old) != 1:
        raise SystemExit(f"Family-grouping anchor found {html.count(old)}x (expected 1): {old[:70]}")
    html = html.replace(old, new)
old2 = 'all=(schema.mapping?.rows||[]).filter(r=>!(r.uiMapping&&r.mapKey===item.key));'
if html.count(old2) != 2:
    raise SystemExit("Schema-window mapping anchor count changed")
html = html.replace(old2, 'all=(schema.mapping?.rows||[]).filter(r=>!(r.uiMapping&&(r.mapKey===item.key||(item.legacyKeys||[]).includes(r.mapKey))));')

# 6d. "Isolate selection" isolates the whole highlighted group (e.g. a mapping row), not only the object
#     shown in Properties. Assemblies are isolated through their parts (releases/v2.36/strings.js).
iso_old = 'Bt("#btnIsolateSel").onclick=()=>{if(tt.selected==null)return $s("Select an element first");Ln.setVisible([tt.selected]),Ln.zoomTo([tt.selected])};'
if html.count(iso_old) != 1:
    raise SystemExit("Isolate selection anchor not found exactly once")
html = html.replace(iso_old, 'Bt("#btnIsolateSel").onclick=()=>{if(tt.selected==null&&!(Ln.selected&&Ln.selected.size))return $s("Select an element first");let s=Ln.selected&&Ln.selected.size>1?[...Ln.selected]:[tt.selected];Ln.setVisible(s),Ln.zoomTo(s)};')

# 6e. Objects with no 3D representation are not checked (not visible in the model -> no LoIN requirement).
#     Every "is this class excluded" test in the engine also skips them (releases/v2.36/boot.js slqNoGeo).
import re as _re
_excl = _re.compile(r'\b([A-Za-z_$][\w$]*)&&\1\(([A-Za-z_$][\w$]*)\.cls\)')
_found = _excl.findall(html)
if len(_found) != 9:
    raise SystemExit(f"Exclusion tests found {len(_found)}x (expected 9)")
html = _excl.sub(lambda m: f"({m.group(0)}||window.slqNoGeo&&window.slqNoGeo({m.group(2)}))", html)

# 6f. Nested property groups. 12d (and some other tools) export attributes as property groups inside
#     property groups (IfcComplexProperty), e.g. 12d Model > TMR > Asset Management > BIM Component Code.
#     The engine read only the first level, so deeper values were lost and reported as missing. Read every
#     level (up to 8 deep), named "Pset.Group/Sub group/Property". First-level names are unchanged.
nested_old = 'else if(ut.HasProperties!==void 0){for(let dt of oS(ut.HasProperties)){let nt=u(dt);nt&&Ms(nt.Name)&&wt.push([gt+"."+et+"/"+Ms(nt.Name),Ms(nt.NominalValue)])}continue}'
nested_new = ('else if(ut.HasProperties!==void 0){const slqWalk=(ids,pre,dep)=>{for(let dt of oS(ids)){let nt=u(dt);if(!nt)continue;let nn=Ms(nt.Name);if(!nn)continue;'
              'if(nt.HasProperties!==void 0){dep<8&&slqWalk(nt.HasProperties,pre+"/"+nn,dep+1);continue}'
              'let vv=nt.NominalValue!==void 0?Ms(nt.NominalValue):nt.EnumerationValues!==void 0?Ms(nt.EnumerationValues):nt.ListValues!==void 0?Ms(nt.ListValues):void 0;'
              'wt.push([pre+"/"+nn,vv])}};slqWalk(ut.HasProperties,gt+"."+et,1);continue}')
if html.count(nested_old) != 1:
    raise SystemExit("Complex-property reader anchor not found exactly once")
html = html.replace(nested_old, nested_new)

# 6g. A value that is blank or only says "Not Set" (12d's default for an unfilled attribute) counts as missing
#     in every check. The value is still shown as-is in Properties.
blank_old = 'lS=e=>e==null||typeof e=="string"&&e.trim()===""'
if html.count(blank_old) != 1:
    raise SystemExit("Blank-value test anchor not found exactly once")
html = html.replace(blank_old, 'lS=e=>e==null||typeof e=="string"&&(e.trim()===""||/^not\\s*set$/i.test(e.trim()))')

# 6h. Colour by mapping group (releases/v2.36/boot.js slqMapGroupColours): a new viewer colour mode, a legend
#     of the largest groups, and the group's colour as a dot on each Mapping row. Mapping rows now keep every
#     object id (no 10,000 cap), so very large groups are coloured, highlighted and isolated in full.
cap_old = 'if(g.ids.length<10000)g.ids.push(el.id);'
if html.count(cap_old) != 1:
    raise SystemExit("Mapping id cap anchor not found exactly once")
html = html.replace(cap_old, 'g.ids.push(el.id);')
opt_old = '<option value="class">Colour: by class</option>'
if html.count(opt_old) != 1:
    raise SystemExit("Colour mode option anchor not found exactly once")
html = html.replace(opt_old, opt_old + '\n        <option value="mapgroup">Colour: by mapping group</option>')
col_old = 'else if(e==="class"){let i=new Map;Ln.colorize'
col_new = ('else if(e==="mapgroup"){let m=window.slqMapGroupColours&&window.slqMapGroupColours();if(!m){Ln.colorize(null),t.innerHTML="";return}'
           'let g=[.82,.83,.85];Ln.colorize(o=>m.byId.get(o)||g);let L=m.list,n=12;'
           't.innerHTML=`<div class="slq-maplegend"><b>${L.length} mapping group${L.length===1?"":"s"}</b>`+L.slice(0,n).map(x=>`<span title="${Ti(x.cls+" · "+x.label)}"><i class="dot" style="background:${window.slqMapGroupCss(x.color)}"></i>${Ti(String(x.label).length>28?String(x.label).slice(0,27)+"\\u2026":x.label)} (${x.count.toLocaleString()})</span>`).join("")'
           '+(L.length>n?`<span class="muted">+${L.length-n} more · see Mapping</span>`:"")+"</div>"}'
           + col_old)
if html.count(col_old) != 1:
    raise SystemExit("Colour-by-class anchor not found exactly once")
html = html.replace(col_old, col_new)
dot_old = '<span class="mapv-ifc" title="'
if html.count(dot_old) != 1:
    raise SystemExit("Mapping row IFC label anchor not found exactly once")
html = html.replace(dot_old, "${window.slqMapGroupDot?window.slqMapGroupDot(r.key):''}" + dot_old)

# 6i. Mapping groups by source program (releases/v2.36/grouping.js, inserted into the engine scope):
#     owner + IFC class + "kind", where the kind is found per program (Revit / 12d / Civil 3D / other), geometry
#     words never count as a kind, and a grouping property is picked automatically when nothing else has a value.
#     A part that takes its owner from its parent no longer forms a separate group. Saved Mapping rows are matched
#     to objects by the same group key during validation (older rows keyed by type, or with "|parent", still match).
grouping_js = (rel / "grouping.js").read_text(encoding="utf-8")
if "</script" in grouping_js.lower():
    raise SystemExit("grouping.js must not contain closing script tags")
fn_old = "function slqBuildMappingRows(schema){"
if html.count(fn_old) != 1:
    raise SystemExit("slqBuildMappingRows anchor not found exactly once")
html = html.replace(fn_old, grouping_js + "\n" + fn_old)
blk_start = '    let own=slqMapOwnerOf(el,settings),tv=typeGet(el.props),ov=objGet(el.props),nv=nameGet(el.props);'
blk_end = 'g.count++;g.ids.push(el.id);'
if html.count(blk_start) != 1:
    raise SystemExit("Mapping group block start not found exactly once")
i0 = html.index(blk_start); i1 = html.index(blk_end, i0) + len(blk_end)
if i1 - i0 > 2000:
    raise SystemExit("Mapping group block is not in the expected shape")
html = html[:i0] + (
    '    let own=slqMapOwnerOf(el,settings),kd=slqKindOf(el),basis=kd.basis,basisValue=kd.value||"",fullType=kd.fullType||"",prof=slqGroupProfile();\n'
    '    let sr=slqSelIdx.size?slqSelIdx.get(slqPV(el,"Attr.GlobalId")):null;if(sr&&sr.uiOwner!==own.owner)sr=null;\n'
    '    let key=sr?["sel",own.owner,sr.uiCategory,sr.uiSubCategory].map(v=>encodeURIComponent(String(v||""))).join("|"):slqGroupKey(own.owner,el.cls,kd),g=groups.get(key);\n'
    '    if(!g&&sr){g={key,owner:own.owner,ownerRaw:own.raw,ownerSource:own.source||"",cls:el.cls,type:"",name:"",basis:"selection",basisValue:"",label:"Allocated by selection",basisLabel:"Allocated by selection in the model (by GlobalId)",selMap:sr,inherited:0,count:0,ids:[]};groups.set(key,g)}\n'
    '    if(sr){g.count++;g.ids.push(el.id);continue}\n'
    '    if(!g){let bl=basis==="family"?"family":basis==="type"?"type name":basis==="name"?"name":basis==="string"?"string name (number removed)":basis==="shape"?"identical shape (no type, name or property to group by)":basis==="prop"?slqPropShort(kd.prop)+(kd.found?" (picked automatically)":""):"IFC class only (no grouping property found)";'
    'g={key,owner:own.owner,ownerRaw:own.raw,ownerSource:own.source||"",cls:el.cls,type:basis==="type"||basis==="family"?basisValue:"",name:basis==="name"?basisValue:"",basis,basisValue,prop:kd.prop||"",'
    'label:basis==="prop"?slqPropShort(kd.prop)+": "+basisValue:basis==="shape"?"Same shape: "+basisValue:basisValue,basisLabel:SLQ_PROFILE_LABEL[prof.profile]+" · grouped by "+bl,inherited:0,count:0,ids:[]};groups.set(key,g)}\n'
    '    if(own.inherited)g.inherited++;\n'
    '    if(basis==="family"){g.types||(g.types=[]);g.types.includes(fullType)||g.types.push(fullType)}g.count++;g.ids.push(el.id);'
) + html[i1:]
# Validation: Mapping-tab rows are matched by group key.
k_old1 = 'r=new Map,u=[];for(let v of i){if(!v.components?.length)continue;let T={comps:v.components'
k_new1 = 'r=new Map,u=[],slqK=new Map,slqG=new Map,slqSet=O1(e);for(let v of i){if(!v.components?.length)continue;if(v.slqSel){for(let g of v.gids||[])slqG.set(g,v.components);continue}if(v.uiMapping&&v.mapKey){slqK.set(v.mapKey,(slqK.get(v.mapKey)||[]).concat(v.components));continue}let T={comps:v.components'
k_old2 = 'return v=>{let T=[...r.get(String(v.cls).toLowerCase())||[],...u];if(!T.length)return null;let O=null,U,_;'
k_new2 = 'return v=>{let O=null;if(slqG.size){let sg=slqG.get(slqPV(v,"Attr.GlobalId"));if(sg)O=new Set(sg)}if(!O&&slqK.size){for(let k of slqGroupKeysOf(v,slqSet)){let c=slqK.get(k);if(c){O=new Set(c);break}}}let T=[...r.get(String(v.cls).toLowerCase())||[],...u];if(!T.length)return O?[...O]:null;let U,_;'
for o_, n_ in ((k_old1, k_new1), (k_old2, k_new2)):
    if html.count(o_) != 1:
        raise SystemExit("Validation mapping matcher anchor not found exactly once: " + o_[:60])
    html = html.replace(o_, n_)
# Row labels show the kind (e.g. "pit type: TMR FIELD S1") and the grouping basis on hover.
lab_old = """<span class="mapv-ifc" title="${esc((r.types||[]).join('\\n'))}">${esc(r.cls)} · ${esc(r.basisValue||'class only')}"""
lab_new = """<span class="mapv-ifc" title="${esc([r.basisLabel||'',...(r.types||[])].filter(Boolean).join('\\n'))}">${esc(r.cls)} · ${esc(r.label||r.basisValue||'class only')}"""
if html.count(lab_old) != 1:
    raise SystemExit("Mapping row label anchor not found exactly once")
html = html.replace(lab_old, lab_new)
sug_old = "esc(`${x.r.cls} · ${x.r.basisValue||'class only'}`)"
if html.count(sug_old) != 1:
    raise SystemExit("Suggestion label anchor not found exactly once")
html = html.replace(sug_old, "esc(`${x.r.cls} · ${x.r.label||x.r.basisValue||'class only'}`)")

sel_edits = [
    ('let settings=O1(schema),typeGet=I2("Attr.TypeName"),objGet=I2("Attr.ObjectType"),nameGet=I2("Attr.Name"),groups=new Map,exclude=tt.excl;',
     'let settings=O1(schema),typeGet=I2("Attr.TypeName"),objGet=I2("Attr.ObjectType"),nameGet=I2("Attr.Name"),groups=new Map,exclude=tt.excl,slqSelIdx=slqSelIndex(schema);'),
    ('let map=isNA?null:(uiByKey.get(g.key)||legacyMap||null)', 'let map=isNA?null:(g.selMap||uiByKey.get(g.key)||legacyMap||null)'),
    ("if(row.map?.slqV223Manual||row.map?.slqV222Manual)return{key:'mapped',label:'Mapped · manual',cls:'manual'};",
     "if(row.map?.slqSel)return{key:'mapped',label:'Mapped · by selection',cls:'manual'};if(row.map?.slqV223Manual||row.map?.slqV222Manual)return{key:'mapped',label:'Mapped · manual',cls:'manual'};"),
    ('function slqClearUiMapping(item){', 'function slqClearUiMapping(item){if(item&&item.basis==="selection"){window.slqSelClear(item.ids);return}'),
    ("function upsertMapping(row,category,subCategory,meta={}){", "function upsertMapping(row,category,subCategory,meta={}){if(row&&row.basis==='selection')return !!window.slqSelAllocate(row.ids,row.owner,category,subCategory).ok;"),
    ('Bt("#tree").addEventListener("click",e=>{', 'window.slqTreeIds=P_;Bt("#tree").addEventListener("click",e=>{'),
]
for o_, n_ in sel_edits:
    if html.count(o_) != 1:
        raise SystemExit("Selection allocation anchor found %dx (expected 1): %s" % (html.count(o_), o_[:70]))
    html = html.replace(o_, n_)

# 6j. An unmapped row whose asset the tool cannot recognise (class-only or unknown guess, 72% or less) is titled
#     with its kind (family, pit type, CodeName...) instead of "Unknown asset" or the bare IFC class name.
dn_old = "r.mapped?(r.subCategory||r.category||d.name):d.name;"
if html.count(dn_old) != 1:
    raise SystemExit("Mapping row title anchor not found exactly once")
html = html.replace(dn_old, "r.mapped?(r.subCategory||r.category||d.name):(d.confidence<=72&&r.basisValue?r.basisValue:d.name);")

# 6l. Colour by mapping status: mapped / by selection / N.A. / unmapped / owner missing (boot.js slqMapStatusColours).
st_opt_old = '<option value="mapgroup">Colour: by mapping group</option>'
if html.count(st_opt_old) != 1:
    raise SystemExit("Mapping-group colour option not found exactly once")
html = html.replace(st_opt_old, st_opt_old + '\n        <option value="mapstatus">Colour: mapped vs unmapped</option>')
st_old = 'else if(e==="mapgroup"){'
if html.count(st_old) != 1:
    raise SystemExit("Mapping-group colour branch not found exactly once")
html = html.replace(st_old, ('else if(e==="mapstatus"){let m=window.slqMapStatusColours&&window.slqMapStatusColours();if(!m){Ln.colorize(null),t.innerHTML="";return}'
    'let g=[.82,.83,.85];Ln.colorize(o=>m.byId.get(o)||g);'
    'let cn=k=>(m.list.find(x=>x.key===k)||{}).count||0,mp=cn("mapped")+cn("selection"),um=cn("unmapped")+cn("owner"),na=cn("na"),tot=mp+um+na;'
    't.innerHTML=`<div class="slq-maplegend slq-mapsum"><b>Mapped (${mp.toLocaleString()}) vs Unmapped (${um.toLocaleString()})</b>${na?`<span>N.A. (${na.toLocaleString()})</span>`:""}<span class="muted">${tot?Math.round((mp+na)/tot*100):0}% resolved</span></div>`+`<div class="slq-maplegend">`+m.list.filter(x=>x.count).map(x=>`<span><i class="dot" style="background:${window.slqMapGroupCss(x.color)}"></i>${Ti(x.label)} (${x.count.toLocaleString()})</span>`).join("")+"</div>"}') + st_old)

# 7. 3D strings: while the IFC is still open (after properties are read, before CloseModel), draw the curve
#    geometry of elements that produced no mesh (releases/v2.36/strings.js). Skipped in data-only mode.
recentre_old = 'let V=new h2().setFromObject(this.group);if(!V.isEmpty()){let J=V.getCenter(new Ht);for(let Z of this.parts)Z.mesh.geometry.translate(-J.x,-J.y,-J.z)}'
if html.count(recentre_old) != 1:
    raise SystemExit("Viewer re-centring anchor not found exactly once")
html = html.replace(recentre_old, 'this.slqOffset=null;let V=new h2().setFromObject(this.group);if(!V.isEmpty()){let J=V.getCenter(new Ht);this.slqOffset=[J.x,J.y,J.z];for(let Z of this.parts)Z.mesh.geometry.translate(-J.x,-J.y,-J.z)}')
old_hook = ',T="";try{T=o.GetModelSchema(d)}catch{}'
if html.count(old_hook) != 1:
    raise SystemExit("Load hook anchor not found exactly once")
html = html.replace(old_hook, ',T="";try{t||!window.slqLoadCurves||window.slqLoadCurves(o,d,v,h)}catch(__e){console.warn("SunLinQ strings:",__e)}try{T=o.GetModelSchema(d)}catch{}')

# 8. Layout layer at the very end of the page, after the engine has bound its handlers
body_end = html.rfind("</body>")
if body_end < 0:
    raise SystemExit("No </body> found")
html = html[:body_end] + f'<script id="slq-v236-strings">\n{strings_js}\n</script>\n<script id="slq-v236-ui">\n{ui}\n</script>\n' + f'<script id="slq-v236-allocate">\n{allocate_js}\n</script>\n' + html[body_end:]

for marker in ("slq-builtin-rules", "slq-v236-boot", "slq-v236-ui", "slq-v236-css", "if(active&&active.builtin)return active;"):
    if marker not in html:
        raise SystemExit(f"Build check failed: {marker} missing")

dst.write_text(html, encoding="utf-8")
print(f"Built SunLinQ LoIN v2.36 ({len(rules['rules'])} built-in rules, id {rules_id}) -> {dst}")
