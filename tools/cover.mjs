// Renders tools/cover.html to docs/cover.png (1600x1000, 16:10). Needs `npm run serve`.
import { launch, sleep } from "./cdp.mjs";
const b = await launch({ url: "http://localhost:5173/_tools/cover.html", width: 1600, height: 1000, scale: 1, mobile: false });
await sleep(800);
await b.shot("docs/cover.png");
console.log(b.problems.length ? `PROBLEMS:\n${b.problems.join("\n")}` : "cover saved, no console errors");
await b.close();
process.exit(b.problems.length ? 1 : 0);
