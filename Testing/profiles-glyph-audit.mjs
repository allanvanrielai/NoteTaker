// Audit for the Mint colour rules: finds every element (and radio dot) whose text colour, border, outline, fill or shadow is one of Mint's orange or green,
// in every state the app can show (pinned card, failure panels, banners, selected radio, active header entry, backup ok / failed), in Mint light and dark.
// Prints one line per use with its role, size and weight, so it can be checked against: green text and thin rules only on white in light; orange text only large or bold.
// Run: node Testing/profiles-glyph-audit.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, "..", "app");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe", HP = 47626, DP = 9346;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "nt-audit-"));
const server = spawn("python", ["-m", "http.server", String(HP), "--bind", "127.0.0.1", "--directory", APP], { stdio: "ignore" });
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + DP, "--user-data-dir=" + profile, "--no-first-run", "about:blank"], { stdio: "ignore" });
const up = async (u) => { for (let i = 0; i < 60; i++) { try { const r = await fetch(u); await r.arrayBuffer(); if (r.ok) return; } catch {} await sleep(250); } throw new Error("not up " + u); };
const SCAN = `(() => {
  const NAMES = { '#F15927': 'Mint orange-red', '#F48130': 'Mint orange', '#439E46': 'Mint green', '#89C146': 'Mint light green', '#217A3C': 'app green (backup ok, light)', '#6FCF8A': 'app green (backup ok, dark)' };
  const hex = (c) => { const m = c.match(/[\\d.]+/g); if (!m || (m.length > 3 && +m[3] === 0)) return null; return '#' + m.slice(0, 3).map((v) => Math.round(+v).toString(16).padStart(2, '0')).join('').toUpperCase(); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const h = hex(getComputedStyle(e).backgroundColor); if (h) return h; } return '#(page)'; };
  const label = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + (el.textContent && el.children.length === 0 ? ' "' + el.textContent.trim().slice(0, 18) + '"' : '');
  const out = [], seen = new Set();
  const note = (el, prop, col, extra) => { const n = NAMES[col]; if (!n) return; const cs = getComputedStyle(el); const key = label(el) + prop + col; if (seen.has(key)) return; seen.add(key);
    out.push({ el: label(el), use: prop, colour: col + ' ' + n, size: cs.fontSize, weight: cs.fontWeight, on: bgOf(el.parentElement || el), extra: extra || '' }); };
  for (const el of document.querySelectorAll('body *, header *')) {
    if (!el.getClientRects().length) continue; const cs = getComputedStyle(el);
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) note(el, 'TEXT colour', hex(cs.color));
    for (const side of ['Top']) if (parseFloat(cs['border' + side + 'Width']) > 0) note(el, 'border (' + cs['border' + side + 'Width'] + ')', hex(cs['border' + side + 'Color']));
    if (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none') note(el, 'outline', hex(cs.outlineColor));
    note(el, 'fill', hex(cs.backgroundColor));
    const sh = cs.boxShadow; if (sh && sh !== 'none') { const m = sh.match(/rgba?\\([^)]*\\)/); if (m) note(el, 'ring (box-shadow)', hex(m[0])); }
    const ib = getComputedStyle(el, '::before'); if (ib.content && ib.content !== 'none' && ib.content !== 'normal') note(el, '::before shape', hex(ib.backgroundColor), 'pseudo');
  }
  return out; })()`;
try {
  await up("http://127.0.0.1:" + DP + "/json/version"); await up("http://127.0.0.1:" + HP + "/");
  const t = await (await fetch("http://127.0.0.1:" + DP + "/json/new?" + encodeURIComponent("about:blank"), { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://127.0.0.1:" + HP + "/" }); await sleep(1500);
  for (const [title, text] of [["First", "text"], ["Second", "text"], ["", ""]]) {
    await ev("document.getElementById('newCard').click()"); await sleep(150);
    if (title) { await ev("document.querySelector('.card .title').focus()"); await send("Input.insertText", { text: title }); await ev("document.querySelector('.card textarea.body').focus()"); await send("Input.insertText", { text }); }
    await sleep(700);
  }
  await ev("[...document.querySelectorAll('.card')].find((c) => c.querySelector('.title').value === 'Second').querySelector('.btn-pin') && 0");
  await ev("[...document.querySelectorAll('.card .btns button')].find((x) => /^pin$/i.test(x.textContent)).click()"); await sleep(400);
  for (const [profileName, theme] of [["mint", "light"], ["mint", "dark"], ["default", "light"], ["default", "dark"]]) {
    await ev(`localStorage.setItem('notetaker-profile', '${profileName}'); localStorage.setItem('notetaker-theme', '${theme}')`);
    await send("Page.reload"); await sleep(1500);
    await ev(`(() => { banner('warn', 'w'); banner('err', 'e'); const ids = [...document.querySelectorAll('.card')].map((c) => c.dataset.id); showPanel(cards.get(ids[0]), 'changed'); showPanel(cards.get(ids[1]), 'samefile', 'x'); setBackup('failed'); })()`); await sleep(300);
    const failed = await ev(SCAN); await ev("setBackup('ok')"); const ok = await ev(SCAN);
    const all = new Map(); for (const r of [...failed, ...ok]) all.set(r.el + r.use + r.colour, r);
    // state of the selected radio and the active entry are already on the page; the hover border colour comes from the same token as the active border
    console.log("\n=== " + profileName + " " + theme + " : " + all.size + " uses of Mint orange/green (or the app's green) ===");
    for (const r of all.values()) console.log("  " + r.use.padEnd(22) + r.colour.padEnd(34) + (r.size + " " + r.weight).padEnd(11) + " on " + String(r.on).padEnd(9) + " " + r.el + (r.extra ? "  [" + r.extra + "]" : ""));
  }
  ws.close();
} finally { chrome.kill(); server.kill(); await sleep(700); try { rmSync(profile, { recursive: true, force: true }); } catch {} }
