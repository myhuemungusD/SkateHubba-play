#!/usr/bin/env node
/**
 * ios-preflight.mjs — free Linux check that runs before the paid macOS build.
 *
 * The TestFlight job rents a Mac (~$0.50 a try). On 2026-10-18 three tries
 * failed in a row on our video-recorder "pro capture" patch:
 *   1. it read `self.isRecording`, a member that does not exist (#753)
 *   2. it called setSampleBufferDelegate(self, ...) without declaring
 *      AVCaptureVideoDataOutputSampleBufferDelegate conformance (#754)
 *   3. the delegate methods were internal on a public class, so they were
 *      not valid protocol witnesses (#755)
 * Every one of those is visible in the patched source without Xcode.
 *
 * What it does:
 *   1. Downloads a pristine copy of the installed video-recorder version
 *      (`npm pack`, so node_modules' already-patched copy is not trusted),
 *      or uses --plugin-dir.
 *   2. Runs scripts/patch-ios-spm.mjs + scripts/ios-patches against it in a
 *      temp root, exactly as postinstall does.
 *   3. Statically validates the patched Plugin.swift (rules below).
 *   4. If `swiftc` is on PATH (GitHub ubuntu runners ship it), runs
 *      `swiftc -parse` for a full syntax check. Apple frameworks don't exist
 *      on Linux, so a real typecheck is impossible there; the rules cover the
 *      semantic mistakes we've actually made.
 *
 * Usage:
 *   node scripts/ios-preflight.mjs                 # npm run ios:preflight
 *   node scripts/ios-preflight.mjs --plugin-dir D  # use a pristine plugin dir
 *   node scripts/ios-preflight.mjs --swift FILE    # validate one Swift file
 * Exit 0 = safe to spend a Mac build; 1 = problems printed.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = "@capacitor-community/video-recorder";
const PLUGIN_SWIFT = "ios/Sources/VideoRecorder/Plugin.swift";

/** Members a CAPPlugin / NSObject / UIView subclass inherits (used via self.). */
const INHERITED = new Set(["init", "bounds", "bridge", "notifyListeners", "frame", "layer", "webView", "pluginId"]);

