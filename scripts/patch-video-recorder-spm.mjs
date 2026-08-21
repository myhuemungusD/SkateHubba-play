/**
 * Widen @capacitor-community/video-recorder's Swift Package Manager pin so
 * the iOS SPM graph resolves under Capacitor 8.
 *
 * The plugin's published Package.swift pins capacitor-swift-pm with
 * `from: "7.0.0"` (i.e. 7.0.0..<8.0.0), while every @capacitor/* 8.x plugin
 * requires 8.0.0..<9.0.0 — SPM refuses to resolve the app's CapApp-SPM
 * package with both in the graph. The plugin's npm peerDependency is already
 * `@capacitor/core >= 7.0.0`, so only the Swift-side pin is stale. No
 * Capacitor-8 release of the plugin exists yet (latest is 7.5.0); remove this
 * patch and the package.json postinstall hook once one ships.
 *
 * Runs from npm postinstall. Idempotent; exits 0 when the package is absent
 * (e.g. production installs with --omit=dev are unaffected — it's a regular
 * dependency, but be safe) and fails loudly if the file exists but the
 * expected pin is missing AND the patched pin isn't there either — that
 * means the plugin changed and this patch needs review.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgSwift = resolve(root, "node_modules/@capacitor-community/video-recorder/Package.swift");

const UPSTREAM_PIN = '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0")';
const PATCHED_PIN = '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", "7.0.0"..<"9.0.0")';

if (!existsSync(pkgSwift)) {
  process.exit(0);
}

const content = readFileSync(pkgSwift, "utf-8");

if (content.includes(PATCHED_PIN)) {
  process.exit(0); // already patched
}

if (!content.includes(UPSTREAM_PIN)) {
  console.error(
    "[patch-video-recorder-spm] @capacitor-community/video-recorder's Package.swift no longer " +
      "contains the expected capacitor-swift-pm pin — the plugin likely updated. " +
      "Review scripts/patch-video-recorder-spm.mjs: if the plugin now supports Capacitor 8, " +
      "delete this patch and the postinstall hook.",
  );
  process.exit(1);
}

writeFileSync(pkgSwift, content.replace(UPSTREAM_PIN, PATCHED_PIN));
console.log("[patch-video-recorder-spm] widened capacitor-swift-pm pin to 7.0.0..<9.0.0");
