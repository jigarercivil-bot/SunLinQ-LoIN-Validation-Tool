# SunLinQ LoIN Validation Tool

Private source repository for the SunLinQ Level of Information Need (LoIN) validation tool.

**Current baseline:** V2.34 — cleaned package titles, updated package list, signature/date controls, owner-specific mapping/MVC and N.A. owner support.

## Files
- `index.html` — the complete standalone application, generated automatically from versioned source chunks.
- `source/v2.34/part-*.txt` — UTF-8 chunks of the original V2.34 HTML (split only to permit upload).
- `scripts/assemble.py` — deterministic assembler.
- `.github/workflows/assemble.yml` — automatically commits `index.html` when source parts change.

## How to use
Open `index.html` in the private repository and choose **Download raw file**, then open locally in a supported browser. GitHub's file viewer does not execute HTML applications.

## Privacy
The GitHub repository is **private**. Access requires an authorised GitHub account. Do **not** enable public GitHub Pages, and do not upload project IFC files, credentials, or client-sensitive data without approval. GitHub storage alone does not create a privately hosted, interactive application.
