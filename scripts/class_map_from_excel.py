#!/usr/bin/env python3
"""Turn the reviewed IFC 4.3 class mapping workbook into the tool's class map.

    python3 scripts/class_map_from_excel.py            # rules/ifc-class-map.xlsx -> rules/ifc-class-map.json

Reads the "IFC to TMR" and "IFC to QR" sheets. A row is used when Match is Primary or Possible and
Reviewed is not "No". "Any" rows mark generic classes (e.g. IfcBuildingElementProxy) that are not filtered.
Every sub-category must exist in rules/dscrlp-ruleset.json, otherwise the script stops.
Needs openpyxl (pip install openpyxl).
"""
import json
import sys
from pathlib import Path

from openpyxl import load_workbook

root = Path(__file__).resolve().parents[1]
src = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "rules" / "ifc-class-map.xlsx"
dst = root / "rules" / "ifc-class-map.json"

rules = json.loads((root / "rules" / "dscrlp-ruleset.json").read_text(encoding="utf-8"))
tool_keys = {}
for c in rules["components"]:
    kind = str(c.get("kind", "")).upper()
    cat = str(c.get("category") or c.get("group") or "")
    sub = str(c.get("subCategory") or c.get("name") or "")
    tool_keys.setdefault(kind, set()).add((cat, sub))

wb = load_workbook(src, read_only=True, data_only=True)


def rows(sheet):
    it = wb[sheet].iter_rows(values_only=True)
    head = [str(h or "").strip() for h in next(it)]
    for r in it:
        yield {h: ("" if v is None else str(v).strip()) for h, v in zip(head, r)}


out, generic, problems, skipped = [], {"TMR": set(), "QRL": set()}, [], 0
for sheet, kind, cat_col, sub_col in (("IFC to TMR", "TMR", "TMR category", "TMR sub-category"),
                                      ("IFC to QR", "QRL", None, "QR sub-category")):
    for r in rows(sheet):
        match = r.get("Match", "")
        if r.get("Reviewed", "").lower() == "no":
            skipped += 1
            continue
        if match == "Any":
            generic[kind].add(r["IFC class"])
            continue
        if match not in ("Primary", "Possible"):
            continue
        sub = r[sub_col]
        if cat_col:
            cats = [r[cat_col]] if (r[cat_col], sub) in tool_keys.get(kind, set()) else []
        else:
            # QR components have no category level in the rule set: the tool's category for a QR
            # component is its class type (Eq / Floc / ...). Look it up from the sub-category name.
            cats = sorted(c for c, s2 in tool_keys.get(kind, set()) if s2 == sub)
        if not cats:
            problems.append(f"{sheet}: '{sub}' is not a {kind} sub-category in the rule set")
            continue
        for cat in cats:
            out.append({"c": r["IFC class"], "t": r.get("Predefined type", ""), "k": kind, "cat": cat, "sub": sub,
                        "m": "P" if match == "Primary" else "A"})

if problems:
    print("\n".join(problems))
    raise SystemExit(1)

data = {"source": src.name, "rows": out, "generic": {k: sorted(v) for k, v in generic.items()}}
dst.write_text(json.dumps(data, ensure_ascii=False, indent=0), encoding="utf-8")
print(f"Wrote {dst.name}: {len(out)} class links ({sum(1 for x in out if x['m'] == 'P')} primary), "
      f"{skipped} rows marked Reviewed = No left out")
