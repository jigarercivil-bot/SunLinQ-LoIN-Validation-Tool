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

# 6. Layout layer at the very end of the page, after the engine has bound its handlers
body_end = html.rfind("</body>")
if body_end < 0:
    raise SystemExit("No </body> found")
html = html[:body_end] + f'<script id="slq-v236-ui">\n{ui}\n</script>\n' + html[body_end:]

for marker in ("slq-builtin-rules", "slq-v236-boot", "slq-v236-ui", "slq-v236-css", "if(active&&active.builtin)return active;"):
    if marker not in html:
        raise SystemExit(f"Build check failed: {marker} missing")

dst.write_text(html, encoding="utf-8")
print(f"Built SunLinQ LoIN v2.36 ({len(rules['rules'])} built-in rules, id {rules_id}) -> {dst}")
