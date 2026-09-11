/**
 * local-ocr-kit - minimal .docx native text reader (dependency-free)
 *
 * Reads word/document.xml + headers/footers straight out of the zip using the
 * browser's built-in DecompressionStream("deflate-raw"). Native text means the
 * verdict can be strict: no OCR, no glyph forgiveness.
 *
 * An `inflateRaw` function can be injected for non-browser runtimes (tests).
 */

const WANTED = /^word\/(document\.xml|header\d*\.xml|footer\d*\.xml)$/;

async function defaultInflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function u16(v, o) { return v[o] | (v[o + 1] << 8); }
function u32(v, o) { return (v[o] | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24)) >>> 0; }

/** Parse the zip central directory. Entry names use forward slashes. */
function centralDirectory(v) {
  // EOCD signature 0x06054b50, scan backwards (comment can pad the tail)
  let e = -1;
  for (let i = v.length - 22; i >= Math.max(0, v.length - 22 - 65535); i--) {
    if (u32(v, i) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) throw new Error("not a zip file (.docx expected)");
  const count = u16(v, e + 10), cdOff = u32(v, e + 16);
  const entries = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (u32(v, p) !== 0x02014b50) throw new Error("bad central directory");
    const method = u16(v, p + 10), csize = u32(v, p + 20);
    const nlen = u16(v, p + 28), xlen = u16(v, p + 30), clen = u16(v, p + 32);
    const lho = u32(v, p + 42);
    const name = new TextDecoder().decode(v.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, "/");
    entries.push({ name, method, csize, lho });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

function entryData(v, ent) {
  if (u32(v, ent.lho) !== 0x04034b50) throw new Error("bad local header");
  const nlen = u16(v, ent.lho + 26), xlen = u16(v, ent.lho + 28);
  const start = ent.lho + 30 + nlen + xlen;
  return v.subarray(start, start + ent.csize);
}

/** Strip WordprocessingML down to plain text, preserving line/cell boundaries. */
export function xmlToText(xml) {
  let s = xml.replace(/>\s+</g, "><");                     // whitespace between tags is not content
  s = s.replace(/<w:del\b[\s\S]*?<\/w:del>/g, "");          // tracked deletions are not document content
  s = s.replace(/<\/w:p>\s*(?=<\/w:tc>)/g, "");          // paragraph end inside a cell is not a line break
  s = s.replace(/<\/w:tc>/g, "\t").replace(/<\/w:p>|<\/w:tr>/g, "\n");
  s = s.replace(/<[^>]+>/g, "");                            // NB: nothing inserted between w:t runs
  s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
  return s.split(/\n/).map(l => l.replace(/[ \t]+$/g, "")).filter(l => l.trim()).join("\n");
}

/**
 * @param data ArrayBuffer | Uint8Array of a .docx file
 * @returns {text, parts} - plain text (document + headers/footers) for exact-mode matching
 */
export async function readDocx(data, { inflateRaw = defaultInflateRaw } = {}) {
  const v = data instanceof Uint8Array ? data : new Uint8Array(data);
  const entries = centralDirectory(v).filter(e => WANTED.test(e.name));
  if (!entries.some(e => /document\.xml$/.test(e.name))) throw new Error("word/document.xml missing - is this a .docx?");
  // document first, then headers/footers, deterministic order
  entries.sort((a, b) => (WANTED.exec(a.name)[1] > WANTED.exec(b.name)[1] ? 1 : -1));
  const parts = [];
  for (const ent of entries) {
    const raw = entryData(v, ent);
    const bytes = ent.method === 0 ? raw : ent.method === 8 ? await inflateRaw(raw) : (() => { throw new Error("unsupported zip method " + ent.method); })();
    parts.push({ name: ent.name, text: xmlToText(new TextDecoder().decode(bytes)) });
  }
  return { text: parts.map(p => p.text).join("\n"), parts };
}
