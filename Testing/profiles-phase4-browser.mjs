// Profiles Phase 4 browser tests: the header height is read from the page (not a constant), in all four looks at 1920 and 1366: ensureVisible leaves a container fully below the header,
// --hdr follows the real height, the list column sticks below it. Throwaway origin http://127.0.0.1:47631. Run: node Testing/profiles-phase4-browser.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(here, "..", "app");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const HTTP_PORT = 47631, DEBUG_PORT = 9351;
const ORIGIN = "http://127.0.0.1:" + HTTP_PORT + "/";
const profile = mkdtempSync(join(tmpdir(), "ntp4-profile-"));
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
  async mouse(type, x, y) { await this.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 }); }
  async key(key, code, vk) { for (const type of ["keyDown", "keyUp"]) await this.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk }); }
  async ready() { await waitFor(async () => (await this.eval("document.readyState")) === "complete" && (await this.eval("!!document.getElementById('backup') && document.getElementById('backup').textContent !== 'Backup: starting…'"))); await sleep(500); }
  async reload() { await this.send("Page.reload", { ignoreCache: true }); await sleep(300); await this.ready(); }
  async close() { try { this.ws.close(); } catch {} try { await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/close/" + this.targetId); } catch {} }
}

const HARNESS = `(() => {
  window.__calls = { picker: 0 };
  const getDir = () => navigator.storage.getDirectory();
  window.__read = async (n) => { try { const d = await getDir(); return await (await (await d.getFileHandle(n)).getFile()).text(); } catch (e) { return null; } };
  window.__remove = async (n) => { const d = await getDir(); await d.removeEntry(n); };
  window.showSaveFilePicker = async (opts) => { window.__calls.picker++; const d = await getDir(); return await d.getFileHandle(opts.suggestedName, { create: true }); };
})();`;


let tab;
const ev = (x) => tab.eval(x);
const CARDS = "[...document.querySelectorAll('.card')]";
async function newCard(title, text) {
  const before = await ev(`${CARDS}.map(c => c.dataset.id)`);
  await ev("document.getElementById('newCard').click()"); await sleep(200);
  const id = (await ev(`${CARDS}.map(c => c.dataset.id)`)).find((x) => !before.includes(x));
  if (title) { await ev(`document.querySelector('.card[data-id="${id}"] .title').focus()`); await tab.type(title); }
  if (text) { await ev(`document.querySelector('.card[data-id="${id}"] textarea.body').focus()`); await tab.type(text); }
  await sleep(250); return id;
}
const viewport = async (w, h) => { await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(350); };
async function look({ profile, theme }) {
  await ev(`(() => { ${profile === "mint" ? "localStorage.setItem('notetaker-profile', 'mint')" : "localStorage.removeItem('notetaker-profile')"}; localStorage.setItem('notetaker-theme', '${theme}'); })()`);
  await tab.reload(); await ev("window.scrollTo(0,0)"); await sleep(300);
}
const HEADER_H = () => ev("document.querySelector('header').getBoundingClientRect().height");
const rows = [];

try {
  const up = async (url) => { const r = await fetch(url); await r.arrayBuffer(); return r.ok; };
  await waitFor(() => up("http://127.0.0.1:" + DEBUG_PORT + "/json/version"), 15000);
  await waitFor(() => up(ORIGIN), 15000);
  tab = await Tab.open(ORIGIN);
  await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: HARNESS });
  await tab.reload();
  await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  const ids = [];
  for (const t of ["One", "Two", "Three", "Four", "Five", "Six"]) ids.push(await newCard(t, "line one of " + t + "\nline two"));
  await ev("document.activeElement && document.activeElement.blur()");

  for (const [profile, theme] of [["default", "light"], ["default", "dark"], ["mint", "light"], ["mint", "dark"]]) for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    await viewport(w, h); await look({ profile, theme });
    const tag = `${profile} ${theme} ${w}x${h}: `, H = await HEADER_H();
    // --hdr is kept equal to the real header height
    check(tag + "--hdr equals the real header height (" + H + " px)", (await ev("getComputedStyle(document.documentElement).getPropertyValue('--hdr').trim()")) === H + "px" && (await ev("headerPx()")) === H, [H, await ev("getComputedStyle(document.documentElement).getPropertyValue('--hdr').trim()")]);
    check(tag + "the header is not clipped and nothing overflows sideways", await ev(`(() => { const h = document.querySelector('header'); return h.scrollHeight <= h.clientHeight + 1 && h.scrollWidth <= h.clientWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth; })()`));
    // ensureVisible: a container whose top is partly under the header is brought fully below it by clicking in it
    const target = ids[3];
    await ev(`(() => { const c = document.querySelector('.card[data-id="${target}"]'); window.scrollBy(0, c.getBoundingClientRect().top - ${H} + 25); })()`); await sleep(600);   // its top is now 25 px UNDER the header
    const before = await ev(`document.querySelector('.card[data-id="${target}"]').getBoundingClientRect().top`);
    const pt = await ev(`(() => { const t = document.querySelector('.card[data-id="${target}"] textarea.body').getBoundingClientRect(); return { x: Math.round(t.left + 300), y: Math.round(Math.max(t.top + 20, ${H} + 10)) }; })()`);
    await tab.mouse("mouseMoved", pt.x, pt.y); await tab.mouse("mousePressed", pt.x, pt.y); await tab.mouse("mouseReleased", pt.x, pt.y); await sleep(1100);
    const after = await ev(`document.querySelector('.card[data-id="${target}"]').getBoundingClientRect().top`);
    check(tag + "set up: the container's top was hidden under the header before the click (top " + Math.round(before) + " < " + H + ")", before < H - 5, [before, H]);
    check(tag + "after ensureVisible the container's top is fully visible below the header (top " + Math.round(after) + " >= " + H + ", the app leaves 12 px)", after >= H && Math.abs(after - (H + 12)) < 2, [after, H]);
    // the list column sticks below the real header
    await ev("window.scrollTo(0, 1200)"); await sleep(500);
    const side = await ev("document.getElementById('side').getBoundingClientRect().top");
    check(tag + "the list column sticks 10 px below the header (" + Math.round(side) + ")", Math.abs(side - (H + 10)) < 1.5, [side, H]);
    // keeping in step: make the header taller and --hdr follows
    await ev("document.querySelector('header').style.minHeight = '140px'"); await sleep(300);
    check(tag + "if the header becomes taller, --hdr follows at once (140 px) and the list column moves down with it", (await ev("getComputedStyle(document.documentElement).getPropertyValue('--hdr').trim()")) === "140px" && Math.abs((await ev("document.getElementById('side').getBoundingClientRect().top")) - 150) < 1.5);
    await ev("document.querySelector('header').style.minHeight = ''"); await sleep(300);
    const natural = await ev("(() => { const h = document.querySelector('header'); h.style.minHeight = '0px'; const n = h.getBoundingClientRect().height; h.style.minHeight = ''; return n; })()");
    check(tag + "the header's own content (" + Math.round(natural * 10) / 10 + " px) fits inside its height (" + H + " px)", natural <= H + 0.5, [natural, H]);
    rows.push({ look: profile + " " + theme, w: w + "x" + h, header: H, natural: Math.round(natural * 10) / 10 });
  }
  console.log("\n      real sticky header height (px):");
  for (const r of rows) console.log("        " + r.look.padEnd(14) + r.w.padEnd(10) + r.header + "   (content alone needs " + r.natural + ")");
  await tab.close();
} catch (e) {
  fail++; console.log("FAIL  test run aborted: " + e.stack);
} finally { await cleanup(); }
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
