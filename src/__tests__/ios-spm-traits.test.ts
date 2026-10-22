import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../capacitor.config";

/**
 * No Facebook SDK in the iOS binary. @capacitor-firebase/authentication's
 * SwiftPM traits default to Google + Facebook, and SwiftPM links whatever the
 * traits enable, regardless of the plugin's runtime `providers` list. The
 * Facebook SDK's privacy manifest declares tracking (NSPrivacyTracking,
 * ep1.facebook.com, Device ID / User ID used for tracking), which would put
 * tracking in the archive's Privacy Report and contradict our App Store
 * privacy labels (1.2.0 build 1 shipped it). capacitor.config.ts pins the
 * traits; `cap sync` writes them into CapApp-SPM/Package.swift.
 */
const root = resolve(__dirname, "../..");
const capAppDir = resolve(root, "ios/App/CapApp-SPM");
const capAppPackage = readFileSync(resolve(capAppDir, "Package.swift"), "utf8");
const spm = config.experimental?.ios?.spm;

/** Local plugin packages in CapApp-SPM: name, path and traits list (if any). */
const localPackages = [
  ...capAppPackage.matchAll(/\.package\(name: "([^"]+)", path: "([^"]+)"(?:, traits: \[([^\]]*)\])?\)/g),
].map(([, name, path, traits]) => ({
  name,
  path,
  traits: traits === undefined ? null : [...traits.matchAll(/"([^"]+)"|(\.defaults)/g)].map((t) => t[1] ?? t[2]),
}));

describe("iOS SwiftPM plugin traits", () => {
  it("builds the auth plugin with the Google trait only", () => {
    expect(spm?.packageTraits?.["@capacitor-firebase/authentication"]).toEqual(["Google"]);
    expect(localPackages.find((p) => p.name === "CapacitorFirebaseAuthentication")?.traits).toEqual(["Google"]);
  });

  it("declares Swift tools 6.1+, which package traits require", () => {
    const [major, minor] = (spm?.swiftToolsVersion ?? "0").split(".").map(Number);
    expect(major > 6 || (major === 6 && minor >= 1)).toBe(true);
    expect(capAppPackage.split("\n")[0]).toBe(`// swift-tools-version: ${spm?.swiftToolsVersion}`);
  });

  it("enables no Facebook trait, or default traits, on any plugin that can link the Facebook SDK", () => {
    expect(localPackages.length).toBeGreaterThan(5);
    const facebookCapable = localPackages.filter((p) =>
      readFileSync(resolve(capAppDir, p.path, "Package.swift"), "utf8").includes("facebook-ios-sdk"),
    );
    expect(facebookCapable.map((p) => p.name)).toContain("CapacitorFirebaseAuthentication");
    for (const p of facebookCapable) {
      expect(p.traits, `${p.name} must pin traits`).not.toBeNull();
      expect(p.traits).not.toContain("Facebook");
      expect(p.traits).not.toContain(".defaults");
    }
  });
});
