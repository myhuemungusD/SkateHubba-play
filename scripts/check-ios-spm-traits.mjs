/**
 * Post-sync guard: no Facebook SDK in the iOS binary.
 *
 * Run right after `npx cap sync ios` (ios-release.yml, ios-build.yml, Xcode
 * Cloud ci_post_clone.sh). capacitor.config.ts pins the auth plugin's SwiftPM
 * traits to ["Google"]; without that pin SwiftPM uses the plugin's defaults
 * (Google + Facebook) and links the Facebook SDK, whose privacy manifest
 * declares tracking. This checks the manifest `cap sync` actually generated,
 * so a CLI that renames or drops `packageTraits` fails the build instead of
 * quietly shipping Facebook (1.2.0 build 1 did).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, process.argv[2] ?? "ios/App/CapApp-SPM/Package.swift");
const manifest = readFileSync(manifestPath, "utf-8");

const problems = [];
if (!/\.package\(name: "CapacitorFirebaseAuthentication", path: "[^"]+", traits: \["Google"\]\)/.test(manifest)) {
  problems.push('CapacitorFirebaseAuthentication is not pinned to traits: ["Google"]');
}
if (/facebook/i.test(manifest)) problems.push("the manifest mentions facebook");

if (problems.length > 0) {
  console.error(`[check-ios-spm-traits] ${manifestPath}: ${problems.join("; ")}.`);
  console.error(
    "[check-ios-spm-traits] The Facebook SDK would be linked. Fix experimental.ios.spm in capacitor.config.ts.",
  );
  process.exit(1);
}
console.log('[check-ios-spm-traits] OK: auth plugin traits ["Google"], no Facebook.');
