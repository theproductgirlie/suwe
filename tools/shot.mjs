// Headless Chrome at a phone viewport: screenshot + console/exception report.
// Usage: node tools/shot.mjs [url] [out.png] [width] [height]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url = "http://localhost:5173/", out = "shots/shot.png", w = "390", h = "844"] =
  process.argv.slice(2);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9400 + Math.floor(process.pid % 500);
const profile = mkdtempSync(join(tmpdir(), "suwe-chrome-"));

const chrome = spawn(
  CHROME,
  [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--headless=new", "--disable-gpu", "--no-first-run", "about:blank"],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    if (targets.some((t) => t.type === "page")) break;
  } catch {}
  await sleep(200);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m.result ?? m.error);
  else if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type))
    problems.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  else if (m.method === "Runtime.exceptionThrown")
    problems.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
  else if (m.method === "Log.entryAdded" && m.params.entry.level === "error")
    problems.push(`log: ${m.params.entry.text} ${m.params.entry.url ?? ""}`);
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await send("Runtime.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: Number(w),
  height: Number(h),
  deviceScaleFactor: 2,
  mobile: true,
});
await send("Page.navigate", { url });
await sleep(2500);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
const size = await send("Runtime.evaluate", {
  expression: "innerWidth + 'x' + innerHeight",
  returnByValue: true,
});
console.log(`viewport ${size.result?.value}, saved ${out}`);
console.log(problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "no console errors");
ws.close();
chrome.kill();
process.exit(problems.length ? 1 : 0);
