// Minimal Chrome DevTools Protocol helper for phone-sized headless runs.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
process.setMaxListeners(0); // each browser adds exit handlers; a long run opens many
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 390, height = 844, url, scale = 2, mobile = true, args = [] }) {
  const port = 9400 + Math.floor(process.pid % 500);
  const profile = mkdtempSync(join(tmpdir(), "suwe-chrome-"));
  const chrome = spawn(
    CHROME,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--headless=new", "--disable-gpu", "--no-first-run", ...args, "about:blank"],
    { stdio: "ignore" },
  );
  // Never leave a browser behind, even if this script is stopped.
  const cleanup = () => {
    try {
      chrome.kill("SIGKILL");
    } catch {}
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  };
  process.once("exit", cleanup);
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {}
    await sleep(200);
  }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0;
  const pending = new Map();
  const listeners = new Map(); // method -> callbacks, for tools that want raw protocol events
  const problems = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method) for (const fn of listeners.get(m.method) ?? []) fn(m.params);
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
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile });
  if (mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await send("Page.navigate", { url });
  await sleep(1500);

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result?.value;
  };
  const touch = (type, x, y) =>
    send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });

  return {
    send,
    on: (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]),
    problems,
    evaluate,
    touch,
    async shot(file) {
      const s = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(file, Buffer.from(s.data, "base64"));
    },
    async tap(x, y) {
      await touch("touchStart", x, y);
      await sleep(30);
      await touch("touchEnd", x, y);
    },
    async close() {
      ws.close();
      cleanup();
    },
  };
}
