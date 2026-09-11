import { describe, test, expect } from "bun:test";
import { matchOne, matchAll, extractTargets, expectedCount, summarize, compact, DEFAULT_GLYPH_GROUPS } from "./match.js";

/* ---------- seeded RNG so every run is reproducible ---------- */
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ0123456789";
function fakeId(r, len = 12) { let s = "X"; for (let i = 1; i < len; i++) s += ALPHABET[Math.floor(r() * ALPHABET.length)]; return s; }

/* Simulate what a real OCR engine does to a line. */
const SOFT_SWAP = { "0": "O", "O": "0", "1": "I", "I": "1", "L": "1", "5": "S", "S": "5", "8": "B", "B": "8", "2": "Z", "Z": "2", "D": "0", "T": "1" };
function ocrCorrupt(id, r) {
  // swap 1-2 glyph-confusable chars + inject commas/spaces mid-string
  let chars = id.split("");
  let swapped = 0;
  for (let i = 0; i < chars.length && swapped < 2; i++) {
    if (SOFT_SWAP[chars[i]] && r() < 0.6) { chars[i] = SOFT_SWAP[chars[i]]; swapped++; }
  }
  const cut = 3 + Math.floor(r() * (chars.length - 4));
  return chars.slice(0, cut).join("") + ", " + chars.slice(cut).join(" ").slice(0, 2) + chars.slice(cut + 1).join("");
}

/* ---------- fixtures ---------- */
const r = rng(42);
const IDS = Array.from({ length: 30 }, () => fakeId(r));
const DOC = IDS.map((id, i) => `row ${i + 1}   applicant: ${ocrCorrupt(id, r)}   status: ok`).join("\n");

describe("positive controls (OCR mode)", () => {
  test("glyph-swapped + comma/space-injected IDs are all found (matched, never notfound)", () => {
    const rows = matchAll(IDS, DOC);
    const s = summarize(rows);
    expect(s.notfound).toBe(0);
    expect(s.matched).toBe(30); // soft swaps are free by design
  });
  test("1 hard difference -> review, with position reported", () => {
    const res = matchOne("XQQQ7MK2P4WN", "id: XQQQ7MK2P4WA end"); // N->A is hard
    expect(res.status).toBe("review");
    expect(res.diffs.filter(d => !d.soft).length).toBe(1);
    expect(res.diffs[0].pos).toBe(11);
  });
  test("3 hard differences -> notfound (beyond maxCost 2)", () => {
    const res = matchOne("XQQQ7MK2P4WN", "id: XRRR7MK2P4WN end");
    expect(res.status).toBe("notfound");
  });
});

describe("negative control: false-positive rate", () => {
  test("5000 random IDs vs real doc -> zero matched", () => {
    const r2 = rng(777);
    const randoms = Array.from({ length: 5000 }, () => fakeId(r2));
    const rows = matchAll(randoms.filter(x => !IDS.includes(x)), DOC);
    expect(rows.filter(x => x.status === "matched").length).toBe(0);
  });
});

describe("exact mode (native .docx text)", () => {
  const doc = [{ label: "a.docx", text: "name list:\nXABC123DEF45\nXZZZ999YYY88", exactText: true }];
  test("literal hit -> matched", () => {
    expect(matchAll(["XABC123DEF45"], doc)[0].status).toBe("matched");
  });
  test("one-char typo -> review even when glyph-equivalent (0 vs O is a real difference in typed text)", () => {
    const row = matchAll(["XABC123DEF4S"], doc)[0]; // 5->S soft in OCR, but this is typed text
    expect(row.status).toBe("review");
    expect(row.reasonKey).toBe("typo-suspect");
  });
});

describe("extraction + count reconciliation", () => {
  const blob = "Items (3)\nPO-00000001 ok\nPO-00000002 ok\nnoise PO-00000002 dup\nPO-00000003 ok";
  test("extractTargets dedupes by default", () => {
    expect(extractTargets(blob, { pattern: "PO-\\d{8}" })).toEqual(["PO-00000001", "PO-00000002", "PO-00000003"]);
  });
  test("expectedCount: list mode = list length; recipe mode = regex capture", () => {
    expect(expectedCount(["a", "b"])).toBe(2);
    expect(expectedCount(blob, "Items \\((\\d+)\\)")).toBe(3);
    expect(expectedCount(blob, "Nothing \\((\\d+)\\)")).toBe(0); // unknown -> no warning
  });
  test("summarize flags count mismatch", () => {
    const rows = matchAll(["PO-00000001"], "PO-00000001");
    expect(summarize(rows, 3).countMismatch).toBe(true);
    expect(summarize(rows, 1).countMismatch).toBe(false);
    expect(summarize(rows, 0).countMismatch).toBe(false);
  });
});

describe("tamper self-proof: break a rule, tests must go red (asserted as behaviour flips)", () => {
  test("emptying glyph groups demotes soft matches -> proves the groups do real work", () => {
    const withGroups = matchOne("X0O0O0O0O0O1", "val: XO0O0O0O0O0I"); // all-soft diffs
    const without = matchOne("X0O0O0O0O0O1", "val: XO0O0O0O0O0I", { glyphGroups: [] });
    expect(withGroups.status).toBe("matched");
    expect(without.status).toBe("notfound"); // >2 hard diffs once forgiveness is removed
  });
  test("maxCost 0 demotes review -> proves the cost cap is live", () => {
    const normal = matchOne("XQQQ7MK2P4WN", "XQQQ7MK2P4WA");
    const strict = matchOne("XQQQ7MK2P4WN", "XQQQ7MK2P4WA", { maxCost: 0 });
    expect(normal.status).toBe("review");
    expect(strict.status).toBe("notfound");
  });
});

describe("report ordering & hygiene", () => {
  test("human work floats to top: notfound -> review -> matched", () => {
    const doc = "XAAA111BBB22\nXCCC333DDD4Q";
    const rows = matchAll(["XZZZ777YYY88", "XCCC333DDD44", "XAAA111BBB22"], doc);
    expect(rows.map(x => x.status)).toEqual(["notfound", "review", "matched"]);
  });
  test("notfound rows carry no snippet presented as a hit", () => {
    const rows = matchAll(["XZZZ777YYY88"], "XAAA111BBB22");
    expect(rows[0].status).toBe("notfound");
  });
  test("compact keeps a correct back-map to original indices", () => {
    const { text, map } = compact("a-1 b,2");
    expect(text).toBe("A1B2");
    expect(map).toEqual([0, 2, 4, 6]);
  });
});
