// Phase 3 unit tests: display order (both modes, pinned first), manual moves, pinning, search matching.
// Run: node Testing/phase3-unit.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "app", "index.html"), "utf8");
const m = html.match(/\/\/ ===== <pure-logic>[\s\S]*?\n([\s\S]*?)\/\/ ===== <\/pure-logic> =====/);
if (!m) { console.error("FAIL: pure-logic block not found"); process.exit(2); }
const ctx = {}; vm.createContext(ctx);
vm.runInContext(m[1] + "\nthis.api={displayOrder,assignMissingOrders,newCardOrder,manualMove,manualMoveBy,pinChange,matchesQuery,normalizeCard,newCard};", ctx);
const api = ctx.api;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)));
}
const mk = (id, o) => Object.assign({ id, title: id, text: "", createdAt: 1, lastEdited: 1, order: 0, pinned: false }, o || {});
const ids = (list) => list.map((c) => c.id);

// ----- displayOrder
const a = mk("a", { order: 2, lastEdited: 30, createdAt: 1 }), b = mk("b", { order: 0, lastEdited: 10, createdAt: 2 }), c = mk("c", { order: 1, lastEdited: 20, createdAt: 3 });
eq("order: manual follows the order field", ids(api.displayOrder([a, b, c], "manual")), ["b", "c", "a"]);
eq("order: edited is newest edit first", ids(api.displayOrder([a, b, c], "edited")), ["a", "c", "b"]);
eq("order: no mode means manual", ids(api.displayOrder([a, b, c])), ["b", "c", "a"]);
eq("order: unknown mode means manual", ids(api.displayOrder([a, b, c], "zzz")), ["b", "c", "a"]);
const pc = Object.assign({}, c, { pinned: true });
eq("order: pinned card first in manual mode", ids(api.displayOrder([a, b, pc], "manual")), ["c", "b", "a"]);
eq("order: pinned card first in edited mode", ids(api.displayOrder([a, Object.assign({}, b, { pinned: true }), c], "edited")), ["b", "a", "c"]);
eq("order: tie in order broken by newest created, then id", ids(api.displayOrder([mk("x", { order: 5, createdAt: 1 }), mk("y", { order: 5, createdAt: 9 }), mk("w", { order: 5, createdAt: 9 })], "manual")), ["w", "y", "x"]);
eq("order: tie in last edited broken by newest created", ids(api.displayOrder([mk("x", { lastEdited: 5, createdAt: 1 }), mk("y", { lastEdited: 5, createdAt: 9 })], "edited")), ["y", "x"]);
api.displayOrder([a, b, c], "manual");
eq("order: input array order unchanged after sorting", ids([a, b, c]), ["a", "b", "c"]);
eq("order: empty list", api.displayOrder([], "manual"), []);

// ----- assignMissingOrders / newCardOrder
const legacy = [mk("o1", { order: null, createdAt: 100 }), mk("o2", { order: undefined, createdAt: 300 }), mk("o3", { order: null, createdAt: 200 })];
api.assignMissingOrders(legacy);
eq("legacy: missing orders give newest created first", ids(api.displayOrder(legacy, "manual")), ["o2", "o3", "o1"]);
const kept = mk("k", { order: 7 }); api.assignMissingOrders([kept]);
eq("legacy: an existing order is kept", kept.order, 7);
eq("legacy: an order of 0 is kept (not treated as missing)", (() => { const z = mk("z", { order: 0 }); api.assignMissingOrders([z]); return z.order; })(), 0);
eq("new card: goes above every existing card", api.newCardOrder([mk("p", { order: 3 }), mk("q", { order: -4 })]), -5);
eq("new card: first card gets 0", api.newCardOrder([]), 0);

