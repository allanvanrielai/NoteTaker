// Profiles Phase 3 browser tests: profile switch, Mint profile (optional file), persistence, loading, no flash, header and logo, Mint rules, contrast in all four looks incl. hover/pressed, radios, network.
// Two throwaway origins: 47621 serves app/ (Mint present), 47622 serves a copy of index.html alone (Mint absent). Run: node Testing/profiles-phase3-browser.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(here, "..", "app");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const HTTP_PORT = 47621, DEBUG_PORT = 9341;
const ORIGIN = "http://127.0.0.1:" + HTTP_PORT + "/";
const profile = mkdtempSync(join(tmpdir(), "ntp3-profile-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, detail) { cond ? pass++ : fail++; console.log((cond ? "PASS  " : "FAIL  ") + name + (cond || detail === undefined ? "" : "   -> " + JSON.stringify(detail))); }
const HTTP_PORT_B = 47622, PORT_B = HTTP_PORT_B;
const STAGE_B = mkdtempSync(join(tmpdir(), "ntp3-nomint-")); copyFileSync(join(APP_DIR, "index.html"), join(STAGE_B, "index.html"));
const serverB = spawn("python", ["-m", "http.server", String(HTTP_PORT_B), "--bind", "127.0.0.1", "--directory", STAGE_B], { stdio: "ignore" });
const server = spawn("python", ["-m", "http.server", String(HTTP_PORT), "--bind", "127.0.0.1", "--directory", APP_DIR], { stdio: "ignore" });
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + profile,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1920,911", "about:blank"], { stdio: "ignore" });
async function cleanup() { try { chrome.kill(); } catch {} try { server.kill(); } catch {} try { serverB.kill(); } catch {} await sleep(800); try { rmSync(profile, { recursive: true, force: true }); } catch {} }
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


import { readFileSync } from "node:fs";
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
const os = (v) => tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: v }] });
const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
const rgbHex = (s) => { const m = s.match(/[\d.]+/g).map(Number); return hex(m[0], m[1], m[2]); };
const cs = (sel, prop) => ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)}))[${JSON.stringify(prop)}]`);
// set what the browser remembers (profile, theme) and the system setting, then reload
async function look({ profile, theme, system = "light" }) {
  if (process.env.TRACE) console.log("... look", profile, theme, system);
  await os(system);
  await ev(`(() => { ${profile ? `localStorage.setItem('notetaker-profile', '${profile}')` : "localStorage.removeItem('notetaker-profile')"}; ${theme ? `localStorage.setItem('notetaker-theme', '${theme}')` : "localStorage.removeItem('notetaker-theme')"}; })()`);
  await tab.reload(); await ev("window.scrollTo(0,0)"); await sleep(250);
}
const ORIGIN_B = "http://127.0.0.1:" + PORT_B + "/";

// ---- measurement library, installed in the page (text and border contrast from the real computed colours, corner circle included) ----
const LIB = `(() => {
  const parse = (c) => { if (c.trim() === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }; const mm = c.match(/[\\d.]+/g); if (!mm) throw new Error('cannot read colour: ' + c); const m = mm.map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const over = (t, b) => { const a = t.a + b.a * (1 - t.a); return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: (t.r * t.a + b.r * b.a * (1 - t.a)) / a, g: (t.g * t.a + b.g * b.a * (1 - t.a)) / a, b: (t.b * t.a + b.b * b.a * (1 - t.a)) / a, a }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
  const sigOf = () => parse(getComputedStyle(document.documentElement).getPropertyValue('--sig').trim() || 'rgba(0,0,0,0)');
  const inCircle = (x, y) => Math.hypot(x - (document.documentElement.clientWidth - 110), y - 70) < 220;
  const bgAt = (el, x, y) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(e); let acc = { r: 255, g: 255, b: 255, a: 1 };
    for (const e of chain) { const c = getComputedStyle(e); acc = over(parse(c.backgroundColor), acc); if ((e.tagName === 'BODY' || e.tagName === 'HEADER') && /radial-gradient/.test(c.backgroundImage) && inCircle(x, y)) acc = over(sigOf(), acc); }
    return acc; };
  const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const ownBg = (el) => { const [x, y] = centre(el); return over(parse(getComputedStyle(el).backgroundColor), bgAt(el.parentElement, x, y)); };
  const textPair = (el, colour) => { const [x, y] = centre(el); const bg = bgAt(el, x, y); const fg = over(parse(colour || getComputedStyle(el).color), bg); const cst = getComputedStyle(el), px = parseFloat(cst.fontSize), wt = parseInt(cst.fontWeight); return { ratio: ratio(fg, bg), circle: inCircle(x, y) && !!el.closest('header'), large: px >= 24 || (px >= 18.66 && wt >= 700) }; };   // large text (24 px, or 18.66 px bold) needs 3:1
  const edge = (el) => { const [x, y] = centre(el); const cstyle = getComputedStyle(el); const col = parse(cstyle.borderTopColor); const outBg = bgAt(el.parentElement, x, y), inBg = ownBg(el); const out = ratio(over(col, outBg), outBg), inn = ratio(over(col, inBg), inBg);   // a see-through border (alpha) is composited over what is behind it
    return { outside: out, inside: inn === 1 ? out : inn, width: parseFloat(cstyle.borderTopWidth) }; };
  const sel = { 'heading': 'h1', 'card title': '.card .title', 'locked title': '.card .title[readonly]', 'card text': '.card textarea.body', 'meta line': '.card .meta span', 'unsaved badge (card)': '.card .badge',
    'small print': '.card .small', 'card buttons (Copy)': '.btns .btn-copy', 'primary button': 'button.primary', 'Open button': '#openBtn', 'Save button': '.btn-save', 'theme button': '#themeBtn', 'header count': '#count',
    'backup status': '#backup', 'profile label': '#profileLabel', 'profile button (pressed)': '.segbtns button[aria-pressed="true"]', 'profile button (not pressed)': '.segbtns button[aria-pressed="false"]',
    'index title': '#index .t', 'index detail': '#index .s span', 'index badge': '#index .s .badge', 'side heading': '#side h2', 'sort labels': '.sortrow label', 'search box': '#q',
    'panel message': '.panel:not(.warn) .pmsg', 'panel button': '.panel button', 'warn panel message': '.panel.warn .pmsg', 'banner text': '.banner > span', 'banner button': '.banner button', 'move arrows': '.reorder button:not(:disabled)', 'drag handle': '.grip' };
  const visible = (el) => el && el.getClientRects().length > 0;
  window.__M = {
    all() {
      const text = []; for (const [name, q] of Object.entries(sel)) { const el = document.querySelector(q); if (!visible(el)) { text.push({ name, missing: true }); continue; } text.push(Object.assign({ name }, textPair(el))); }
      const qb = document.getElementById('q'); text.push(Object.assign({ name: 'search placeholder' }, textPair(qb, getComputedStyle(qb, '::placeholder').color)));
      const ui = [];
      for (const [name, q2] of [['button border (Copy)', '.btns .btn-copy'], ['primary button border', 'button.primary'], ['Save button fill', '.btn-save'], ['Open button fill', '#openBtn'], ['title field border', '.card .title'], ['text area border', '.card textarea.body'], ['search border', '#q'], ['sort radio ring', 'input[name=sort]:not(:checked)'],
          ['profile group border', '.segbtns'], ['theme button border', '#themeBtn'], ['move arrow border', '.reorder button:not(:disabled)'], ['pinned ring', '.card.pinned'], ['active entry border', '#index li.active'],
          ['warn panel border', '.panel.warn'], ['error panel border', '.panel:not(.warn)'], ['warn banner border', '.banner.warn'], ['error banner border', '.banner.err']]) {
        const el = document.querySelector(q2); if (!visible(el)) { ui.push({ name, missing: true, outside: 0, inside: 0 }); continue; } const e = edge(el); ui.push({ name, outside: e.outside, inside: e.inside }); }
      const ic = document.querySelector('#index .ic'); if (ic) { const p = textPair(ic); ui.push({ name: 'index icon', outside: p.ratio, inside: p.ratio }); }
      const foc = []; for (const [name, q4] of [['search focus ring', '#q'], ['text area focus ring', '.card textarea.body'], ['title focus ring', '.card .title'], ['sort radio focus ring', 'input[name=sort]:not(:checked)'], ['profile button focus ring', '.segbtns button[aria-pressed="false"]']]) {
        const el = document.querySelector(q4); if (!visible(el)) continue; el.focus({ focusVisible: true }); const c = getComputedStyle(el); const [x, y] = centre(el);
        foc.push({ name, style: c.outlineStyle, width: c.outlineWidth, outside: ratio(parse(c.outlineColor), bgAt(el.parentElement, x, y)) }); el.blur(); }
      return { text, ui, foc };
    },
    forced(q) {   // called while hover + pressed are forced on the element
      const el = document.querySelector(q); if (!visible(el)) return { missing: true };
      const t = textPair(el), e = edge(el); return { text: t.ratio, large: t.large, borderOutside: e.outside, borderWidth: e.width, borderColour: getComputedStyle(el).borderTopColor, bg: getComputedStyle(el).backgroundColor };
    },
  };
  return true; })()`;

const HDR = `(() => { const R = (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left * 10) / 10, t: Math.round(r.top * 10) / 10, r: Math.round(r.right * 10) / 10, b: Math.round(r.bottom * 10) / 10 }; };
  const h = document.querySelector('header'), box = document.getElementById('profileBox'), lab = document.getElementById('profileLabel');
  const ids = ['backup', 'newCard', 'openBtn', 'count'].concat(box.hidden ? [] : ['profileLabel']).concat(['themeBtn']);
  const kids = ids.map((id) => Object.assign({ id }, R(document.getElementById(id)))), seg = box.hidden ? null : R(box.querySelector('.segbtns'));
  const r2 = R(document.getElementById('hrow2')), d = document.documentElement, slot = document.getElementById('logoSlot'), s = getComputedStyle(slot);
  return { pos: getComputedStyle(h).position, h: Math.round(h.getBoundingClientRect().height * 10) / 10, hdrVar: getComputedStyle(d).getPropertyValue('--hdr').trim(), clip: h.scrollHeight > h.clientHeight + 1 || h.scrollWidth > h.clientWidth + 1,
    docOverflow: d.scrollWidth > d.clientWidth, h1: R(document.querySelector('h1')), r2, kids, seg, hdrRight: R(h).r, hdrBottom: R(h).b, labelShown: !box.hidden && lab.getClientRects().length > 0,
    slot: { display: s.display, rect: slot.getClientRects().length ? R(slot) : null, padding: s.padding, bg: s.backgroundColor, bgImg: s.backgroundImage.slice(0, 22), role: slot.getAttribute('role'), inSide: slot.parentElement.id === 'side', inHeader: !!slot.closest('header') }, sideBox: R(document.querySelector('#side .box')) }; })()`;

const MINT_HEX = ["243C7A","184B9A","0361A7","65A1D7","C3E0A7","89C146","439E46","EDEEF0","CFD8DB","99A7AE","626E73","475054","85C4EB","478DCB","0877BE","FAB179","F48130","F15927","8EC5BA","63BEAC","2B9E95","AD7682","AD3140","9B0016","004C9F"];
const EXPECT = {
  "default light": { bg: "#EEF2F7", card: "#FFFFFF", text: "#253D52", line: "#4880AE", cta: "#253D52", ctaText: "#FFFFFF", btn: "#325A7A", heading: "#253D52", radiusCard: "14px", radiusBtn: "8px", fontStart: /^Arial/, h1w: "700" },
  "default dark": { bg: "#253D52", card: "#325A7A", text: "#FFFFFF", line: "#A0C2DB", cta: "#A0C2DB", ctaText: "#253D52", btn: "#EEF2F7", heading: "#FFFFFF", radiusCard: "14px", radiusBtn: "8px", fontStart: /^Arial/, h1w: "700" },
  "mint light": { bg: "#FFFFFF", card: "#EDEEF0", text: "#475054", line: "{{LINE_LIGHT}}", cta: "#F48130", ctaText: "#243C7A", btn: "#184B9A", heading: "#184B9A", radiusCard: "20px", radiusBtn: "999px", fontStart: /^"NT Brand Sans"/, h1w: "300" },
  "mint dark": { bg: "#0D0F10", card: "#222629", text: "#FFFFFF", line: "#7A8388", cta: "#F48130", ctaText: "#0D0F10", btn: "#184B9A", heading: "#FFFFFF", radiusCard: "20px", radiusBtn: "999px", fontStart: /^"NT Brand Sans"/, h1w: "300" },
};
const MINT_LINE_LIGHT = process.env.MINT_LINE_LIGHT || "#626E73";
EXPECT["mint light"].line = MINT_LINE_LIGHT.toUpperCase();

try {
  const up = async (url) => { const r = await fetch(url); await r.arrayBuffer(); return r.ok; };
  await waitFor(() => up("http://127.0.0.1:" + DEBUG_PORT + "/json/version"), 15000);
  await waitFor(() => up(ORIGIN), 15000); await waitFor(() => up(ORIGIN_B), 15000);

  // ===== S1 index.html carries no Mint content
  const html = readFileSync(join(APP_DIR, "index.html"), "utf8");
  const foundHex = MINT_HEX.filter((h) => new RegExp("#" + h + "\\b", "i").test(html));
  check("S1 index.html contains no Mint hex value", foundHex.length === 0, foundHex);
  check("S1 index.html contains no Lato (or the embedded font's name), no font data and no logo", !/\blato\b/i.test(html) && !/NT Brand Sans/i.test(html) && !/data:(font|application\/font|image)/i.test(html) && !/<svg\b/i.test(html), null);
  const mintJs = readFileSync(join(APP_DIR, "mint-profile.js"), "utf8");
  check("S1 mint-profile.js has the licence notice, four faces (300, 400, 700 and 400 italic) and the logo, and nothing from a network", /SIL OPEN FONT LICENSE Version 1.1/.test(mintJs) && (mintJs.match(/@font-face/g) || []).length === 4 && /font-weight: 300/.test(mintJs) && /font-weight: 400/.test(mintJs) && /font-weight: 700/.test(mintJs) && (mintJs.match(/font-style: italic/g) || []).length === 1 && /data:image\/svg\+xml;base64,/.test(mintJs) && !/https?:\/\//.test(mintJs.replace(/http:\/\/(scripts\.sil\.org\/OFL|www\.latofonts\.com\/)/g, "").replace(/http:\/\/scripts\.sil\.org\/OFL/g, "")), null);

  // ===== S2 Mint absent (the server for ORIGIN_B has no mint-profile.js)
  console.log("... S2 opening B"); tab = await Tab.open(ORIGIN_B); console.log("... S2 opened");
  await tab.send("Network.enable"); await tab.send("Log.enable");
  await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: HARNESS });
  await tab.reload(); console.log("... S2 reloaded");
  const probe = await ev(`fetch('mint-profile.js').then((r) => r.status)`);
  check("S2 setup: on this server mint-profile.js really is absent (404)", probe === 404, probe);
  check("S2 Mint absent: the profile control is not offered, the Default look shows, no data-profile", (await ev("document.getElementById('profileBox').hidden")) && (await ev("document.documentElement.getAttribute('data-profile')")) === null && rgbHex(await cs("body", "backgroundColor")) === "#EEF2F7" && (await ev("window.NoteTakerMint === undefined")));
  check("S2 Mint absent: no banner when Mint was never chosen", (await ev("document.querySelectorAll('.banner').length")) === 0);
  const idB = await newCard("Works without Mint", "text");
  await ev("document.getElementById('themeBtn').click()"); await sleep(250);
  check("S2 Mint absent: containers, typing and the dark/light button still work", (await ev(`${CARDS}.length`)) === 1 && (await ev("document.documentElement.getAttribute('data-theme')")) === "dark" && (await ev("document.getElementById('themeBtn').textContent")) === "☀ Light");
  await ev("localStorage.setItem('notetaker-profile', 'mint')"); await tab.reload();
  const bn = await ev("[...document.querySelectorAll('.banner')].map((b) => b.querySelector('span').textContent)");
  check("S2 stored choice 'mint' but the file is missing: Default look, and exactly one banner says so", bn.length === 1 && /mint-profile\.js/.test(bn[0]) && /Default/.test(bn[0]) && (await ev("document.documentElement.getAttribute('data-profile')")) === null, bn);
  check("S2 the stored choice is kept as 'mint'", (await ev("localStorage.getItem('notetaker-profile')")) === "mint");
  await ev("document.querySelector('.banner .bx').click()");
  check("S2 the banner can be dismissed", (await ev("document.querySelectorAll('.banner').length")) === 0);
  await tab.reload();
  check("S2 on the next page load it is told once again (once per load)", (await ev("document.querySelectorAll('.banner').length")) === 1);
  check("S2 the logo slot is empty and hidden", (await ev("getComputedStyle(document.getElementById('logoSlot')).display")) === "none");
  await ev("localStorage.setItem('notetaker-profile', 'default')"); await tab.reload();
  check("S2 a stored 'default' with no file shows no banner", (await ev("document.querySelectorAll('.banner').length")) === 0);
  await ev("localStorage.removeItem('notetaker-profile'); localStorage.removeItem('notetaker-theme')");
  await tab.close();

  // ===== everything else runs with the file present, watching errors and network
  tab = await Tab.open(ORIGIN);
  const net = [], errs = [], frames = [];
  tab.ws.addEventListener("message", (m) => { const d = JSON.parse(m.data);
    if (d.method === "Network.requestWillBeSent") net.push(d.params.request.url);
    if (d.method === "Runtime.exceptionThrown") errs.push((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description) || d.params.exceptionDetails.text);
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error") { if (!/favicon\.ico/.test(d.params.entry.url || d.params.entry.text)) errs.push("log: " + d.params.entry.text + " " + (d.params.entry.url || "")); } });   // (the test server has no favicon: that 404 is nothing to do with the app)
  await tab.send("Network.enable"); await tab.send("Log.enable");
  await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: HARNESS });
  await tab.reload();
  await os("light");
  const a = await newCard("Meeting notes: supplier call", "Agreed delivery moves to the 14th.");
  const b = await newCard("Copilot answer: SQL window functions", "SELECT customer_id,\n  SUM(total) OVER (PARTITION BY customer_id) AS running_total\nFROM orders;");
  const c = await newCard("Reply draft to Sam", "Hi Sam,\n\nThanks for sending the draft over.");
  const u = await newCard("", "");        // an untitled container (its header entry is italic)
  await ev(`[...document.querySelectorAll('.card[data-id="${b}"] .btns button')].find((x) => /^pin$/i.test(x.textContent)).click()`); await sleep(400);
  await ev(`document.querySelector('.card[data-id="${c}"] .btn-save').click()`); await sleep(600);
  await ev("document.activeElement && document.activeElement.blur(); true");
  const addStates = async () => { await ev(`(() => { document.querySelectorAll('.banner').forEach((x) => x.remove()); banner('warn', 'Sample warning banner.'); banner('err', 'Sample error banner.'); showPanel(cards.get(${JSON.stringify(a)}), 'changed'); showPanel(cards.get(${JSON.stringify(c)}), 'samefile', 'Other'); })()`); await sleep(300); };

  if (!process.env.QUICK) {   // QUICK=1 skips S3-S9 (used to iterate on the contrast section)
  // ===== S3 the switch
  await look({ profile: null, theme: "light" });
  check("S3 the profile control is offered with a visible 'Profile' label, Default pressed", !(await ev("document.getElementById('profileBox').hidden")) && (await ev("document.getElementById('profileLabel').textContent")) === "Profile" && (await ev("document.querySelector('.segbtns button[data-profile=default]').getAttribute('aria-pressed')")) === "true");
  check("S3 Default: no logo (slot hidden), no data-profile", (await ev("getComputedStyle(document.getElementById('logoSlot')).display")) === "none" && (await ev("document.documentElement.getAttribute('data-profile')")) === null);
  await ev("document.querySelector('.segbtns button[data-profile=mint]').click()"); await sleep(250);
  check("S3 clicking Mint switches the look at once (no reload) and remembers it", (await ev("document.documentElement.getAttribute('data-profile')")) === "mint" && rgbHex(await cs("body", "backgroundColor")) === "#FFFFFF" && (await ev("localStorage.getItem('notetaker-profile')")) === "mint" && (await ev("document.querySelector('.segbtns button[data-profile=mint]').getAttribute('aria-pressed')")) === "true");
  check("S3 the logo shows in Mint", (await ev("getComputedStyle(document.getElementById('logoSlot')).display")) === "block" && /url\(/.test(await cs("#logoSlot", "backgroundImage")));
  await tab.reload();
  check("S3 Mint survives a reload (and a stored theme choice stays independent)", (await ev("document.documentElement.getAttribute('data-profile')")) === "mint" && (await ev("document.documentElement.getAttribute('data-theme')")) === "light");
  await ev("document.getElementById('themeBtn').click()"); await sleep(200);
  check("S3 switching theme in Mint keeps Mint, and the button follows", (await ev("document.documentElement.getAttribute('data-profile')")) === "mint" && (await ev("document.documentElement.getAttribute('data-theme')")) === "dark" && rgbHex(await cs("body", "backgroundColor")) === "#0D0F10" && (await ev("document.getElementById('themeBtn').textContent")) === "☀ Light");
  await ev("document.querySelector('.segbtns button[data-profile=default]').click()"); await sleep(250);
  check("S3 switching back to Default (theme kept) and the logo goes away", (await ev("document.documentElement.getAttribute('data-profile')")) === null && rgbHex(await cs("body", "backgroundColor")) === "#253D52" && (await ev("localStorage.getItem('notetaker-profile')")) === "default" && (await ev("getComputedStyle(document.getElementById('logoSlot')).display")) === "none");
  await tab.reload();
  check("S3 Default also survives a reload", (await ev("document.documentElement.getAttribute('data-profile')")) === null && (await ev("document.querySelector('.segbtns button[data-profile=default]').getAttribute('aria-pressed')")) === "true");
  await ev("localStorage.setItem('notetaker-profile', 'banana')"); await tab.reload();
  check("S3 an unknown stored value means Default, with no banner", (await ev("document.documentElement.getAttribute('data-profile')")) === null && (await ev("document.querySelectorAll('.banner').length")) === 0);
  // keyboard
  await look({ profile: "mint", theme: "light" });
  await ev("document.querySelector('.segbtns button[data-profile=default]').focus()");
  await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); await sleep(200);
  check("S3 the profile buttons work from the keyboard (Enter)", (await ev("document.documentElement.getAttribute('data-profile')")) === null);

  // ===== S4 profile x system dark x manual choice
  const combos = [
    ["OS dark, no manual choice", "dark", null, "dark"], ["OS dark, manual light", "dark", "light", "light"], ["OS light, manual dark", "light", "dark", "dark"],
    ["OS light, no manual choice", "light", null, "light"], ["OS dark, manual dark", "dark", "dark", "dark"], ["OS light, manual light", "light", "light", "light"] ];
  for (const profile of ["default", "mint"]) for (const [name, system, manual, expectTheme] of combos) {
    await look({ profile, theme: manual, system });
    const E = EXPECT[profile + " " + expectTheme];
    check(`S4 ${profile}: ${name} -> ${expectTheme} look`, rgbHex(await cs("body", "backgroundColor")) === E.bg && rgbHex(await cs(".card", "backgroundColor")) === E.card && (await ev("getComputedStyle(document.documentElement).colorScheme")) === expectTheme && (await ev("document.getElementById('themeBtn').textContent")) === (expectTheme === "dark" ? "☀ Light" : "☾ Dark"), [await cs("body", "backgroundColor"), await cs(".card", "backgroundColor"), expectTheme]);
  }
  await os("light");
  await look({ profile: "mint", theme: null, system: "dark" });
  await os("light"); await sleep(400);
  check("S4 Mint, no manual choice: the system changing to light switches the look and the button live", rgbHex(await cs("body", "backgroundColor")) === "#FFFFFF" && (await ev("document.getElementById('themeBtn').textContent")) === "☾ Dark");

  // ===== S5 computed styles per look match the tokens
  for (const [profile, theme] of [["default", "light"], ["default", "dark"], ["mint", "light"], ["mint", "dark"]]) {
    await look({ profile, theme }); await viewport(1920, 1080); await addStates();
    const E = EXPECT[profile + " " + theme], tag = `${profile} ${theme}: `;
    const lineNow = await cs(".card textarea.body", "borderTopColor");
    check(tag + "canvas, card, text, heading, field, border and button colours match the tokens", rgbHex(await cs("body", "backgroundColor")) === E.bg && rgbHex(await cs(".card", "backgroundColor")) === E.card && rgbHex(await cs(".card .meta span", "color")) !== "" && rgbHex(await cs("h1", "color")) === E.heading &&
      (E.line === "rgba" ? /^rgba\(255, 255, 255, 0\.3\)$/.test(lineNow) : rgbHex(lineNow) === E.line) && rgbHex(await cs("button.primary", "backgroundColor")) === E.cta && rgbHex(await cs("button.primary", "color")) === E.ctaText && rgbHex(await cs(".btn-save", "backgroundColor")) === E.btn, [E, lineNow]);
    check(tag + "radii (cards " + E.radiusCard + ", buttons " + E.radiusBtn + ") and fonts", (await cs(".card", "borderTopLeftRadius")) === E.radiusCard && (await cs(".btns .btn-copy", "borderTopLeftRadius")) === (E.radiusBtn === "999px" ? "999px" : "8px") && E.fontStart.test(await cs("body", "fontFamily")) && /Consolas/.test(await cs("textarea.body", "fontFamily")) && /monospace/.test(await cs("textarea.body", "fontFamily")) && (await cs("textarea.body", "height")) === "400px", [await cs("body", "fontFamily"), await cs("textarea.body", "fontFamily")]);
    check(tag + "heading weight " + E.h1w + "; strong text (titles, buttons) is 700", (await cs("h1", "fontWeight")) === E.h1w && (await cs(".card .title", "fontWeight")) === "700", [await cs("h1", "fontWeight")]);
    check(tag + "no drop shadows (pinned ring only) and the corner circle exists only in Default", await ev(`(() => { const ok = (el) => { const s = getComputedStyle(el).boxShadow; return s === 'none' || /^rgb[a]?\\([^)]*\\) 0px 0px 0px 1px$/.test(s); }; return [...document.querySelectorAll('.card, #side .box, header, button, .panel, .banner')].every(ok); })()`) &&
      ((await ev("getComputedStyle(document.documentElement).getPropertyValue('--sig').trim()")) === "transparent") === (profile === "mint"));
    // logo
    const H = await ev(HDR);
    if (profile === "mint") {
      const plateDark = theme === "dark";
      check(tag + "logo: width set, proportions kept (111.22:54.6), plate " + (plateDark ? "#CFD8DB with 8px 14px padding" : "none"), H.slot.display === "block" && H.slot.rect && Math.abs((H.slot.rect.b - H.slot.rect.t - (plateDark ? 16 : 0)) / (H.slot.rect.r - H.slot.rect.l - (plateDark ? 28 : 0)) - 54.6 / 111.22) < 0.01 &&
        (plateDark ? H.slot.padding === "8px 14px" && rgbHex(H.slot.bg) === "#CFD8DB" : H.slot.padding === "0px" && /rgba\(0, 0, 0, 0\)|transparent/.test(H.slot.bg)) && H.slot.bgImg.startsWith("url(") && H.slot.role === "img", H.slot);
    } else check(tag + "no logo", H.slot.display === "none" && H.slot.rect === null, H.slot);
  }

  if (process.env.ONLY_S45) { await tab.close(); await cleanup(); console.log("\n" + pass + " passed, " + fail + " failed (ONLY_S45: stopped after S5)"); process.exit(fail ? 1 : 0); }   // used by the mutation check
  // ===== S6 Mint typography
  await look({ profile: "mint", theme: "light" }); await viewport(1920, 1080); await sleep(400);
  const faces = await ev("[...document.fonts].map((f) => f.family + '|' + f.weight + '|' + f.style + '|' + f.status)");
  check("S6 Mint embeds exactly four faces: 300, 400, 700 normal and 400 italic", faces.length === 4 && faces.every((f) => f.startsWith("NT Brand Sans|")) && ["300|normal", "400|normal", "700|normal", "400|italic"].every((w) => faces.some((f) => f.includes("|" + w + "|"))), faces);
  check("S6 all four faces are loaded because they are used: Light heading, Regular body, Bold strong text, and the Italic for 'untitled' entries (so they are not synthesised)", faces.every((f) => f.endsWith("|loaded")), faces);
  const wd = await ev(`(() => { const w = (wt) => { const s = document.createElement('span'); s.textContent = 'Hamburgefonstiv Hamburgefonstiv'; s.style.cssText = 'position:absolute;left:-999px;font:' + wt + ' 40px "NT Brand Sans", monospace'; document.body.appendChild(s); const r = s.getBoundingClientRect().width; s.remove(); return r; }; return [w(300), w(400), w(600), w(700)]; })()`);
  check("S6 weight 600 renders as Bold in Mint (same width as 700; there is no 600 face) while Light, Regular and Bold all differ", wd[2] === wd[3] && wd[0] !== wd[1] && wd[1] !== wd[3], wd);
  const italic = await ev("(() => { const e = document.querySelector('#index .t.untitled'); return e ? getComputedStyle(e).fontStyle + ' ' + getComputedStyle(e).fontWeight + ' ' + getComputedStyle(e).fontFamily.split(',')[0] : null; })()");
  check("S6 the 'untitled' header entry is italic 400 in NT Brand Sans (the real Italic face)", italic === 'italic 400 "NT Brand Sans"', italic);
  check("S6 Mint text area is still the monospace Consolas stack", /Consolas/.test(await cs("textarea.body", "fontFamily")));

  // ===== S7 no flash of Default and no visible font swap when Mint is selected
  for (const theme of ["light", "dark"]) {
    await ev(`localStorage.setItem('notetaker-profile', 'mint'); localStorage.setItem('notetaker-theme', '${theme}')`);
    const rec = `(() => { window.__frames = []; let n = 0; const f = () => { const d = document, h1 = d.querySelector('h1'); window.__frames.push({ n, body: !!d.body, h1: !!h1, prof: d.documentElement.getAttribute('data-profile'), bg: getComputedStyle(d.documentElement).getPropertyValue('--bg').trim(), font: d.fonts.check('300 18px "NT Brand Sans"'), faces: [...d.fonts].map((x) => x.weight + ':' + x.status).join(',') }); if (++n < 25) requestAnimationFrame(f); }; requestAnimationFrame(f); })()`;
    const sid = (await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: rec })).identifier;
    await tab.reload(); await sleep(900);
    const fr = await ev("window.__frames");
    const wantBg = theme === "light" ? "#FFFFFF" : "#0D0F10";
    check(`S7 Mint ${theme}: every frame from the very first has Mint set and Mint's background (never Default's)`, fr.length >= 5 && fr.every((f) => f.prof === "mint" && f.bg.toUpperCase() === wantBg), fr.slice(0, 3));
    const firstText = fr.find((f) => f.h1);
    check(`S7 Mint ${theme}: the font is already loaded in the first frame that has text (no swap from a fallback font)`, firstText && firstText.font === true && /300:loaded/.test(firstText.faces), firstText);
    await tab.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: sid });
  }

  // ===== S8 header with the logo and the profile control
  for (const theme of ["light", "dark"]) for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    await look({ profile: "mint", theme }); await viewport(w, h); await ev("window.scrollTo(0,0)"); await sleep(250);
    const H = await ev(HDR), t2 = `Mint ${theme} ${w}x${h}: `;
    check(t2 + "header sticky, " + H.h + " px, nothing clipped, no page overflow", H.pos === "sticky" && H.hdrVar === H.h + "px" && !H.clip && !H.docOverflow, H);
    check(t2 + "row 2 fits on one line with the Profile label and group: backup, New, Open, count, Profile, group, theme", H.labelShown && H.kids.every((k, i) => i === 0 || k.l >= H.kids[i - 1].r - 0.5) && H.kids.every((k) => k.b - k.t < 44 && k.r <= H.hdrRight - 15) && H.seg && H.seg.r <= H.kids[H.kids.length - 1].l, H.kids);
    check(t2 + "logo (" + (theme === "dark" ? "120" : "190") + " px wide) is at the top of the container-list column, left-aligned with the list box and above it, and not in the header", H.slot.rect && H.slot.inSide && Math.abs((H.slot.rect.r - H.slot.rect.l) - (theme === "dark" ? 120 + 28 : 190)) < 1 && Math.abs(H.slot.rect.l - H.sideBox.l) < 1 && H.slot.rect.b <= H.sideBox.t && H.slot.rect.t >= H.hdrBottom - 0.5 && !H.slot.inHeader, [H.slot, H.sideBox]);
    check(t2 + "the heading is 24 px Light in Mint", (await cs("h1", "fontSize")) === "24px" && (await cs("h1", "fontWeight")) === "300");
    console.log("      " + t2 + "header " + H.h + " px (Default is 76; was 52 before Phase 2); logo " + (H.slot.rect ? Math.round(H.slot.rect.r - H.slot.rect.l) + " x " + Math.round(H.slot.rect.b - H.slot.rect.t) : "-") + " px incl. plate; heading font " + await cs("h1", "fontFamily").then((f) => f.split(",")[0]) + " " + await cs("h1", "fontWeight") + " " + await cs("h1", "fontSize"));
    await ev("setBackup('failed')"); await sleep(200); const F = await ev(HDR);
    check(t2 + "with BACKUP FAILED showing row 2 still fits with no overflow", !F.clip && !F.docOverflow && F.kids.every((k) => k.b - k.t < 44 && k.r <= F.hdrRight - 15 + 0.5) && F.labelShown, F.kids);
    await ev("setBackup('ok')");
  }
  for (const [w, h] of [[1920, 1080], [1366, 768]]) { await look({ profile: "default", theme: "light" }); await viewport(w, h); const H = await ev(HDR);
    check(`Default ${w}x${h}: with the Profile control the header is still 76 px, one line in row 2, no overflow`, H.h === 76 && !H.clip && !H.docOverflow && H.labelShown && H.kids.every((k, i) => i === 0 || k.l >= H.kids[i - 1].r - 0.5) && H.kids.every((k) => k.b - k.t < 44), H.kids); }

  // ===== S9 Mint rules
  for (const theme of ["light", "dark"]) {
    await look({ profile: "mint", theme }); await viewport(1920, 1080); await addStates();
    const r = await ev(`(() => { const parse = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1]; }; const h = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
      const GREEN = ['#439E46', '#89C146'], ORANGE = ['#F15927', '#F48130'], out = { whiteOnOrange: [], greenText: [], orangeText: [], ctaOk: null };
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0.5) return h(c); } return '#FFFFFF'; };
      for (const el of document.querySelectorAll('body *')) { if (!el.getClientRects().length) continue; const cs = getComputedStyle(el); const col = h(parse(cs.color)), bg = bgOf(el), hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (hasText && ORANGE.includes(bg) && col === '#FFFFFF') out.whiteOnOrange.push(el.tagName + '.' + el.className);
        if (hasText && GREEN.includes(col)) out.greenText.push({ el: el.tagName + '#' + el.id, col, bg });
        if (hasText && ORANGE.includes(col)) out.orangeText.push({ el: el.tagName + '#' + el.id, col, bg, w: cs.fontWeight, px: cs.fontSize }); }
      const p = document.querySelector('button.primary'), pc = getComputedStyle(p); out.ctaOk = { bg: h(parse(pc.backgroundColor)), text: h(parse(pc.color)), weight: pc.fontWeight, px: parseFloat(pc.fontSize) }; return out; })()`);
    check(`S9 Mint ${theme}: no white text on orange, and the orange CTA uses bold ${theme === "dark" ? "#0D0F10" : "#243C7A"} text at 18.66 px or larger`, r.whiteOnOrange.length === 0 && r.ctaOk.bg === "#F48130" && r.ctaOk.text === (theme === "dark" ? "#0D0F10" : "#243C7A") && Number(r.ctaOk.weight) >= 700 && r.ctaOk.px >= 18.66, r);
    check(`S9 Mint ${theme}: green text appears only on the white page background in light (never on grey panels); orange text only large or bold`, (theme === "dark" || r.greenText.every((g) => g.bg === "#FFFFFF")) && r.orangeText.every((o) => Number(o.w) >= 700 || parseFloat(o.px) >= 24), r);
    console.log("      Mint " + theme + ": green text elements " + JSON.stringify(r.greenText) + "; orange text elements " + JSON.stringify(r.orangeText));
  }

  }   // end of S3-S9
  // ===== S10 contrast in all four looks, resting, hover/pressed and focus
  await tab.send("DOM.enable"); await tab.send("CSS.enable");
  const forcedList = [["Copy (quiet button)", ".btns .btn-copy"], ["Save (filled)", ".btn-save"], ["New container (CTA)", "button.primary"], ["Open file (filled)", "#openBtn"], ["theme button", "#themeBtn"], ["profile button (not pressed)", '.segbtns button[aria-pressed="false"]'], ["profile button (pressed)", '.segbtns button[aria-pressed="true"]'], ["move arrow", ".reorder button:not(:disabled)"], ["header entry", "#index li:not(.active)"], ["header entry (current)", "#index li.active"], ["search box", "#q"]];
  const allLooks = {}, summary = [];
  for (const [profile, theme] of [["default", "light"], ["default", "dark"], ["mint", "light"], ["mint", "dark"]]) for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    await look({ profile, theme }); await viewport(w, h); await addStates(); await ev("window.scrollTo(0,0)"); await sleep(250); await ev(LIB); await ev("document.activeElement && document.activeElement.blur()");
    const M = await ev("__M.all()"), tag = `${profile} ${theme} ${w}: `;
    const ctaLabel = M.text.find((x) => x.name === 'primary button'), badT = M.text.filter((x) => x.missing || x.ratio < (x.large ? 3 : 4.5)),
      badU = M.ui.filter((x) => x.missing || ((x.outside < 3 || x.inside < 3) && !(x.name === 'primary button border' && ctaLabel && ctaLabel.large && ctaLabel.ratio >= 3))),   // a filled button whose large bold label is 3:1 on its fill is identified by its label even if the fill is under 3:1 on the page (Mint's orange on white)
      badF = M.foc.filter((x) => x.outside < 3 || x.style === "none" || parseFloat(x.width) < 2);
    const low = (arr, f) => arr.filter((x) => !x.missing).reduce((m, x) => (f(x) < m.v ? { v: f(x), n: x.name } : m), { v: 99, n: '' });
    const sum = { look: profile + ' ' + theme, w, text: low(M.text.filter((x) => !x.large), (x) => x.ratio), large: low(M.text.filter((x) => x.large), (x) => x.ratio), border: low(M.ui, (x) => Math.min(x.outside, x.inside)), focus: low(M.foc, (x) => x.outside), hoverText: { v: 99, n: '' }, hoverBorder: { v: 99, n: '' } }; summary.push(sum);
    check(tag + "every kind of text is at least 4.5:1 (" + M.text.length + " measured, lowest " + Math.min(...M.text.filter((x) => !x.missing).map((x) => x.ratio)) + ")", badT.length === 0, badT);
    check(tag + "every border, ring and icon is at least 3:1 on both sides (" + M.ui.length + " measured, lowest " + Math.min(...M.ui.filter((x) => !x.missing).map((x) => Math.min(x.outside, x.inside))) + ")", badU.length === 0, badU);
    check(tag + "keyboard focus rings are 3 px and at least 3:1 (" + M.foc.length + " measured)", badF.length === 0 && M.foc.length >= 4, badF);
    {
      if (w === 1920) allLooks[profile + " " + theme] = { text: M.text.map((x) => x.name + " " + x.ratio).join(" | "), ui: M.ui.map((x) => x.name + " " + x.outside + "/" + x.inside).join(" | "), foc: M.foc.map((x) => x.name + " " + x.outside).join(" | ") };
      const doc = await tab.send("DOM.getDocument", { depth: 0 }); const bad = [], rows = [];
      for (const [name, q] of forcedList) {
        const n = await tab.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: q }); if (!n.nodeId) { rows.push(name + " (absent)"); continue; }
        await tab.send("CSS.forcePseudoState", { nodeId: n.nodeId, forcedPseudoClasses: ["hover", "active"] }); await sleep(60);
        const f = await ev(`__M.forced(${JSON.stringify(q)})`); await tab.send("CSS.forcePseudoState", { nodeId: n.nodeId, forcedPseudoClasses: [] });
        rows.push(`${name} text ${f.text}${f.borderWidth > 0 ? " border " + f.borderOutside : ""}`);
        if (!f.missing) { if (!f.large && f.text < sum.hoverText.v) sum.hoverText = { v: f.text, n: name }; if (f.borderWidth > 0 && f.borderOutside < sum.hoverBorder.v) sum.hoverBorder = { v: f.borderOutside, n: name }; }
        if (f.missing || f.text < (f.large ? 3 : 4.5) || (f.borderWidth > 0 && f.borderOutside < 3)) bad.push({ name, f });
      }
      check(tag + "hover and pressed: text 4.5:1 and borders 3:1 on buttons, the profile control and header entries", bad.length === 0, bad);
      if (w === 1920) allLooks[profile + " " + theme].forced = rows.join(" | ");
    }
  }
  console.log("\n      FINAL CONTRAST AUDIT: the lowest figure per look and screen width (targets: text 4.5, large text 3, borders/rings/focus 3; hover and pressed measured by forcing the state)");
  for (const r of summary) console.log("      " + (r.look + " " + r.w).padEnd(18) + "text " + r.text.v + " (" + r.text.n + ")  | large text " + (r.large.v === 99 ? "-" : r.large.v + " (" + r.large.n + ")") + "  | border " + r.border.v + " (" + r.border.n + ")  | focus " + r.focus.v + " (" + r.focus.n + ")  | hover text " + r.hoverText.v + " (" + r.hoverText.n + ")  | hover border " + r.hoverBorder.v + " (" + r.hoverBorder.n + ")");
  for (const [k, v] of Object.entries(allLooks)) { console.log("      [" + k + "] text: " + v.text); console.log("      [" + k + "] borders (outside/inside): " + v.ui); console.log("      [" + k + "] focus: " + v.foc); console.log("      [" + k + "] hover+pressed: " + v.forced); }

  // ===== S11 radios (sort row): still native input[type=radio], keyboard, label click, visible focus, both themes
  for (const theme of ["light", "dark"]) {
    await look({ profile: "default", theme }); await viewport(1920, 1080);
    const nat = await ev("(() => { const r = document.querySelector('input[name=sort]'); const c = getComputedStyle(r); return { type: r.type, tag: r.tagName, appearance: c.appearance, w: c.width }; })()");
    check(`S11 ${theme}: the sort radios are native input type=radio with appearance removed`, nat.type === "radio" && nat.tag === "INPUT" && nat.appearance === "none" && nat.w === "16px", nat);
    await ev("document.querySelector('input[name=sort][value=manual]').focus()");
    const ring = await ev("(() => { const c = getComputedStyle(document.activeElement); return [c.outlineStyle, c.outlineWidth]; })()");
    check(`S11 ${theme}: a focus ring is visible on the focused radio`, ring[0] === "solid" && parseFloat(ring[1]) >= 3, ring);
    await tab.key("ArrowUp", "ArrowUp", 38); await sleep(200);
    check(`S11 ${theme}: arrow keys move the selection between the radios`, (await ev("document.querySelector('input[name=sort][value=edited]').checked")) === true && (await ev("document.body.dataset.sort")) === "edited", await ev("document.body.dataset.sort"));
    await tab.key("ArrowDown", "ArrowDown", 40); await sleep(200);
    check(`S11 ${theme}: arrow down moves it back`, (await ev("document.querySelector('input[name=sort][value=manual]').checked")) === true && (await ev("document.body.dataset.sort")) === "manual");
    await ev("document.querySelector('input[name=sort][value=edited]').closest('label').click()"); await sleep(200);
    check(`S11 ${theme}: clicking the label text selects its radio`, (await ev("document.querySelector('input[name=sort][value=edited]').checked")) === true && (await ev("document.body.dataset.sort")) === "edited");
    await ev("document.querySelector('input[name=sort][value=manual]').closest('label').click()"); await sleep(150);
  }

  // ===== S12 only localhost, and no unhandled errors
  const hosts = [...new Set(net.filter((u) => !u.startsWith("data:") && !u.startsWith("blob:")).map((u) => new URL(u).host))];
  check("S12 no request went to any host other than localhost (" + net.length + " requests, hosts: " + hosts.join(", ") + ")", hosts.every((h) => h.startsWith("127.0.0.1:") || h.startsWith("localhost:")), hosts);
  check("S12 no unhandled errors or error logs with Mint present", errs.length === 0, errs.slice(0, 5));
  await tab.close();
} catch (e) {
  fail++; console.log("FAIL  test run aborted: " + e.stack);
} finally { await cleanup(); }
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
