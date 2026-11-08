#!/usr/bin/env python3
"""Rebuild the standalone LoIN tool from version-controlled UTF-8 parts."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
parts = sorted((root / "source" / "v2.34").glob("part-*.txt"))
if len(parts) != 27:
    raise SystemExit(f"Expected 27 parts, got {len(parts)}")
html = "".join(p.read_text(encoding="utf-8") for p in parts)
if not html.startswith("<!doctype html>") or not html.rstrip().endswith("</html>"):
    raise SystemExit("Rebuilt HTML failed basic integrity checks")
out = root / "index.html"
out.write_text(html, encoding="utf-8")
print(f"Built {out} ({len(html):,} characters)")
