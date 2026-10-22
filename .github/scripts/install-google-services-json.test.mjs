import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { decodeGoogleServicesJson, installGoogleServicesJson } from "./install-google-services-json.mjs";

const JSON_BODY = JSON.stringify({
  project_info: { project_id: "example-project" },
  client: [
    {
      client_info: {
        mobilesdk_app_id: "1:000:android:example",
        android_client_info: { package_name: "com.skatehubba.app" },
      },
    },
  ],
});

test("accepts raw json", () => {
  const body = decodeGoogleServicesJson(JSON_BODY);
  assert.match(body, /com\.skatehubba\.app/);
  assert.ok(body.endsWith("\n"));
});

test("accepts base64 of the json", () => {
  const body = decodeGoogleServicesJson(Buffer.from(JSON_BODY).toString("base64"));
  assert.match(body, /example-project/);
});

test("rejects an empty secret, the wrong app, and non-json text", () => {
  assert.throws(() => decodeGoogleServicesJson("  "), /empty/);
  assert.throws(
    () => decodeGoogleServicesJson(JSON_BODY.replace("com.skatehubba.app", "com.example.other")),
    /no Android client/,
  );
  assert.throws(() => decodeGoogleServicesJson(Buffer.from("hello").toString("base64")), /not the Android/);
  assert.throws(() => decodeGoogleServicesJson(JSON.stringify({ client: "nope" })), /no Android client/);
});

test("leaves an existing file alone and writes when it is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "gservices-"));
  try {
    const existing = join(dir, "already.json");
    writeFileSync(existing, "keep-me\n");
    assert.equal(installGoogleServicesJson({ dest: existing, secret: "" }), "present");
    assert.equal(readFileSync(existing, "utf8"), "keep-me\n");

    const dest = join(dir, "app", "google-services.json");
    assert.equal(installGoogleServicesJson({ dest, secret: JSON_BODY }), "written");
    assert.ok(existsSync(dest));
    assert.match(readFileSync(dest, "utf8"), /com\.skatehubba\.app/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
