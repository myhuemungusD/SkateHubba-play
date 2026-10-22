/**
 * Release guard: no tracking in any privacy manifest that ships in the app.
 *
 * Runs on the signed IPA (or a built .app folder) after `build_app` and before
 * the TestFlight upload (fastlane/Fastfile, lane :beta). It walks every
 * `*.xcprivacy` in the bundle (the app's own, SwiftPM resource bundles and
 * embedded frameworks) and fails if any of them sets NSPrivacyTracking, lists
 * NSPrivacyTrackingDomains, or marks a collected data type as used for
 * tracking. Our App Store answers say "Data used to track you: none" and the
 * app has no App Tracking Transparency prompt, so any of those is a 5.1.2
 * rejection risk (1.2.0 build 1 shipped the Facebook SDK, which declares all
 * three).
 *
 * It also fails on an unreadable or oddly shaped manifest, a missing app
 * manifest, and any Facebook SDK bundle or framework by name.
 *
 * It also prints every manifest found and the combined collected data types,
 * and appends them to $GITHUB_STEP_SUMMARY. That list is the same data Xcode's
 * Privacy Report aggregates, so each release run keeps the evidence without a
 * Mac.
 *
 * Usage: node scripts/check-ios-privacy-manifests.mjs <path to .ipa or .app>
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "[check-ios-privacy-manifests]";

/**
 * Converts a property list (XML or binary) to JSON with macOS `plutil`.
 *
 * Every manifest goes through `plutil`, never a hand-written parser: it is
 * Apple's own CoreFoundation reader, so comments, CDATA, entities, odd tag
 * spacing and binary files all resolve exactly as they do for Xcode's Privacy
 * Report, and malformed input makes it exit non-zero (execFileSync throws).
 * Manifests hold no <date>/<data>, so JSON output loses nothing; if one ever
 * did, the conversion fails, which fails the check.
 *
 * Off macOS there is no `plutil`, and a weaker substitute would be the thing
 * that lets a tracking manifest through, so it refuses instead. Tests inject
 * a converter.
 */
export function plutilJson(path, platform = process.platform) {
  if (platform !== "darwin") throw new Error("plutil required (macOS): refusing to parse a plist without it");
  return execFileSync("plutil", ["-convert", "json", "-o", "-", path]);
}

/** Reads one manifest into plain JS values. */
export function readManifest(path, convert = plutilJson) {
  return JSON.parse(convert(path).toString("utf8"));
}

// Facebook SDK bundles and frameworks (FBSDKCoreKit, FacebookCore, FBAEMKit…).
// Checked by name too, so one that ships without a manifest still fails. Only
// native code and resource containers count, so a web asset under public/
// (a facebook-icon.svg, a FacebookShare-*.js chunk) never fails a release.
const FACEBOOK_NAME = /(?:facebook|fbsdk|fbaem)[^/]*\.(?:bundle|framework|appex|dylib)$/i;

/**
 * Every `*.xcprivacy` file under `dir`, sorted, plus any path whose name looks
 * like a Facebook SDK. Directory symlinks are not followed: an iOS .app is a
 * shallow bundle, and Xcode copies resource bundles and frameworks as real
 * folders, so a symlink would point back into the same tree at most.
 */
export function scanApp(dir) {
  const manifests = [];
  const facebook = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (FACEBOOK_NAME.test(entry.name)) facebook.push(relative(dir, full));
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".xcprivacy")) manifests.push(full);
    }
  };
  walk(dir);
  return { manifests: manifests.sort(), facebook: facebook.sort() };
}

const shortType = (t) => String(t).replace(/^NSPrivacyCollectedDataType/, "");

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Problems in one parsed manifest (empty when clean).
 *
 * The shape is validated strictly and anything unexpected is a failure, not a
 * pass: a tracking flag written as a string or a number, or a manifest whose
 * root isn't a dictionary, must not slip through as "no tracking".
 */
export function manifestProblems(manifest) {
  if (!isObject(manifest)) return ["root is not a dictionary"];
  const problems = [];
  const tracking = manifest.NSPrivacyTracking;
  if (tracking !== undefined && typeof tracking !== "boolean") problems.push("NSPrivacyTracking has unexpected type");
  else if (tracking === true) problems.push("NSPrivacyTracking is true");

  const domains = manifest.NSPrivacyTrackingDomains;
  if (domains !== undefined && !isStringArray(domains)) problems.push("NSPrivacyTrackingDomains has unexpected type");
  else if (domains?.length) problems.push(`NSPrivacyTrackingDomains lists ${domains.join(", ")}`);

  const types = manifest.NSPrivacyCollectedDataTypes;
  if (types !== undefined && !(Array.isArray(types) && types.every(isObject))) {
    problems.push("NSPrivacyCollectedDataTypes has unexpected type");
    return problems;
  }
  for (const entry of types ?? []) {
    const name = shortType(entry.NSPrivacyCollectedDataType);
    const flag = entry.NSPrivacyCollectedDataTypeTracking;
    if (flag !== undefined && typeof flag !== "boolean") {
      problems.push(`${name} NSPrivacyCollectedDataTypeTracking has unexpected type`);
    } else if (flag === true) problems.push(`${name} is used for tracking`);
  }
  return problems;
}

