// Phase 4 unit tests: decoding files safely (UTF-8 only, byte-order mark, line endings) and putting them back exactly.
// Run: node Testing/phase4-unit.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "app", "index.html"), "utf8");
const m = html.match(/\/\/ ===== <pure-logic>[\s\S]*?\n([\s\S]*?)\/\/ ===== <\/pure-logic> =====/);
if (!m) { console.error("FAIL: pure-logic block not found"); process.exit(2); }
const ctx = { TextDecoder, Uint8Array }; vm.createContext(ctx);
vm.runInContext(m[1] + "\nthis.api={decodeFileBytes,encodeForFile,describeOpenRefusal,failureMessage,normalizeCard,MAX_OPEN_BYTES};", ctx);
const api = ctx.api;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)));
}
const bytes = (s, bom) => new Uint8Array([...(bom ? [0xEF, 0xBB, 0xBF] : []), ...Buffer.from(s, "utf8")]);
const slim = (d) => (d.ok ? { ok: true, text: d.text, bom: d.bom, eol: d.eol, mixed: d.mixed } : d);

// ----- what a good file decodes to
eq("plain LF text", slim(api.decodeFileBytes(bytes("hello\nworld\n"))), { ok: true, text: "hello\nworld\n", bom: false, eol: "lf", mixed: false });
eq("CRLF text is held with LF line breaks and remembered as CRLF", slim(api.decodeFileBytes(bytes("a\r\nb\r\n"))), { ok: true, text: "a\nb\n", bom: false, eol: "crlf", mixed: false });
eq("byte-order mark is removed from the text and remembered", slim(api.decodeFileBytes(bytes("abc", true))), { ok: true, text: "abc", bom: true, eol: "lf", mixed: false });
eq("BOM + CRLF together", slim(api.decodeFileBytes(bytes("a\r\nb", true))), { ok: true, text: "a\nb", bom: true, eol: "crlf", mixed: false });
eq("empty file", slim(api.decodeFileBytes(new Uint8Array([]))), { ok: true, text: "", bom: false, eol: "lf", mixed: false });
eq("a file that is only a BOM", slim(api.decodeFileBytes(new Uint8Array([0xEF, 0xBB, 0xBF]))), { ok: true, text: "", bom: true, eol: "lf", mixed: false });
eq("no trailing newline is preserved", api.decodeFileBytes(bytes("a\nb")).text, "a\nb");
eq("accents, CJK and emoji decode correctly", api.decodeFileBytes(bytes("Café 日本語 😀")).text, "Café 日本語 😀");
eq("a BOM character in the middle of the text is kept (only a leading BOM is special)", api.decodeFileBytes(bytes("a﻿b")).text, "a﻿b");
eq("a file with no line breaks at all is LF and not mixed", slim(api.decodeFileBytes(bytes("one line"))), { ok: true, text: "one line", bom: false, eol: "lf", mixed: false });
eq("accepts a plain ArrayBuffer as well as a Uint8Array", api.decodeFileBytes(bytes("hi").buffer).text, "hi");

// ----- mixed and unusual line endings
eq("mixed: CRLF majority -> CRLF, flagged", slim(api.decodeFileBytes(bytes("a\r\nb\nc\r\n"))), { ok: true, text: "a\nb\nc\n", bom: false, eol: "crlf", mixed: true });
eq("mixed: LF majority -> LF, flagged", slim(api.decodeFileBytes(bytes("a\nb\nc\r\n"))), { ok: true, text: "a\nb\nc\n", bom: false, eol: "lf", mixed: true });
eq("mixed: a tie goes to LF", api.decodeFileBytes(bytes("a\r\nb\n")).eol, "lf");
eq("lone CR (old Mac style) becomes a line break and is flagged", slim(api.decodeFileBytes(bytes("a\rb\r"))), { ok: true, text: "a\nb\n", bom: false, eol: "lf", mixed: true });
eq("a lone CR inside CRLF text is flagged too", api.decodeFileBytes(bytes("a\r\nb\rc\r\n")).mixed, true);

