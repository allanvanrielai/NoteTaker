// Phase 1 unit tests: extracts the <pure-logic> block from app/index.html and tests it.
// Run: node Testing/phase1-unit.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "app", "index.html"), "utf8");
const m = html.match(/\/\/ ===== <pure-logic>[\s\S]*?\n([\s\S]*?)\/\/ ===== <\/pure-logic> =====/);
if (!m) { console.error("FAIL: pure-logic block not found"); process.exit(2); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[1] + "\nthis.api={countWords,countChars,formatStamp,unsavedState,newCard,displayOrder};", ctx);
const api = ctx.api;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)));
}

// word count
eq("words: empty", api.countWords(""), 0);
eq("words: only whitespace", api.countWords("  \n\t "), 0);
eq("words: one", api.countWords("hello"), 1);
eq("words: three with extra spaces/newlines", api.countWords("  one  two\nthree\t"), 3);
eq("words: punctuation attached", api.countWords("it's a well-known fact."), 4);
// char count (includes spaces)
eq("chars: empty", api.countChars(""), 0);
eq("chars: includes spaces", api.countChars("a b"), 3);
eq("chars: newline counts as one", api.countChars("a\nb"), 3);
eq("chars: emoji counts as one character", api.countChars("a😀b"), 3);
// timestamp format (local time)
eq("stamp: format", api.formatStamp(new Date(2026, 9, 9, 7, 5, 3).getTime()), "2026/10/09 07:05:03");
// unsaved state
const c = api.newCard(1000, "x");
eq("unsaved: new empty card", api.unsavedState(c), "");
c.text = "hi";
eq("unsaved: text, never saved", api.unsavedState(c), "never-saved");
c.savedText = "hi";
eq("unsaved: matches saved text", api.unsavedState(c), "");
c.text = "hi!";
eq("unsaved: differs from saved text", api.unsavedState(c), "unsaved");
c.savedText = ""; c.text = "";
eq("unsaved: saved empty, still empty", api.unsavedState(c), "");
// newCard shape
eq("newCard: fields", api.newCard(5, "id1"),
   { id: "id1", title: "", text: "", createdAt: 5, lastEdited: 5, savedText: null, pinned: false, collapsed: false });
// display order: newest created first, stable tie-break by id
const a = api.newCard(1, "a"), b = api.newCard(3, "b"), d = api.newCard(2, "d"), e = api.newCard(3, "e");
eq("order: newest first, ties by id", api.displayOrder([a, d, e, b]).map((x) => x.id), ["b", "e", "d", "a"]);
eq("order: does not mutate input", [a, d, e, b].map((x) => x.id), ["a", "d", "e", "b"]);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
