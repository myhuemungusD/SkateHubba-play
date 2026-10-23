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

/* ── Fix 3: video-recorder pro capture (lens, 60fps, stabilization, focus) ──
 * The plugin opens only the wide camera at its preset frame rate with no
 * stabilization. Skaters film on the 0.5x ultra-wide, so the back camera
 * becomes the virtual triple / dual-wide device (smooth 0.5x-1x-2x ramp that
 * works mid-take), the 1080p format is locked to 60fps, cinematic
 * stabilization is on, and setZoom / getLensInfo / focusAt are exposed.
 * Each edit is anchored on upstream text; a missing anchor fails the install
 * so a plugin update can't silently drop the patch. */

const recorderSwift = resolve(
  root,
  "node_modules/@capacitor-community/video-recorder/ios/Sources/VideoRecorder/Plugin.swift",
);
const PRO_MARK = "SkateHubba pro capture";
if (existsSync(recorderSwift)) {
  let swift = readFileSync(recorderSwift, "utf-8");
  if (!swift.includes(PRO_MARK)) {
    const edits = [
      [
        '        CAPPluginMethod(name: "getDuration", returnType: CAPPluginReturnPromise),\n',
        '        CAPPluginMethod(name: "getDuration", returnType: CAPPluginReturnPromise),\n' +
          '        CAPPluginMethod(name: "setZoom", returnType: CAPPluginReturnPromise),\n' +
          '        CAPPluginMethod(name: "getLensInfo", returnType: CAPPluginReturnPromise),\n' +
          '        CAPPluginMethod(name: "focusAt", returnType: CAPPluginReturnPromise),\n' +
          '        CAPPluginMethod(name: "setQuality", returnType: CAPPluginReturnPromise),\n' +
          '        CAPPluginMethod(name: "getQualityModes", returnType: CAPPluginReturnPromise),\n' +
          '        CAPPluginMethod(name: "getPerformanceMetrics", returnType: CAPPluginReturnPromise),\n' +
          '        CAPPluginMethod(name: "setPreRoll", returnType: CAPPluginReturnPromise),\n' +
          '        CAPPluginMethod(name: "getPreRollStatus", returnType: CAPPluginReturnPromise),\n' +
          '        CAPPluginMethod(name: "setNativeFisheye", returnType: CAPPluginReturnPromise),\n',
      ],
      [
        "                        if (self.backCamera == nil) {\n",
        "                        if let pro = AVCaptureDevice.default(.builtInTripleCamera, for: .video, position: .back)\n" +
          "                            ?? AVCaptureDevice.default(.builtInDualWideCamera, for: .video, position: .back) {\n" +
          "                            self.backCamera = pro\n" +
          "                        }\n" +
          "                        if (self.backCamera == nil) {\n",
      ],
      [
        "                        // Commit configurations\n                        self.captureSession?.commitConfiguration()\n",
        "                        // Commit configurations\n                        self.captureSession?.commitConfiguration()\n                        self.shTune()\n",
      ],
      [
        "                self.cameraInput = input\n                self.captureSession?.commitConfiguration()\n",
        "                self.cameraInput = input\n                self.captureSession?.commitConfiguration()\n                self.shTune()\n",
      ],
      [
        "                        connection.isVideoMirrored = false\n",
        "                        connection.isVideoMirrored = false\n                        self.shStabilize(connection)\n",
      ],
      [
        "    @objc func flipCamera(_ call: CAPPluginCall) {\n",
        readFileSync(resolve(root, "scripts/ios-patches/video-recorder-pro.swift.txt"), "utf-8") +
          "    @objc func flipCamera(_ call: CAPPluginCall) {\n",
      ],
    ];
    for (const [anchor, replacement] of edits) {
      if (swift.split(anchor).length !== 2) {
        console.error(
          `[patch-ios-spm] video-recorder Plugin.swift anchor not found once: ${anchor.trim().slice(0, 60)}`,
        );
        process.exit(1);
      }
      swift = swift.replace(anchor, replacement);
    }
    // The pre-roll block above is the class's sample-buffer delegate (it calls
    // setSampleBufferDelegate(self, ...)), so declare the conformance, and pull
    // in CoreImage for the native fisheye filter keys.
    swift = swift.replace("import AVFoundation\n", "import AVFoundation\nimport CoreImage\n");
    swift += "\nextension VideoRecorder: AVCaptureVideoDataOutputSampleBufferDelegate {}\n";
    writeFileSync(recorderSwift, swift);
    log("added pro capture (ultra-wide lens, 1080p60, stabilization, focus) to video-recorder");
  }
}

/* ── Fix 4: video-recorder see-through web view (camera preview visibility) ──
 * The plugin draws the camera BEHIND the WKWebView and, to let it show
 * through, clears `webView.backgroundColor` and `isOpaque`. It never touches
 * `webView.scrollView.backgroundColor` — and Capacitor paints that scroll view
 * with `ios.backgroundColor` (#0A0A0A in capacitor.config.ts). That opaque
 * near-black layer sits between the camera and the page, so capture runs (the
 * green dot is on) but the preview is invisible: TestFlight build 3. Clear
 * the scroll view too while the camera is up, and put both colours back on
 * destroy() instead of the plugin's hard-coded white, each from its own saved
 * value (fallback #0A0A0A). Own marker, so builds that already carry Fix 3
 * (or the v1 of this fix) still pick this up. */

