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
 * It also prints every manifest found and the combined collected data types,
 * and appends them to $GITHUB_STEP_SUMMARY. That list is the same data Xcode's
 * Privacy Report aggregates, so each release run keeps the evidence without a
 * Mac.
 *
 * Usage: node scripts/check-ios-privacy-manifests.mjs <path to .ipa or .app>
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "[check-ios-privacy-manifests]";

/** Parses an XML property list into plain JS values. */
export function parsePlistXml(xml) {
  const tokens = [...xml.matchAll(/<(\/?)(dict|array|key|string|integer|real|date|data|true|false)(\s*\/)?>([^<]*)/g)];
  let i = 0;
  const value = () => {
    const [, close, tag, selfClose, text] = tokens[i++] ?? [];
    if (!tag || close) throw new Error("malformed plist");
    if (tag === "true" || tag === "false") {
      if (!selfClose) i++;
      return tag === "true";
    }
    if (selfClose && tag === "dict") return {};
    if (selfClose && tag === "array") return [];
    if (tag === "dict") {
      const out = {};
      while (tokens[i] && !(tokens[i][1] && tokens[i][2] === "dict")) {
        const [, , keyTag, , key] = tokens[i++];
        if (keyTag !== "key") throw new Error("malformed plist");
        i++; // </key>
        out[decode(key)] = value();
      }
      i++;
      return out;
    }
    if (tag === "array") {
      const out = [];
      while (tokens[i] && !(tokens[i][1] && tokens[i][2] === "array")) out.push(value());
      i++;
      return out;
    }
    if (selfClose) return tag === "integer" || tag === "real" ? 0 : "";
    i++; // closing tag
    if (tag === "integer" || tag === "real") return Number(text);
    return decode(text);
  };
  const body = xml.slice(xml.indexOf("<plist"));
  if (!body.startsWith("<plist")) throw new Error("not an XML plist");
  return value();
}

function decode(text) {
  return text
    .trim()
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Reads a manifest, converting a binary plist with macOS `plutil` first. */
export function readManifest(path, convert = (p) => execFileSync("plutil", ["-convert", "xml1", "-o", "-", p])) {
  const raw = readFileSync(path);
  const xml =
    raw.subarray(0, 6).toString("latin1") === "bplist" ? convert(path).toString("utf8") : raw.toString("utf8");
  return parsePlistXml(xml);
}

/** Every `*.xcprivacy` file under `dir`, sorted. */
export function findManifests(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".xcprivacy")) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

const shortType = (t) => String(t).replace(/^NSPrivacyCollectedDataType/, "");

/** Tracking problems in one parsed manifest (empty when clean). */
export function trackingProblems(manifest) {
  const problems = [];
  if (manifest.NSPrivacyTracking === true) problems.push("NSPrivacyTracking is true");
  const domains = manifest.NSPrivacyTrackingDomains ?? [];
  if (domains.length > 0) problems.push(`NSPrivacyTrackingDomains lists ${domains.join(", ")}`);
  for (const entry of manifest.NSPrivacyCollectedDataTypes ?? []) {
    if (entry.NSPrivacyCollectedDataTypeTracking === true) {
      problems.push(`${shortType(entry.NSPrivacyCollectedDataType)} is used for tracking`);
    }
  }
  return problems;
}

/** Checks every manifest under `appDir` and returns a report. */
export function checkApp(appDir, read = readManifest) {
  const manifests = findManifests(appDir).map((path) => {
    const manifest = read(path);
    return {
      path: relative(appDir, path),
      types: (manifest.NSPrivacyCollectedDataTypes ?? []).map((e) => shortType(e.NSPrivacyCollectedDataType)),
      problems: trackingProblems(manifest),
    };
  });
  const types = [...new Set(manifests.flatMap((m) => m.types))].sort();
  const failures = manifests.filter((m) => m.problems.length > 0);
  if (manifests.length === 0) failures.push({ path: "(none)", problems: ["no privacy manifest found in the app"] });
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
  for (const m of report.manifests) {
    lines.push(`| \`${m.path}\` | ${m.types.join(", ") || "none"} | ${m.problems.join("; ") || "no"} |`);
  }
  lines.push("", `Combined collected types: ${report.types.join(", ") || "none"}`, "");
  return lines.join("\n");
}

/** Unzips an IPA into a temp folder and returns the Payload/*.app path. */
function unpackIpa(ipa) {
  const dir = mkdtempSync(join(tmpdir(), "ipa-"));
  execFileSync("unzip", ["-q", ipa, "-d", dir]);
  const payload = join(dir, "Payload");
  const app = readdirSync(payload).find((n) => n.endsWith(".app"));
  if (!app) throw new Error(`no .app inside ${ipa}`);
  return { app: join(payload, app), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const target = argv[0];
  if (!target) {
    console.error(`${TAG} usage: check-ios-privacy-manifests.mjs <path to .ipa or .app>`);
    return 2;
  }
  const abs = resolve(target);
  const isDir = statSync(abs).isDirectory();
  const { app, cleanup } = isDir ? { app: abs, cleanup: () => {} } : unpackIpa(abs);
  try {
    const report = checkApp(app);
    for (const m of report.manifests) console.log(`${TAG} ${m.path}: ${m.types.join(", ") || "no data types"}`);
    console.log(`${TAG} combined collected types: ${report.types.join(", ") || "none"}`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summaryMarkdown(report));
    if (report.failures.length > 0) {
      for (const f of report.failures) console.error(`${TAG} FAIL ${f.path}: ${f.problems.join("; ")}`);
      console.error(
        `${TAG} Tracking would contradict the App Store answers (docs/STORE_PRIVACY_ANSWERS.md). Remove the SDK.`,
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
