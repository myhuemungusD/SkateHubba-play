#!/usr/bin/env node
/**
 * Guard firestore.rules against Firebase's 256 KiB (262,144-byte) rules
 * source limit (GAPS P2-9). Deploys fail outright above the cap, so CI
 * fails well before it.
 *   > FAIL_BYTES → exit 1    > WARN_BYTES → GitHub ::warning
 * Usage: node scripts/check-rules-size.mjs [path=firestore.rules]
 */
import { statSync } from "node:fs";

export const LIMIT_BYTES = 262_144;
export const WARN_BYTES = 225_000;
export const FAIL_BYTES = 240_000;

const file = process.argv[2] ?? "firestore.rules";
const bytes = statSync(file).size;
const pct = ((bytes / LIMIT_BYTES) * 100).toFixed(1);
const msg = `${file}: ${bytes.toLocaleString("en-US")} bytes = ${pct}% of the ${LIMIT_BYTES.toLocaleString("en-US")}-byte Firebase limit (warn > ${WARN_BYTES.toLocaleString("en-US")}, fail > ${FAIL_BYTES.toLocaleString("en-US")})`;

if (bytes > FAIL_BYTES) {
  console.log(
    `::error file=${file}::${msg}. Extract shared predicates or move long comments to docs/FIRESTORE_RULES_NOTES.md.`,
  );
  process.exit(1);
} else if (bytes > WARN_BYTES) {
  console.log(`::warning file=${file}::${msg}`);
} else {
  console.log(`OK ${msg}`);
}
