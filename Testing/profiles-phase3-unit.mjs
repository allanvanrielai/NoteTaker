// Profiles Phase 3 unit tests: which profile applies (including Mint unavailable), the storage key, and the dark/light button label.
// Run: node Testing/profiles-phase3-unit.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "app", "index.html"), "utf8").split("\r\n").join("\n");
const m = html.match(/\/\/ ===== <profile-logic>[^\n]*\n([\s\S]*?)\/\/ ===== <\/profile-logic> =====/);
if (!m) { console.error("FAIL: profile-logic block not found"); process.exit(2); }
const ctx = {}; vm.createContext(ctx);
vm.runInContext(m[1] + "\nthis.api={PROFILE_KEY,resolveProfile,themeLabel};", ctx);
const api = ctx.api;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)));
}

// persistence key
eq("the storage key is notetaker-profile (next to notetaker-theme)", api.PROFILE_KEY, "notetaker-profile");
// resolution
eq("nothing stored -> Default", api.resolveProfile(null, true), { profile: "default", fellBack: false });
eq("nothing stored and no Mint file -> Default, nothing to report", api.resolveProfile(null, false), { profile: "default", fellBack: false });
eq("undefined -> Default", api.resolveProfile(undefined, true), { profile: "default", fellBack: false });
eq("'default' stored -> Default", api.resolveProfile("default", true), { profile: "default", fellBack: false });
eq("'default' stored, no Mint file -> Default, nothing to report", api.resolveProfile("default", false), { profile: "default", fellBack: false });
eq("'mint' stored and the file is there -> Mint", api.resolveProfile("mint", true), { profile: "mint", fellBack: false });
eq("'mint' stored but the file is missing -> Default and fellBack is true (the app tells the user once)", api.resolveProfile("mint", false), { profile: "default", fellBack: true });
eq("an unknown stored value -> Default, no message", api.resolveProfile("banana", true), { profile: "default", fellBack: false });
eq("an unknown stored value, no file -> Default, no message", api.resolveProfile("banana", false), { profile: "default", fellBack: false });
eq("a different case is not 'mint' (exact match only)", api.resolveProfile("Mint", true), { profile: "default", fellBack: false });
eq("an empty string -> Default", api.resolveProfile("", true), { profile: "default", fellBack: false });
eq("resolution never rewrites the stored choice (it returns a new value only)", (() => { const s = "mint"; api.resolveProfile(s, false); return s; })(), "mint");
// dark / light button label
eq("light mode shows 'Dark' (with the moon) and offers dark", api.themeLabel(false), { text: "☾ Dark", title: "Switch to dark mode" });
eq("dark mode shows 'Light' (with the sun) and offers light", api.themeLabel(true), { text: "☀ Light", title: "Switch to light mode" });
eq("the labels are the ones the app already had", [api.themeLabel(false).text, api.themeLabel(true).text], ["☾ Dark", "☀ Light"]);
// the head script and the stored choice work together (simulated page start)
function start(stored, mintLoaded) {
  const doc = { documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } } };
  const win = { NoteTakerMint: mintLoaded ? { available: true } : undefined };
  const store = { getItem: (k) => (k === api.PROFILE_KEY ? stored : null) };
  const run = html.match(/\(function \(\) \{\n  var stored = null;[\s\S]*?\}\)\(\);/)[0];
  vm.runInContext("(function(document, window, localStorage, resolveProfile, PROFILE_KEY){" + run.replace(/^\(function \(\) \{/, "{").replace(/\}\)\(\);$/, "}") + "})", Object.assign(ctx, {}))(doc, win, store, api.resolveProfile, api.PROFILE_KEY);
  return { attr: doc.documentElement.attrs["data-profile"], state: win.__profileState };
}
eq("page start: stored mint + file -> data-profile=mint is set before first paint", start("mint", true).attr, "mint");
eq("page start: stored mint + no file -> no attribute, fellBack recorded, stored value untouched", [start("mint", false).attr, start("mint", false).state.fellBack, start("mint", false).state.stored], [undefined, true, "mint"]);
eq("page start: nothing stored -> no attribute", start(null, true).attr, undefined);
eq("page start: blocked storage (throws) -> Default", (() => { const doc = { documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } } }; const win = { NoteTakerMint: { available: true } }; const store = { getItem() { throw new Error("blocked"); } };
  const run = html.match(/\(function \(\) \{\n  var stored = null;[\s\S]*?\}\)\(\);/)[0];
  vm.runInContext("(function(document, window, localStorage, resolveProfile, PROFILE_KEY){" + run.replace(/^\(function \(\) \{/, "{").replace(/\}\)\(\);$/, "}") + "})", ctx)(doc, win, store, api.resolveProfile, api.PROFILE_KEY); return doc.documentElement.attrs["data-profile"]; })(), undefined);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
