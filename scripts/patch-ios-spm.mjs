/**
 * iOS Swift Package Manager fixups for third-party Capacitor plugins.
 *
 * Runs from npm postinstall AND from the Capacitor CLI hooks
 * (capacitor:update:after / capacitor:sync:after) because `cap sync`
 * regenerates ios/App/CapApp-SPM/Package.swift and would undo fix 2.
 * Idempotent — safe to run any number of times, in any order with cap sync.
 *
 * Fix 1 — @capacitor-community/video-recorder pin.
 * The plugin's published Package.swift pins capacitor-swift-pm with
 * `from: "7.0.0"` (7.0.0..<8.0.0) while every @capacitor/* 8.x plugin
 * requires 8.x, so SPM cannot resolve the app package graph. Its npm
 * peerDependency already allows @capacitor/core >= 7 — only the Swift pin is
 * stale. Widen it to 7.0.0..<9.0.0. Remove once a Capacitor-8 release ships
 * (latest is 7.5.0).
 *
 * Fix 2 — @capacitor-firebase/app-check identity collision.
 * SwiftPM derives a local package's identity from its DIRECTORY name, so
 * node_modules/@capacitor-firebase/app-check gets identity "app-check" —
 * colliding with https://github.com/google/app-check.git ("app-check")
 * required by GoogleSignIn and firebase-ios-sdk. xcodebuild then fails with
 * "product 'AppCheckCore' ... not found in package 'app-check'". No plugin
 * release can fix a directory-name identity, so we mirror the plugin to
 * node_modules/@capacitor-firebase/capacitor-firebase-app-check (identity
 * "capacitor-firebase-app-check") and repoint the generated CapApp-SPM
 * Package.swift at the mirror.
 */

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const log = (msg) => console.log(`[patch-ios-spm] ${msg}`);

/* ── Fix 1: video-recorder capacitor-swift-pm pin ── */

const recorderPkgSwift = resolve(root, "node_modules/@capacitor-community/video-recorder/Package.swift");
const UPSTREAM_PIN = '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0")';
const PATCHED_PIN = '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", "7.0.0"..<"9.0.0")';

if (existsSync(recorderPkgSwift)) {
  const content = readFileSync(recorderPkgSwift, "utf-8");
  if (content.includes(UPSTREAM_PIN)) {
    writeFileSync(recorderPkgSwift, content.replace(UPSTREAM_PIN, PATCHED_PIN));
    log("widened video-recorder's capacitor-swift-pm pin to 7.0.0..<9.0.0");
  } else if (!content.includes(PATCHED_PIN)) {
    console.error(
      "[patch-ios-spm] video-recorder's Package.swift no longer contains the expected " +
        "capacitor-swift-pm pin — the plugin likely updated. Review scripts/patch-ios-spm.mjs: " +
        "if it now supports Capacitor 8, delete Fix 1.",
    );
    process.exit(1);
  }
}

/* ── Fix 2: app-check identity mirror ── */

const appCheckSrc = resolve(root, "node_modules/@capacitor-firebase/app-check");
const appCheckMirror = resolve(root, "node_modules/@capacitor-firebase/capacitor-firebase-app-check");

if (existsSync(appCheckSrc)) {
  const srcVersion = JSON.parse(readFileSync(resolve(appCheckSrc, "package.json"), "utf-8")).version;
  const mirrorPkgJson = resolve(appCheckMirror, "package.json");
  const mirrorVersion = existsSync(mirrorPkgJson)
    ? JSON.parse(readFileSync(mirrorPkgJson, "utf-8")).version
    : null;
  if (mirrorVersion !== srcVersion) {
    rmSync(appCheckMirror, { recursive: true, force: true });
    cpSync(appCheckSrc, appCheckMirror, { recursive: true });
    log(`mirrored @capacitor-firebase/app-check@${srcVersion} to a non-colliding directory`);
  }

  const capAppSpm = resolve(root, "ios/App/CapApp-SPM/Package.swift");
  if (existsSync(capAppSpm)) {
    const manifest = readFileSync(capAppSpm, "utf-8");
    const patched = manifest.replaceAll(
      "node_modules/@capacitor-firebase/app-check",
      "node_modules/@capacitor-firebase/capacitor-firebase-app-check",
    );
    if (patched !== manifest) {
      writeFileSync(capAppSpm, patched);
      log("repointed CapApp-SPM at the app-check mirror");
    }
  }
}
