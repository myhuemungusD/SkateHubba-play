#!/usr/bin/env node
/**
 * Roll Dice e2e: e2e/dice.spec.ts against auth, firestore, storage AND the
 * functions emulator (the diceAction callable rolls every die).
 *
 * The dice switches are turned on for this run only:
 *   - VITE_FEATURE_DICE_ENABLED=true for the Vite dev server Playwright starts.
 *   - DICE_ENABLED=true for the functions emulator, through
 *     functions/.env.demo-skatehubba (gitignored, only read for the demo
 *     project). An existing file is left alone; it just has to say
 *     DICE_ENABLED=true.
 * Nothing here touches a real Firebase project or the production build.
 *
 * Extra arguments go to Playwright, e.g. `npm run test:e2e:dice -- -g Craps`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envFile = resolve(root, "functions/.env.demo-skatehubba");

function run(cmd, args, env = process.env) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env, shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(envFile)) {
  writeFileSync(envFile, "DICE_ENABLED=true\n");
  console.log("[e2e-dice] wrote functions/.env.demo-skatehubba (DICE_ENABLED=true)");
} else if (!/^DICE_ENABLED=true$/m.test(readFileSync(envFile, "utf8"))) {
  console.error("[e2e-dice] functions/.env.demo-skatehubba exists but doesn't set DICE_ENABLED=true.");
  process.exit(1);
}

run("node", ["scripts/make-emulator-rules.mjs"]);
run("npm", ["--prefix", "functions", "run", "build"]);

const playwright = ["playwright", "test", "e2e/dice.spec.ts", ...process.argv.slice(2)]
  .map((part) => (/^[\w./:=,-]+$/.test(part) ? part : `'${part.replace(/'/g, "'\\''")}'`))
  .join(" ");
run(
  "npx",
  [
    "firebase",
    "emulators:exec",
    "--config",
    "firebase.emulator.json",
    "--only",
    "auth,firestore,storage,functions",
    "--project",
    "demo-skatehubba",
    playwright,
  ],
  { ...process.env, E2E_DICE: "true", VITE_FEATURE_DICE_ENABLED: "true" },
);
