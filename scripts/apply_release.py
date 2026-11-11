"""Build the release HTML from the preserved v2.34 baseline and checked-in changes."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root / "index.html"
release = json.loads((root / "releases/v2.35.patch.json").read_text(encoding="utf-8"))
lines = source.read_text(encoding="utf-8").splitlines(keepends=True)
if len(lines) != release["baseLines"]:
    raise RuntimeError("Baseline HTML changed: cannot safely apply v2.35 release patch")
for change in reversed(release["patches"]):
    at = change["at"]
    lines[at:at + change["remove"]] = [change["add"]]
result = "".join(lines)
if not all(x in result for x in ("mvcSignatureApply", "slqSaveDscrlpDefault", "btnRestoreDscrlp")):
    raise RuntimeError("Required v2.35 features missing from generated HTML")
# The classification and stage-gate summary cards are useful in the Mapping UI,
# but must not be included on printed MVC reports.
notice_insertion = "_mvcMapBrief+_scopeBrief+'$1'"
if notice_insertion not in result:
    raise RuntimeError("Could not locate MVC report-only notices")
result = result.replace(notice_insertion, "'$1'")

# A typed signature must be connected through a valid script closing tag.
# An escaped backslash produces <\\/script> in the generated MVC, which
# prevents the browser from running the electronic-signing click handler.
if '"})();<\\\\/script>"' in result:
    raise RuntimeError("Electronic signature handler script is incorrectly escaped")

# Use the source IFC filename as the MVC print-to-PDF document title.
# Browsers ordinarily suggest the document title as the Save as PDF filename.
# Preserve every filename segment; remove only the final file extension.
old_mvc_title = r'\\n<title>Model Validation Certificate</title>\\n'
new_mvc_title = r'\\n<title>"+Ti(_mvcPrintName)+"</title>\\n'
if result.count(old_mvc_title) != 1:
    raise RuntimeError("Expected exactly one MVC report title in generated HTML")
result = result.replace(
    old_mvc_title,
    new_mvc_title,
    1,
)
old_mvc_start = '  var html="<!DOCTYPE html>'
new_mvc_start = (
    '  var _mvcPrintName=String(tt.fileName||H$()||"Model Validation Certificate")'
    '.replace(/\\.[^.\\/\\\\]+$/,"");\\n'
    + old_mvc_start
)
if result.count(old_mvc_start) != 1:
    raise RuntimeError("Expected exactly one MVC HTML creation point")
result = result.replace(old_mvc_start, new_mvc_start, 1)

source.write_text(result, encoding="utf-8")
print("Published SunLinQ LoIN v2.35 with typed signatures and saved DSCRLP defaults")
