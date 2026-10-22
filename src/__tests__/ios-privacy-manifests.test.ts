import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

// Stand-in for macOS `plutil -convert json` on Linux CI: Python's plistlib
// is a real (expat-based) plist reader, so comments, CDATA, entities and tag
// spacing resolve the way Apple's parser resolves them, and malformed input
// throws, which is exactly the property the guard relies on.
const pyJson = (path: string) =>
  execFileSync(
    "python3",
    ["-c", "import plistlib,json,sys; print(json.dumps(plistlib.load(open(sys.argv[1],'rb'))))", path],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
const check = (app: string) => guard.checkApp(app, (p: string) => guard.readManifest(p, pyJson));
const problemsOf = (app: string, path = "x.bundle/PrivacyInfo.xcprivacy") =>
  check(app).failures.find((f: { path: string }) => f.path === path)?.problems ?? [];
/** An app with a clean root manifest plus one SDK manifest with this raw text. */
const appWith = (raw: string) => makeApp({ "PrivacyInfo.xcprivacy": CLEAN, "x.bundle/PrivacyInfo.xcprivacy": raw });
const RAW = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">${body}</plist>`;

describe("plutilJson", () => {
  it("refuses to parse without plutil off macOS", () => {
    expect(() => guard.plutilJson("x.xcprivacy", "linux")).toThrow("plutil required (macOS)");
  });

  it("runs plutil on macOS, which throws on a file it cannot read", () => {
    // ENOENT for the binary on Linux, a non-zero exit on macOS: a throw either way.
    expect(() => guard.plutilJson("/nonexistent/PrivacyInfo.xcprivacy", "darwin")).toThrow();
  });

  it("is the default reader, so a Linux run of a real app fails closed", () => {
    if (process.platform === "darwin") return;
    const app = makeApp({ "PrivacyInfo.xcprivacy": CLEAN });
    expect(guard.checkApp(app).failures[0].problems[0]).toMatch(/^unreadable: plutil required/);
  });
});

describe("readManifest", () => {
  it("parses the converter's JSON", () => {
    const convert = vi.fn(() => Buffer.from('{"NSPrivacyTracking":false}'));
    expect(guard.readManifest("x.xcprivacy", convert)).toEqual({ NSPrivacyTracking: false });
    expect(convert).toHaveBeenCalledWith("x.xcprivacy");
  });

  it("reads the app's own manifest, which declares no tracking", () => {
    const manifest = guard.readManifest(resolve(root, "ios/App/App/PrivacyInfo.xcprivacy"), pyJson);
    expect(guard.manifestProblems(manifest)).toEqual([]);
    expect(manifest.NSPrivacyCollectedDataTypes.length).toBeGreaterThan(0);
  });
});

describe("manifestProblems", () => {
  it("reports the tracking flag, tracking domains and tracked data types", () => {
    expect(
      guard.manifestProblems(
        guard.readManifest(join(appWith(FACEBOOK_LIKE), "x.bundle/PrivacyInfo.xcprivacy"), pyJson),
      ),
    ).toEqual([
      "NSPrivacyTracking is true",
      "NSPrivacyTrackingDomains lists ep1.facebook.com",
      "DeviceID is used for tracking",
    ]);
  });

  it("treats missing keys as no tracking", () => {
    expect(guard.manifestProblems({})).toEqual([]);
  });

  it.each([
    ["a top-level array", [], "root is not a dictionary"],
    ["a top-level string", "x", "root is not a dictionary"],
    ["null", null, "root is not a dictionary"],
    ["NSPrivacyTracking as a string", { NSPrivacyTracking: "YES" }, "NSPrivacyTracking has unexpected type"],
    ["NSPrivacyTracking as a number", { NSPrivacyTracking: 1 }, "NSPrivacyTracking has unexpected type"],
    ["domains as a string", { NSPrivacyTrackingDomains: "a.com" }, "NSPrivacyTrackingDomains has unexpected type"],
    ["domains with a non-string", { NSPrivacyTrackingDomains: [1] }, "NSPrivacyTrackingDomains has unexpected type"],
    ["data types as a dict", { NSPrivacyCollectedDataTypes: {} }, "NSPrivacyCollectedDataTypes has unexpected type"],
    [
      "a data type that isn't a dict",
      { NSPrivacyCollectedDataTypes: ["x"] },
      "NSPrivacyCollectedDataTypes has unexpected type",
    ],
    [
      "a data type tracking flag as a string",
      {
        NSPrivacyCollectedDataTypes: [
          {
            NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeUserID",
            NSPrivacyCollectedDataTypeTracking: "true",
          },
        ],
      },
      "UserID NSPrivacyCollectedDataTypeTracking has unexpected type",
    ],
  ])("fails %s", (_label, manifest, problem) => {
    expect(guard.manifestProblems(manifest)).toContain(problem);
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
    const report = check(app);
    expect(report.manifests.map((m: { path: string }) => m.path)).toEqual([
      "Firebase_FirebaseAuth.bundle/PrivacyInfo.xcprivacy",
      "Frameworks/Sentry.framework/PrivacyInfo.xcprivacy",
      "PrivacyInfo.xcprivacy",
    ]);
    expect(report.types).toEqual(["UserID"]);
    expect(report.failures).toEqual([]);
  });

  // Each row of the #858 review's fail-open table, read the way Apple reads it.
  it.each([
    [
      "a comment hiding the real value",
      RAW("<dict><key>NSPrivacyTracking</key><!--<false/><key>c</key>--><true/></dict>"),
      "NSPrivacyTracking is true",
    ],
    ["a CDATA key", RAW("<dict><key><![CDATA[NSPrivacyTracking]]></key><true/></dict>"), "NSPrivacyTracking is true"],
    [
      "a numeric entity in a key",
      RAW("<dict><key>NSPrivacy&#84;racking</key><true/></dict>"),
      "NSPrivacyTracking is true",
    ],
    [
      "whitespace and attributes in a tag",
      RAW('<dict  attr="x"><key>NSPrivacyTracking</key><true/></dict >'),
      "NSPrivacyTracking is true",
    ],
    [
      "a top-level array",
      RAW("<array><dict><key>NSPrivacyTracking</key><true/></dict></array>"),
      "root is not a dictionary",
    ],
    ["a truncated file", '<plist version="1.0"><dict><key>A</key><string>x</string>', "unreadable:"],
    ["a second root after the first", RAW("<dict/><dict><key>NSPrivacyTracking</key><true/></dict>"), ""],
    [
      "the flag as a string",
      RAW("<dict><key>NSPrivacyTracking</key><string>YES</string></dict>"),
      "NSPrivacyTracking has unexpected type",
    ],
    [
      "the flag as an integer",
      RAW("<dict><key>NSPrivacyTracking</key><integer>1</integer></dict>"),
      "NSPrivacyTracking has unexpected type",
    ],
  ])("fails %s", (_label, raw, problem) => {
    const problems = problemsOf(appWith(raw));
    // Parsers differ on a second root (reject it, or keep the tracking one); both fail.
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toContain(problem);
  });

  it("names the unreadable file and keeps checking the rest", () => {
    const app = makeApp({
      "PrivacyInfo.xcprivacy": CLEAN,
      "a.bundle/PrivacyInfo.xcprivacy": "not a plist",
      "b.bundle/PrivacyInfo.xcprivacy": FACEBOOK_LIKE,
    });
    const failures = check(app).failures.map((f: { path: string }) => f.path);
    expect(failures).toEqual(["a.bundle/PrivacyInfo.xcprivacy", "b.bundle/PrivacyInfo.xcprivacy"]);
    // A reader that throws a non-Error is still reported, not rethrown.
    const odd = guard.checkApp(app, () => {
      throw "boom";
    });
    expect(odd.failures[0].problems).toEqual(["unreadable: boom"]);
  });

  it("fails when the app's own manifest is missing, even if SDK manifests exist", () => {
    const app = makeApp({ "Firebase_FirebaseAuth.bundle/PrivacyInfo.xcprivacy": CLEAN });
    expect(check(app).failures).toEqual([
      { path: "PrivacyInfo.xcprivacy", problems: ["the app's own privacy manifest is missing from the bundle root"] },
    ]);
    const empty = makeApp({ "Info.plist": "<plist/>" });
    expect(check(empty).failures[0].path).toBe("PrivacyInfo.xcprivacy");
  });

  it("fails on Facebook SDK bundles and frameworks by name, manifest or not", () => {
    const app = makeApp({
      "PrivacyInfo.xcprivacy": CLEAN,
      "Frameworks/FBSDKCoreKit.framework/Info.plist": "<plist/>",
      "FBAEMKit_FBAEMKit.bundle/Info.plist": "<plist/>",
      "Facebook_FacebookCore.bundle/PrivacyInfo.xcprivacy": FACEBOOK_LIKE,
    });
    const failures = check(app).failures.map((f: { path: string }) => f.path);
    expect(failures).toEqual([
      "Facebook_FacebookCore.bundle/PrivacyInfo.xcprivacy",
      "FBAEMKit_FBAEMKit.bundle",
      "Facebook_FacebookCore.bundle",
      "Frameworks/FBSDKCoreKit.framework",
    ]);
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

  it("escapes pipes in cells and lists the failures", () => {
    const md = guard.summaryMarkdown({
      manifests: [{ path: "a|b.bundle/PrivacyInfo.xcprivacy", types: [], problems: ["unreadable: x | y"] }],
      types: [],
      failures: [{ path: "a|b.bundle/PrivacyInfo.xcprivacy", problems: ["unreadable: x | y"] }],
    });
    expect(md).toContain("| `a\\|b.bundle/PrivacyInfo.xcprivacy` | none | unreadable: x \\| y |");
    expect(md).toContain("**Failures:**");
  });
});

describe("main", () => {
  const read = (p: string) => guard.readManifest(p, pyJson);

  it("prints usage without a path", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(guard.main([], {})).toBe(2);
  });

  it("passes a clean .app folder and writes the step summary", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = makeApp({ "PrivacyInfo.xcprivacy": CLEAN, "A.bundle/PrivacyInfo.xcprivacy": plist("") });
    const summary = join(app, "..", "summary.md");
    expect(guard.main([app], { GITHUB_STEP_SUMMARY: summary }, read)).toBe(0);
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
    expect(guard.main([ipa], {}, read)).toBe(1);
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
    expect(() => guard.main([join(dir, "Empty.zip")], {}, read)).toThrow("no .app inside");
  });

  it("removes its temp folder when the IPA cannot be unpacked", () => {
    const dir = mkdtempSync(join(tmpdir(), "privguard-"));
    dirs.push(dir);
    writeFileSync(join(dir, "Broken.ipa"), "not a zip");
    const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith("ipa-")));
    expect(() => guard.main([join(dir, "Broken.ipa")], {}, read)).toThrow();
    const leaked = readdirSync(tmpdir()).filter((n) => n.startsWith("ipa-") && !before.has(n));
    expect(leaked).toEqual([]);
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