const APP_MANIFEST = "PrivacyInfo.xcprivacy";

/** Checks every manifest under `appDir` and returns a report. */
export function checkApp(appDir, read = readManifest) {
  const scan = scanApp(appDir);
  const manifests = scan.manifests.map((full) => {
    const path = relative(appDir, full);
    let manifest;
    try {
      manifest = read(full);
    } catch (err) {
      return { path, types: [], problems: [`unreadable: ${err instanceof Error ? err.message : String(err)}`] };
    }
    const problems = manifestProblems(manifest);
    const entries =
      isObject(manifest) && Array.isArray(manifest.NSPrivacyCollectedDataTypes)
        ? manifest.NSPrivacyCollectedDataTypes
        : [];
    const types = entries.filter(isObject).map((e) => shortType(e.NSPrivacyCollectedDataType));
    return { path, types, problems };
  });
  const types = [...new Set(manifests.flatMap((m) => m.types))].sort();
  const failures = manifests.filter((m) => m.problems.length > 0);
  if (!manifests.some((m) => m.path === APP_MANIFEST)) {
    failures.push({ path: APP_MANIFEST, problems: ["the app's own privacy manifest is missing from the bundle root"] });
  }
  for (const path of scan.facebook) failures.push({ path, problems: ["Facebook SDK content in the app"] });
  return { manifests, types, failures };
}

/** Markdown summary for $GITHUB_STEP_SUMMARY. */
export function summaryMarkdown(report) {
  const lines = [
    "### Privacy manifests in the app",
    "",
    "| Manifest | Collected data types | Tracking |",
    "|---|---|---|",
  ];
  // A "|" in a path or a problem would end the cell early.
  const cell = (text) => text.replace(/\|/g, "\\|");
  for (const m of report.manifests) {
    lines.push(
      `| \`${cell(m.path)}\` | ${cell(m.types.join(", ") || "none")} | ${cell(m.problems.join("; ") || "no")} |`,
    );
  }
  lines.push("", `Combined collected types: ${report.types.join(", ") || "none"}`, "");
  if (report.failures.length > 0) {
    lines.push("**Failures:**", "");
    for (const f of report.failures) lines.push(`- \`${f.path}\`: ${f.problems.join("; ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Unzips an IPA into a temp folder and returns the Payload/*.app path. */
function unpackIpa(ipa) {
  const dir = mkdtempSync(join(tmpdir(), "ipa-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    execFileSync("unzip", ["-q", ipa, "-d", dir]);
    const payload = join(dir, "Payload");
    const app = readdirSync(payload).find((n) => n.endsWith(".app"));
    if (!app) throw new Error(`no .app inside ${ipa}`);
    return { app: join(payload, app), cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

export function main(argv = process.argv.slice(2), env = process.env, read = readManifest) {
  const target = argv[0];
  if (!target) {
    console.error(`${TAG} usage: check-ios-privacy-manifests.mjs <path to .ipa or .app>`);
    return 2;
  }
  const abs = resolve(target);
  const isDir = statSync(abs).isDirectory();
  const { app, cleanup } = isDir ? { app: abs, cleanup: () => {} } : unpackIpa(abs);
  try {
    const report = checkApp(app, read);
    for (const m of report.manifests) console.log(`${TAG} ${m.path}: ${m.types.join(", ") || "no data types"}`);
    console.log(`${TAG} combined collected types: ${report.types.join(", ") || "none"}`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summaryMarkdown(report));
    if (report.failures.length > 0) {
      for (const f of report.failures) console.error(`${TAG} FAIL ${f.path}: ${f.problems.join("; ")}`);
      console.error(
        `${TAG} Tracking, an unreadable manifest, a missing app manifest or Facebook SDK content would contradict the App Store answers (docs/STORE_PRIVACY_ANSWERS.md).`,
      );
      return 1;
    }
    console.log(`${TAG} OK: ${report.manifests.length} manifests, none declare tracking.`);
    return 0;
  } finally {
    cleanup();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
