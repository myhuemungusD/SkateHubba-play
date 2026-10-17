import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { decodeGoogleServiceInfo, installGoogleServiceInfo } from "./install-google-service-info.mjs";

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>BUNDLE_ID</key><string>com.skatehubba.app</string>
  <key>REVERSED_CLIENT_ID</key><string>com.googleusercontent.apps.example</string>
</dict></plist>
`;

test("accepts raw plist xml", () => {
  const body = decodeGoogleServiceInfo(PLIST);
  assert.match(body, /com\.skatehubba\.app/);
  assert.match(body, /<plist/);
});

test("accepts base64 of the plist", () => {
  const body = decodeGoogleServiceInfo(Buffer.from(PLIST).toString("base64"));
  assert.match(body, /com\.googleusercontent\.apps\.example/);
});

test("rejects an empty secret, the wrong app, and non-plist text", () => {
  assert.throws(() => decodeGoogleServiceInfo("  "), /empty/);
  assert.throws(
    () => decodeGoogleServiceInfo(PLIST.replace("com.skatehubba.app", "com.example.other")),
    /com\.skatehubba\.app/,
  );
  assert.throws(() => decodeGoogleServiceInfo(Buffer.from("hello").toString("base64")), /not the iOS/);
});

test("leaves an existing file alone and writes when it is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "gservice-"));
  try {
    const dest = join(dir, "App", "GoogleService-Info.plist");
    writeFileSync(join(dir, "already.plist"), "keep-me\n");
    assert.equal(
      installGoogleServiceInfo({ dest: join(dir, "already.plist"), secret: undefined, exists: true }),
      "present",
    );
    assert.equal(readFileSync(join(dir, "already.plist"), "utf8"), "keep-me\n");
    assert.equal(installGoogleServiceInfo({ dest, secret: PLIST, exists: false }), "written");
    assert.match(readFileSync(dest, "utf8"), /com\.skatehubba\.app/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
