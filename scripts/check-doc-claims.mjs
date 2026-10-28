#!/usr/bin/env node
/**
 * Fails when a doc or store text states something the code contradicts.
 *
 * Facts that live in code are read from code, never copied:
 *   - version: package.json, pbxproj MARKETING_VERSION
 *   - store flags: ios-release.yml, ci_post_clone.sh, android-aab.yml
 *   - Android permissions: AndroidManifest.xml
 *   - iOS collected data types: PrivacyInfo.xcprivacy
 *   - coverage floors: vite.config.ts
 *   - minimum age: src/utils/age.ts
 * Facts that live nowhere else (entity, public emails, doc claims) are in
 * docs/facts.json. Add a claim there whenever a doc says something that can drift.
 *
 * Usage: node scripts/check-doc-claims.mjs [--root <dir>] [--json]
 * Exit 1 on any error; warnings print but pass.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const read = (root, f) => readFileSync(join(root, f), "utf8");

/** `VITE_FEATURE_X: "true"` (workflow) or `export VITE_FEATURE_X=true` (shell). Input defaults count as their default. */
export function parseFlags(text) {
  const flags = {};
  const re = /(?:^|\s)(?:export\s+)?(VITE_FEATURE_[A-Z0-9_]+)\s*[:=]\s*"?([^"\s]+)"?/gm;
  for (const m of text.matchAll(re)) {
    let v = m[2];
    const dflt = /\$\{\{?\s*[^}]*\|\|\s*'?(\w+)'?|:-(\w+)\}/.exec(v);
    if (v.startsWith("$")) v = dflt ? dflt[1] || dflt[2] : "input";
    flags[m[1]] = v;
  }
  return flags;
}

export function parseAndroidPermissions(xml) {
  return [...xml.matchAll(/uses-permission\s+android:name="android\.permission\.([A-Z_]+)"/g)].map((m) => m[1]);
}

export function parsePrivacyTypes(xml) {
  return [...xml.matchAll(/<string>NSPrivacyCollectedDataType(?!Purpose)([A-Za-z]+)<\/string>/g)].map((m) => m[1]);
}

/** 4-tuples (lines/functions/branches/statements) from vite.config.ts thresholds. */
export function parseCoverageTuples(cfg) {
  const out = new Set();
  for (const m of cfg.matchAll(
    /lines:\s*([\d.]+),\s*functions:\s*([\d.]+),\s*branches:\s*([\d.]+),\s*statements:\s*([\d.]+)/g,
  )) {
    out.add(`${m[1]}/${m[2]}/${m[4]}/${m[3]}`); // docs write lines/functions/branches/statements; keep both orders
    out.add(`${m[1]}/${m[2]}/${m[3]}/${m[4]}`);
  }
  return out;
}

