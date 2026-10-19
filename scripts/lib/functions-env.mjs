/**
 * Shared helpers for the Cloud Functions parameter file (KEY=value lines).
 *
 * The live values never live in the repo. They sit in one file outside it:
 *   $SKATEHUBBA_FUNCTIONS_ENV, else ~/.skatehubba/functions.<project>.env
 * scripts/testers-sync.mjs edits the *_TESTER_UIDS lines there, and
 * scripts/deploy.mjs copies it to functions/.env.<project> for the upload
 * and deletes that copy afterwards.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export const PROJECT_ID = "sk8hub-d7806";
export const DATABASE_ID = "skatehubba";

export function functionsEnvPath(env = process.env, project = PROJECT_ID) {
  return env.SKATEHUBBA_FUNCTIONS_ENV || join(homedir(), ".skatehubba", `functions.${project}.env`);
}

/** Parse KEY=value lines (no export, # comments, optional quotes). */
export function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** Set keys in dotenv text, keeping order/comments; appends new keys. */
export function setDotenv(text, updates) {
  const done = new Set();
  const lines = text.split(/\r?\n/);
  const out = lines.map((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && m[1] in updates) {
      done.add(m[1]);
      return `${m[1]}=${updates[m[1]]}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const [k, v] of Object.entries(updates)) if (!done.has(k)) out.push(`${k}=${v}`);
  return out.join("\n") + "\n";
}

/** Normalize a comma-separated uid list: trimmed, de-duplicated, sorted. */
export function normalizeUids(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))].sort();
}
