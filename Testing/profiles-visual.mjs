// Visual-regression capture for the profile work. Serves ONE html file (as index.html, plus any sibling files in its folder) on a throwaway origin,
// fills it with sample containers (time frozen so screenshots are repeatable), and writes screenshots + a computed-style fingerprint.
// Run: node Testing/profiles-visual.mjs <app-folder-or-html> <out-dir> [label]
// Output per look: <out>/<label>-<w>-<theme>[-states].png and <out>/<label>-<w>-<theme>.json (computed styles of every element)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
const src = process.argv[2], OUT = process.argv[3], LABEL = process.argv[4] || "shot";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe", HP = 47615, DP = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stage = mkdtempSync(join(tmpdir(), "nt-vis-site-")), profile = mkdtempSync(join(tmpdir(), "nt-vis-prof-"));
if (statSync(src).isDirectory()) { for (const f of readdirSync(src)) copyFileSync(join(src, f), join(stage, f)); } else copyFileSync(src, join(stage, "index.html"));
mkdirSync(OUT, { recursive: true });
const server = spawn("python", ["-m", "http.server", String(HP), "--bind", "127.0.0.1", "--directory", stage], { stdio: "ignore" });
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + DP, "--user-data-dir=" + profile, "--no-first-run", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
const up = async (u) => { for (let i = 0; i < 60; i++) { try { const r = await fetch(u); await r.arrayBuffer(); if (r.ok) return; } catch {} await sleep(250); } throw new Error("not up " + u); };
const FREEZE = "(()=>{const T=Date.UTC(2026,9,13,9,30,0);const R=Date;let n=0;class D extends R{constructor(...a){a.length?super(...a):super(T)}static now(){return T+(n++)}};window.Date=D;let u=0;crypto.randomUUID=()=>'00000000-0000-4000-8000-'+String(++u).padStart(12,'0');})()";
const FINGERPRINT = `(() => { const props = ['color','backgroundColor','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','outlineColor','borderTopLeftRadius','borderTopWidth','fontFamily','fontWeight','fontSize','fontStyle','boxShadow','opacity','display','height','width','textTransform','letterSpacing']; const out = []; const all = document.querySelectorAll('body, body *'); all.forEach((el, i) => { if (['SCRIPT','STYLE'].includes(el.tagName)) return; const cs = getComputedStyle(el); const o = { k: i + ':' + el.tagName + (el.id ? '#' + el.id : '') + '.' + (el.className && el.className.baseVal === undefined ? el.className : '') }; props.forEach((p) => o[p] = cs[p]); out.push(o); }); return out; })()`;
try {
  await up("http://127.0.0.1:" + DP + "/json/version"); await up("http://127.0.0.1:" + HP + "/");
  const t = await (await fetch("http://127.0.0.1:" + DP + "/json/new?" + encodeURIComponent("about:blank"), { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  await send("Page.addScriptToEvaluateOnNewDocument", { source: FREEZE });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  const metrics = (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await metrics(1920, 1080);
  await send("Page.navigate", { url: "http://127.0.0.1:" + HP + "/" }); await sleep(1500);
  const items = [
    ["Meeting notes: supplier call", "Agreed delivery moves to the 14th.\nFollow up on the revised quote."],
    ["Copilot answer: SQL window functions", "SELECT customer_id, order_date,\n  SUM(total) OVER (PARTITION BY customer_id ORDER BY order_date) AS running_total\nFROM orders;"],
    ["Reply draft to Sam", "Hi Sam,\n\nThanks for sending the draft over.\n\nAllan"],
    ["GitHub Instructions", "1. Create a branch from main.\n2. Keep commits small.\n".repeat(4)],
  ];
  for (const [title, text] of items) {
    await ev("document.getElementById('newCard').click()"); await sleep(150);
    await ev("document.querySelector('.card .title').focus()"); await send("Input.insertText", { text: title });
    await ev("document.querySelector('.card textarea.body').focus()"); await send("Input.insertText", { text });
    await sleep(1100);
  }
  // pin the third card, collapse the fourth (found by their buttons' text)
  await ev(`(() => { const cs = [...document.querySelectorAll('.card')]; const b = (c, re) => [...c.querySelectorAll('button')].find((x) => re.test(x.textContent + x.title)); const p = b(cs[2], /pin/i); if (p) p.click(); const c = b(cs[3], /collapse/i); if (c) c.click(); })()`);
  await sleep(600);
  await ev("document.activeElement && document.activeElement.blur()");
  const widths = [[1920, 1080], [1366, 768]];
  for (const theme of ["light", "dark"]) {
    await ev(`localStorage.setItem('notetaker-theme', '${theme}'); ${process.env.PROFILE ? `localStorage.setItem('notetaker-profile', '${process.env.PROFILE}')` : "localStorage.removeItem('notetaker-profile')"}`);   // PROFILE=mint to capture the Mint look
    await send("Page.reload"); await sleep(1800);
    for (const [w, h] of widths) {
      await metrics(w, h); await sleep(500); await ev("window.scrollTo(0,0)"); await sleep(300);
      const base = join(OUT, `${LABEL}-${w}-${theme}`);
      writeFileSync(base + ".png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
      writeFileSync(base + ".json", JSON.stringify(await ev(FINGERPRINT), null, 1));
      // failure states: banners, a failure panel, backup failed, search highlight
      await ev(`(() => { const dom = [...document.querySelectorAll('.card')].map((e) => cards.get(e.dataset.id)); banner('warn', 'Sample warning banner.'); banner('err', 'Sample error banner.'); showPanel(dom[0], 'changed'); showPanel(dom[1], 'permission'); showPanel(dom[2], 'samefile', 'Other'); setBackup('failed'); })()`);
      await sleep(400);
      writeFileSync(base + "-states.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
      writeFileSync(base + "-states.json", JSON.stringify(await ev(FINGERPRINT), null, 1));
      await send("Page.reload"); await sleep(1800);
    }
  }
  console.log("saved to " + OUT); ws.close();
} finally { chrome.kill(); server.kill(); await sleep(700); for (const d of [profile, stage]) try { rmSync(d, { recursive: true, force: true }); } catch {} }
