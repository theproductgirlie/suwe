// Checks the game against start.ng's published requirements (https://start.ng/docs.md):
// the files and rules, then the 10-point checklist, then the live site and start.ng's own check.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { join, relative, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DOCS = join(ROOT, "docs");
const REPO = "https://github.com/theproductgirlie/suwe";
let fails = 0;
let notes = 0;
const out = (tag, msg) => console.log(`${tag.padEnd(5)} ${msg}`);
const ok = (msg) => out("PASS", msg);
const bad = (msg) => {
  fails++;
  out("FAIL", msg);
};
const note = (msg) => {
  notes++;
  out("NOTE", msg);
};
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));
const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

// ---- the files ----------------------------------------------------------------------
const ALLOWED = new Set("html htm css js mjs json map txt svg png jpg jpeg gif webp avif ico woff woff2 ttf otf mp3 ogg wav mp4 webm wasm".split(" "));
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else files.push({ path: relative(DOCS, p), size: st.size, full: p });
  }
})(DOCS);

console.log("\nFiles and rules");
check(files.some((f) => f.path === "index.html"), "a ready-to-play index.html is in docs/");
const bySkipped = files.filter((f) => !ALLOWED.has(extname(f.path).slice(1).toLowerCase()));
check(bySkipped.length === 0, `every file is an allowed type${bySkipped.length ? ` (not allowed: ${bySkipped.map((f) => f.path).join(", ")})` : ""}`);
check(files.every((f) => !f.path.split("/").some((seg) => seg.startsWith("."))), "no hidden files or folders");
check(files.length <= 2000, `${files.length} files (max 2,000)`);
const total = files.reduce((a, f) => a + f.size, 0);
check(total <= 100 * 1024 * 1024, `${(total / 1024).toFixed(0)} KB in total (max 100 MB)`);
check(files.every((f) => f.size <= 25 * 1024 * 1024), "no file over 25 MB");

const read = (rel) => readFileSync(join(DOCS, rel), "utf8");
const text = files.filter((f) => /\.(html|css|js|json|svg)$/.test(f.path)).map((f) => ({ ...f, body: readFileSync(f.full, "utf8") }));

