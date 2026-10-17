/**
 * Write ios/App/App/GoogleService-Info.plist from GOOGLE_SERVICE_INFO_PLIST_BASE64
 * when the file is not already in the checkout. The secret may be the raw
 * plist XML or the base64 of that XML. The file contents are never printed.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const BUNDLE_ID = "com.skatehubba.app";

/**
 * @param {string | undefined} secret
 * @returns {string}
 */
export function decodeGoogleServiceInfo(secret) {
  const trimmed = String(secret ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!trimmed) {
    throw new Error("GOOGLE_SERVICE_INFO_PLIST_BASE64 is empty");
  }
  const body =
    trimmed.includes("<plist") || trimmed.includes("<?xml")
      ? String(secret).replace(/^\uFEFF/, "")
      : Buffer.from(trimmed, "base64").toString("utf8");
  if (!body.includes("<plist") || !body.includes(BUNDLE_ID)) {
    throw new Error(
      "GOOGLE_SERVICE_INFO_PLIST_BASE64 is not the iOS GoogleService-Info.plist for com.skatehubba.app",
    );
  }
  return body.endsWith("\n") ? body : `${body}\n`;
}

/**
 * @param {{ dest: string, secret: string | undefined, exists?: boolean }} options
 * @returns {"present" | "written"}
 */
export function installGoogleServiceInfo({ dest, secret, exists }) {
  const already = exists ?? existsSync(dest);
  if (already) {
    return "present";
  }
  const body = decodeGoogleServiceInfo(secret);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, body, { encoding: "utf8", mode: 0o600 });
  return "written";
}

function main() {
  const dest = process.env.GOOGLE_SERVICE_INFO_DEST || "ios/App/App/GoogleService-Info.plist";
  const result = installGoogleServiceInfo({
    dest,
    secret: process.env.GOOGLE_SERVICE_INFO_PLIST_BASE64,
  });
  if (result === "present") {
    console.log("GoogleService-Info.plist is already in the checkout. Left it in place.");
    return;
  }
  console.log("Wrote GoogleService-Info.plist from the GitHub secret.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not install GoogleService-Info.plist";
    console.error(`::error::${message}`);
    process.exit(1);
  }
}
