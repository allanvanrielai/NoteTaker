// Profiles Phase 2 browser tests: the Default (personal brand) look in light and dark: header layout, tokens, fonts, shape, contrast measured from the rendered page.
// Throwaway origin http://127.0.0.1:47618, fresh Chrome profile. Run: node Testing/profiles-phase2-browser.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(here, "..", "app");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const HTTP_PORT = 47618, DEBUG_PORT = 9338;
const ORIGIN = "http://127.0.0.1:" + HTTP_PORT + "/";
const profile = mkdtempSync(join(tmpdir(), "ntp2-profile-"));
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
const setTheme = async (t) => { await ev(`localStorage.setItem('notetaker-theme', '${t}')`); await tab.reload(); await ev("window.scrollTo(0,0)"); await sleep(250); };
const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
const rgbHex = (s) => { const m = s.match(/[\d.]+/g).map(Number); return hex(m[0], m[1], m[2]); };
const cs = (sel, prop) => ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)}))[${JSON.stringify(prop)}]`);

// ---- rendered-page measurement (runs in the page): text and border contrast from the real computed colours, including the corner circle where it lies under an element ----
const MEASURE = `(() => {
  const parse = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const over = (t, b) => { const a = t.a + b.a * (1 - t.a); return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: (t.r * t.a + b.r * b.a * (1 - t.a)) / a, g: (t.g * t.a + b.g * b.a * (1 - t.a)) / a, b: (t.b * t.a + b.b * b.a * (1 - t.a)) / a, a }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
  const rootCS = getComputedStyle(document.documentElement);
  const sig = parse(rootCS.getPropertyValue('--sig').trim() || 'rgba(0,0,0,0)');
  const W = document.documentElement.clientWidth;
  const inCircle = (x, y) => Math.hypot(x - (W - 110), y - 70) < 220;     // centre 110 px in from the right edge, 70 px down, radius 220, fixed to the window
  const bgAt = (el, x, y) => {
    const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(e);
    let acc = { r: 255, g: 255, b: 255, a: 1 };
    for (const e of chain) {
      const cs = getComputedStyle(e); acc = over(parse(cs.backgroundColor), acc);
      if ((e.tagName === 'BODY' || e.tagName === 'HEADER') && /radial-gradient/.test(cs.backgroundImage) && inCircle(x, y)) acc = over(sig, acc);
    }
    return acc;
  };
  const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const textPair = (el, colour) => { const [x, y] = centre(el); const bg = bgAt(el, x, y); const fg = over(parse(colour || getComputedStyle(el).color), bg); return { ratio: ratio(fg, bg), circle: inCircle(x, y) && !!el.closest('header') }; };
  const sel = { 'heading': 'h1', 'card title': '.card .title', 'locked title': '.card .title[readonly]', 'card text': '.card textarea.body', 'meta line': '.card .meta span', 'unsaved badge (card)': '.card .badge',
    'small print': '.card .small', 'card buttons (Copy)': '.btns .btn-copy', 'primary button': 'button.primary', 'Open button': '#openBtn', 'Save button': '.btn-save', 'theme button': '#themeBtn', 'header count': '#count',
    'backup status': '#backup', 'index title': '#index .t', 'index detail': '#index .s span', 'index badge': '#index .s .badge', 'side heading': '#side h2', 'sort labels': '.sortrow label', 'search box': '#q',
    'panel message': '.panel:not(.warn) .pmsg', 'panel button': '.panel button', 'warn panel message': '.panel.warn .pmsg', 'banner text': '.banner > span', 'banner button': '.banner button', 'move arrows': '.reorder button:not(:disabled)', 'drag handle': '.grip' };
  const text = []; for (const [name, q] of Object.entries(sel)) { const el = document.querySelector(q); if (!el) { text.push({ name, missing: true }); continue; } text.push(Object.assign({ name }, textPair(el))); }
  const q = document.getElementById('q'); text.push(Object.assign({ name: 'search placeholder' }, textPair(q, getComputedStyle(q, '::placeholder').color)));
  const ui = [];
  const ownBg = (el) => { const [x, y] = centre(el); return over(parse(getComputedStyle(el).backgroundColor), bgAt(el.parentElement, x, y)); };
  const edge = (name, el) => { const [x, y] = centre(el); const col = parse(getComputedStyle(el).borderTopColor); const out = ratio(col, bgAt(el.parentElement, x, y)), inn = ratio(col, ownBg(el)); ui.push({ name, outside: out, inside: inn === 1 ? out : inn }); };   // a border the same colour as its own fill is just the fill: measure it against the outside only
  for (const [name, q2] of [['button border (Copy)', '.btns .btn-copy'], ['primary button border', 'button.primary'], ['Save button fill', '.btn-save'], ['Open button fill', '#openBtn'], ['title field border', '.card .title'], ['text area border', '.card textarea.body'], ['search border', '#q'], ['sort radio ring', 'input[name=sort]:not(:checked)'], ['theme button border', '#themeBtn'], ['move arrow border', '.reorder button:not(:disabled)'],
      ['pinned ring', '.card.pinned'], ['active entry border', '#index li.active'], ['warn panel border', '.panel.warn'], ['error panel border', '.panel:not(.warn)'], ['warn banner border', '.banner.warn'], ['error banner border', '.banner.err']]) {
    const el = document.querySelector(q2); if (el) edge(name, el); else ui.push({ name, missing: true, outside: 0, inside: 0 }); }
  const ic = document.querySelector('#index .ic'); if (ic) { const p = textPair(ic); ui.push({ name: 'index icon', outside: p.ratio, inside: p.ratio }); }
  const foc = []; for (const [name, q4] of [['search focus ring', '#q'], ['text area focus ring', '.card textarea.body'], ['title focus ring', '.card .title']]) { const el = document.querySelector(q4); if (!el) continue; el.focus(); const c = getComputedStyle(el); const [x, y] = centre(el);
    foc.push({ name, style: c.outlineStyle, width: c.outlineWidth, outside: ratio(parse(c.outlineColor), bgAt(el.parentElement, x, y)) }); el.blur(); }
  return { text, ui, foc }; })()`;

const HDR = `(() => { const R = (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left * 10) / 10, t: Math.round(r.top * 10) / 10, r: Math.round(r.right * 10) / 10, b: Math.round(r.bottom * 10) / 10 }; };
  const h = document.querySelector('header'), kids = ['backup', 'newCard', 'openBtn', 'count', 'themeBtn'].map((id) => Object.assign({ id }, R(document.getElementById(id))));
  const r2 = R(document.getElementById('hrow2')), d = document.documentElement;
  return { pos: getComputedStyle(h).position, h: Math.round(h.getBoundingClientRect().height * 10) / 10, hdrVar: getComputedStyle(d).getPropertyValue('--hdr').trim(), clip: h.scrollHeight > h.clientHeight + 1 || h.scrollWidth > h.clientWidth + 1,
    docOverflow: d.scrollWidth > d.clientWidth, h1: R(document.querySelector('h1')), r2, kids, hdrRight: R(h).r }; })()`;

try {
  const up = async (url) => { const r = await fetch(url); await r.arrayBuffer(); return r.ok; };
  await waitFor(() => up("http://127.0.0.1:" + DEBUG_PORT + "/json/version"), 15000);
  await waitFor(() => up(ORIGIN), 15000);
  tab = await Tab.open(ORIGIN);
  await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: HARNESS });
  await tab.reload();
  await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  const a = await newCard("Meeting notes: supplier call", "Agreed delivery moves to the 14th.");
  const b = await newCard("Copilot answer: SQL window functions", "SELECT customer_id,\n  SUM(total) OVER (PARTITION BY customer_id) AS running_total\nFROM orders;");
  const c = await newCard("Reply draft to Sam", "Hi Sam,\n\nThanks for sending the draft over.");
  await ev(`[...document.querySelectorAll('.card[data-id="${b}"] .btns button')].find((x) => /^pin$/i.test(x.textContent)).click()`); await sleep(400);
  await ev(`document.querySelector('.card[data-id="${c}"] .btn-save').click()`); await sleep(600);      // Save (stubbed file picker) links the file and locks this title
  await ev("document.activeElement && document.activeElement.blur(); true");
  // failure states so their colours are measured: banners, a failure panel, a warning panel
  const addStates = async () => { await ev(`(() => { document.querySelectorAll('.banner').forEach((x) => x.remove()); banner('warn', 'Sample warning banner.'); banner('err', 'Sample error banner.'); showPanel(cards.get(${JSON.stringify(a)}), 'changed'); showPanel(cards.get(${JSON.stringify(c)}), 'samefile', 'Other'); })()`); await sleep(300); };

  const LOOKS = { light: { bg: "#EEF2F7", card: "#FFFFFF", text: "#253D52", line: "#4880AE", field: "#FFFFFF", cta: "#253D52", ctaText: "#FFFFFF" },
                  dark: { bg: "#253D52", card: "#325A7A", text: "#FFFFFF", line: "#A0C2DB", field: "#253D52", cta: "#A0C2DB", ctaText: "#253D52" } };

  for (const theme of ["light", "dark"]) {
    const L = LOOKS[theme], tag = "Default " + theme + ": ";
    await viewport(1920, 1080); await setTheme(theme); await addStates();
    check(tag + "page canvas, card, text, field, border and button colours match the Default tokens",
      rgbHex(await cs("body", "backgroundColor")) === L.bg && rgbHex(await cs(".card", "backgroundColor")) === L.card && rgbHex(await cs("h1", "color")) === L.text &&
      rgbHex(await cs(".card textarea.body", "backgroundColor")) === L.field && rgbHex(await cs(".card textarea.body", "borderTopColor")) === L.line && rgbHex(await cs("button.primary", "backgroundColor")) === L.cta && rgbHex(await cs("button.primary", "color")) === L.ctaText,
      [await cs("body", "backgroundColor"), await cs(".card", "backgroundColor"), await cs("h1", "color"), await cs(".card textarea.body", "borderTopColor")]);
    check(tag + "Arial throughout, text area still monospace (Consolas stack) and 400 px high", /^Arial/.test(await cs("body", "fontFamily")) && /^Arial/.test(await cs(".card .title", "fontFamily")) && /Consolas/.test(await cs("textarea.body", "fontFamily")) && /monospace/.test(await cs("textarea.body", "fontFamily")) && (await cs("textarea.body", "height")) === "400px", [await cs("body", "fontFamily"), await cs("textarea.body", "fontFamily"), await cs("textarea.body", "height")]);
    check(tag + "radii: cards 14, buttons 8, title field 10, text area 12", (await cs(".card", "borderTopLeftRadius")) === "14px" && (await cs(".btns button", "borderTopLeftRadius")) === "8px" && (await cs(".card .title", "borderTopLeftRadius")) === "10px" && (await cs("textarea.body", "borderTopLeftRadius")) === "12px");
    check(tag + "strong text is 700 (Arial has no 600)", (await cs(".card .title", "fontWeight")) === "700" && (await cs("h1", "fontWeight")) === "700");
    check(tag + "no drop shadows (a pinned ring is allowed: no offset, no blur) and no accent stripes", await ev(`(() => { const ok = (el) => { const s = getComputedStyle(el).boxShadow; return s === 'none' || /^rgb[a]?\\([^)]*\\) 0px 0px 0px 1px$/.test(s); };
      const even = (el) => { const c = getComputedStyle(el); return c.borderLeftWidth === c.borderTopWidth && c.borderLeftColor === c.borderTopColor; };
      return [...document.querySelectorAll('.card, #side .box, header, button, .panel, .banner')].every((e) => ok(e) && even(e)); })()`));
    check(tag + "the corner circle is a background on the page and the header (nothing to click through)", /radial-gradient/.test(await cs("body", "backgroundImage")) && /radial-gradient/.test(await cs("header", "backgroundImage")) && (await ev("(() => { const b = document.getElementById('themeBtn').getBoundingClientRect(); return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === document.getElementById('themeBtn'); })()")));
    check(tag + "dark/light button keeps its labels", (await ev("document.getElementById('themeBtn').textContent")) === (theme === "light" ? "☾ Dark" : "☀ Light"));

    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
      await viewport(w, h); await ev("window.scrollTo(0,0)"); await sleep(250);
      const H = await ev(HDR), t2 = tag + w + "x" + h + ": ";
      check(t2 + "header is sticky and 76 px high (" + H.h + "), nothing clipped, no page overflow", H.pos === "sticky" && H.h === 76 && H.hdrVar === "76px" && !H.clip && !H.docOverflow, H);
      check(t2 + "row 1 is the heading; row 2 holds backup, New container, Open file, count, theme button left to right on one line", H.h1.b <= H.r2.t + 1 && H.kids.every((k, i) => i === 0 || k.l >= H.kids[i - 1].r - 0.5) && H.kids.every((k) => k.t >= H.r2.t - 1 && k.b <= H.r2.b + 1 && k.b - k.t < 40), H);
      check(t2 + "backup line is below the heading and left of the buttons; theme button at the right edge", H.kids[0].t > H.h1.t && H.kids[0].l < H.kids[1].l && H.kids[4].r <= H.hdrRight - 15 && H.kids[4].r >= H.hdrRight - 18, [H.kids[4].r, H.hdrRight]);
      await ev("window.scrollTo(0, 900)"); await sleep(300);
      check(t2 + "scrolled down the whole header stays at the top", (await ev("document.querySelector('header').getBoundingClientRect().top")) === 0);
      await ev("window.scrollTo(0,0)"); await sleep(200);
      await ev("setBackup('failed')"); await sleep(200);
      const F = await ev(HDR);
      check(t2 + "with BACKUP FAILED showing the header still fits on one line with no overflow", !F.clip && !F.docOverflow && F.kids.every((k) => k.b - k.t < 40 && k.r <= F.hdrRight - 15), F);
      await ev("setBackup('ok')"); await sleep(150);
      const G = await ev(`(() => { const c = document.querySelector('.card').getBoundingClientRect(), s = document.getElementById('side').getBoundingClientRect(); return { card: Math.round(c.width), side: Math.round(s.width), over: [...document.querySelectorAll('.card, #side .box')].some((e) => e.scrollWidth > e.clientWidth + 1) }; })()`);
      if (w === 1920) check(t2 + "container column 1060 px and header list 528 px (as built)", G.card === 1060 && G.side === 528 && !G.over, G); else check(t2 + "both columns readable, nothing overflows", G.card >= 700 && G.side >= 240 && !G.over, G);
      console.log("      " + t2 + "header height " + H.h + " px (was 52): " + (H.h - 52) + " px of vertical space lost = " + (((H.h - 52) / h) * 100).toFixed(1) + " % of the screen height");
    }

    await viewport(1920, 1080);
    const r0 = await ev(`(() => { const r = document.querySelector('.card[data-id="${c}"]').getBoundingClientRect(); return [r.width, r.height]; })()`);
    await ev(`[...document.querySelectorAll('.card[data-id="${c}"] .btns button')].find((x) => x.textContent === 'Copy').click()`);
    const mid = []; for (const ms of [30, 200, 700]) { await sleep(ms); mid.push(await ev(`(() => { const r = document.querySelector('.card[data-id="${c}"]').getBoundingClientRect(); return [r.width, r.height, !!document.querySelector('.toast')]; })()`)); }
    check(tag + "clicking Copy (a toast shows) does not change the container's size", mid.every((m) => m[0] === r0[0] && m[1] === r0[1]) && mid.some((m) => m[2]), [r0, mid]);

    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
      await viewport(w, h); await ev("window.scrollTo(0,0)"); await sleep(250);
      const M = await ev(MEASURE), t2 = tag + w + " contrast: ";
      const badT = M.text.filter((x) => x.missing || x.ratio < 4.5), badU = M.ui.filter((x) => x.missing || x.outside < 3 || x.inside < 3), badF = M.foc.filter((x) => x.outside < 3 || x.style === "none" || parseFloat(x.width) < 2);
      check(t2 + "every kind of text is at least 4.5:1 (" + M.text.length + " measured, lowest " + Math.min(...M.text.filter((x) => !x.missing).map((x) => x.ratio)) + ")", badT.length === 0, badT);
      check(t2 + "every border, ring and icon is at least 3:1 on both sides (" + M.ui.length + " measured, lowest " + Math.min(...M.ui.map((x) => Math.min(x.outside, x.inside))) + ")", badU.length === 0, badU);
      check(t2 + "keyboard focus rings are 3 px and at least 3:1", badF.length === 0 && M.foc.length === 3, badF);
      const circ = M.text.filter((x) => x.circle); check(t2 + "text on the corner circle is measured and passes (" + circ.map((x) => x.name + " " + x.ratio).join(", ") + ")", circ.length >= 1 && circ.every((x) => x.ratio >= 4.5), circ);
      if (w === 1920) { console.log("      " + theme + " text ratios: " + M.text.map((x) => x.name + " " + x.ratio).join(" | ")); console.log("      " + theme + " UI ratios (outside/inside): " + M.ui.map((x) => x.name + " " + x.outside + "/" + x.inside).join(" | ")); console.log("      " + theme + " focus: " + M.foc.map((x) => x.name + " " + x.outside).join(" | ")); }
    }
    await viewport(1920, 1080);
    for (const st of ["ok", "failed"]) { await ev(`setBackup('${st}')`); const r = await ev(MEASURE); const row = r.text.find((x) => x.name === "backup status");
      check(tag + "backup line '" + st + "' is at least 4.5:1 on the page background (" + row.ratio + ")", row.ratio >= 4.5, row); }
    await ev("setBackup('ok')");
  }

  await ev("localStorage.removeItem('notetaker-theme')");
  await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }); await tab.reload();
  check("no saved choice, system dark: Default dark tokens apply and the button offers Light", rgbHex(await cs("body", "backgroundColor")) === "#253D52" && rgbHex(await cs(".card", "backgroundColor")) === "#325A7A" && (await ev("document.getElementById('themeBtn').textContent")) === "☀ Light");
  await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] }); await sleep(400);
  check("system changes to light with no saved choice: Default light tokens and the button follow", rgbHex(await cs("body", "backgroundColor")) === "#EEF2F7" && (await ev("document.getElementById('themeBtn').textContent")) === "☾ Dark");
  await tab.close();
} catch (e) {
  fail++; console.log("FAIL  test run aborted: " + e.stack);
} finally { await cleanup(); }
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