/** Delegate setters → protocol `self` must conform to. */
const DELEGATE_SETTERS = [
  [/setSampleBufferDelegate\(\s*self\b/, "AVCaptureVideoDataOutputSampleBufferDelegate"],
  [/setMetadataObjectsDelegate\(\s*self\b/, "AVCaptureMetadataOutputObjectsDelegate"],
  [/recordingDelegate:\s*self\b/, "AVCaptureFileOutputRecordingDelegate"],
  [/capturePhoto\([^)]*delegate:\s*self\b/, "AVCapturePhotoCaptureDelegate"],
];

/** Protocol → requirement method names (witnesses must be public on a public class). */
const REQUIREMENTS = {
  AVCaptureVideoDataOutputSampleBufferDelegate: ["captureOutput"],
  AVCaptureMetadataOutputObjectsDelegate: ["metadataOutput"],
  AVCaptureFileOutputRecordingDelegate: ["fileOutput"],
  AVCapturePhotoCaptureDelegate: ["photoOutput"],
};

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Find the body of `class Name` (brace-matched) in source. */
function classBody(src, name) {
  const m = new RegExp(`\\bclass\\s+${name}\\b[^{]*\\{`).exec(src);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
  }
  return { header: m[0], body: src.slice(m.index + m[0].length, i - 1), start: m.index };
}

/**
 * Validate a Swift source. Returns a list of human-readable problems.
 * @param {string} source
 * @param {{ className?: string }} [opts]
 */
export function validateSwift(source, { className = "VideoRecorder" } = {}) {
  const errors = [];
  const src = stripComments(source);

  let depth = 0;
  for (const ch of src) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) errors.push(`unbalanced braces (depth ${depth} at end of file)`);

  const cls = classBody(src, className);
  if (!cls) return [...errors, `class ${className} not found`];

  // Rule 1: every self.<member> must be declared somewhere in the file or inherited.
  const declared = new Set([...src.matchAll(/\b(?:var|let|func|case)\s+`?(\w+)/g)].map((m) => m[1]));
  const missing = new Set();
  for (const m of src.matchAll(/\bself\.(\w+)/g)) {
    if (!declared.has(m[1]) && !INHERITED.has(m[1])) missing.add(m[1]);
  }
  for (const name of missing) errors.push(`self.${name} is referenced but never declared (no var/let/func ${name})`);

  // Conformances: class header + `extension Name: A, B`.
  const conforms = new Set();
  const addList = (list) =>
    list
      .split(",")
      .map((s) => s.trim().split(/\s|where/)[0])
      .filter(Boolean)
      .forEach((p) => conforms.add(p));
  const hdr = /class\s+\w+\s*:\s*([^{]*)\{/.exec(cls.header);
  if (hdr) addList(hdr[1]);
  for (const m of src.matchAll(new RegExp(`\\bextension\\s+${className}\\s*:\\s*([^{]*)\\{`, "g"))) addList(m[1]);

  // Rule 2: passing self as a delegate requires declaring the protocol.
  for (const [re, proto] of DELEGATE_SETTERS) {
    if (re.test(src) && !conforms.has(proto)) {
      errors.push(`${className} passes self as a delegate but does not declare conformance to ${proto}`);
    }
  }

  // Rule 3: on a public class, protocol witnesses must be public/open.
  const isPublic = /\b(public|open)\s+(final\s+)?class\s/.test(
    src.slice(Math.max(0, cls.start - 40), cls.start + cls.header.length),
  );
  if (isPublic) {
    for (const proto of conforms) {
      for (const fn of REQUIREMENTS[proto] ?? []) {
        for (const m of src.matchAll(
          new RegExp(`^([ \\t]*)((?:@\\w+\\s+)*)((?:\\w+\\s+)*)func\\s+${fn}\\s*\\(`, "gm"),
        )) {
          if (!/\b(public|open)\b/.test(m[2] + m[3])) {
            const line = src.slice(0, m.index).split("\n").length;
            errors.push(`line ${line}: ${fn}(...) implements ${proto} on public class ${className} but is not public`);
          }
        }
      }
    }
  }
  return errors;
}

function sh(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, encoding: "utf-8", shell: process.platform === "win32" });
}

/** Fetch a pristine copy of the installed plugin version into dir. */
function packPristine(dir) {
  const pkgJson = resolve(ROOT, "node_modules", PLUGIN, "package.json");
  if (!existsSync(pkgJson)) throw new Error(`${PLUGIN} is not installed — run npm ci first`);
  const { version } = JSON.parse(readFileSync(pkgJson, "utf-8"));
  const r = sh("npm", ["pack", `${PLUGIN}@${version}`, "--silent"], dir);
  if (r.status !== 0) throw new Error(`npm pack failed: ${r.stderr}`);
  const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  const x = sh("tar", ["xzf", tgz], dir);
  if (x.status !== 0) throw new Error(`tar failed: ${x.stderr}`);
  return join(dir, "package");
}

/** Apply patch-ios-spm.mjs to a pristine plugin copy in a temp root; returns patched Swift path. */
export function applyPatches(pluginDir, { root = ROOT } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "ios-preflight-"));
  mkdirSync(join(tmp, "scripts"), { recursive: true });
  cpSync(join(root, "scripts/patch-ios-spm.mjs"), join(tmp, "scripts/patch-ios-spm.mjs"));
  cpSync(join(root, "scripts/ios-patches"), join(tmp, "scripts/ios-patches"), { recursive: true });
  cpSync(pluginDir, join(tmp, "node_modules", PLUGIN), { recursive: true });
  const r = sh(process.execPath, [join(tmp, "scripts/patch-ios-spm.mjs")], tmp);
  if (r.status !== 0) throw new Error(`patch-ios-spm.mjs failed:\n${r.stdout}${r.stderr}`);
  const swift = join(tmp, "node_modules", PLUGIN, PLUGIN_SWIFT);
  if (!readFileSync(swift, "utf-8").includes("SkateHubba pro capture")) {
    throw new Error("patch-ios-spm.mjs ran but the pro capture patch was not applied");
  }
  return { tmp, swift };
}

function swiftParse(file) {
  const probe = sh("swiftc", ["--version"]);
  if (probe.status !== 0) return { skipped: true };
  const r = sh("swiftc", ["-parse", file]);
  return { skipped: false, ok: r.status === 0, out: r.stderr + r.stdout };
}

export function main(argv = process.argv.slice(2)) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  let swiftFile = arg("--swift");
  let cleanup = [];
  try {
    if (!swiftFile) {
      let pluginDir = arg("--plugin-dir");
      if (!pluginDir) {
        const packDir = mkdtempSync(join(tmpdir(), "ios-preflight-pack-"));
        cleanup.push(packDir);
        pluginDir = packPristine(packDir);
      }
      const { tmp, swift } = applyPatches(resolve(pluginDir));
      cleanup.push(tmp);
      swiftFile = swift;
      console.log("[ios-preflight] patches applied cleanly to a pristine plugin copy");
    }
    const errors = validateSwift(readFileSync(swiftFile, "utf-8"));
    const parse = swiftParse(swiftFile);
    if (parse.skipped) console.log("[ios-preflight] swiftc not found — syntax parse skipped (static rules still ran)");
    else if (!parse.ok) errors.push(`swiftc -parse failed:\n${parse.out}`);
    else console.log("[ios-preflight] swiftc -parse OK");
    if (errors.length) {
      console.error(`[ios-preflight] ${errors.length} problem(s) — the Mac build would fail:`);
      for (const e of errors) console.error(`  ✗ ${e}`);
      return 1;
    }
    console.log("[ios-preflight] OK — safe to start the paid iOS build");
    return 0;
  } catch (err) {
    console.error(`[ios-preflight] ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    for (const d of cleanup) rmSync(d, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
