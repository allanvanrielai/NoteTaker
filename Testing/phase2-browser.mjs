// Phase 2 browser tests. Drives real Chrome against a THROWAWAY origin (http://127.0.0.1:47614, fresh profile).
// Files are real FileSystemFileHandles from Chrome's private file system (same API as disk files), so rename, delete,
// external edits, write failures and permission states can be produced and checked. The real OS file dialog is stubbed:
// it cannot be automated, so it is covered by the manual checklist.
// Run: node Testing/phase2-browser.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(here, "..", "app");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const HTTP_PORT = 47614, DEBUG_PORT = 9333;
const ORIGIN = "http://127.0.0.1:" + HTTP_PORT + "/";
const profile = mkdtempSync(join(tmpdir(), "nt2-profile-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond || detail === undefined ? "" : "   -> " + JSON.stringify(detail)));
}
const server = spawn("python", ["-m", "http.server", String(HTTP_PORT), "--bind", "127.0.0.1", "--directory", APP_DIR], { stdio: "ignore" });
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + profile,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1920,911", "about:blank"], { stdio: "ignore" });
async function cleanup() { try { chrome.kill(); } catch {} try { server.kill(); } catch {} await sleep(800); try { rmSync(profile, { recursive: true, force: true }); } catch {} }
async function waitFor(fn, ms = 10000, step = 150) { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch {} await sleep(step); } return last; }

