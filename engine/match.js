/**
 * local-ocr-kit — tolerant matching engine (dependency-free ES module)
 *
 * Philosophy: better three "needs human check" than one false match.
 * - OCR text ("ocr" mode): only 5 glyph-confusion groups are forgiven;
 *   any other character difference costs 1, capped at maxCost (default 2).
 * - Native text ("exact" mode, e.g. .docx): tolerant search still locates
 *   the closest line (so a typo can be pointed at), but only a literal
 *   character-by-character hit counts as "matched".
 */

/** Glyph groups that real-world OCR genuinely cannot tell apart. */
export const DEFAULT_GLYPH_GROUPS = ["0OD", "1ILT", "2Z", "5S", "8B"];

/** Build a char -> group-id lookup. */
function glyphMap(groups) {
  const m = new Map();
  groups.forEach((g, i) => { for (const ch of g) m.set(ch, i); });
  return m;
}

/** Uppercase and strip everything that is not A-Z / 0-9, keeping a map back to original indices. */
export function compact(line) {
  const up = line.toUpperCase();
  let text = "", map = [];
  for (let i = 0; i < up.length; i++) {
    const c = up[i];
    if ((c >= "A" && c <= "Z") || (c >= "0" && c <= "9")) { text += c; map.push(i); }
  }
  return { text, map };
}

/** Cost of aligning target at position pos in compacted text. Returns {cost,diffs}. */
function windowCost(target, text, pos, gmap, maxCost) {
  let cost = 0; const diffs = [];
  for (let k = 0; k < target.length; k++) {
    const a = target[k], b = text[pos + k];
    if (a === b) continue;
    const soft = gmap.has(a) && gmap.get(a) === gmap.get(b);
    if (!soft) { cost++; if (cost > maxCost) return { cost: Infinity, diffs }; }
    diffs.push({ pos: k, expected: a, got: b, soft });
  }
  return { cost, diffs };
}

/**
 * Search one target value in one document text.
 * @returns {status, line, lineNo, snippet, cost, diffs}
 *   status: "matched" | "review" | "notfound"
 */
export function matchOne(rawTarget, docText, opts = {}) {
  const {
    exactText = false,
    maxCost = 2,
    glyphGroups = DEFAULT_GLYPH_GROUPS,
  } = opts;
  const gmap = glyphMap(glyphGroups);
  const target = compact(String(rawTarget)).text;
  if (!target) return { status: "notfound", cost: Infinity, diffs: [], reason: "empty-target" };

  const lines = String(docText).split(/\r?\n/);
  let best = null;
  for (let ln = 0; ln < lines.length; ln++) {
    const { text, map } = compact(lines[ln]);
    if (text.length < target.length) continue;
    for (let pos = 0; pos + target.length <= text.length; pos++) {
      const { cost, diffs } = windowCost(target, text, pos, gmap, maxCost);
      if (cost === Infinity) continue;
      const hardCost = cost;
      if (!best || hardCost < best.cost || (hardCost === best.cost && diffs.length < best.diffs.length)) {
        const from = map[pos], to = map[pos + target.length - 1];
        best = {
          cost: hardCost, diffs, lineNo: ln + 1,
          line: lines[ln],
          snippet: lines[ln].slice(from, to + 1),
          exactHit: diffs.length === 0,
        };
        if (hardCost === 0 && diffs.length === 0) break; // perfect, stop scanning this line set
      }
    }
    if (best && best.cost === 0 && best.diffs.length === 0) break;
  }

  if (!best) return { status: "notfound", cost: Infinity, diffs: [] };

  if (exactText) {
    // Native text: only a literal hit counts. Everything else needs a human.
    if (best.exactHit) return { status: "matched", ...best };
    return { status: "review", reasonKey: "typo-suspect", ...best };
  }
  // OCR text: soft (glyph-group) differences are free; hard differences up to maxCost -> review.
  if (best.cost === 0) return { status: "matched", ...best };
  return { status: "review", reasonKey: "ocr-uncertain", ...best };
}

/**
 * Match a list of targets against one or more documents.
 * @param targets  string[] — values to verify
 * @param docs     string | {label, text, exactText}[]
 * @returns rows sorted: notfound -> review -> matched (human work on top)
 */
export function matchAll(targets, docs, opts = {}) {
  const list = typeof docs === "string" ? [{ label: "document", text: docs, exactText: !!opts.exactText }] : docs;
  const rows = targets.map((t, i) => {
    let best = null;
    for (const d of list) {
      const r = matchOne(t, d.text, { ...opts, exactText: d.exactText });
      const rank = { matched: 0, review: 1, notfound: 2 }[r.status];
      if (!best || rank < best.rank || (rank === best.rank && r.cost < best.cost)) {
        best = { ...r, rank, from: d.label };
      }
      if (best.rank === 0) break;
    }
    return { index: i + 1, target: t, ...best };
  });
  const order = { notfound: 0, review: 1, matched: 2 };
  return rows.slice().sort((a, b) => order[a.status] - order[b.status] || a.index - b.index);
}

/** Extract target values from a pasted blob of system text. */
export function extractTargets(text, { pattern, flags = "g", unique = true } = {}) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, flags);
  const found = String(text).match(re) || [];
  return unique ? [...new Set(found)] : found;
}

/**
 * Expected-count reconciliation.
 * mode A (paste-a-list): expected = list length — pass targets array.
 * mode B (recipe):       expectedFrom regex with one capture group; take the max over all hits; 0 = unknown.
 */
export function expectedCount(source, expectedFrom) {
  if (Array.isArray(source)) return source.length;
  if (!expectedFrom) return 0;
  const re = expectedFrom instanceof RegExp ? expectedFrom : new RegExp(expectedFrom, "g");
  let max = 0, m;
  while ((m = re.exec(String(source))) !== null) max = Math.max(max, parseInt(m[1], 10) || 0);
  return max;
}

/** Summarize rows for the report header + count reconciliation banner. */
export function summarize(rows, expected = 0) {
  const s = { matched: 0, review: 0, notfound: 0 };
  rows.forEach(r => s[r.status]++);
  const total = rows.length;
  return {
    ...s, total, expected,
    countMismatch: expected > 0 && expected !== total,
  };
}
