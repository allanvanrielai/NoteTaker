// Phase 1 browser tests: drives real Chrome over the DevTools protocol against a THROWAWAY origin
// (http://127.0.0.1:47614, fresh profile), so the production origin's data is never touched.
// Run: node Testing/phase1-browser.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(here, "..", "app");
const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HTTP_PORT = 47614, DEBUG_PORT = 9333;
const ORIGIN = "http://127.0.0.1:" + HTTP_PORT + "/";
const profile = mkdtempSync(join(tmpdir(), "nt-profile-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond || detail === undefined ? "" : "   -> " + JSON.stringify(detail)));
}

// ---------- processes ----------
const server = spawn("python", ["-m", "http.server", String(HTTP_PORT), "--bind", "127.0.0.1", "--directory", APP_DIR], { stdio: "ignore" });
const chrome = spawn(CHROME, [
  "--headless=new", "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + profile,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1200,900", "about:blank"
], { stdio: "ignore" });

async function cleanup() {
  try { chrome.kill(); } catch {}
  try { server.kill(); } catch {}
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

async function waitFor(fn, ms = 10000, step = 150) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch {} await sleep(step); }
  return last;
}

// ---------- minimal CDP client ----------
class Tab {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener("message", (m) => { const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) { const { res, rej } = this.pending.get(d.id); this.pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
      else if (d.method) this.events.push(d); }); }
  static async open(url) {
    const t = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/new?" + encodeURIComponent(url), { method: "PUT" })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
    const tab = new Tab(ws); tab.targetId = t.id;
    await tab.send("Runtime.enable"); await tab.send("Page.enable");
    return tab;
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("eval error: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async click(x, y) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await this.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); }
  async type(text) { await this.send("Input.insertText", { text }); }
  async reload() { await this.send("Page.reload", { ignoreCache: true }); await sleep(300); await this.ready(); }
  async goto(url) { await this.send("Page.navigate", { url }); await sleep(300); await this.ready(); }
  async ready() { await waitFor(async () => (await this.eval("document.readyState")) === "complete" && (await this.eval("!!document.getElementById('backup') && document.getElementById('backup').textContent !== 'Backup: starting…'"))); }
  async close() { try { this.ws.close(); } catch {} try { await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/close/" + this.targetId); } catch {} }
}

// ---------- page helpers (run inside the page) ----------
const cardInfo = `(() => [...document.querySelectorAll('.card')].map(c => ({
  id: c.dataset.id, title: c.querySelector('.title').value, text: c.querySelector('textarea.body').value,
  meta: c.querySelector('.meta').innerText, buttons: [...c.querySelectorAll('.btns button')].map(b => b.textContent + (b.disabled ? '(disabled)' : ''))
})))()`;
const idbDump = `new Promise((res, rej) => { const r = indexedDB.open('notetaker');
  r.onerror = () => rej(r.error);
  r.onsuccess = () => { const db = r.result; const out = {};
    const tx = db.transaction(['cards','handles'], 'readonly');
    const a = tx.objectStore('cards').getAll(); const k = tx.objectStore('handles').getAllKeys();
    tx.oncomplete = () => { out.cards = a.result; out.handleKeys = k.result; db.close(); res(out); }; } })`;

async function focusAndType(tab, selector, text) {
  await tab.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.setSelectionRange && e.setSelectionRange(e.value.length, e.value.length); })()`);
  await tab.type(text);
}

// ================= tests =================
try {
  // Always read the response body: leaving it unread makes Node's fetch crash on larger pages.
  const up = async (url) => { const r = await fetch(url); await r.arrayBuffer(); return r.ok; };
  await waitFor(() => up("http://127.0.0.1:" + DEBUG_PORT + "/json/version"), 15000);
  await waitFor(() => up(ORIGIN), 15000);
  const ver = (await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/version")).json()).Browser;
  console.log("Browser under test: " + ver + "\nTest origin: " + ORIGIN + "\n");

  const tab = await Tab.open(ORIGIN);
  await tab.ready();

  // --- T1 first load
  check("T1 empty state shown on first load", await tab.eval("!document.getElementById('empty').hidden"));
  check("T1 count reads 0 containers", (await tab.eval("document.getElementById('count').textContent")) === "0 containers");
  check("T1 backup indicator up to date", (await tab.eval("document.getElementById('backup').textContent")) === "Backup: up to date");

  // --- T2 new container
  await tab.eval("document.getElementById('newCard').click()");
  let cs = await tab.eval(cardInfo);
  check("T2 New container creates one card", cs.length === 1);
  check("T2 empty state hidden", await tab.eval("document.getElementById('empty').hidden"));
  check("T2 title input is focused", await tab.eval("document.activeElement && document.activeElement.classList.contains('title')"));
  check("T2 all six buttons present and enabled (Save, Save As, Copy, Pin, Collapse, Delete)",
        JSON.stringify(cs[0].buttons) === JSON.stringify(["Save", "Save As", "Copy", "Pin", "Collapse", "Delete"]), cs[0].buttons);
  const firstId = cs[0].id;

  // --- T3 typing, counts, badge
  await focusAndType(tab, ".card .title", "Meeting notes");
  await focusAndType(tab, ".card textarea.body", "alpha beta  gamma\nsecond line");
  cs = await tab.eval(cardInfo);
  check("T3 title typed", cs[0].title === "Meeting notes", cs[0].title);
  check("T3 text typed", cs[0].text === "alpha beta  gamma\nsecond line", cs[0].text);
  check("T3 word count = 5", /\b5 words\b/.test(cs[0].meta), cs[0].meta);
  check("T3 char count = 29 (includes spaces and newline)", /\b29 chars\b/.test(cs[0].meta), cs[0].meta);
  check("T3 'Not saved to a file' badge shown", /Not saved to a file/.test(cs[0].meta), cs[0].meta);
  check("T3 Edited timestamp present (yyyy/mm/dd hh:mm:ss)", /Edited \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/.test(cs[0].meta), cs[0].meta);

  // --- T4 written to IndexedDB within the flush window
  await sleep(700);
  let dump = await tab.eval(idbDump);
  check("T4 IndexedDB holds 1 card", dump.cards.length === 1, dump.cards.length);
  check("T4 IndexedDB text/title match the UI", dump.cards[0].text === "alpha beta  gamma\nsecond line" && dump.cards[0].title === "Meeting notes", dump.cards[0]);
  check("T4 backup indicator back to 'up to date'", (await tab.eval("document.getElementById('backup').textContent")) === "Backup: up to date");

  // --- T5 lastEdited updates on title change and on text change independently of createdAt
  const before = dump.cards[0].lastEdited;
  await sleep(1100);
  await focusAndType(tab, ".card .title", "!");
  await sleep(600);
  dump = await tab.eval(idbDump);
  check("T5 lastEdited advanced after a title change", dump.cards[0].lastEdited > before, [before, dump.cards[0].lastEdited]);
  check("T5 createdAt unchanged", dump.cards[0].createdAt <= before);

  // --- T6 reload restores everything
  await tab.reload();
  cs = await tab.eval(cardInfo);
  check("T6 card restored after reload", cs.length === 1 && cs[0].id === firstId);
  check("T6 title restored", cs[0].title === "Meeting notes!", cs[0].title);
  check("T6 text restored", cs[0].text === "alpha beta  gamma\nsecond line", cs[0].text);
  check("T6 counts recomputed", /\b5 words\b/.test(cs[0].meta) && /\b29 chars\b/.test(cs[0].meta), cs[0].meta);

  // --- T7 ordering: newest created first
  await sleep(10);
  await tab.eval("document.getElementById('newCard').click()");
  await sleep(10);
  await focusAndType(tab, ".card:first-child .title", "Second");
  await tab.eval("document.getElementById('newCard').click()");
  await focusAndType(tab, ".card:first-child .title", "Third");
  cs = await tab.eval(cardInfo);
  check("T7 three cards, newest first", cs.length === 3 && cs[0].title === "Third" && cs[1].title === "Second" && cs[2].title === "Meeting notes!", cs.map((c) => c.title));
  check("T7 count reads 3 containers", (await tab.eval("document.getElementById('count').textContent")) === "3 containers");
  await sleep(600);
  await tab.reload();
  cs = await tab.eval(cardInfo);
  check("T7 order survives reload", cs.map((c) => c.title).join("|") === "Third|Second|Meeting notes!", cs.map((c) => c.title));

  // --- T8 crash backup: leave the page N ms after typing; report which delays survive
  const T8_DELAYS = [0, 50, 150, 300, 600];
  const survived = {};
  for (const d of T8_DELAYS) {
    const marker = " [d" + d + "]";
    await focusAndType(tab, ".card:last-child textarea.body", marker);
    if (d) await sleep(d);
    await tab.goto("about:blank");                       // pagehide fires; flush must land
    await tab.goto(ORIGIN);
    const mnT8 = (await tab.eval(cardInfo)).find((c) => c.title === "Meeting notes!");
    survived[d] = !!(mnT8 && mnT8.text.endsWith(marker));
    if (!survived[d]) {                                  // re-type so later delays are measured independently
      await focusAndType(tab, ".card:last-child textarea.body", marker); await sleep(700);
    }
  }
  console.log("      T8 survival by delay between typing and leaving the page: " + JSON.stringify(survived));
  check("T8 text typed >= 600 ms before leaving the page survives", survived[600] === true, survived);
  check("T8 text typed 0 ms before leaving the page survives (strict)", survived[0] === true, survived);
  const mnNow = (await tab.eval(cardInfo)).find((c) => c.title === "Meeting notes!");
  const expectedText = mnNow.text;

  // --- T9 Copy
  await tab.send("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"], origin: ORIGIN.replace(/\/$/, "") }).catch(() => {});
  await tab.eval("document.querySelector('.card:last-child textarea.body').focus()");
  await tab.eval("document.querySelector('.card:last-child .btn-copy').click()");
  await sleep(300);
  const copiedLabel = await tab.eval("(document.querySelector('.card:last-child .toast')||{}).textContent");
  let clip = null;
  try { clip = await tab.eval("navigator.clipboard.readText()"); } catch (e) { clip = "ERR " + e.message; }
  check("T9 Copy shows a 'Copied' note", copiedLabel === "Copied", copiedLabel);
  const norm = (s) => (s || "").replace(/\r\n/g, "\n");   // Windows adds CRLF when text goes to the clipboard (correct for pasting into other apps)
  check("T9 clipboard holds that card's text (CRLF-normalised)", norm(clip) === expectedText, clip);
  check("T9 clipboard text uses CRLF line endings on Windows", /\r\n/.test(clip), clip);
  // Copy on an empty card
  await tab.eval("document.getElementById('newCard').click()");
  await tab.eval("document.querySelector('.card:first-child .btn-copy').click()");
  const emptyLabel = await tab.eval("(document.querySelector('.card:first-child .toast')||{}).textContent");
  check("T9 Copy on an empty card shows 'Nothing to copy'", emptyLabel === "Nothing to copy", emptyLabel);
  clip = await tab.eval("navigator.clipboard.readText()");
  check("T9 empty-card Copy leaves the clipboard unchanged", norm(clip) === expectedText, clip);

  // --- T9b Copy must not change the layout (the button row must not resize or wrap while the note shows)
  const shape = `(() => { const c = document.querySelector('.card:last-child'); const r = c.getBoundingClientRect();
    const b = [...c.querySelectorAll('.btns button')].map(x => Math.round(x.getBoundingClientRect().top));
    return { h: Math.round(r.height), w: Math.round(r.width), rows: new Set(b).size }; })()`;
  const shapeBefore = await tab.eval(shape);
  await tab.eval("document.querySelector('.card:last-child .btn-copy').click()");
  await sleep(100);
  const shapeDuring = await tab.eval(shape);
  const toastShown = await tab.eval("!!document.querySelector('.card:last-child .toast')");
  check("T9b the Copy note is visible while measuring", toastShown);
  check("T9b card size unchanged while the note is shown", JSON.stringify(shapeBefore) === JSON.stringify(shapeDuring), [shapeBefore, shapeDuring]);
  check("T9b the number of button rows is unchanged while the note shows", shapeDuring.rows === shapeBefore.rows, [shapeBefore, shapeDuring]);

  // --- T9c layout at the user's screen (1920 x 911 viewport, 100% zoom) and the header index
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 911, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const lay = await tab.eval(`(() => { const c = document.querySelector('.card').getBoundingClientRect();
    const sd = document.getElementById('side').getBoundingClientRect(); const ta = document.querySelector('.card textarea.body');
    return { cardW: Math.round(c.width), sideW: Math.round(sd.width), taH: Math.round(ta.getBoundingClientRect().height),
             fs: getComputedStyle(ta).fontSize, left: Math.round(c.left), right: Math.round(document.documentElement.clientWidth - sd.right),
             hscroll: document.documentElement.scrollWidth > innerWidth }; })()`);
  check("T9c container is 1060 px wide at 1920", lay.cardW === 1060, lay);
  check("T9c header column is 528 px wide at 1920", lay.sideW === 528, lay);
  check("T9c text area is 400 px high", lay.taH === 400, lay);
  check("T9c text size is 14 px", lay.fs === "14px", lay);
  check("T9c the pair is centred (left and right margins within 2 px)", Math.abs(lay.left - lay.right) <= 2, lay);
  check("T9c no horizontal scrollbar at 1920", !lay.hscroll, lay);

  const idx = await tab.eval(`[...document.querySelectorAll('#index li')].map(li => ({ id: li.dataset.id, t: li.querySelector('.t').textContent, s: li.querySelector('.s').textContent }))`);
  const cardsNow = await tab.eval(cardInfo);
  check("T9c index has one entry per container, in the same order", idx.length === cardsNow.length && idx.every((x, i) => x.id === cardsNow[i].id), [idx.length, cardsNow.length]);
  check("T9c index shows 'Untitled' for an untitled container", idx[0].t === "Untitled", idx[0]);
  const withText = idx.find((x) => x.t === "Meeting notes!");
  check("T9c index shows word count and a 'no file' mark for a container with text", withText && /\d+ words/.test(withText.s) && /no file/.test(withText.s), withText);
  check("T9c index shows no 'no file' mark for an empty container", !/no file/.test(idx.find((x) => x.t === "Live title" || x.t === "Untitled").s), idx[0]);
  await focusAndType(tab, ".card:first-child .title", "Live title");
  check("T9c typing a title updates the index at once", (await tab.eval("document.querySelector('#index li .t').textContent")) === "Live title");
  await tab.eval("window.scrollTo(0, 0)");
  await tab.eval("[...document.querySelectorAll('#index li')].pop().click()");
  await sleep(1200);
  const jump = await tab.eval(`(() => { const last = [...document.querySelectorAll('.card')].pop().getBoundingClientRect();
    const li = [...document.querySelectorAll('#index li')].pop(); return { top: Math.round(last.top), bottom: Math.round(last.bottom), active: li.classList.contains('active'), y: Math.round(scrollY) }; })()`);
  check("T9c clicking the last header scrolls its container fully into view", jump.top >= 0 && jump.bottom <= 911 && jump.y > 0, jump);
  check("T9c the clicked header is highlighted", jump.active, jump);
  await tab.eval("window.scrollTo(0, 0)"); await sleep(300);
  await tab.eval("document.querySelectorAll('#index li')[1].click()"); await sleep(1200);
  const mid = await tab.eval(`(() => { const lis = [...document.querySelectorAll('#index li')]; const act = lis.filter((l) => l.classList.contains('active'));
    return { activeCount: act.length, activeIsClicked: act[0] === lis[1] }; })()`);
  check("T9c clicking a middle header highlights exactly that one", mid.activeCount === 1 && mid.activeIsClicked, mid);
  await tab.eval("window.scrollTo(0, 0)"); await sleep(300);
  const top0 = await tab.eval("[...document.querySelectorAll('#index li')].findIndex((l) => l.classList.contains('active'))");
  check("T9c after scrolling to the top by hand the first header is highlighted", top0 === 0, top0);
  const sticky = await tab.eval("Math.round(document.getElementById('side').getBoundingClientRect().top)");
  check("T9c header column stays in view while scrolled (sticky)", sticky > 0 && sticky < 120, sticky);
  await tab.eval("window.scrollTo(0, 0)");
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const narrow = await tab.eval(`({ hscroll: document.documentElement.scrollWidth > innerWidth, cardW: Math.round(document.querySelector('.card').getBoundingClientRect().width),
    sideW: Math.round(document.getElementById('side').getBoundingClientRect().width) })`);
  check("T9c at 1366 the layout shrinks to fit (no horizontal scrollbar)", !narrow.hscroll, narrow);
  check("T9c at 1366 both columns are still readable (card >= 700, header >= 240)", narrow.cardW >= 700 && narrow.sideW >= 240, narrow);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 911, deviceScaleFactor: 1, mobile: false });
  await sleep(300);

  // --- T9d clicking inside a container brings the WHOLE container into view (reported from manual testing)
  const geom = `(k) => { const c = document.querySelectorAll('.card')[k]; const r = c.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), abs: Math.round(r.top + scrollY) }; }`;
  const HDRH = await tab.eval("document.querySelector('header').getBoundingClientRect().height");   // the real rendered header height (was a fixed 52, which went stale)
  const vis = (g) => g.top >= HDRH && g.bottom <= 911;
  const pointIn = `(k) => { const t = document.querySelectorAll('.card textarea.body')[k].getBoundingClientRect(); const lo = ${HDRH + 6}, hi = 899;
    const y = Math.max(t.top + 20, lo) <= Math.min(t.bottom - 20, hi) ? Math.round((Math.max(t.top + 20, lo) + Math.min(t.bottom - 20, hi)) / 2) : null; return { x: Math.round(t.left + 200), y }; }`;
  const nCards = (await tab.eval(cardInfo)).length;
  check("T9d setup: at least 4 containers", nCards >= 4, nCards);

  // card 2 cut off at the BOTTOM of the screen
  await tab.eval(`window.scrollTo(0, (${geom})(2).abs - (innerHeight - 220))`); await sleep(500);
  let g = await tab.eval(`(${geom})(2)`);
  check("T9d setup: container is cut off at the bottom before the click", g.bottom > 911 && g.top > HDRH, g);
  let pt = await tab.eval(`(${pointIn})(2)`);
  await tab.click(pt.x, pt.y); await sleep(900);
  g = await tab.eval(`(${geom})(2)`);
  check("T9d clicking a container cut off at the bottom brings all of it into view", vis(g), g);

  // card 2 cut off at the TOP (title and buttons under the header)
  await tab.eval(`window.scrollTo(0, (${geom})(2).abs + 120)`); await sleep(500);
  g = await tab.eval(`(${geom})(2)`);
  check("T9d setup: container is cut off at the top before the click", g.top < HDRH, g);
  pt = await tab.eval(`(${pointIn})(2)`);
  await tab.click(pt.x, pt.y); await sleep(900);
  g = await tab.eval(`(${geom})(2)`);
  check("T9d clicking a container cut off at the top brings all of it into view", vis(g), g);

  // already fully visible: nothing should move
  const y0 = await tab.eval("scrollY");
  pt = await tab.eval(`(${pointIn})(2)`);
  await tab.click(pt.x, pt.y); await sleep(700);
  check("T9d clicking an already visible container does not move the page", (await tab.eval("scrollY")) === y0, [y0, await tab.eval("scrollY")]);

  // keyboard focus (programmatic focus, no pointer) also brings it fully into view
  await tab.eval(`window.scrollTo(0, (${geom})(1).abs - (innerHeight - 220))`); await sleep(500);
  await tab.eval("document.activeElement && document.activeElement.blur(); document.querySelectorAll('.card .title')[1].focus()"); await sleep(900);
  g = await tab.eval(`(${geom})(1)`);
  check("T9d keyboard focus into a cut-off container brings all of it into view", vis(g), g);

  // buttons must not move the page (a moving page can swallow the click)
  await tab.eval(`window.scrollTo(0, (${geom})(3).abs - (innerHeight - 330))`); await sleep(500);
  const yb = await tab.eval("scrollY");
  const btn = await tab.eval(`(() => { const b = document.querySelectorAll('.card')[3].querySelector('.btn-copy').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
  await tab.click(btn.x, btn.y); await sleep(700);
  check("T9d clicking a button does not move the page", (await tab.eval("scrollY")) === yb, [yb, await tab.eval("scrollY")]);
  await tab.eval("window.scrollTo(0, 0)"); await sleep(300);

  // --- T10 second tab warns
  const tab2 = await Tab.open(ORIGIN);
  await tab2.ready();
  await sleep(500);
  check("T10 a second tab shows the 'already open' warning", await tab2.eval("!!document.querySelector('.banner.warn')"));
  check("T10 the first tab shows no warning", !(await tab.eval("!!document.querySelector('.banner.warn')")));
  await tab2.close();

  // --- T11 delete: cancel keeps, confirm removes everything
  await sleep(600);
  const countBefore = (await tab.eval(cardInfo)).length;
  await tab.eval("window.confirm = () => false; document.querySelector('.card:last-child .btn-delete').click()");
  await sleep(300);
  check("T11 Delete + Cancel keeps the card", (await tab.eval(cardInfo)).length === countBefore);
  let confirmMsg = "";
  await tab.eval("window.__msg = null; window.confirm = (m) => { window.__msg = m; return true; }; document.querySelector('.card:last-child .btn-delete').click()");
  await sleep(500);
  confirmMsg = await tab.eval("window.__msg");
  check("T11 confirm text says the file on disk is untouched", /No file on disk is touched/.test(confirmMsg), confirmMsg);
  check("T11 confirm text warns about unsaved text", /not been saved to a file/.test(confirmMsg), confirmMsg);
  check("T11 Delete + OK removes the card from the page", (await tab.eval(cardInfo)).length === countBefore - 1);
  check("T11 the header index entry is removed too", (await tab.eval("document.querySelectorAll('#index li').length")) === countBefore - 1);
  dump = await tab.eval(idbDump);
  check("T11 card removed from IndexedDB", dump.cards.length === countBefore - 1 && !dump.cards.some((c) => c.title === "Meeting notes!"), dump.cards.map((c) => c.title));
  check("T11 handles store has no leftover entry for the deleted card", !dump.handleKeys.includes(firstId), dump.handleKeys);
  await tab.reload();
  check("T11 deleted card does not come back after reload", !(await tab.eval(cardInfo)).some((c) => c.title === "Meeting notes!"));

  // --- T12 storage failure is surfaced, not silent
  await tab.eval("document.querySelector('.card .title').focus()");
  const fakeFail = await tab.eval(`(async () => {
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new Error('simulated storage failure'); };
    const t = document.querySelector('.card .title'); t.focus();
    return true;
  })()`);
  await tab.type("x");
  await sleep(700);
  const bk = await tab.eval("document.getElementById('backup').textContent");
  check("T12 a failing backup is shown loudly", /BACKUP FAILED/.test(bk), bk);

  await tab.close();
} catch (e) {
  fail++; console.log("FAIL  test run aborted: " + e.stack);
} finally {
  await cleanup();
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