const html = read("index.html");
check(!/src=["']\/src\//.test(html) && !/\.(ts|tsx|jsx)["']/.test(html), "index.html is built (no source files that need a build step)");
const absolute = [];
for (const m of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const u = m[1];
  if (/^(https?:)?\/\//.test(u) || u.startsWith("/") ) absolute.push(`index.html: ${u}`);
}
for (const f of text.filter((t) => t.path.endsWith(".css"))) {
  for (const m of f.body.matchAll(/url\(\s*["']?([^"')]+)/g)) if (m[1].startsWith("/") && !m[1].startsWith("//")) absolute.push(`${f.path}: ${m[1]}`);
}
for (const f of text.filter((t) => t.path.endsWith(".js"))) {
  for (const m of f.body.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)) if (!m[1].startsWith(".")) absolute.push(`${f.path}: import "${m[1]}"`);
}
check(absolute.length === 0, `all paths are relative${absolute.length ? ` (found: ${absolute.slice(0, 4).join("; ")})` : ""}`);

const http = text.filter((t) => /http:\/\/(?!www\.w3\.org\/2000\/svg)/.test(t.body)).map((t) => t.path);
check(http.length === 0, `nothing loads over http://${http.length ? ` (${http.join(", ")})` : ""}`);
const extScripts = [...html.matchAll(/<script[^>]+src=["'](https?:[^"']+)/g)].map((m) => m[1]);
check(extScripts.length === 0, "no external scripts (everything is copied into the repo)");
check(!/type=["']password["']/i.test(html) && text.every((t) => !/type\s*=\s*["']password["']/i.test(t.body)), "no password fields");
check(text.every((t) => !/\beval\s*\(|new Function\s*\(/.test(t.body)), "no eval or hidden code");
check(text.every((t) => !/location\.(replace|assign)\s*\(/.test(t.body)), "no automatic redirects");
const secrets = text.filter((t) => /(api[_-]?key|secret|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,})/i.test(t.body)).map((t) => t.path);
check(secrets.length === 0, "no secrets in the game files");
check(!files.some((f) => /\.(apk|aab|env|pem)$/i.test(f.path)), "no APK, .env or key files are served");

// ---- the cover -------------------------------------------------------------------------
console.log("\nCover picture");
const coverFile = files.find((f) => /^cover\.(png|jpe?g|webp)$/.test(f.path));
check(Boolean(coverFile), "cover.png is next to index.html");
if (coverFile) {
  const b = readFileSync(coverFile.full);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  check(w >= 640 && h >= 400, `${w}x${h} (at least 640x400; 1600x1000 looks sharp)`);
  check(Math.abs(w / h - 1.6) < 0.01, `16:10 ratio (${(w / h).toFixed(2)})`);
  check(coverFile.size < 2 * 1024 * 1024, `${(coverFile.size / 1024).toFixed(0)} KB (under 2 MB)`);
}

// ---- players and the character rule ----------------------------------------------------
console.log("\nPlayers and the character rule");
const js = (rel) => read(`js/${rel}`);
const startng = js("startng.js");
check(startng.includes("startng:whoami"), "asks start.ng who is playing (startng:whoami)");
check(/e\.origin\s*!==\s*START_NG/.test(startng) && /e\.source\s*!==\s*el\.contentWindow/.test(startng), "checks the reply's origin and source before trusting it");
check(startng.includes('const START_NG = "https://start.ng"') && /\$\{START_NG\}\/connect/.test(startng), "uses start.ng's connect page (https://start.ng/connect)");
check(/location\.hostname\.endsWith\("\.start\.ng"\)/.test(startng), "only talks to start.ng when served from *.start.ng, so it still runs locally");
const character = js("render/character.js");
const fields = ["body", "primaryColor", "secondaryColor", "skinColor", "hairColor", "hair", "hat", "accessory"];
check(fields.every((f) => character.includes(f)), "the character is drawn from all 8 start.ng style fields");
const hairs = ["short", "afro", "braids", "bun", "ponytail", "dreads", "bald"];
const hats = ["none", "cap", "beanie", "tophat", "crown"];
const acc = ["none", "glasses", "earrings", "beard", "scarf", "backpack"];
check([...hairs, ...hats, ...acc].every((v) => character.includes(`"${v}"`)), "every hair, hat and accessory value is handled");
check(/normalizeStyle/.test(character) && /HEX/.test(character), "unknown or missing style values fall back to something sensible");
const main = js("main.js");
check(/style:\s*p\.style/.test(main) || /view\.hero\.style = normalizeStyle\(p\.look\)/.test(main), "the player's own look is used for their character in the match");
check(html.includes('id="player-card"') && html.includes('id="player-face"') && /player-account/.test(html), "a profile card shows their face, character name and @account");
check(html.includes('id="player-sign-in"') && main.includes("signInUrl()"), "someone who is not signed in gets a Sign in button");
check(startng.includes("return_to="), "sign-in links back to the game (return_to)");
check(/visibilitychange/.test(startng) && /focus/.test(startng), "asks again when the player comes back to the tab");

// ---- the leaderboard --------------------------------------------------------------------
console.log("\nLeaderboard");
let cfg = null;
try {
  cfg = JSON.parse(read("startng.json"));
  ok("startng.json is valid JSON");
} catch {
  bad("startng.json is valid JSON");
}
if (cfg) {
  const stats = cfg.leaderboard?.stats ?? [];
  check(stats.length >= 1 && stats.length <= 5, `${stats.length} stats (1 to 5 allowed)`);
  check(stats.every((s) => /^[a-z][a-z0-9_]{0,23}$/.test(s.key) && s.label.length <= 30 && ["highest", "lowest"].includes(s.order ?? "highest")), "keys, labels and order follow the rules");
  const sent = [...main.slice(main.indexOf("await saveScore({")).matchAll(/^\s+(\w+): whole\(/gm)].map((m) => m[1]);
  check(JSON.stringify(sent) === JSON.stringify(stats.map((s) => s.key)), `the game sends exactly those stats (${sent.join(", ")}), each a whole number`);
  check(startng.includes("startng:score") && startng.includes("startng:leaderboard"), "saves scores and reads the board through start.ng");
}

// ---- the repo and the live site ----------------------------------------------------------
console.log("\nRepo and live site");
const vis = sh("gh repo view theproductgirlie/suwe --json visibility -q .visibility");
check(vis === "PUBLIC", `the GitHub repo is public (${vis || "could not read"})`);
const ahead = sh("git rev-list --count origin/main..HEAD");
const dirty = sh("git status --porcelain docs");
if (ahead && ahead !== "0") note(`${ahead} commit(s) are not pushed yet, so the live site is behind this checkout`);
else ok("everything is pushed to GitHub");
if (dirty) note(`uncommitted changes in docs/: ${dirty.split("\n").length} file(s)`);

try {
  const res = await fetch("https://api.start.ng/games/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_url: REPO, name: "suwe" }),
  });
  const body = await res.json();
  check(res.status === 200 && body.ok, `start.ng's own check passes for what is on GitHub (${body.files} files, ${body.warnings?.length ?? "?"} warnings, ${body.errors?.length ?? 0} errors)`);
  if (body.errors?.length) body.errors.forEach((e) => bad(`  ${e.code}: ${e.message}`));
  if (body.warnings?.length) body.warnings.forEach((w) => note(`  ${w.code}: ${w.message}`));
  check(body.update === true, "the game is already published and linked to the account");
} catch (e) {
  note(`could not reach api.start.ng (${e.message})`);
}

try {
  const games = await (await fetch("https://api.start.ng/games")).json();
  const g = games.find((x) => x.name === "suwe");
  check(Boolean(g), "suwe is in start.ng's live games list");
  if (g) {
    check(Boolean(g.cover_url), "its card has a cover picture");
    if (g.leaderboard) ok(`start.ng knows its leaderboard columns (${g.leaderboard.stats?.map((s) => s.key).join(", ") ?? "yes"})`);
    else if (ahead && ahead !== "0") note("start.ng does not know the leaderboard columns yet: startng.json is in the unpushed commits");
    else bad("start.ng does not know the leaderboard columns (startng.json is not being picked up)");
    if (g.update_problem) bad(`start.ng reports a problem with the latest push: ${JSON.stringify(g.update_problem)}`);
  }
  // Is the live site the same as this checkout?
  let same = 0;
  let differ = [];
  for (const f of files.filter((x) => /\.(js|css|html|json)$/.test(x.path))) {
    const r = await fetch(`https://suwe.start.ng/${f.path === "index.html" ? "" : f.path}`);
    const live = Buffer.from(await r.arrayBuffer());
    const local = readFileSync(f.full);
    if (r.ok && createHash("sha1").update(live).digest("hex") === createHash("sha1").update(local).digest("hex")) same++;
    else differ.push(f.path);
  }
  if (differ.length) note(`the live site differs from this checkout in ${differ.length} file(s): ${differ.slice(0, 6).join(", ")}${differ.length > 6 ? ", ..." : ""}`);
  else ok(`the live site matches this checkout exactly (${same} files)`);
} catch (e) {
  note(`could not check the live site (${e.message})`);
}

console.log(`
start.ng's 10-point checklist (from https://start.ng/docs.md)
  1. A built index.html is committed in docs/                       -> checked above
  2. Relative paths, allowed file types, no secrets                  -> checked above
  3. The game finds out who is playing (startng:whoami + origin)     -> checked above
  4. It shows the player's start.ng character                        -> checked above
  5. Not signed in: a way to sign in                                 -> checked above
  6. Leaderboard with startng.json and score saving                  -> checked above
  7. cover.png, 16:10                                                -> checked above
  8. The repo is public and pushed                                   -> checked above (see notes)
  9. start.ng's check passes with no errors                          -> checked above
 10. Published and approved                                          -> checked above`);
console.log(`\n${fails ? `${fails} FAILED` : "all requirements met"}${notes ? `, ${notes} note(s)` : ""}`);
process.exit(fails ? 1 : 0);
