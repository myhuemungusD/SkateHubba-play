import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * App Store 5.1.1: PrivacyInfo.xcprivacy must declare every data type the app
 * collects. This pins the declarations to features that exist in code so a
 * removal (or a new feature without a declaration) is caught in review.
 */
const manifest = readFileSync(resolve(__dirname, "../../ios/App/App/PrivacyInfo.xcprivacy"), "utf8");

describe("iOS privacy manifest", () => {
  it.each([
    ["EmailAddress", "email sign-in"],
    ["PhoneNumber", "SMS two-step verification (src/services/mfa.ts)"],
    ["OtherUserContent", "clip comments, spot names and bios"],
    ["OtherDataTypes", "date of birth from the age gate (src/utils/age.ts)"],
    ["PhotosorVideos", "trick clips and avatars"],
    ["AudioData", "trick clip sound"],
    ["PreciseLocation", "spots map"],
    ["ProductInteraction", "last-seen / Who's skating + analytics"],
    ["UserID", "account uid"],
    ["DeviceID", "push tokens"],
    ["CrashData", "Sentry"],
  ])("declares %s (%s)", (type) => {
    expect(manifest).toContain(`<string>NSPrivacyCollectedDataType${type}</string>`);
  });

  it("links Product Interaction to the user for App Functionality and Analytics", () => {
    const block = manifest.split("NSPrivacyCollectedDataTypeProductInteraction")[1]?.split("</dict>")[0] ?? "";
    expect(block).toMatch(/NSPrivacyCollectedDataTypeLinked[\s\S]*?<true\/>/);
    expect(block).toContain("NSPrivacyCollectedDataTypePurposeAppFunctionality");
    expect(block).toContain("NSPrivacyCollectedDataTypePurposeAnalytics");
  });

  it("declares no tracking and no tracking domains", () => {
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(manifest).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
    expect(manifest).not.toMatch(/<string>NSPrivacyCollectedDataTypeTracking<\/string>|Tracking<\/key>\s*<true\/>/);
  });
});
