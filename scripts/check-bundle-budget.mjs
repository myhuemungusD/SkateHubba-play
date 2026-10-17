/**
 * Gzip budgets for the production JS chunks that sit on the first-paint
 * and Firebase paths. Wired into `npm run build` so CI fails a regression
 * without a new workflow. Limits are ~10% above the measured build.
 *
 * Usage: node scripts/check-bundle-budget.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const assetsDir = join(process.cwd(), "dist", "assets");

/** @type {{ name: string; match: RegExp; maxGzip: number }[]} */
const budgets = [
  { name: "entry", match: /^index-.*\.js$/, maxGzip: 36_000 },
  { name: "react", match: /^react-.*\.js$/, maxGzip: 76_000 },
  { name: "firebase-core", match: /^firebase-core-.*\.js$/, maxGzip: 28_000 },
  { name: "firebase-auth", match: /^firebase-auth-.*\.js$/, maxGzip: 36_000 },
  { name: "firebase-firestore", match: /^firebase-firestore-.*\.js$/, maxGzip: 155_000 },
  { name: "firebase-storage", match: /^firebase-storage-.*\.js$/, maxGzip: 14_000 },
  { name: "firebase-app-check", match: /^firebase-app-check-.*\.js$/, maxGzip: 18_000 },
];

const files = readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
let failed = false;

for (const budget of budgets) {
  const matches = files.filter((name) => budget.match.test(name));
  if (matches.length === 0) {
    console.error(`bundle budget: missing ${budget.name} chunk`);
    failed = true;
    continue;
  }
  for (const name of matches) {
    const gzip = gzipSync(readFileSync(join(assetsDir, name))).length;
    const kib = (gzip / 1024).toFixed(1);
    const limit = (budget.maxGzip / 1024).toFixed(1);
    if (gzip > budget.maxGzip) {
      console.error(`bundle budget: ${budget.name} ${name} is ${kib} KiB gzip (limit ${limit} KiB)`);
      failed = true;
    } else {
      console.log(`bundle budget: ${budget.name} ${name} ${kib} KiB gzip (limit ${limit} KiB)`);
    }
  }
}

/**
 * JS the first load needs. The entry may be a module script, a modulepreload,
 * or the `app-entry` meta (public/lcp-shell.js injects it after first paint).
 * Static imports of the entry are part of that graph — Vite used to emit
 * them as modulepreloads.
 */
const html = readFileSync(join(process.cwd(), "dist", "index.html"), "utf8");
const initial = [...html.matchAll(/(?:src|href|content)="\/assets\/([^"]+\.js)"/g)].map((match) => match[1]);
const uniqueInitial = [...new Set(initial)];
for (const name of [...uniqueInitial]) {
  if (!name.startsWith("index-")) continue;
  const source = readFileSync(join(assetsDir, name), "utf8");
  for (const dep of source.matchAll(/from"\.\/([^"]+\.js)"/g)) {
    uniqueInitial.push(dep[1]);
  }
}
const dedupedInitial = [...new Set(uniqueInitial)];
if (dedupedInitial.length === 0) {
  console.error("bundle budget: no initial JS in dist/index.html");
  failed = true;
} else {
  let total = 0;
  for (const name of dedupedInitial) {
    total += gzipSync(readFileSync(join(assetsDir, name))).length;
  }
  const maxInitial = 150 * 1024;
  const kib = (total / 1024).toFixed(1);
  if (total > maxInitial) {
    console.error(`bundle budget: initial JS ${kib} KiB gzip (limit 150.0 KiB) [${dedupedInitial.join(", ")}]`);
    failed = true;
  } else {
    console.log(`bundle budget: initial JS ${kib} KiB gzip (limit 150.0 KiB)`);
  }
}

/**
 * three / react-three-fiber / drei must stay in the lazy runner chunk.
 * The main entry and anything it static-imports are the Lighthouse path.
 * Sourcemaps list the original modules; a string scan covers a chunk whose
 * map was stripped.
 */
const THREE_SOURCE = /node_modules[/\\](?:three|@react-three|three-stdlib)[/\\]/;
const THREE_TEXT = ["@react-three/fiber", "@react-three/drei", "THREE.WebGLRenderer", "react-three-fiber"];

function chunkUsesThree(name) {
  const mapPath = join(assetsDir, `${name}.map`);
  if (existsSync(mapPath)) {
    try {
      const sources = JSON.parse(readFileSync(mapPath, "utf8")).sources ?? [];
      if (sources.some((source) => THREE_SOURCE.test(String(source)))) return true;
    } catch (err) {
      console.error(`bundle budget: could not read sourcemap for ${name}: ${err.message}`);
      failed = true;
    }
  }
  const js = readFileSync(join(assetsDir, name), "utf8");
  return THREE_TEXT.some((marker) => js.includes(marker));
}

const initialThree = [];
const lazyThree = [];
for (const name of files) {
  if (!chunkUsesThree(name)) continue;
  if (dedupedInitial.includes(name)) initialThree.push(name);
  else lazyThree.push(name);
}
if (initialThree.length > 0) {
  console.error(`bundle budget: three/r3f landed in the initial JS [${initialThree.join(", ")}]`);
  failed = true;
} else if (lazyThree.length === 0) {
  console.error("bundle budget: expected three/r3f in a lazy chunk (runner route)");
  failed = true;
} else {
  console.log(`bundle budget: three/r3f is lazy only [${lazyThree.join(", ")}]`);
}

if (failed) process.exit(1);
