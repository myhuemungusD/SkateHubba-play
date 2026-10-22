import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain .mjs script without type declarations
import * as guard from "../../scripts/check-ios-privacy-manifests.mjs";

const root = resolve(__dirname, "../..");

const plist = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>${body}</dict>\n</plist>\n`;
const type = (name: string, tracking: boolean) =>
  `<dict><key>NSPrivacyCollectedDataType</key><string>NSPrivacyCollectedDataType${name}</string><key>NSPrivacyCollectedDataTypeLinked</key><true/><key>NSPrivacyCollectedDataTypeTracking</key>${tracking ? "<true/>" : "<false/>"}<key>NSPrivacyCollectedDataTypePurposes</key><array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array></dict>`;
const CLEAN = plist(
  `<key>NSPrivacyTracking</key><false/><key>NSPrivacyTrackingDomains</key><array/><key>NSPrivacyCollectedDataTypes</key><array>${type("UserID", false)}</array>`,
);
const FACEBOOK_LIKE = plist(
  `<key>NSPrivacyTracking</key><true/><key>NSPrivacyTrackingDomains</key><array><string>ep1.facebook.com</string></array><key>NSPrivacyCollectedDataTypes</key><array>${type("DeviceID", true)}</array>`,
);

const dirs: string[] = [];
function makeApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "privguard-"));
  dirs.push(dir);
  const app = join(dir, "Payload", "App.app");
  for (const [rel, content] of Object.entries(files)) {
    const full = join(app, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return app;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("parsePlistXml", () => {
  it("parses dicts, arrays, strings, booleans, numbers and entities", () => {
    expect(
      guard.parsePlistXml(
        plist(
          "<key>a</key><string>x &amp; y</string><key>b</key><array><true/><false/><integer>3</integer></array><key>c</key><string/><key>d</key><dict/>",
        ),
      ),
    ).toEqual({ a: "x & y", b: [true, false, 3], c: "", d: {} });
  });

  it("rejects text that is not an XML plist", () => {
    expect(() => guard.parsePlistXml("bplist00")).toThrow("not an XML plist");
    expect(() => guard.parsePlistXml("<plist><dict><string>x</string></dict></plist>")).toThrow("malformed plist");
  });

  it("parses the app's own manifest, which declares no tracking", () => {
    const manifest = guard.parsePlistXml(readFileSync(resolve(root, "ios/App/App/PrivacyInfo.xcprivacy"), "utf8"));
    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(guard.trackingProblems(manifest)).toEqual([]);
    expect(manifest.NSPrivacyCollectedDataTypes.length).toBeGreaterThan(0);
  });
});

describe("trackingProblems", () => {
  it("reports the tracking flag, tracking domains and tracked data types", () => {
    expect(guard.trackingProblems(guard.parsePlistXml(FACEBOOK_LIKE))).toEqual([
      "NSPrivacyTracking is true",
      "NSPrivacyTrackingDomains lists ep1.facebook.com",
      "DeviceID is used for tracking",
    ]);
  });

  it("treats missing keys as no tracking", () => {
    expect(guard.trackingProblems({})).toEqual([]);
  });
});

describe("readManifest", () => {
  it("converts a binary plist before parsing", () => {
    const app = makeApp({ "x.xcprivacy": "bplist00junk" });
    const convert = vi.fn(() => Buffer.from(CLEAN));
    expect(guard.readManifest(join(app, "x.xcprivacy"), convert).NSPrivacyTracking).toBe(false);
    expect(convert).toHaveBeenCalledWith(join(app, "x.xcprivacy"));
  });
});

describe("checkApp", () => {
  it("lists every manifest in the app, bundles and frameworks, and passes when none track", () => {
    const app = makeApp({
      "PrivacyInfo.xcprivacy": CLEAN,
      "Firebase_FirebaseAuth.bundle/PrivacyInfo.xcprivacy": CLEAN,
      "Frameworks/Sentry.framework/PrivacyInfo.xcprivacy": plist("<key>NSPrivacyCollectedDataTypes</key><array/>"),
      "Info.plist": "<plist/>",
    });
    const report = guard.checkApp(app);
    expect(report.manifests.map((m: { path: string }) => m.path)).toEqual([
      "Firebase_FirebaseAuth.bundle/PrivacyInfo.xcprivacy",
      "Frameworks/Sentry.framework/PrivacyInfo.xcprivacy",
      "PrivacyInfo.xcprivacy",
    ]);
    expect(report.types).toEqual(["UserID"]);
    expect(report.failures).toEqual([]);
  });

  it("fails on a tracking manifest and on an app with no manifest at all", () => {
    const bad = makeApp({ "Facebook_FacebookCore.bundle/PrivacyInfo.xcprivacy": FACEBOOK_LIKE });
    expect(guard.checkApp(bad).failures.map((f: { path: string }) => f.path)).toEqual([
      "Facebook_FacebookCore.bundle/PrivacyInfo.xcprivacy",
    ]);
    const empty = makeApp({ "Info.plist": "<plist/>" });
    expect(guard.checkApp(empty).failures[0].problems).toEqual(["no privacy manifest found in the app"]);
  });
});

describe("summaryMarkdown", () => {
  it("renders a table row per manifest and the combined types", () => {
    const md = guard.summaryMarkdown({
      manifests: [
        { path: "PrivacyInfo.xcprivacy", types: ["UserID"], problems: [] },
        { path: "x.bundle/PrivacyInfo.xcprivacy", types: [], problems: ["NSPrivacyTracking is true"] },
      ],
      types: ["UserID"],
      failures: [],
    });
    expect(md).toContain("| `PrivacyInfo.xcprivacy` | UserID | no |");
    expect(md).toContain("| `x.bundle/PrivacyInfo.xcprivacy` | none | NSPrivacyTracking is true |");
    expect(md).toContain("Combined collected types: UserID");
    expect(guard.summaryMarkdown({ manifests: [], types: [], failures: [] })).toContain(
      "Combined collected types: none",
    );
  });
});

describe("main", () => {
  it("prints usage without a path", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(guard.main([], {})).toBe(2);
  });

  it("passes a clean .app folder and writes the step summary", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = makeApp({ "PrivacyInfo.xcprivacy": CLEAN, "A.bundle/PrivacyInfo.xcprivacy": plist("") });
    const summary = join(app, "..", "summary.md");
    expect(guard.main([app], { GITHUB_STEP_SUMMARY: summary })).toBe(0);
    expect(readFileSync(summary, "utf8")).toContain("### Privacy manifests in the app");
  });

  it("fails a tracking manifest inside a signed IPA", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = makeApp({
      "PrivacyInfo.xcprivacy": CLEAN,
      "Facebook_FacebookCore.bundle/PrivacyInfo.xcprivacy": FACEBOOK_LIKE,
    });
    const dir = join(app, "..", "..");
    const ipa = join(dir, "App.ipa");
    execFileSync("python3", [
      "-c",
      "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2], 'Payload')",
      ipa.replace(/\.ipa$/, ""),
      dir,
    ]);
    execFileSync("mv", [ipa.replace(/\.ipa$/, ".zip"), ipa]);
    expect(guard.main([ipa], {})).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("FAIL Facebook_FacebookCore.bundle/PrivacyInfo.xcprivacy");
  });

  it("rejects an IPA with no app inside", () => {
    const dir = mkdtempSync(join(tmpdir(), "privguard-"));
    dirs.push(dir);
    mkdirSync(join(dir, "Payload"));
    writeFileSync(join(dir, "Payload", "readme.txt"), "x");
    execFileSync("python3", [
      "-c",
      "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2], 'Payload')",
      join(dir, "Empty"),
      dir,
    ]);
    expect(() => guard.main([join(dir, "Empty.zip")], {})).toThrow("no .app inside");
  });
});

describe("release wiring", () => {
  it("runs on the IPA between build_app and the TestFlight upload", () => {
    const fastfile = readFileSync(resolve(root, "fastlane/Fastfile"), "utf8");
    const beta = fastfile.slice(fastfile.indexOf("lane :beta"), fastfile.indexOf("lane :release"));
    const build = beta.indexOf("build_app(");
    const check = beta.indexOf("check-ios-privacy-manifests.mjs");
    const upload = beta.indexOf("pilot(");
    expect(build).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(build);
    expect(upload).toBeGreaterThan(check);
  });
});
