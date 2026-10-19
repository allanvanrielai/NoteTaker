// Does OneDrive sync change a file's lastModified by itself? (That would cause false "changed outside NoteTaker" warnings.)
// Writes 3 small files in a folder inside OneDrive, records their modified time, then polls for changes without touching them.
// Run: node Testing/phase2-onedrive-mtime.mjs <folder> [seconds]
import { mkdirSync, writeFileSync, statSync, rmSync, existsSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2], secs = Number(process.argv[3] || 240);
mkdirSync(dir, { recursive: true });
const names = ["probe-a.txt", "probe-b.txt", "probe-c.txt"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = (n) => { const s = statSync(join(dir, n)); return { m: Math.round(s.mtimeMs), size: s.size, attrs: s.mode }; };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
for (const n of names) writeFileSync(join(dir, n), "probe " + n + " " + "x".repeat(2000));
const base = {}; names.forEach((n) => { base[n] = snap(n); });
log("written; baseline mtimes:", JSON.stringify(Object.fromEntries(names.map((n) => [n, base[n].m]))));
let changes = 0; const start = Date.now(); let editedAt = null;
while ((Date.now() - start) / 1000 < secs) {
  await sleep(3000);
  for (const n of names) {
    const now = snap(n);
    if (now.m !== base[n].m || now.size !== base[n].size) {
      if (n === "probe-c.txt" && editedAt) { log("probe-c.txt changed after our own edit (expected)"); base[n] = now; continue; }
      changes++; log("UNEXPECTED CHANGE in", n, "mtime", base[n].m, "->", now.m, "size", base[n].size, "->", now.size); base[n] = now;
    }
  }
  if (!editedAt && (Date.now() - start) / 1000 > secs / 3) {      // control: our own edit must be visible
    writeFileSync(join(dir, "probe-c.txt"), "edited " + "y".repeat(2000)); editedAt = Date.now(); log("control: edited probe-c.txt ourselves");
    await sleep(500); const s = snap("probe-c.txt");
    log("control edit visible in mtime:", s.m !== base["probe-c.txt"].m); base["probe-c.txt"] = s;
  }
}
log("RESULT: unexpected mtime/size changes on untouched files =", changes, "over", secs, "seconds");
for (const n of names) rmSync(join(dir, n), { force: true });
try { rmSync(dir, { recursive: true, force: true }); } catch {}
