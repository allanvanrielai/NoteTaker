// Phase 2 unit tests: file-name sanitising, default names, title lock helpers, and the save routine's decisions.
// Run: node Testing/phase2-unit.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "app", "index.html"), "utf8");
const m = html.match(/\/\/ ===== <pure-logic>[\s\S]*?\n([\s\S]*?)\/\/ ===== <\/pure-logic> =====/);
if (!m) { console.error("FAIL: pure-logic block not found"); process.exit(2); }
const ctx = {}; vm.createContext(ctx);
vm.runInContext(m[1] + "\nthis.api={sanitizeTitle,defaultFileName,stripExtension,checkBeforeWrite,classifyWriteError,failureMessage,normalizeCard,newCard};", ctx);
const api = ctx.api;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)));
}
const yes = (name, cond, detail) => eq(name, !!cond, true) || (cond || console.log("      " + JSON.stringify(detail)));

// ----- sanitizeTitle
eq("sanitize: plain title unchanged", api.sanitizeTitle("Meeting notes"), "Meeting notes");
eq("sanitize: forbidden characters removed", api.sanitizeTitle('a\\b/c:d*e?f"g<h>i|j'), "abcdefghij");
eq("sanitize: control characters removed", api.sanitizeTitle("a\u0000b\u001fc\u007fd\ne\tf"), "abcdef");
eq("sanitize: leading and trailing spaces trimmed", api.sanitizeTitle("   hello   "), "hello");
eq("sanitize: internal spaces kept", api.sanitizeTitle("a  b"), "a  b");
eq("sanitize: trailing dots removed", api.sanitizeTitle("report..."), "report");
eq("sanitize: trailing dots and spaces mixed", api.sanitizeTitle("report . . "), "report");
eq("sanitize: leading dot kept", api.sanitizeTitle(".config"), ".config");
eq("sanitize: only dots becomes empty", api.sanitizeTitle("..."), "");
eq("sanitize: only forbidden characters becomes empty", api.sanitizeTitle('???***'), "");
eq("sanitize: empty and whitespace", [api.sanitizeTitle(""), api.sanitizeTitle("   ")], ["", ""]);
eq("sanitize: unicode kept", api.sanitizeTitle("Café – résumé 日本語"), "Café – résumé 日本語");
for (const r of ["CON", "con", "Prn", "AUX", "NUL", "COM1", "com9", "LPT1", "lpt9"])
  eq("sanitize: reserved name " + r + " prefixed", api.sanitizeTitle(r), "_" + r);
eq("sanitize: reserved name with extension prefixed", api.sanitizeTitle("con.txt"), "_con.txt");
eq("sanitize: reserved name followed by a dot", api.sanitizeTitle("CON."), "_CON");
eq("sanitize: COM10 is not reserved", api.sanitizeTitle("COM10"), "COM10");
eq("sanitize: CONSOLE is not reserved", api.sanitizeTitle("CONSOLE"), "CONSOLE");
eq("sanitize: COM0 is not reserved", api.sanitizeTitle("COM0"), "COM0");
eq("sanitize: capped at 100 characters", api.sanitizeTitle("x".repeat(150)).length, 100);
eq("sanitize: 100 characters exactly is untouched", api.sanitizeTitle("y".repeat(100)).length, 100);
eq("sanitize: spaces exposed by the cap are trimmed", api.sanitizeTitle("a".repeat(99) + " " + "b".repeat(20)), "a".repeat(99));
eq("sanitize: cap counts characters, not UTF-16 units", Array.from(api.sanitizeTitle("😀".repeat(120))).length, 100);

// ----- defaultFileName
const now = new Date(2026, 9, 9, 7, 5, 3).getTime();
eq("name: title gets .txt", api.defaultFileName("Meeting notes", now), "Meeting notes.txt");
eq("name: empty title uses User_Text timestamp", api.defaultFileName("", now), "User_Text_20261009_070503.txt");
eq("name: title that sanitises to empty uses the timestamp", api.defaultFileName("???", now), "User_Text_20261009_070503.txt");
eq("name: existing .md kept", api.defaultFileName("notes.md", now), "notes.md");
eq("name: existing .txt kept, case-insensitive", api.defaultFileName("notes.TXT", now), "notes.TXT");
eq("name: other extension is not removed", api.defaultFileName("report.v2", now), "report.v2.txt");
eq("name: reserved title is made safe", api.defaultFileName("CON", now), "_CON.txt");
eq("name: forbidden characters removed from the default", api.defaultFileName('Q4: plan/draft?', now), "Q4 plandraft.txt");