// ----- manualMove
const row = () => ["a", "b", "c", "d"].map((id, i) => mk(id, { order: i }));
const seqAfter = (cards, map) => ids(cards.map((x) => Object.assign({}, x, { order: map[x.id] })).sort((p, q) => p.order - q.order));
eq("move: a after c", seqAfter(row(), api.manualMove(row(), "a", "c", true)), ["b", "c", "a", "d"]);
eq("move: d before b", seqAfter(row(), api.manualMove(row(), "d", "b", false)), ["a", "d", "b", "c"]);
eq("move: c to the very end (after d)", seqAfter(row(), api.manualMove(row(), "c", "d", true)), ["a", "b", "d", "c"]);
eq("move: b to the very start (before a)", seqAfter(row(), api.manualMove(row(), "b", "a", false)), ["b", "a", "c", "d"]);
eq("move: to the same place changes nothing", seqAfter(row(), api.manualMove(row(), "b", "c", false)), ["a", "b", "c", "d"]);
eq("move: onto itself is refused", api.manualMove(row(), "b", "b", true), null);
eq("move: unknown card refused", api.manualMove(row(), "zz", "b", true), null);
eq("move: unknown target refused", api.manualMove(row(), "a", "zz", true), null);
const mv = api.manualMove(row(), "a", "d", true);
eq("move: result gives every card a unique whole-number order", [Object.keys(mv).length, new Set(Object.values(mv)).size, Object.values(mv).every(Number.isInteger)], [4, 4, true]);
const dup = ["a", "b", "c"].map((id) => mk(id, { order: 5, createdAt: { a: 3, b: 2, c: 1 }[id] }));
eq("move: works even when orders were all equal", seqAfter(dup, api.manualMove(dup, "c", "a", false)), ["c", "a", "b"]);

// ----- manualMoveBy
const up1 = api.manualMoveBy(row(), "c", -1);
eq("moveBy: up one", seqAfter(row(), up1), ["a", "c", "b", "d"]);
eq("moveBy: down one", seqAfter(row(), api.manualMoveBy(row(), "b", 1)), ["a", "c", "b", "d"]);
eq("moveBy: first cannot go up", api.manualMoveBy(row(), "a", -1), null);
eq("moveBy: last cannot go down", api.manualMoveBy(row(), "d", 1), null);
eq("moveBy: unknown card", api.manualMoveBy(row(), "zz", 1), null);
const withPin = row(); withPin[1].pinned = true;   // b pinned: shown first, not part of the movable sequence
eq("moveBy: a pinned card cannot move", api.manualMoveBy(withPin, "b", 1), null);
eq("moveBy: moving past a pinned card swaps with the next unpinned card", seqAfter(withPin, api.manualMoveBy(withPin, "c", -1)), ["c", "a", "b", "d"]);
eq("moveBy: the first unpinned card cannot go up (the pinned card is not a neighbour)", api.manualMoveBy(withPin, "a", -1), null);

// ----- pinChange
const three = ["a", "b", "c"].map((id) => mk(id));
eq("pin: pinning marks only that card", api.pinChange(three, "b"), { b: true });
const pinnedB = three.map((x) => (x.id === "b" ? Object.assign({}, x, { pinned: true }) : x));
eq("pin: pinning another card unpins the first", api.pinChange(pinnedB, "c"), { b: false, c: true });
eq("pin: pinning the pinned card unpins it", api.pinChange(pinnedB, "b"), { b: false });
eq("pin: unknown card changes nothing", api.pinChange(three, "zz"), {});
const two = three.map((x) => Object.assign({}, x, { pinned: x.id !== "c" }));   // (corrupt) two pinned: pinning a third clears both
eq("pin: clears every other pinned card", api.pinChange(two, "c"), { a: false, b: false, c: true });

// ----- matchesQuery
const q = mk("q", { title: "Alpha Plan", text: "The Zebra crossing is on 5th & Main (north)." });
eq("search: empty matches everything", [api.matchesQuery(q, ""), api.matchesQuery(q, "   ")], [true, true]);
eq("search: title match, case-insensitive", [api.matchesQuery(q, "alpha"), api.matchesQuery(q, "PLAN")], [true, true]);
eq("search: text match, case-insensitive", [api.matchesQuery(q, "zebra"), api.matchesQuery(q, "NORTH")], [true, true]);
eq("search: no match", api.matchesQuery(q, "giraffe"), false);
eq("search: partial words and surrounding spaces", [api.matchesQuery(q, "  zeb "), api.matchesQuery(q, "lpha pla")], [true, true]);
eq("search: characters that mean something in patterns are literal", [api.matchesQuery(q, "(north)"), api.matchesQuery(q, "5th & main"), api.matchesQuery(q, ".*"), api.matchesQuery(q, "[")], [true, true, false, false]);
eq("search: matches across title only or text only", [api.matchesQuery(mk("t", { title: "needle", text: "" }), "needle"), api.matchesQuery(mk("t", { title: "", text: "needle" }), "needle")], [true, true]);
eq("search: unicode, case-insensitive", api.matchesQuery(mk("t", { title: "Café", text: "" }), "CAFÉ"), true);

// ----- normalizeCard still adds order
eq("normalize: order defaults to null (assigned at load)", api.normalizeCard({ id: "x" }).order, null);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
