# local-ocr-kit

**[中文版说明 → README.zh-CN.md](README.zh-CN.md)**

Check a list of IDs / numbers / codes against a scanned document, a photo, a PDF or a Word file — in one click, fully offline. OCR runs on **your** machine; nothing is ever uploaded.

> Paste your list → drop the document → get a three-tier report: **matched / needs human check / not found**.

---

## Contents

1. [What it does](#1-what-it-does)
2. [Which version should I use?](#2-which-version-should-i-use)
3. [Try it online (30 seconds)](#3-try-it-online)
4. [Download the Windows enhanced version](#4-windows-enhanced-version)
5. [Customize it for your own scenario](#5-customize)
6. [How the matching works](#6-how-matching-works)
7. [For developers](#7-for-developers)
8. [Tests & data policy](#8-tests--data-policy)
9. [FAQ](#9-faq)

## 1. What it does

Ever had to check a scanned document or a PDF dozens of pages long — a list in one system, the document on your screen, your eyes going blurry matching them line by line? Wished an AI could do it, but every option feels wrong: the documents are confidential and cannot go to external AI tools; even where they could, feeding dozens of scanned pages to an LLM burns an absurd number of tokens; and opening a chat, uploading files and re-explaining the task every single time is far too heavy for a fixed daily routine.

This project gives you a third way: **a lightweight verification app built on the OCR engine that ships inside Windows** —

- **Works out of the box**: paste your list, drop the document, get a three-tier report in seconds (matched / needs human check / not found);
- **Fits your workflow**: import your own review rules (what to look for, how strict) into the framework and build a verification tool of your own;
- **Fully local**: no file, no data ever leaves your machine — everything runs on your own Windows PC.

And it is honest about uncertainty: anything the OCR is not sure about is flagged "needs human check", never silently counted as a match.

## 2. Which version should I use?

| | Web version | Windows enhanced version |
|---|---|---|
| Best for | **trying it out** (30 seconds, zero install) | **daily use** — download this one |
| OCR engine | runs inside your browser (WASM) | the engine built into Windows 10/11 (`Windows.Media.Ocr`) |
| Speed | slow — in our tests a 4-page scan took ~53 s | fast — the same 4 pages took ~2.3 s |
| Requirements | any modern browser, any OS | Windows 10/11 |
| Privacy | files never leave your browser | files never leave your machine |

Same interface, same matching engine, same report — only the OCR "heart" differs. **Not on Windows? Use the web version; everything except speed is identical.**

No Windows app? The web page falls back to in-browser OCR (Tesseract WASM) — English only, ~22 MB loaded once, still fully local.

## 3. Try it online

Open **[the web version](#)** <!-- GitHub Pages 链接占位 -->, click **Load sample** to see a full run on fictional data — or paste your own list and drop a document. Zero install; your files never leave the browser.

## 4. Windows enhanced version

Recommended for daily use. Download the release zip — one small folder (`start.bat`, `winocr.ps1`, the app files), **no install, no admin rights.** Double-click `start.bat` — same interface, but OCR switches to the Windows built-in engine: **~20× faster in our tests** and better on CJK text. Requires Windows 10/11.

## 5. Customize

Three levels, pick the cheapest one that fits:

| Level | You have | You do |
|---|---|---|
| 5.1 Zero config | a list of values | paste it, one per line — the list length doubles as the expected count |
| 5.2 Recipe file | a repeating scenario | copy a file from `recipes/`, edit a few fields |
| 5.3 Ask an AI | a unique system format | feed `skill/SKILL.md` + a sample of your text to any AI; it writes your recipe for you |

Level 5.3 is the point of this repo: **you don't need to code to turn this into your own tool.**

## 6. How matching works

- Tolerant matching for OCR text: only 5 glyph-confusion groups (0/O/D, 1/I/L/T, 2/Z, 5/S, 8/B) are forgiven; anything else costs, capped at 2 — *better three "needs human check" than one false match*.
- Word (.docx) files are read natively (no OCR), so they are judged **strictly, character by character**.
- Count reconciliation: if the document should contain N items and the tool reads a different number, it warns you *before* you trust the table.
- Report order puts human work on top: not found → needs check → matched.

## 7. For developers

The matching engine is dependency-free JavaScript: `import { matchAll } from "./engine/match.js"`.

## 8. Tests & data policy

All sample data in this repo is fictional. The test suite includes negative controls (random IDs must NOT match) and a tamper-check harness (breaking a rule must turn tests red). Run: `bun test`.

## 9. FAQ

**Is my document uploaded anywhere?** No. Web version: everything stays in your browser. Windows version: everything stays in a local process.

**Why not just use an LLM?** Three reasons: confidential documents often cannot be sent to external models at all; feeding dozens of scanned pages to an LLM is expensive in tokens for a check that happens every day; and audits require reproducible verdicts, which non-deterministic LLM output cannot give. Deterministic rules + local OCR solve all three — nothing leaves your machine, zero tokens, same input, same result, every time.