class Tab {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (m) => { const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) { const { res, rej } = this.pending.get(d.id); this.pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } }); }
  static async open(url) {
    const t = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/new?" + encodeURIComponent(url), { method: "PUT" })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
    const tab = new Tab(ws); tab.targetId = t.id;
    await tab.send("Runtime.enable"); await tab.send("Page.enable");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 911, deviceScaleFactor: 1, mobile: false });
    return tab;
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("eval error: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async type(text) { await this.send("Input.insertText", { text }); }
  async ready() { await waitFor(async () => (await this.eval("document.readyState")) === "complete" && (await this.eval("(document.getElementById('backup')||{}).textContent !== 'Backup: starting…' && !!document.getElementById('backup')"))); await sleep(500); }
  async reload() { await this.send("Page.reload", { ignoreCache: true }); await sleep(300); await this.ready(); }
  async close() { try { this.ws.close(); } catch {} try { await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/close/" + this.targetId); } catch {} }
}

// Installed in every page load: a stub for the file dialog (backed by the private file system) and hooks to make failures.
const HARNESS = `(() => {
  window.__calls = { picker: 0, writable: 0 }; window.__optsInfo = []; window.__next = [];
  const getDir = () => navigator.storage.getDirectory();
  window.__read = async (n) => { try { const d = await getDir(); const f = await (await d.getFileHandle(n)).getFile(); return await f.text(); } catch (e) { return null; } };
  window.__mtime = async (n) => { try { const d = await getDir(); return (await (await d.getFileHandle(n)).getFile()).lastModified; } catch (e) { return null; } };
  window.__write = async (n, t) => { const d = await getDir(); const h = await d.getFileHandle(n, { create: true }); const w = await h.createWritable(); await w.write(t); await w.close(); };
  window.__remove = async (n) => { const d = await getDir(); await d.removeEntry(n); };
  window.__rename = async (a, b) => { const t = await window.__read(a); await window.__write(b, t); await window.__remove(a); };
  window.__list = async () => { const d = await getDir(); const out = []; for await (const [k] of d.entries()) out.push(k); return out.sort(); };
  const origCW = FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable = function (...a) {
    window.__calls.writable++;
    if (window.__failWrite) return Promise.reject(new DOMException('simulated lock', window.__failWrite));
    return origCW.apply(this, a);
  };
  const oq = FileSystemFileHandle.prototype.queryPermission, orq = FileSystemFileHandle.prototype.requestPermission;
  const stored = sessionStorage.getItem('perm'); window.__perm = stored ? JSON.parse(stored) : null;
  FileSystemFileHandle.prototype.queryPermission = function (o) { return window.__perm ? Promise.resolve(window.__perm.query) : oq.call(this, o); };
  FileSystemFileHandle.prototype.requestPermission = function (o) { window.__calls.request = (window.__calls.request || 0) + 1; return window.__perm ? Promise.resolve(window.__perm.request) : orq.call(this, o); };
  window.showSaveFilePicker = async (opts) => {
    window.__calls.picker++;
    window.__optsInfo.push({ suggestedName: opts.suggestedName, id: opts.id, startIn: typeof opts.startIn === 'string' ? opts.startIn : (opts.startIn && opts.startIn.constructor.name), accept: JSON.stringify(opts.types) });
    const n = window.__next.shift();
    if (n === 'ABORT') throw new DOMException('cancelled', 'AbortError');
    const d = await getDir();
    return await d.getFileHandle(n || opts.suggestedName, { create: true });
  };
})();`;

const cardsInfo = `(() => [...document.querySelectorAll('.card')].map(c => ({ id: c.dataset.id,
  title: c.querySelector('.title').value, readOnly: c.querySelector('.title').readOnly,
  lockShown: !c.querySelector('.lock').hidden, smallShown: !c.querySelector('.small').hidden,
  text: c.querySelector('textarea.body').value, meta: c.querySelector('.meta').innerText,
  panel: c.querySelector('.panel') ? { kind: c.querySelector('.panel').dataset.kind, text: c.querySelector('.panel .pmsg').textContent,
    buttons: [...c.querySelectorAll('.panel button')].map(b => b.textContent) } : null })))()`;
const idbDump = `new Promise((res, rej) => { const r = indexedDB.open('notetaker'); r.onerror = () => rej(r.error);
  r.onsuccess = () => { const db = r.result; const tx = db.transaction(['cards','handles'], 'readonly');
    const a = tx.objectStore('cards').getAll(); const k = tx.objectStore('handles').getAllKeys();
    tx.oncomplete = () => { db.close(); res({ cards: a.result, handleKeys: k.result }); }; } })`;

let tab;
const ev = (x) => tab.eval(x);
const cardAt = (k) => `document.querySelectorAll('.card')[${k}]`;
const cardsNow = () => ev(cardsInfo);
const clickBtn = async (k, cls) => { await ev(`${cardAt(k)}.querySelector('.${cls}').click()`); await sleep(450); };
const clickPanelBtn = async (k, label) => { await ev(`[...${cardAt(k)}.querySelectorAll('.panel button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`); await sleep(450); };
async function newCard(title, text) {
  await ev("document.getElementById('newCard').click()"); await sleep(150);
  if (title) { await ev(`${cardAt(0)}.querySelector('.title').focus()`); await tab.type(title); }
  if (text) { await ev(`${cardAt(0)}.querySelector('textarea.body').focus()`); await tab.type(text); }
  await sleep(300);
}
// Optional: SHOT_DIR=<folder> saves screenshots of key states so the look can be checked.
async function shot(name) { if (!process.env.SHOT_DIR) return; const r = await tab.send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(process.env.SHOT_DIR, name + ".png"), Buffer.from(r.data, "base64")); }
const resetCalls = () => ev("window.__calls = { picker: 0, writable: 0 }; window.__optsInfo = []; true");

try {
  const up = async (url) => { const r = await fetch(url); await r.arrayBuffer(); return r.ok; };
  await waitFor(() => up("http://127.0.0.1:" + DEBUG_PORT + "/json/version"), 15000);
  await waitFor(() => up(ORIGIN), 15000);
  console.log("Browser under test: " + (await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/version")).json()).Browser + "\n");

  tab = await Tab.open("about:blank");
  await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: HARNESS });
  await tab.send("Page.navigate", { url: ORIGIN }); await tab.ready();

  // ===== S1 first Save on an unbound container = Save As, default name from the sanitised title, then the title locks
  await newCard('My: notes?', "line one\nline two\n");
  let c = (await cardsNow())[0];
  check("S1 before saving: title is editable, small print shown, no lock", !c.readOnly && c.smallShown && !c.lockShown, c);
  check("S1 small print wording", (await ev(`${cardAt(0)}.querySelector('.small').textContent`)) === "Title locks to the file name on first save");
  await clickBtn(0, "btn-save");
  const o1 = (await ev("window.__optsInfo"))[0];
  check("S1 first Save opened the dialog once", (await ev("window.__calls.picker")) === 1);
  check("S1 suggested name is the sanitised title + .txt", o1 && o1.suggestedName === "My notes.txt", o1);
  check("S1 dialog accepts .txt and .md", /\.txt/.test(o1.accept) && /\.md/.test(o1.accept), o1.accept);
  check("S1 first dialog starts in Documents and remembers its folder by id", o1.startIn === "documents" && o1.id === "notetaker", o1);
  check("S1 file content is exactly the text (no title)", (await ev("window.__read('My notes.txt')")) === "line one\nline two\n", await ev("window.__read('My notes.txt')"));
  c = (await cardsNow())[0];
  check("S1 title became the saved file name without extension", c.title === "My notes", c.title);
  check("S1 title is locked: read-only, lock shown, small print hidden", c.readOnly && c.lockShown && !c.smallShown, c);
  check("S1 'Not saved to a file' is gone and 'Saved hh:mm:ss' shown", !/Not saved|Unsaved/.test(c.meta) && /Saved \d\d:\d\d:\d\d/.test(c.meta), c.meta);
  check("S1 header index shows the lock", /\uD83D\uDD12 My notes/.test(await ev("document.querySelector('#index li .t').textContent")));

  await shot("p2-1-locked");
  // ===== S2 locked title cannot be typed over
  await ev(`${cardAt(0)}.querySelector('.title').focus()`); await tab.type("XYZ"); await sleep(200);
  check("S2 typing in a locked title changes nothing", (await cardsNow())[0].title === "My notes");

  // ===== S3 empty title -> User_Text name; cancel changes nothing
  await newCard("", "scratch text");
  await ev("window.__next.push('ABORT')");
  await clickBtn(0, "btn-save");
  c = (await cardsNow())[0];
  check("S3 empty title suggests User_Text_yyyymmdd_hhmmss.txt", /^User_Text_\d{8}_\d{6}\.txt$/.test((await ev("window.__optsInfo"))[1].suggestedName), await ev("window.__optsInfo"));
  check("S3 cancelling leaves the title editable and unlocked", !c.readOnly && !c.lockShown && c.smallShown, c);
  check("S3 cancelling shows no panel and creates no file", c.panel === null && !(await ev("window.__list()")).some((n) => n.startsWith("User_Text")), [c.panel, await ev("window.__list()")]);
  check("S3 text is still there and still unsaved", c.text === "scratch text" && /Not saved to a file/.test(c.meta), c.meta);
  await ev("window.__next.length = 0");

  // ===== S4 later Saves on a bound container are silent and never raise a false alarm
  await resetCalls();
  await ev(`${cardAt(1)}.querySelector('textarea.body').focus()`); await tab.type("added line\n"); await sleep(200);
  check("S4 editing a saved container shows 'Unsaved changes'", /Unsaved changes/.test((await cardsNow())[1].meta));
  for (let i = 0; i < 4; i++) { await clickBtn(1, "btn-save"); }
  check("S4 four Saves in a row: no dialog", (await ev("window.__calls.picker")) === 0);
  check("S4 four Saves in a row: no panel (no false 'changed' alarm)", (await cardsNow())[1].panel === null, (await cardsNow())[1].panel);
  check("S4 the file holds the new text", (await ev("window.__read('My notes.txt')")) === "line one\nline two\nadded line\n");
  check("S4 'Unsaved changes' cleared", !/Unsaved/.test((await cardsNow())[1].meta));

  // ===== S5 two quick clicks on Save: only one write
  await ev(`${cardAt(1)}.querySelector('textarea.body').focus()`); await tab.type("x"); await sleep(200);
  await resetCalls();
  await ev(`(() => { const b = ${cardAt(1)}.querySelector('.btn-save'); b.click(); b.click(); })()`); await sleep(700);
  check("S5 a double click writes once", (await ev("window.__calls.writable")) === 1, await ev("window.__calls"));

  // ===== S6 Save As on a bound container: new file, title adopts the new name, old file untouched
  const oldText = await ev("window.__read('My notes.txt')");
  await ev("window.__next.push('Renamed copy.md')");
  await clickBtn(1, "btn-saveas");
  c = (await cardsNow())[1];
  check("S6 Save As rebinds: title adopts the new name without extension", c.title === "Renamed copy", c.title);
  check("S6 new file holds the text", (await ev("window.__read('Renamed copy.md')")) === c.text);
  check("S6 the old file is left as it was", (await ev("window.__read('My notes.txt')")) === oldText);
  await ev(`${cardAt(1)}.querySelector('textarea.body').focus()`); await tab.type("more"); await sleep(200);
  await clickBtn(1, "btn-save");
  check("S6 later Saves go to the new file only", (await ev("window.__read('Renamed copy.md')")).endsWith("more") && (await ev("window.__read('My notes.txt')")) === oldText);

  // ===== S7 external edit: Save must refuse; text and file both survive; Overwrite anyway works
  await sleep(60);
  await ev("window.__write('Renamed copy.md', 'EDITED ELSEWHERE')");
  await ev(`${cardAt(1)}.querySelector('textarea.body').focus()`); await tab.type("!"); await sleep(200);
  await clickBtn(1, "btn-save");
  c = (await cardsNow())[1];
  check("S7 Save refuses after an external edit and says why", c.panel && c.panel.kind === "changed" && /changed outside NoteTaker/.test(c.panel.text), c.panel);
  check("S7 panel offers Save As new file / Overwrite anyway / Dismiss", JSON.stringify(c.panel.buttons) === JSON.stringify(["Save As new file", "Overwrite anyway", "Dismiss"]), c.panel.buttons);
  check("S7 the externally edited file is untouched", (await ev("window.__read('Renamed copy.md')")) === "EDITED ELSEWHERE");
  check("S7 the container's text is untouched and still unsaved", /more!$/.test(c.text) && /Unsaved changes/.test(c.meta), c.text);
  await shot("p2-2-changed-panel");
  await clickPanelBtn(1, "Overwrite anyway");
  c = (await cardsNow())[1];
  check("S7 Overwrite anyway writes the container's text and clears the panel", c.panel === null && (await ev("window.__read('Renamed copy.md')")) === c.text);
  await clickBtn(1, "btn-save");
  check("S7 the next ordinary Save works again", (await cardsNow())[1].panel === null);

  // ===== S8 external edit -> Save As new file from the panel
  await sleep(60); await ev("window.__write('Renamed copy.md', 'EDITED AGAIN')");
  await ev(`${cardAt(1)}.querySelector('textarea.body').focus()`); await tab.type("?"); await sleep(200);
  await clickBtn(1, "btn-save");
  await ev("window.__next.push('Safe copy.txt')");
  await clickPanelBtn(1, "Save As new file");
  c = (await cardsNow())[1];
  check("S8 Save As new file from the panel links the new file and clears the panel", c.title === "Safe copy" && c.panel === null, [c.title, c.panel]);
  check("S8 the externally edited file is still untouched", (await ev("window.__read('Renamed copy.md')")) === "EDITED AGAIN");
  check("S8 the new file holds the container's text", (await ev("window.__read('Safe copy.txt')")) === c.text);

  // ===== S9 file deleted: Save must not silently re-create it
  await ev("window.__remove('Safe copy.txt')");
  await ev(`${cardAt(1)}.querySelector('textarea.body').focus()`); await tab.type("#"); await sleep(200);
  await clickBtn(1, "btn-save");
  c = (await cardsNow())[1];
  check("S9 Save after delete shows 'renamed, moved or deleted'", c.panel && c.panel.kind === "missing", c.panel);
  check("S9 panel offers Save As new file / Re-create file here / Dismiss", JSON.stringify(c.panel.buttons) === JSON.stringify(["Save As new file", "Re-create file here", "Dismiss"]), c.panel.buttons);
  check("S9 the file was NOT re-created", (await ev("window.__read('Safe copy.txt')")) === null);
  check("S9 the text is safe in the container", /#$/.test(c.text));
  await clickPanelBtn(1, "Re-create file here");
  check("S9 Re-create file here writes the file again", (await ev("window.__read('Safe copy.txt')")) === (await cardsNow())[1].text && (await cardsNow())[1].panel === null);

  // ===== S10 file renamed
  await ev("window.__rename('Safe copy.txt', 'Moved away.txt')");
  await ev(`${cardAt(1)}.querySelector('textarea.body').focus()`); await tab.type("$"); await sleep(200);
  await clickBtn(1, "btn-save");
  c = (await cardsNow())[1];
  check("S10 Save after a rename shows the 'missing' panel", c.panel && c.panel.kind === "missing", c.panel);
  check("S10 nothing was written at the old path, the renamed file is untouched", (await ev("window.__read('Safe copy.txt')")) === null && !/\$/.test(await ev("window.__read('Moved away.txt')")));
  await clickPanelBtn(1, "Dismiss");
  check("S10 Dismiss clears the panel", (await cardsNow())[1].panel === null);

  // ===== S11 write failure (file locked / changed while saving): nothing overwritten, text safe, retry works
  await ev("window.__write('Safe copy.txt', 'baseline')");
  await ev("window.__next.push('Locked file.txt')");
  await ev(`${cardAt(1)}.querySelector('.btn-saveas').click()`); await sleep(500);
  const fileBefore = await ev("window.__read('Locked file.txt')");
  await ev(`${cardAt(1)}.querySelector('textarea.body').focus()`); await tab.type("%"); await sleep(200);
  await ev("window.__failWrite = 'InvalidStateError'");
  await clickBtn(1, "btn-save");
  c = (await cardsNow())[1];
  check("S11 a failing write shows the 'locked' panel", c.panel && c.panel.kind === "locked" && /could not write/.test(c.panel.text), c.panel);
  check("S11 panel offers Save As new file / Try again / Dismiss", JSON.stringify(c.panel.buttons) === JSON.stringify(["Save As new file", "Try again", "Dismiss"]), c.panel.buttons);
  check("S11 the file is untouched and the text is safe", (await ev("window.__read('Locked file.txt')")) === fileBefore && /%$/.test(c.text));
  await ev("window.__failWrite = null");
  await clickPanelBtn(1, "Try again");
  check("S11 Try again succeeds once the problem is gone", (await cardsNow())[1].panel === null && /%$/.test(await ev("window.__read('Locked file.txt')")));

  // ===== S12 permission not granted: ask inside the click; deny -> panel; allow -> works
  await ev(`${cardAt(1)}.querySelector('textarea.body').focus()`); await tab.type("^"); await sleep(200);
  await ev("window.__perm = { query: 'prompt', request: 'denied' }; window.__calls = { picker: 0, writable: 0 }");
  await clickBtn(1, "btn-save");
  c = (await cardsNow())[1];
  check("S12 Save asked for permission (requestPermission was called)", (await ev("window.__calls.request")) >= 1);
  check("S12 permission denied shows the permission panel with Allow saving", c.panel && c.panel.kind === "permission" && c.panel.buttons[0] === "Allow saving", c.panel);
  check("S12 nothing was written", (await ev("window.__calls.writable")) === 0 && !/\^/.test(await ev("window.__read('Locked file.txt')")));
  await shot("p2-3-permission-panel");
  await ev("window.__perm = { query: 'prompt', request: 'granted' }");
  await clickPanelBtn(1, "Allow saving");
  check("S12 Allow saving (granted) clears the panel", (await cardsNow())[1].panel === null);
  await ev("window.__perm = null");
  await clickBtn(1, "btn-save");
  check("S12 Save then works", /\^$/.test(await ev("window.__read('Locked file.txt')")));

  // ===== S13 same file linked to two containers: warn on both
  await newCard("Twin A", "alpha");
  await ev("window.__next.push('Shared.txt')"); await clickBtn(0, "btn-save");
  await newCard("Twin B", "beta");
  await ev("window.__next.push('Shared.txt')"); await clickBtn(0, "btn-save");
  let all = await cardsNow();
  const twins = all.filter((x) => x.panel && x.panel.kind === "samefile");
  check("S13 both containers linked to the same file show a warning", twins.length === 2, all.map((x) => [x.title, x.panel && x.panel.kind]));
  check("S13 each warning names the other container", twins.some((x) => /"Shared"/.test(x.panel.text)) || twins.every((x) => /container "/.test(x.panel.text)), twins.map((x) => x.panel.text));
  for (let i = 0; i < 2; i++) { const k = (await cardsNow()).findIndex((x) => x.panel && x.panel.kind === "samefile"); if (k >= 0) await clickPanelBtn(k, "Dismiss"); }

  // ===== S14 reload: links, locks and baselines survive; Save works with no dialog and no false alarm
  await sleep(300);
  const before = await cardsNow();
  await tab.reload();
  all = await cardsNow();
  check("S14 after reload: same containers, titles stay locked", all.length === before.length && all.filter((x) => x.readOnly).length === before.filter((x) => x.readOnly).length, all.map((x) => [x.title, x.readOnly]));
  check("S14 after reload: no panels (permission still granted)", all.every((x) => x.panel === null), all.map((x) => x.panel));
  const k14 = all.findIndex((x) => x.title === "Locked file");
  await resetCalls();
  await ev(`${cardAt(k14)}.querySelector('textarea.body').focus()`); await tab.type("&"); await sleep(250);
  await clickBtn(k14, "btn-save");
  check("S14 after reload: Save goes straight to the file (no dialog)", (await ev("window.__calls.picker")) === 0);
  check("S14 after reload: no false 'changed' alarm (baseline survived)", (await cardsNow())[k14].panel === null, (await cardsNow())[k14].panel);
  check("S14 after reload: file updated", /&$/.test(await ev("window.__read('Locked file.txt')")));
  await ev("window.__next.push('Another.txt')");
  await newCard("After reload", "x");
  await clickBtn(0, "btn-save");
  const o14 = (await ev("window.__optsInfo"))[0];
  check("S14 Save As after reload starts in the last saved file's folder (stored handle as startIn, no id)", o14.startIn === "FileSystemFileHandle" && o14.id === undefined, o14);

  // ===== S15 reload with permission needing a click (as after a browser restart on file://)
  await ev("sessionStorage.setItem('perm', JSON.stringify({ query: 'prompt', request: 'granted' }))");
  await tab.reload();
  all = await cardsNow();
  const bound = all.filter((x) => x.readOnly);
  check("S15 every linked container shows 'needs permission' with Allow saving", bound.length > 0 && bound.every((x) => x.panel && x.panel.kind === "permission" && x.panel.buttons.includes("Allow saving")), bound.map((x) => [x.title, x.panel && x.panel.kind]));
  check("S15 unlinked containers show no panel", all.filter((x) => !x.readOnly).every((x) => x.panel === null));
  const k15 = all.findIndex((x) => x.panel);
  await clickPanelBtn(k15, "Allow saving");
  check("S15 clicking Allow saving clears that container's panel", (await cardsNow())[k15].panel === null);
  await ev("sessionStorage.removeItem('perm')"); await tab.reload();

  // ===== S16 link lost (handle missing from storage)
  const lost = (await cardsNow()).findIndex((x) => x.title === "Locked file");
  const lostId = (await cardsNow())[lost].id;
  await ev(`new Promise((res) => { const r = indexedDB.open('notetaker'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('handles', 'readwrite'); tx.objectStore('handles').delete(${JSON.stringify(lostId)}); tx.oncomplete = () => { db.close(); res(true); }; }; })`);
  await tab.reload();
  c = (await cardsNow()).find((x) => x.id === lostId);
  check("S16 a lost link is reported with the text kept", c.panel && c.panel.kind === "linklost" && /Save As/.test(c.panel.text) && c.text.length > 0, c.panel);
  await resetCalls(); await ev("window.__next.push('Relinked.txt')");
  await clickBtn((await cardsNow()).findIndex((x) => x.id === lostId), "btn-save");
  check("S16 Save on a container with a lost link opens the dialog", (await ev("window.__calls.picker")) === 1 && (await ev("window.__read('Relinked.txt')")) !== null);

  // ===== S17 a failed write right after the dialog keeps the link and does not cause a false alarm later
  await newCard("Late failure", "keep me");
  await ev("window.__next.push('Late.txt'); window.__failWrite = 'InvalidStateError'");
  await clickBtn(0, "btn-save");
  c = (await cardsNow())[0];
  check("S17 write failure after the dialog: panel shown, title locked, text kept", c.panel && c.panel.kind === "locked" && c.readOnly && c.text === "keep me", c);
  await ev("window.__failWrite = null"); await clickBtn(0, "btn-save");
  c = (await cardsNow())[0];
  check("S17 next Save succeeds with no 'changed' alarm", c.panel === null && (await ev("window.__read('Late.txt')")) === "keep me", c.panel);

  // ===== S18 Phase 1 data still opens (cards stored before Phase 2 had no file fields)
  await ev(`new Promise((res) => { const r = indexedDB.open('notetaker'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('cards', 'readwrite');
    tx.objectStore('cards').put({ id: 'legacy-1', title: 'Old card', text: 'from phase 1', createdAt: 1, lastEdited: 1, savedText: null, pinned: false, collapsed: false });
    tx.oncomplete = () => { db.close(); res(true); }; }; })`);
  await tab.reload();
  c = (await cardsNow()).find((x) => x.id === "legacy-1");
  check("S18 a Phase 1 container loads, is editable and unlinked", c && !c.readOnly && c.smallShown && c.panel === null && c.text === "from phase 1", c);
  await resetCalls(); await ev("window.__next.push('Legacy.txt')");
  await clickBtn((await cardsNow()).findIndex((x) => x.id === "legacy-1"), "btn-save");
  check("S18 and it can be saved", (await ev("window.__read('Legacy.txt')")) === "from phase 1");

  // ===== S19 Delete a linked container: link removed from storage, file left alone
  const del = (await cardsNow()).findIndex((x) => x.id === "legacy-1");
  await ev("window.confirm = () => true");
  await clickBtn(del, "btn-delete"); await sleep(300);
  const dump = await ev(idbDump);
  check("S19 deleting removes the container and its stored link", !dump.cards.some((x) => x.id === "legacy-1") && !dump.handleKeys.includes("legacy-1"), dump.handleKeys);
  check("S19 the file on disk is left alone", (await ev("window.__read('Legacy.txt')")) === "from phase 1");
  check("S19 the 'last folder' link is kept", dump.handleKeys.includes("__last"), dump.handleKeys);

  // ===== S20 a large text saves correctly
  await newCard("Big", "");
  const big = "0123456789".repeat(100000);   // 1,000,000 characters
  await ev(`(() => { const t = ${cardAt(0)}.querySelector('textarea.body'); t.value = ${JSON.stringify(big)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  const t0 = Date.now(); await ev("window.__next.push('Big.txt')"); await clickBtn(0, "btn-save"); await sleep(600);
  check("S20 a 1,000,000 character text is saved exactly", (await ev("window.__read('Big.txt')")) === big);
  console.log("      (save of 1,000,000 characters took about " + (Date.now() - t0 - 1050) + " ms including waits)");

  await tab.close();
} catch (e) {
  fail++; console.log("FAIL  test run aborted: " + e.stack);
} finally { await cleanup(); }
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
