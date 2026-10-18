// Phone-size screenshot plus console/exception report.
// Usage: node tools/shot.mjs [url] [out.png] [width] [height]
import { launch, sleep } from "./cdp.mjs";

const [url = "http://localhost:5173/", out = "shots/shot.png", w = "390", h = "844"] = process.argv.slice(2);
const b = await launch({ url, width: Number(w), height: Number(h) });
await sleep(1000);
await b.shot(out);
console.log(`viewport ${await b.evaluate("innerWidth + 'x' + innerHeight")}, saved ${out}`);
console.log(b.problems.length ? `PROBLEMS:\n${b.problems.join("\n")}` : "no console errors");
await b.close();
process.exit(b.problems.length ? 1 : 0);
