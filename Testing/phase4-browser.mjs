// Phase 4 browser tests: the Open button. Real FileSystemFileHandles from Chrome's private file system; the OS dialog is stubbed.
// Files are written as raw bytes, so BOMs, CRLF, invalid UTF-8 and size limits are exercised for real.
// Throwaway origin http://127.0.0.1:47614, fresh profile, 1920 x 911. Run: node Testing/phase4-browser.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(here, "..", "app");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const HTTP_PORT = 47614, DEBUG_PORT = 9333;
const ORIGIN = "http://127.0.0.1:" + HTTP_PORT + "/";
const profile = mkdtempSync(join(tmpdir(), "nt4-profile-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, detail) { cond ? pass++ : fail++; console.log((cond ? "PASS  " : "FAIL  ") + name + (cond || detail === undefined ? "" : "   -> " + JSON.stringify(detail))); }
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
  async ready() { await waitFor(async () => (await this.eval("document.readyState")) === "complete" && (await this.eval("!!document.getElementById('backup') && document.getElementById('backup').textContent !== 'Backup: starting…'"))); await sleep(500); }
  async reload() { await this.send("Page.reload", { ignoreCache: true }); await sleep(300); await this.ready(); }
  async close() { try { this.ws.close(); } catch {} try { await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/close/" + this.targetId); } catch {} }
}

const HARNESS = `(() => {
  window.__calls = { open: 0, save: 0 }; window.__openOpts = []; window.__openNext = []; window.__saveOpts = [];
  const getDir = () => navigator.storage.getDirectory();
  window.__writeBytes = async (n, arr) => { const d = await getDir(); const h = await d.getFileHandle(n, { create: true }); const w = await h.createWritable(); await w.write(new Uint8Array(arr)); await w.close(); };
  window.__writeBig = async (n, size) => { const d = await getDir(); const h = await d.getFileHandle(n, { create: true }); const w = await h.createWritable(); await w.write(new Uint8Array(size).fill(97)); await w.close(); };
  window.__readBytes = async (n) => { try { const d = await getDir(); return Array.from(new Uint8Array(await (await (await d.getFileHandle(n)).getFile()).arrayBuffer())); } catch (e) { return null; } };
  window.__remove = async (n) => { const d = await getDir(); await d.removeEntry(n); };
  window.showOpenFilePicker = async (opts) => {
    window.__calls.open++;
    window.__openOpts.push({ multiple: opts.multiple, id: opts.id, startIn: typeof opts.startIn === 'string' ? opts.startIn : (opts.startIn && opts.startIn.constructor.name), accept: JSON.stringify(opts.types), excludeAll: opts.excludeAcceptAllOption });
    const n = window.__openNext.shift();
    if (n === 'ABORT') throw new DOMException('cancelled', 'AbortError');
    const d = await getDir(); const out = []; for (const name of n) out.push(await d.getFileHandle(name)); return out;
  };
  window.__saveNext = [];
  window.showSaveFilePicker = async (opts) => {
    window.__calls.save++; window.__saveOpts.push({ suggestedName: opts.suggestedName });
    const d = await getDir(); return await d.getFileHandle(window.__saveNext.shift() || opts.suggestedName, { create: true });
  };
})();`;

let tab;
const ev = (x) => tab.eval(x);
const CARDS = "[...document.querySelectorAll('.card')]";
const bytesOf = (s, bom) => [...(bom ? [0xEF, 0xBB, 0xBF] : []), ...Buffer.from(s, "utf8")];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const put = (name, arr) => ev(`window.__writeBytes(${JSON.stringify(name)}, ${JSON.stringify(arr)})`);
const read = (name) => ev(`window.__readBytes(${JSON.stringify(name)})`);
const cardsInfo = () => ev(`${CARDS}.map(c => ({ id: c.dataset.id, title: c.querySelector('.title').value, ro: c.querySelector('.title').readOnly, lock: !c.querySelector('.lock').hidden,
  text: c.querySelector('textarea.body').value, meta: c.querySelector('.meta').innerText, panel: c.querySelector('.panel') ? { kind: c.querySelector('.panel').dataset.kind, warn: c.querySelector('.panel').classList.contains('warn'), text: c.querySelector('.panel .pmsg').textContent, buttons: [...c.querySelectorAll('.panel button')].map(b => b.textContent) } : null }))`);
const banners = () => ev("[...document.querySelectorAll('.banner')].map(b => ({ kind: b.className, text: b.querySelector('span').textContent }))");
async function openFiles(names) { await ev(`window.__openNext.push(${JSON.stringify(names)})`); await ev("document.getElementById('openBtn').click()"); await sleep(900); }
const clickSave = async (i) => { await ev(`${CARDS}[${i}].querySelector('.btn-save').click()`); await sleep(500); };
const typeInto = async (i, text) => { await ev(`(() => { const t = ${CARDS}[${i}].querySelector('textarea.body'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); })()`); await tab.type(text); await sleep(250); };

try {
  const up = async (url) => { const r = await fetch(url); await r.arrayBuffer(); return r.ok; };
  await waitFor(() => up("http://127.0.0.1:" + DEBUG_PORT + "/json/version"), 15000);
  await waitFor(() => up(ORIGIN), 15000);
  console.log("Browser under test: " + (await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/version")).json()).Browser + "\n");
  tab = await Tab.open("about:blank");
  await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: HARNESS });
  await tab.send("Page.navigate", { url: ORIGIN }); await tab.ready();

  // ===== O1 the button and the dialog options
  check("O1 an Open file button is in the header next to New container", await ev("!!document.getElementById('openBtn') && document.getElementById('openBtn').previousElementSibling.id === 'newCard'"));
  await put("Plan.txt", bytesOf("hello\nworld"));
  await openFiles(["Plan.txt"]);
  const o1 = (await ev("window.__openOpts"))[0];
  check("O1 the dialog allows several files, .txt and .md only, no 'all files'", o1.multiple === true && /\.txt/.test(o1.accept) && /\.md/.test(o1.accept) && o1.excludeAll === true, o1);
  check("O1 the first dialog starts in Documents and remembers its folder by id", o1.startIn === "documents" && o1.id === "notetaker", o1);

  // ===== O2 a plain file opens as a linked, locked, clean container
  let cs = await cardsInfo();
  check("O2 one container was created, at the top", cs.length === 1 && cs[0].title === "Plan", cs.map((c) => c.title));
  check("O2 title is the file name without extension and is locked", cs[0].ro && cs[0].lock);
  check("O2 text is the file's content", cs[0].text === "hello\nworld", cs[0].text);
  check("O2 it is NOT marked unsaved or 'not saved to a file'", !/Not saved|Unsaved/.test(cs[0].meta), cs[0].meta);
  check("O2 no failure panel", cs[0].panel === null);
  check("O2 the header column shows it with the lock", /\uD83D\uDD12 Plan/.test(await ev("document.querySelector('#index li .t').textContent")));

  // ===== O3 edit and Save: silent, no dialog, no false 'changed' alarm
  await typeInto(0, "!");
  check("O3 editing an opened container shows 'Unsaved changes'", /Unsaved changes/.test((await cardsInfo())[0].meta));
  await clickSave(0);
  cs = await cardsInfo();
  check("O3 Save goes straight to the file: no dialog", (await ev("window.__calls.save")) === 0);
  check("O3 no 'changed outside' alarm after opening then saving", cs[0].panel === null, cs[0].panel);
  check("O3 the file holds the new text, byte for byte", same(await read("Plan.txt"), bytesOf("hello\nworld!")), await read("Plan.txt"));

  // ===== O4 a BOM + CRLF file keeps both when saved
  await put("Windows.txt", bytesOf("a\r\nb\r\n", true));
  await openFiles(["Windows.txt"]);
  cs = await cardsInfo();
  check("O4 CRLF text is shown with ordinary line breaks (no stray characters)", cs[0].title === "Windows" && cs[0].text === "a\nb\n", cs[0].text);
  check("O4 no warning for a consistent file", cs[0].panel === null);
  await clickSave(0);
  check("O4 saving WITHOUT editing gives back exactly the same bytes (BOM and CRLF kept)", same(await read("Windows.txt"), bytesOf("a\r\nb\r\n", true)), await read("Windows.txt"));
  await typeInto(0, "c\nd");
  await clickSave(0);
  check("O4 after editing, new lines are written as CRLF and the BOM is kept", same(await read("Windows.txt"), bytesOf("a\r\nb\r\nc\r\nd", true)), await read("Windows.txt"));

  // ===== O5 Unix file stays Unix, no BOM added
  await put("Unix.md", bytesOf("# Title\n\nbody\n"));
  await openFiles(["Unix.md"]);
  await clickSave(0);
  check("O5 an LF file with no BOM is rewritten exactly (no BOM, no CRLF added)", same(await read("Unix.md"), bytesOf("# Title\n\nbody\n")), await read("Unix.md"));
  check("O5 a .md file opens like any other (title without extension)", (await cardsInfo())[0].title === "Unix");

  // ===== O6 mixed / unusual line endings: opened, flagged, made consistent on save
  await put("Mixed.txt", bytesOf("a\r\nb\nc\r\n"));
  await openFiles(["Mixed.txt"]);
  cs = await cardsInfo();
  check("O6 a mixed file opens with a yellow warning that says what will happen", cs[0].panel && cs[0].panel.kind === "eolmixed" && cs[0].panel.warn && /CRLF/.test(cs[0].panel.text) && cs[0].panel.buttons.join() === "Dismiss", cs[0].panel);
  check("O6 its text uses ordinary line breaks", cs[0].text === "a\nb\nc\n", cs[0].text);
  await clickSave(0);
  check("O6 saving makes every line ending the majority style (CRLF)", same(await read("Mixed.txt"), bytesOf("a\r\nb\r\nc\r\n")), await read("Mixed.txt"));
  await put("OldMac.txt", bytesOf("a\rb\rc"));
  await openFiles(["OldMac.txt"]);
  cs = await cardsInfo();
  check("O6 a file with old-style (lone CR) line endings opens with the warning and normal line breaks", cs[0].panel && cs[0].panel.kind === "eolmixed" && cs[0].text === "a\nb\nc", [cs[0].panel, cs[0].text]);

  // ===== O7 files that are not UTF-8 text are refused, and left untouched
  const latin1 = [0x48, 0xE9, 0x6C, 0x6C, 0x6F];                                 // "Héllo" in Latin-1
  await put("Latin1.txt", latin1);
  await put("Utf16.txt", [0xFF, 0xFE, 0x68, 0x00, 0x69, 0x00]);
  const before7 = (await cardsInfo()).length;
  await openFiles(["Latin1.txt"]);
  let bn = await banners();
  check("O7 a Latin-1 file is refused with a message naming the file and the reason", (await cardsInfo()).length === before7 && bn.length === 1 && /"Latin1.txt" is not UTF-8 text/.test(bn[0].text) && /warn/.test(bn[0].kind), [bn, (await cardsInfo()).length]);
  check("O7 the refused file is untouched", same(await read("Latin1.txt"), latin1));
  await ev("document.querySelector('.banner .bx').click()"); await sleep(150);
  check("O7 the message has a Dismiss button that removes it", (await banners()).length === 0);
  await openFiles(["Utf16.txt"]);
  check("O7 a UTF-16 file is refused too", (await cardsInfo()).length === before7 && /not UTF-8/.test((await banners())[0].text));
  await ev("document.querySelector('.banner .bx').click()");

  // ===== O8 too big
  await ev("window.__writeBig('Big.txt', 10 * 1024 * 1024 + 1)");
  await openFiles(["Big.txt"]);
  bn = await banners();
  check("O8 a file over 10 MB is refused with its size", (await cardsInfo()).length === before7 && bn.length === 1 && /"Big.txt" is 10\.0 MB, over the 10 MB limit/.test(bn[0].text), bn);
  await ev("document.querySelector('.banner .bx').click()");
  await ev("window.__remove('Big.txt')");

  // ===== O9 empty file; unicode round trip
  await put("Empty.txt", []);
  await openFiles(["Empty.txt"]);
  cs = await cardsInfo();
  check("O9 an empty file opens as an empty, linked container with no unsaved mark", cs[0].title === "Empty" && cs[0].text === "" && !/Not saved|Unsaved/.test(cs[0].meta) && cs[0].panel === null, cs[0]);
  await clickSave(0);
  check("O9 saving the empty container leaves an empty file", same(await read("Empty.txt"), []));
  const uni = bytesOf("Café 日本語 😀\r\nnaïve – “quotes”\r\n", true);
  await put("Unicode.txt", uni);
  await openFiles(["Unicode.txt"]);
  check("O9 accents, CJK and emoji display correctly", (await cardsInfo())[0].text === "Café 日本語 😀\nnaïve – “quotes”\n");
  await clickSave(0);
  check("O9 and survive a save byte for byte", same(await read("Unicode.txt"), uni));

  // ===== O10 several files at once, one of them bad
  await put("Multi1.txt", bytesOf("one")); await put("Multi2.txt", bytesOf("two")); await put("Multi3.txt", [0xE9]);
  const n10 = (await cardsInfo()).length;
  await openFiles(["Multi1.txt", "Multi2.txt", "Multi3.txt"]);
  cs = await cardsInfo();
  check("O10 two good files open and the bad one is refused", cs.length === n10 + 2 && cs.slice(0, 2).map((c) => c.title).sort().join() === "Multi1,Multi2", cs.slice(0, 3).map((c) => c.title));
  bn = await banners();
  check("O10 one message names only the bad file", bn.length === 1 && /Multi3.txt/.test(bn[0].text) && !/Multi1|Multi2/.test(bn[0].text), bn);
  await ev("document.querySelector('.banner .bx').click()");
  const v10 = await ev(`(() => { const li = document.querySelector('#index li.active'); const c = ${CARDS}.find(x => x.querySelector('.title').value === 'Multi1'); const r = c.getBoundingClientRect(); return { active: li ? li.querySelector('.t').textContent : null, top: Math.round(r.top), bottom: Math.round(r.bottom), y: Math.round(scrollY) }; })()`);
  check("O10 the first opened container is scrolled into view and highlighted", v10.active && v10.active.includes("Multi1") && v10.top >= 0 && v10.bottom <= 911, v10);

  // ===== O11 opening a file that is already open does not make a second container
  const n11 = (await cardsInfo()).length;
  await openFiles(["Plan.txt"]);
  check("O11 opening an already open file creates no new container", (await cardsInfo()).length === n11);
  check("O11 a note says it is already open", /Already open/.test(await ev("(document.querySelector('#openBtn').parentElement.querySelector('.toast') || {}).textContent || ''")));
  const v11 = await ev(`(() => { const li = document.querySelector('#index li.active'); const c = ${CARDS}.find(x => x.querySelector('.title').value === 'Plan'); const r = c.getBoundingClientRect(); return { active: li ? li.querySelector('.t').textContent : null, top: Math.round(r.top), bottom: Math.round(r.bottom), y: Math.round(scrollY), max: document.documentElement.scrollHeight - innerHeight, lockId: lockId, lockY: lockY, planId: c.dataset.id, scrolled: lockScrolled }; })()`);
  check("O11 and that container is brought into view and highlighted", v11.active && v11.active.includes("Plan") && v11.top >= 0 && v11.bottom <= 911 + 400, v11);
  await put("Fresh.txt", bytesOf("made by Save As"));
  await ev("document.getElementById('newCard').click()"); await sleep(300);
  await typeInto(0, "temp"); await ev("window.__saveNext.push('Linked.txt')"); await clickSave(0);
  const n11b = (await cardsInfo()).length;
  await openFiles(["Linked.txt"]);
  check("O11 a file linked by Save As is recognised too (no duplicate)", (await cardsInfo()).length === n11b);

  // header click on a container far down the page: the highlight must follow it once the scroll arrives (was lost mid-scroll before)
  await ev("window.scrollTo(0, 0)"); await sleep(400);
  await ev("[...document.querySelectorAll('#index li')].pop().click()"); await sleep(1500);
  const far = await ev(`(() => { const lis = [...document.querySelectorAll('#index li')]; const act = lis.filter((l) => l.classList.contains('active')); return { count: act.length, isLast: act[0] === lis[lis.length - 1], y: Math.round(scrollY) }; })()`);
  check("O11 clicking the LAST header from the top highlights exactly that one after the long scroll", far.count === 1 && far.isLast && far.y > 1000, far);
  await ev("window.scrollTo(0, 0)"); await sleep(400);

  // ===== O12 cancel
  const n12 = (await cardsInfo()).length;
  await ev("window.__openNext.push('ABORT')"); await ev("document.getElementById('openBtn').click()"); await sleep(500);
  check("O12 cancelling the dialog changes nothing and shows no message", (await cardsInfo()).length === n12 && (await banners()).length === 0);

  // ===== O13 external changes after opening are caught by the existing safety check
  await put("Guard.txt", bytesOf("original"));
  await openFiles(["Guard.txt"]);
  await sleep(60); await put("Guard.txt", bytesOf("changed elsewhere"));
  await typeInto(0, " + mine"); await clickSave(0);
  cs = await cardsInfo();
  check("O13 Save after an outside change shows the 'changed outside NoteTaker' panel", cs[0].panel && cs[0].panel.kind === "changed", cs[0].panel);
  check("O13 and the file is untouched", same(await read("Guard.txt"), bytesOf("changed elsewhere")));
  await ev(`[...${CARDS}[0].querySelectorAll('.panel button')].find(b => b.textContent === 'Overwrite anyway').click()`); await sleep(500);
  check("O13 Overwrite anyway writes the container's text", same(await read("Guard.txt"), bytesOf("original + mine")), await read("Guard.txt"));
  await put("Gone.txt", bytesOf("x")); await openFiles(["Gone.txt"]);
  await ev("window.__remove('Gone.txt')"); await typeInto(0, "y"); await clickSave(0);
  check("O13 Save after the file was deleted shows the 'renamed, moved or deleted' panel and does not re-create it", (await cardsInfo())[0].panel?.kind === "missing" && (await read("Gone.txt")) === null);

  // ===== O14 reload: link, lock, baseline and format survive
  await put("Keep.txt", bytesOf("k1\r\nk2\r\n", true));
  await openFiles(["Keep.txt"]);
  await tab.reload();
  cs = await cardsInfo();
  const k = cs.findIndex((c) => c.title === "Keep");
  check("O14 after a reload the opened container is still there, locked and clean", k >= 0 && cs[k].ro && cs[k].text === "k1\nk2\n" && !/Not saved|Unsaved/.test(cs[k].meta) && cs[k].panel === null, cs[k]);
  await typeInto(k, "k3"); await clickSave(k);
  check("O14 after a reload, Save goes to the file with no dialog and no false alarm", (await ev("window.__calls.save")) === 0 && (await cardsInfo())[k].panel === null);
  check("O14 and the BOM and CRLF are still kept", same(await read("Keep.txt"), bytesOf("k1\r\nk2\r\nk3", true)), await read("Keep.txt"));

  // ===== O15 Save As from an opened CRLF container keeps its format in the new file
  await ev("window.__saveNext.push('Copy of Keep.txt')");
  await ev(`${CARDS}[${k}].querySelector('.btn-saveas').click()`); await sleep(600);
  check("O15 Save As writes the new file in the same style (BOM + CRLF)", same(await read("Copy of Keep.txt"), bytesOf("k1\r\nk2\r\nk3", true)), await read("Copy of Keep.txt"));

  // ===== O16 where the dialogs start, and what Open does to search and order
  await ev("window.__openNext.push('ABORT')"); await ev("document.getElementById('openBtn').click()"); await sleep(400);
  const lastOpts = (await ev("window.__openOpts")).pop();
  check("O16 later dialogs start in the folder of the last file used (stored handle)", lastOpts.startIn === "FileSystemFileHandle" && lastOpts.id === undefined, lastOpts);
  await ev("(() => { const q = document.getElementById('q'); q.value = 'zzzz-nothing'; q.dispatchEvent(new Event('input', { bubbles: true })); })()"); await sleep(250);
  await put("Searchy.txt", bytesOf("visible please"));
  await openFiles(["Searchy.txt"]);
  check("O16 Open clears an active search so the opened container is visible", (await ev("document.getElementById('q').value")) === "" && (await cardsInfo())[0].title === "Searchy" && (await ev(`!${CARDS}[0].hidden`)));
  await ev("document.querySelector('input[name=sort][value=edited]').click()"); await sleep(300);
  await put("Edited.txt", bytesOf("e"));
  await openFiles(["Edited.txt"]);
  check("O16 in 'last edited' order an opened container is at the top too", (await cardsInfo())[0].title === "Edited", (await cardsInfo()).slice(0, 3).map((c) => c.title));
  await ev("document.querySelector('input[name=sort][value=manual]').click()"); await sleep(300);

  // ===== O17 containers stored before Phase 4 still load
  await ev(`new Promise((res) => { const r = indexedDB.open('notetaker'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('cards', 'readwrite');
    tx.objectStore('cards').put({ id: 'old-p3', title: 'Old p3', text: 'a\\nb', createdAt: 5, lastEdited: 5, savedText: null, pinned: false, collapsed: false, locked: false, fileName: null, lastModified: null, savedAt: null, order: 99 });
    tx.oncomplete = () => { db.close(); res(true); }; }; })`);
  await tab.reload();
  const old = (await cardsInfo()).find((c) => c.id === "old-p3");
  check("O17 a container from before Phase 4 loads and can still be saved as a new file (LF, no BOM)", !!old && old.text === "a\nb", old);
  const oi = (await cardsInfo()).findIndex((c) => c.id === "old-p3");
  await ev("window.__saveNext.push('Old p3.txt')"); await clickSave(oi);
  check("O17 the new file is plain LF without a BOM", same(await read("Old p3.txt"), bytesOf("a\nb")), await read("Old p3.txt"));

  await tab.close();
} catch (e) {
  fail++; console.log("FAIL  test run aborted: " + e.stack);
} finally { await cleanup(); }
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
