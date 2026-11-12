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
for name, text in (("ui.css", css), ("boot.js", boot), ("ui.js", ui)):
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
]
for old, new in map_edits:
    if html.count(old) != 1:
        raise SystemExit(f"Mapping edit anchor found {html.count(old)}x (expected 1): {old[:70]}")
    html = html.replace(old, new)

# 7. Layout layer at the very end of the page, after the engine has bound its handlers
body_end = html.rfind("</body>")
if body_end < 0:
    raise SystemExit("No </body> found")
html = html[:body_end] + f'<script id="slq-v236-ui">\n{ui}\n</script>\n' + html[body_end:]

for marker in ("slq-builtin-rules", "slq-v236-boot", "slq-v236-ui", "slq-v236-css", "if(active&&active.builtin)return active;"):
    if marker not in html:
        raise SystemExit(f"Build check failed: {marker} missing")

dst.write_text(html, encoding="utf-8")
print(f"Built SunLinQ LoIN v2.36 ({len(rules['rules'])} built-in rules, id {rules_id}) -> {dst}")