// ----- stripExtension
eq("ext: .txt removed", api.stripExtension("notes.txt"), "notes");
eq("ext: .md removed", api.stripExtension("notes.md"), "notes");
eq("ext: only the last extension removed", api.stripExtension("a.b.txt"), "a.b");
eq("ext: no extension unchanged", api.stripExtension("notes"), "notes");
eq("ext: a name that is only an extension is kept", api.stripExtension(".txt"), ".txt");
eq("ext: spaces kept", api.stripExtension("my notes.txt"), "my notes");

// ----- checkBeforeWrite (steps 1 and 2)
eq("check: unchanged file -> write", api.checkBeforeWrite({ ok: true, lastModified: 100 }, 100), { action: "write" });
eq("check: newer file -> changed", api.checkBeforeWrite({ ok: true, lastModified: 200 }, 100), { action: "changed" });
eq("check: older file -> changed", api.checkBeforeWrite({ ok: true, lastModified: 50 }, 100), { action: "changed" });
eq("check: unknown baseline -> changed (cannot verify)", api.checkBeforeWrite({ ok: true, lastModified: 100 }, null), { action: "changed" });
eq("check: NotFoundError -> missing", api.checkBeforeWrite({ ok: false, errorName: "NotFoundError" }, 100), { action: "missing" });
eq("check: other error -> unreadable with its name", api.checkBeforeWrite({ ok: false, errorName: "NotAllowedError" }, 100), { action: "unreadable", errorName: "NotAllowedError" });

// ----- classifyWriteError (step 3)
eq("write error: InvalidStateError -> locked", api.classifyWriteError("InvalidStateError"), "locked");
eq("write error: NoModificationAllowedError -> locked", api.classifyWriteError("NoModificationAllowedError"), "locked");
eq("write error: NotFoundError -> missing", api.classifyWriteError("NotFoundError"), "missing");
eq("write error: NotAllowedError -> permission", api.classifyWriteError("NotAllowedError"), "permission");
eq("write error: QuotaExceededError -> error", api.classifyWriteError("QuotaExceededError"), "error");
eq("write error: undefined -> error", api.classifyWriteError(undefined), "error");

// ----- failure messages
for (const k of ["missing", "changed", "locked", "linklost", "error"])
  yes("message " + k + ": names the file and says the text is safe", /"a.txt"/.test(api.failureMessage(k, "a.txt", "x")) && /text is safe/.test(api.failureMessage(k, "a.txt", "x")), api.failureMessage(k, "a.txt", "x"));
yes("message changed: says saving would overwrite", /overwrite/.test(api.failureMessage("changed", "a.txt")));
yes("message permission: asks for permission", /permission/.test(api.failureMessage("permission", "a.txt")));
yes("message samefile: names the other container", /"Plan B"/.test(api.failureMessage("samefile", "a.txt", "Plan B")));
yes("message error: includes the detail", /boom/.test(api.failureMessage("error", "a.txt", "boom")));

// ----- normalizeCard (cards saved by Phase 1 gain the new fields)
const old = { id: "x", title: "T", text: "body", createdAt: 1, lastEdited: 2, savedText: null, pinned: false, collapsed: false };
const n = api.normalizeCard(old);
eq("normalize: Phase 1 card gains locked/fileName/lastModified/savedAt", [n.locked, n.fileName, n.lastModified, n.savedAt], [false, null, null, null]);
eq("normalize: existing values kept", [n.id, n.title, n.text, n.createdAt, n.lastEdited], ["x", "T", "body", 1, 2]);
eq("normalize: stored values win over defaults", api.normalizeCard({ id: "y", locked: true, fileName: "f.txt", lastModified: 5 }).fileName, "f.txt");
eq("normalize: does not modify its input", Object.keys(old).length, 8);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
