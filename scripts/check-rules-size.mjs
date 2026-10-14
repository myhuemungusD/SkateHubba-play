/**
 * Size guard for the security rulesets. Firebase rejects a ruleset over
 * 256 KB at deploy time, so an oversized firestore.rules only fails once it
 * reaches the Firebase API. Wired into `npm run test:rules`, which runs in
 * the PR gate whenever rules change and before every rules deploy, so CI
 * fails the regression first without a new workflow.
 *
 * Warns past 80% of the limit; fails past 90% to leave room for a fix.
 *
 * Usage: node scripts/check-rules-size.mjs
 */
import { statSync } from "node:fs";
import { join } from "node:path";

const LIMIT_BYTES = 256 * 1024;
const WARN_RATIO = 0.8;
const FAIL_RATIO = 0.9;

const rulesFiles = ["firestore.rules", "storage.rules"];
let failed = false;

for (const file of rulesFiles) {
  const bytes = statSync(join(process.cwd(), file)).size;
  const ratio = bytes / LIMIT_BYTES;
  const summary = `${file} is ${(bytes / 1024).toFixed(1)} KiB (${(ratio * 100).toFixed(1)}% of the 256 KiB limit)`;
  if (ratio > FAIL_RATIO) {
    console.error(`rules size: ${summary}, over the ${FAIL_RATIO * 100}% ceiling`);
    failed = true;
  } else if (ratio > WARN_RATIO) {
    console.warn(`rules size: ${summary}, past the ${WARN_RATIO * 100}% warning line`);
  } else {
    console.log(`rules size: ${summary}`);
  }
}

if (failed) process.exit(1);
