// Fills a throwaway copy of the app with sample cards and saves a 1920x911 screenshot. Run: node Testing/phase1-screenshot.mjs <out.png>
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, "..", "app"), OUT = process.argv[2] || "shot.png";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe", HP = 47615, DP = 9334;
const profile = mkdtempSync(join(tmpdir(), "nt-shot-")), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn("python", ["-m", "http.server", String(HP), "--bind", "127.0.0.1", "--directory", APP], { stdio: "ignore" });
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + DP, "--user-data-dir=" + profile, "--no-first-run", "about:blank"], { stdio: "ignore" });
const up = async (u) => { for (let i = 0; i < 60; i++) { try { const r = await fetch(u); await r.arrayBuffer(); if (r.ok) return; } catch {} await sleep(250); } throw new Error("not up " + u); };
try {
  await up("http://127.0.0.1:" + DP + "/json/version"); await up("http://127.0.0.1:" + HP + "/");
  const t = await (await fetch("http://127.0.0.1:" + DP + "/json/new?" + encodeURIComponent("http://127.0.0.1:" + HP + "/"), { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = (expression) => send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 911, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);
  const items = [
    ["Meeting notes: supplier call", "Agreed delivery moves to the 14th.\nFollow up on the revised quote."],
    ["Copilot answer: SQL window functions", "SELECT customer_id, order_date,\n  SUM(total) OVER (PARTITION BY customer_id ORDER BY order_date) AS running_total\nFROM orders;\n\nThe OVER clause defines the window; PARTITION BY restarts the total for each customer."],
    ["Reply draft to Sam", "Hi Sam,\n\nThanks for sending the draft over. Two small points before it goes to the client:\n\n- The second paragraph repeats the timeline from the first.\n- The pricing table uses two different currencies.\n\nHappy to talk it through whenever suits.\n\nAllan"],
    ["GitHub Instructions", "1. Create a branch from main for each change.\n2. Keep commits small; write messages in the imperative.\n3. Run the tests locally before you push.\n4. Open a draft pull request early and link the issue.\n\n".repeat(4)],
  ];
  for (const [title, text] of items) {
    await ev("document.getElementById('newCard').click()"); await sleep(150);
    await ev("document.querySelector('.card .title').focus()"); await send("Input.insertText", { text: title });
    await ev("document.querySelector('.card textarea.body').focus()"); await send("Input.insertText", { text });
    await sleep(1100);
  }
  if (process.env.THEME) { await ev("localStorage.setItem('notetaker-theme', " + JSON.stringify(process.env.THEME) + "); location.reload()"); await sleep(1800); }   // THEME=dark|light
  await ev("window.scrollTo(0,0)"); await sleep(900);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(OUT, Buffer.from(shot.data, "base64")); console.log("saved " + OUT);
  ws.close();
} finally { chrome.kill(); server.kill(); await sleep(700); try { rmSync(profile, { recursive: true, force: true }); } catch {} }