// ----- what must be refused (never "repair" a file and save it back damaged)
eq("Latin-1 'é' (byte E9 alone) is refused", api.decodeFileBytes(new Uint8Array([0x48, 0xE9, 0x6C])).ok, false);
eq("UTF-16 little-endian text (FF FE BOM) is refused", api.decodeFileBytes(new Uint8Array([0xFF, 0xFE, 0x68, 0x00, 0x69, 0x00])).ok, false);
eq("UTF-16 big-endian text (FE FF BOM) is refused", api.decodeFileBytes(new Uint8Array([0xFE, 0xFF, 0x00, 0x68])).ok, false);
eq("a broken multi-byte sequence is refused", api.decodeFileBytes(new Uint8Array([0xC3, 0x28])).ok, false);
eq("a truncated multi-byte sequence at the end is refused", api.decodeFileBytes(new Uint8Array([0x61, 0xE6, 0x97])).ok, false);
eq("random binary (a PNG header) is refused", api.decodeFileBytes(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])).ok, false);
eq("the refusal gives a reason", api.decodeFileBytes(new Uint8Array([0xFF])).reason, "not-utf8");

// ----- putting it back: a file that is opened and saved without editing comes back byte for byte
const roundtrip = (u8) => { const d = api.decodeFileBytes(u8); return d.ok ? Array.from(Buffer.from(api.encodeForFile(d.text, { eol: d.eol, bom: d.bom }), "utf8")) : null; };
for (const [name, u8] of [
  ["plain LF", bytes("hello\nworld\n")], ["CRLF", bytes("a\r\nb\r\nc\r\n")], ["BOM + CRLF", bytes("a\r\nb", true)], ["BOM + LF", bytes("x\ny\n", true)],
  ["no trailing newline", bytes("a\r\nb")], ["empty", new Uint8Array([])], ["BOM only", bytes("", true)], ["unicode", bytes("Café 日本語 😀\r\n", true)],
  ["blank lines", bytes("a\r\n\r\n\r\nb\r\n")], ["one line", bytes("single")],
]) eq("round trip is byte-exact: " + name, roundtrip(u8), Array.from(u8));
eq("a mixed file comes back with one consistent style (not byte-exact, by design)", roundtrip(bytes("a\r\nb\nc\r\n")).length, Buffer.from("a\r\nb\r\nc\r\n").length);

// ----- encodeForFile
eq("encode: defaults (no format given) leave the text alone", [api.encodeForFile("a\nb"), api.encodeForFile("a\nb", {})], ["a\nb", "a\nb"]);
eq("encode: CRLF turns every line break into CRLF", api.encodeForFile("a\n\nb\n", { eol: "crlf" }), "a\r\n\r\nb\r\n");
eq("encode: LF leaves line breaks alone", api.encodeForFile("a\nb", { eol: "lf" }), "a\nb");
eq("encode: BOM goes first", api.encodeForFile("a", { bom: true }), "﻿a");
eq("encode: BOM and CRLF", api.encodeForFile("a\nb", { eol: "crlf", bom: true }), "﻿a\r\nb");
eq("encode: empty text with a BOM is just the BOM", api.encodeForFile("", { bom: true }), "﻿");
eq("encode: bom false adds nothing", api.encodeForFile("a", { bom: false, eol: "lf" }), "a");

// ----- messages and defaults
eq("limit is 10 MB", api.MAX_OPEN_BYTES, 10 * 1024 * 1024);
eq("refusal: too big names the file and the size", /"big.txt" is 12\.5 MB, over the 10 MB limit/.test(api.describeOpenRefusal("big.txt", "too-big", 12.5 * 1048576)), true);
eq("refusal: not UTF-8 names the file and says why", /"x.txt" is not UTF-8 text.*could damage it/.test(api.describeOpenRefusal("x.txt", "not-utf8")), true);
eq("refusal: unreadable includes the error name", /"y.txt" could not be read \(NotAllowedError\)/.test(api.describeOpenRefusal("y.txt", "unreadable", 0, "NotAllowedError")), true);
eq("message: mixed line endings says what will happen", /mixed or unusual line endings.*CRLF/.test(api.failureMessage("eolmixed", "z.txt", "CRLF (Windows)")), true);
eq("normalize: containers stored earlier default to LF and no BOM", [api.normalizeCard({ id: "x" }).eol, api.normalizeCard({ id: "x" }).bom], ["lf", false]);
eq("normalize: stored line-ending info is kept", [api.normalizeCard({ id: "x", eol: "crlf", bom: true }).eol, api.normalizeCard({ id: "x", eol: "crlf", bom: true }).bom], ["crlf", true]);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
