// Tiny static server for local play and headless checks. Serves docs/ only.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "docs");
const port = Number(process.env.PORT) || 5173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const rel = normalize(path.endsWith("/") ? path + "index.html" : path);
  if (rel.includes("..")) return res.writeHead(400).end();
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, { "Content-Type": types[extname(rel)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`suwe on http://localhost:${port}`));