const SEE_THROUGH_MARK = "SkateHubba see-through webview v2";
const OPAQUE_FALLBACK = "UIColor(red: 10/255, green: 10/255, blue: 10/255, alpha: 1)";
// v1 restored both colours from the one saved scroll-view colour. Kept only
// so an install that already carries v1 is upgraded in place, not skipped.
const SEE_THROUGH_V1 = [
  [
    "import Capacitor\n",
    "import Capacitor\n\n" +
      "// SkateHubba see-through webview: the scroll view colour Capacitor set, restored on destroy().\n" +
      "fileprivate var shSavedWebViewColor: UIColor? = nil\n",
  ],
  [
    "                        self.capWebView?.backgroundColor = UIColor.clear\n",
    "                        if shSavedWebViewColor == nil { shSavedWebViewColor = self.capWebView?.scrollView.backgroundColor }\n" +
      "                        self.capWebView?.backgroundColor = UIColor.clear\n" +
      "                        self.capWebView?.scrollView.isOpaque = false\n" +
      "                        self.capWebView?.scrollView.backgroundColor = UIColor.clear\n",
  ],
  [
    "            self.capWebView?.backgroundColor = UIColor.white\n",
    "            self.capWebView?.backgroundColor = shSavedWebViewColor ?? UIColor.black\n" +
      "            self.capWebView?.scrollView.isOpaque = true\n" +
      "            self.capWebView?.scrollView.backgroundColor = shSavedWebViewColor ?? UIColor.black\n",
  ],
];
const SEE_THROUGH_V2 = [
  [
    "import Capacitor\n",
    "import Capacitor\n\n" +
      `// ${SEE_THROUGH_MARK}: the web view and scroll view colours Capacitor set, each restored on destroy().\n` +
      "fileprivate var shSavedWebViewColor: UIColor? = nil\n" +
      "fileprivate var shSavedScrollViewColor: UIColor? = nil\n",
  ],
  [
    "                        self.capWebView?.backgroundColor = UIColor.clear\n",
    "                        if shSavedWebViewColor == nil { shSavedWebViewColor = self.capWebView?.backgroundColor }\n" +
      "                        if shSavedScrollViewColor == nil { shSavedScrollViewColor = self.capWebView?.scrollView.backgroundColor }\n" +
      "                        self.capWebView?.backgroundColor = UIColor.clear\n" +
      "                        self.capWebView?.scrollView.isOpaque = false\n" +
      "                        self.capWebView?.scrollView.backgroundColor = UIColor.clear\n",
  ],
  [
    "            self.capWebView?.backgroundColor = UIColor.white\n",
    `            self.capWebView?.backgroundColor = shSavedWebViewColor ?? ${OPAQUE_FALLBACK}\n` +
      "            self.capWebView?.scrollView.isOpaque = true\n" +
      `            self.capWebView?.scrollView.backgroundColor = shSavedScrollViewColor ?? ${OPAQUE_FALLBACK}\n`,
  ],
];

/** Apply [from, to] pairs; every `from` must occur exactly once, else fail the install. */
function applyAnchored(swift, edits) {
  for (const [anchor, replacement] of edits) {
    if (swift.split(anchor).length !== 2) {
      console.error(`[patch-ios-spm] video-recorder Plugin.swift anchor not found once: ${anchor.trim().slice(0, 60)}`);
      process.exit(1);
    }
    swift = swift.replace(anchor, replacement);
  }
  return swift;
}

if (existsSync(recorderSwift)) {
  let swift = readFileSync(recorderSwift, "utf-8");
  if (!swift.includes(SEE_THROUGH_MARK)) {
    if (swift.includes("// SkateHubba see-through webview:")) {
      swift = applyAnchored(
        swift,
        SEE_THROUGH_V1.map(([anchor, patched]) => [patched, anchor]),
      );
    }
    // Written only after every anchor matched, so a miss never half-applies.
    writeFileSync(recorderSwift, applyAnchored(swift, SEE_THROUGH_V2));
    log("made the web view see-through while the native camera preview is up");
  }
}

/* ── Fix 2: app-check identity mirror ── */

const appCheckSrc = resolve(root, "node_modules/@capacitor-firebase/app-check");
const appCheckMirror = resolve(root, "node_modules/@capacitor-firebase/capacitor-firebase-app-check");

if (existsSync(appCheckSrc)) {
  const srcVersion = JSON.parse(readFileSync(resolve(appCheckSrc, "package.json"), "utf-8")).version;
  const mirrorPkgJson = resolve(appCheckMirror, "package.json");
  const mirrorVersion = existsSync(mirrorPkgJson) ? JSON.parse(readFileSync(mirrorPkgJson, "utf-8")).version : null;
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
