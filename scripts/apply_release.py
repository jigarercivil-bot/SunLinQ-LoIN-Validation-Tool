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
source.write_text(result, encoding="utf-8")
print("Published SunLinQ LoIN v2.35 with typed signatures and saved DSCRLP defaults")
