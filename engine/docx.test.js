import { describe, test, expect } from "bun:test";
import { readDocx, xmlToText } from "./docx.js";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { writeFileSync } from "node:fs";

/* ---- build a real zip (docx skeleton) in-memory, no libraries ---- */
function crc32(buf) {
  let t = crc32.t; if (!t) { t = crc32.t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } }
  let c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function le(n, w) { const a = []; for (let i = 0; i < w; i++) a.push((n >>> (8 * i)) & 0xff); return a; }
function makeZip(files) { // files: [name, textContent]
  const chunks = [], cd = []; let off = 0;
  for (const [name, content] of files) {
    const nameB = Buffer.from(name), raw = Buffer.from(content, "utf-8");
    const comp = deflateRawSync(raw), crc = crc32(raw);
    const lh = Buffer.from([...le(0x04034b50,4), ...le(20,2), ...le(0,2), ...le(8,2), ...le(0,4), ...le(crc,4), ...le(comp.length,4), ...le(raw.length,4), ...le(nameB.length,2), ...le(0,2)]);
    chunks.push(lh, nameB, comp);
    cd.push({ nameB, crc, csize: comp.length, usize: raw.length, off });
    off += lh.length + nameB.length + comp.length;
  }
  const cdChunks = []; let cdLen = 0;
  for (const e of cd) {
    const c = Buffer.from([...le(0x02014b50,4), ...le(20,2), ...le(20,2), ...le(0,2), ...le(8,2), ...le(0,4), ...le(e.crc,4), ...le(e.csize,4), ...le(e.usize,4), ...le(e.nameB.length,2), ...le(0,2), ...le(0,2), ...le(0,2), ...le(0,2), ...le(0,4), ...le(e.off,4)]);
    cdChunks.push(c, e.nameB); cdLen += c.length + e.nameB.length;
  }
  const eocd = Buffer.from([...le(0x06054b50,4), ...le(0,2), ...le(0,2), ...le(cd.length,2), ...le(cd.length,2), ...le(cdLen,4), ...le(off,4), ...le(0,2)]);
  return Buffer.concat([...chunks, ...cdChunks, eocd]);
}

const DOC_XML = `<?xml version="1.0"?><w:document><w:body>
<w:p><w:r><w:t>Supplier list</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>SP-</w:t></w:r><w:r><w:t>77</w:t></w:r><w:r><w:t>012345</w:t></w:r></w:p></w:tc>
<w:tc><w:p><w:r><w:t>approved</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:del><w:r><w:t>SP-99999999</w:t></w:r></w:del><w:r><w:t>tail &amp; end</w:t></w:r></w:p>
</w:body></w:document>`;
const HDR_XML = `<w:hdr><w:p><w:r><w:t>Header code SP-55554444</w:t></w:r></w:p></w:hdr>`;

const zipBuf = makeZip([["[Content_Types].xml", "<Types/>"], ["word/document.xml", DOC_XML], ["word/header1.xml", HDR_XML]]);
const inflateRaw = b => Promise.resolve(new Uint8Array(inflateRawSync(Buffer.from(b))));

describe("docx native reader", () => {
  test("split runs join back into one value (no separator between w:t)", async () => {
    const { text } = await readDocx(zipBuf, { inflateRaw });
    expect(text).toContain("SP-77012345\tapproved");
  });
  test("headers are read too", async () => {
    const { text } = await readDocx(zipBuf, { inflateRaw });
    expect(text).toContain("SP-55554444");
  });
  test("tracked deletions and entities handled", async () => {
    const { text } = await readDocx(zipBuf, { inflateRaw });
    expect(text).not.toContain("SP-99999999");
    expect(text).toContain("tail & end");
  });
  test("non-zip input rejected", async () => {
    await expect(readDocx(new Uint8Array([1,2,3,4]), { inflateRaw })).rejects.toThrow("not a zip");
  });
  test("table cell boundary becomes a tab, so cell seams cannot forge a hit", () => {
    expect(xmlToText("<w:tbl><w:tr><w:tc><w:p><w:r><w:t>AB12</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>34CD</w:t></w:r></w:p></w:tc></w:tr></w:tbl>")).toBe("AB12\t34CD");
  });
});

/* also drop a fixture for browser-side testing */
writeFileSync(new URL("../.fixtures_sample.docx", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), zipBuf);
