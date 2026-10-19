// Pixel comparison of two PNG files (8-bit, non-interlaced, as Chrome writes them). Run: node Testing/png-diff.mjs a.png b.png -> prints number of differing pixels
import { readFileSync } from "node:fs"; import { inflateSync } from "node:zlib";
function decode(f) {
  const b = readFileSync(f); let p = 8, w, h, ct, idat = [];
  while (p < b.length) { const len = b.readUInt32BE(p), type = b.toString("ascii", p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } if (type === "IDAT") idat.push(d); p += 12 + len; }
  const bpp = ct === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { const ft = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? out[y * stride + x - bpp] : 0, u = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = row[x]; if (ft === 1) v += a; else if (ft === 2) v += u; else if (ft === 3) v += (a + u) >> 1; else if (ft === 4) { const pp = a + u - c, pa = Math.abs(pp - a), pb = Math.abs(pp - u), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? u : c; }
      out[y * stride + x] = v & 255; } }
  return { w, h, bpp, px: out };
}
const A = decode(process.argv[2]), B = decode(process.argv[3]);
if (A.w !== B.w || A.h !== B.h) { console.log("SIZE DIFFERS " + A.w + "x" + A.h + " vs " + B.w + "x" + B.h); process.exit(1); }
let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; for (let i = 0; i < A.px.length; i += A.bpp) if (A.px[i] !== B.px[i] || A.px[i + 1] !== B.px[i + 1] || A.px[i + 2] !== B.px[i + 2]) { n++; const q = i / A.bpp, x = q % A.w, y = (q / A.w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
console.log(n + " differing pixels of " + A.w * A.h + (n ? " in box x " + x0 + "-" + x1 + ", y " + y0 + "-" + y1 : "")); process.exit(n ? 1 : 0);
