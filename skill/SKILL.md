# SKILL.md — let an AI build your recipe

This file is written **for AI assistants**. If you are a human: copy the prompt
template at the bottom, paste it into any AI chat together with this file and a
sample of your own system text, and the AI will produce a ready-to-import
recipe for you. You do not need to write code.

## 1. What a recipe is

A recipe is a small JSON file that adapts local-ocr-kit to one recurring
verification scenario. The app imports it and from then on the user's daily
routine is: paste system text, drop the document, read the report.

## 2. Schema

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | Short scenario name shown in the UI |
| `description` | string | no | One sentence for the picker list |
| `extract.pattern` | string (JS regex source) | yes | How to pull target values out of the pasted system text. Remember JSON escaping: `\\d` in the file means `\d` |
| `extract.expectedFrom` | string (JS regex, ONE capture group) | no | Where the pasted text states how many items there should be, e.g. `"(\\d+)\\s+invoices"`. Used for count reconciliation; omit if the text has no such statement |
| `match.maxCost` | number | no (default 2) | Max hard character differences before a value is "not found". Do not raise above 2 unless the user insists |
| `match.glyphGroups` | string[] | no | Override the built-in OCR confusion groups `["0OD","1ILT","2Z","5S","8B"]`. Rarely needed |
| `report.itemLabel` | string | no | What one value is called in the report ("Invoice no.", "Serial number") |

## 3. Rules for the AI

1. Ask for (or use) a **real sample** of the user's system text. Never invent the pattern from the description alone.
2. Derive the tightest pattern that matches ALL target values in the sample and nothing else. Prefer explicit shapes (`PO-\d{8}`) over loose ones (`\S+`).
3. Count the matches in the sample and tell the user: "this pattern finds N values in your sample - is N correct?" Adjust until it is.
4. Only add `expectedFrom` if the sample literally contains a count statement. It needs exactly one capture group.
5. Values with no stable shape (free-text names, mixed formats)? Do NOT force a regex. Tell the user to use **paste-a-list mode** instead - it needs no recipe.
6. Output the recipe as a single JSON code block, valid JSON, double-escaped backslashes.

## 4. Worked example

User sample:

```
Search results - 3 invoices
INV-004821  approved
INV-004876  approved
INV-004901  pending
```

Correct recipe:

```json
{
  "name": "Invoice number check",
  "extract": { "pattern": "INV-\\d{6}", "expectedFrom": "(\\d+)\\s+invoices" },
  "match": { "maxCost": 2 },
  "report": { "itemLabel": "Invoice no." }
}
```

## 5. Prompt template (for humans - copy from here down)

> You are a configuration generator for "local-ocr-kit", an offline
> list-vs-document verification tool. Read the attached SKILL.md, section 2
> (schema) and section 3 (rules). Below is a sample of the text I copy from my
> system. Produce my recipe JSON, tell me how many values your pattern finds
> in the sample, and ask me to confirm that number.
>
> My sample:
> ```
> (paste your system text here)
> ```
