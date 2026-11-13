# SunLinQ LoIN Validation Tool

Private source repository for the SunLinQ Level of Information Need (LoIN) validation tool.

**Current baseline:** V2.34 — cleaned package titles, updated package list, signature/date controls, owner-specific mapping/MVC and N.A. owner support.

## Files
- `index.html` — the complete standalone application, generated automatically from versioned source chunks.
- `source/v2.34/part-*.txt` — UTF-8 chunks of the original V2.34 HTML (split only to permit upload).
- `scripts/assemble.py` — deterministic assembler.
- `.github/workflows/assemble.yml` — automatically commits `index.html` when source parts change.

## Release build (V2.36)
The published tool is built in three steps, each layered on the one before:

1. `index.html` — the V2.34 baseline (assembled from `source/v2.34`).
2. `python3 scripts/apply_release.py` — applies `releases/v2.35.patch.json` (V2.35).
3. `python3 scripts/build_release.py` — adds V2.36:
   - `rules/dscrlp-ruleset.json` — the **built-in DSCRLP rule set**, with its display name and revision in `rules/ruleset.meta.json`. Users no longer import or export a JSON file.
   - `releases/v2.36/ui.css`, `ui.js`, `boot.js` — the clean layout (stage switcher in the header, icon rail, Help tab). These only rearrange and restyle existing elements; the validation engine, exports and MVC are unchanged.
   - `releases/v2.36/strings.js` — draws **3D strings** (IfcPolyline, IfcIndexedPolyCurve, IfcCompositeCurve, curve sets) for objects that have no solid geometry, aligned with the meshes and included in colouring, picking, isolate and section box.
   - `rules/ifc-class-map.json` — **IFC 4.3 class → TMR / QR category map** used by the Mapping tab (filtered category lists, automatic mapping when one class match is clear). Generated from the reviewed workbook `rules/ifc-class-map.xlsx`.

`.github/workflows/pages.yml` runs steps 2 and 3 on every push to `main`.

**Updating the IFC class map:** edit `rules/ifc-class-map.xlsx` (sheets *IFC to TMR* and *IFC to QR*; mark rows *Reviewed = No* to drop them, add rows for missing links), then run `python3 scripts/class_map_from_excel.py` (needs `openpyxl`) and push `rules/ifc-class-map.json` and the workbook. The script stops if a sub-category does not exist in the rule set.

**Updating the rules:** in the tool, open Help and turn on *Maintainer mode*, make the change under Rules → Maintainer tools, use *Save JSON*, replace `rules/dscrlp-ruleset.json` with that file, update the revision text in `rules/ruleset.meta.json`, and push. Each user's browser picks up the new revision on next load and keeps their mapping work where the categories still exist.

## How to use
Open `index.html` in the private repository and choose **Download raw file**, then open locally in a supported browser. GitHub's file viewer does not execute HTML applications.

## Privacy
The GitHub repository is **private**. Access requires an authorised GitHub account. Do **not** enable public GitHub Pages, and do not upload project IFC files, credentials, or client-sensitive data without approval. GitHub storage alone does not create a privately hosted, interactive application.
