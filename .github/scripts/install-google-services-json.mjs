/**
 * Write android/app/google-services.json from GOOGLE_SERVICES_JSON_BASE64
 * when the file is not already in the checkout. The secret may be the raw
 * JSON or the base64 of that JSON. The file contents are never printed.
 *
 * Without this file android/app/build.gradle skips the google-services
 * plugin, and Android push notifications silently never register.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE_NAME = "com.skatehubba.app";

/**
 * @param {string | undefined} secret
 * @returns {string}
 */
export function decodeGoogleServicesJson(secret) {
  const trimmed = String(secret ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!trimmed) {
    throw new Error("GOOGLE_SERVICES_JSON_BASE64 is empty");
  }
  const body = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("GOOGLE_SERVICES_JSON_BASE64 is not the Android google-services.json");
  }
  const clients = Array.isArray(parsed?.client) ? parsed.client : [];
  const matches = clients.some((c) => c?.client_info?.android_client_info?.package_name === PACKAGE_NAME);
  if (!matches) {
    throw new Error(`GOOGLE_SERVICES_JSON_BASE64 has no Android client for ${PACKAGE_NAME}`);
  }
  return body.endsWith("\n") ? body : `${body}\n`;
}

/**
 * @param {{ dest: string, secret: string | undefined, exists?: boolean }} options
 * @returns {"present" | "written"}
 */
export function installGoogleServicesJson({ dest, secret, exists }) {
  const already = exists ?? existsSync(dest);
  if (already) {
    return "present";
  }
  const body = decodeGoogleServicesJson(secret);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, body, { encoding: "utf8", mode: 0o600 });
  return "written";
}

function main() {
  const dest = process.env.GOOGLE_SERVICES_JSON_DEST || "android/app/google-services.json";
  const result = installGoogleServicesJson({
    dest,
    secret: process.env.GOOGLE_SERVICES_JSON_BASE64,
  });
  if (result === "present") {
    console.log("google-services.json is already in the checkout. Left it in place.");
    return;
  }
  console.log("Wrote google-services.json from the GitHub secret.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not install google-services.json";
    console.error(`::error::${message}`);
    process.exit(1);
  }
}