function listDocs(root) {
  let files;
  try {
    files = execFileSync("git", ["ls-files", "*.md", "public/*.html", "fastlane/metadata/**"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    files = [];
  }
  // Archived audits and the changelog are dated history, not current claims.
  return files.filter((f) => !/^docs\/(archive|audits)\/|CHANGELOG\.md$/.test(f) && existsSync(join(root, f)));
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

export function check(root) {
  const errors = [];
  const warns = [];
  const facts = JSON.parse(read(root, "docs/facts.json"));
  const add = (sev, msg) => (sev === "warn" ? warns : errors).push(msg);

  // 1. Version
  const version = JSON.parse(read(root, "package.json")).version;
  const pbx = read(root, "ios/App/App.xcodeproj/project.pbxproj");
  for (const m of pbx.matchAll(/MARKETING_VERSION = ([\d.]+);/g))
    if (m[1] !== version) add("error", `pbxproj MARKETING_VERSION ${m[1]} != package.json ${version}`);

  // 2. Store flags: the two iOS build paths must agree
  const ios = parseFlags(read(root, ".github/workflows/ios-release.yml"));
  const xcode = parseFlags(read(root, "ios/App/ci_scripts/ci_post_clone.sh"));
  const android = parseFlags(read(root, ".github/workflows/android-aab.yml"));
  for (const k of new Set([...Object.keys(ios), ...Object.keys(xcode)])) {
    if (ios[k] === "input" || xcode[k] === "input") continue;
    if ((ios[k] ?? "unset") !== (xcode[k] ?? "unset"))
      add("error", `${k}: ios-release.yml=${ios[k] ?? "unset"} but ci_post_clone.sh=${xcode[k] ?? "unset"}`);
  }
  const platforms = { ios, android };

  // 3. Registered claims
  for (const c of facts.claims ?? []) {
    if (c.when) {
      const ok = Object.entries(c.when).every(([p, kv]) =>
        Object.entries(kv).every(([k, v]) => (platforms[p][k] ?? "unset") === v),
      );
      if (!ok) continue;
    }
    const path = join(root, c.file);
    if (!existsSync(path)) {
      add("error", `${c.id}: ${c.file} is missing`);
      continue;
    }
    const text = readFileSync(path, "utf8");
    if (c.mustNotMatch) {
      const m = new RegExp(c.mustNotMatch, "i").exec(text);
      if (m)
        add(
          c.severity ?? "error",
          `${c.id}: ${c.file}:${lineOf(text, m.index)} says "${m[0].slice(0, 80)}" — ${c.why}`,
        );
    }
    if (c.mustMatch && !new RegExp(c.mustMatch, "i").test(text))
      add(c.severity ?? "error", `${c.id}: ${c.file} must say /${c.mustMatch}/ — ${c.why}`);
  }

  // 4. Entity
  for (const e of facts.entityMustAppearIn ?? []) {
    const p = join(root, e.file);
    if (!existsSync(p) || !readFileSync(p, "utf8").includes(facts.entity))
      add(e.severity, `${e.file} does not name the operator "${facts.entity}"`);
  }

  const docs = listDocs(root);
  const allowed = new Set(facts.emails);
  const coverage = parseCoverageTuples(read(root, "vite.config.ts"));
  for (const f of docs) {
    const text = read(root, f);
    // 5. Public emails
    for (const m of text.matchAll(/[a-z0-9._+-]+@skatehubba\.com/gi))
      if (!allowed.has(m[0].toLowerCase()))
        add("error", `${f}:${lineOf(text, m.index)} uses ${m[0]}, not in docs/facts.json emails`);
    // 6. Coverage tuples quoted in docs must exist in vite.config.ts
    for (const m of text.matchAll(/\b(\d{2,3}(?:\.\d)?\/\d{2,3}(?:\.\d)?\/\d{2,3}(?:\.\d)?\/\d{2,3}(?:\.\d)?)\b/g))
      if (!coverage.has(m[1]))
        add("error", `${f}:${lineOf(text, m.index)} quotes coverage ${m[1]}, not a vite.config.ts floor`);
  }

  // 7. Every Android permission and iOS data type is named in the privacy answers
  const answers = read(root, "docs/STORE_PRIVACY_ANSWERS.md");
  for (const perm of parseAndroidPermissions(read(root, "android/app/src/main/AndroidManifest.xml")))
    if (!answers.includes(perm)) add("error", `STORE_PRIVACY_ANSWERS.md never names Android permission ${perm}`);
  const words = (t) =>
    t
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/sor/, "s or")
      .toLowerCase();
  for (const t of parsePrivacyTypes(read(root, "ios/App/App/PrivacyInfo.xcprivacy")))
    if (!answers.toLowerCase().includes(words(t)))
      add("warn", `STORE_PRIVACY_ANSWERS.md has no row for manifest type ${t} ("${words(t)}")`);

  // 8. Minimum age
  const minAge = /MIN_AGE = (\d+)/.exec(read(root, "src/utils/age.ts"))?.[1];
  for (const f of docs) {
    const text = read(root, f);
    for (const m of text.matchAll(/age gate[^.\n]{0,20}?\b(\d{1,2})\+/gi))
      if (m[1] !== minAge)
        add("error", `${f}:${lineOf(text, m.index)} says age gate ${m[1]}+, code MIN_AGE is ${minAge}`);
  }

  return { errors, warns, version, flags: platforms };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--root");
  const root = i > 0 ? process.argv[i + 1] : process.cwd();
  const r = check(root);
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  for (const w of r.warns) console.warn(`warn  ${w}`);
  for (const e of r.errors) console.error(`error ${e}`);
  console.log(`check-doc-claims: ${r.errors.length} error(s), ${r.warns.length} warning(s)`);
  process.exit(r.errors.length ? 1 : 0);
}
