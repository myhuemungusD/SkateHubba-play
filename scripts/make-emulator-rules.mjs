#!/usr/bin/env node
/**
 * Generate the EMULATOR variant of firestore.rules for the E2E suite.
 *
 * Why this exists: firestore.rules pins every video URL to the production
 * Storage bucket (`https://firebasestorage.googleapis.com/v0/b/
 * sk8hub-d7806.firebasestorage.app/...`) — a deliberate anti-exfil
 * hardening. The Storage EMULATOR issues URLs shaped
 * `http://localhost:9199/v0/b/demo-skatehubba.appspot.com/...`, which that
 * pin rejects three ways at once (scheme, host, bucket), so the core loop's
 * setting→matching write could never succeed in E2E and every test that set
 * a trick was structurally blocked.
 *
 * The production file is NOT touched — the deploy path stays a straight
 * upload of firestore.rules. This script rewrites only the bucket-pin
 * constants into firestore.emulator.rules (gitignored, regenerated on every
 * `npm run test:e2e`), plus a firebase.emulator.json that points the
 * emulator at it. Every replacement asserts its expected occurrence count,
 * so if the pins in firestore.rules are ever renamed or moved this fails
 * loudly instead of silently testing the wrong ruleset.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const src = readFileSync(resolve(root, "firestore.rules"), "utf8");

/** The emulator's download-URL prefix + bucket, regex-escaped like the originals. */
const EMU_PREFIX = "http://localhost:9199/v0/b/";
const EMU_BUCKET = "demo-skatehubba\\\\.appspot\\\\.com";

/** Replace exactly `count` occurrences of `from`, or die. */
function replaceExact(text, from, to, count, label) {
  const found = text.split(from).length - 1;
  if (found !== count) {
    console.error(
      `make-emulator-rules: expected ${count} occurrence(s) of ${label}, found ${found}.\n` +
        `firestore.rules' bucket pins have moved or been renamed — update this script in lockstep.`,
    );
    process.exit(1);
  }
  return text.split(from).join(to);
}

let out = src;

// 1. FIREBASE_BUCKET() — feeds the userClips / avatar / profile-image concat
//    pins ('^https://firebasestorage.../v0/b/' + FIREBASE_BUCKET() + ...).
out = replaceExact(
  out,
  "return 'sk8hub-d7806\\\\.firebasestorage\\\\.app';",
  `return '${EMU_BUCKET}';`,
  1,
  "FIREBASE_BUCKET() body",
);

// 2. BUCKET_DL_URL_RE() — matchVideoUrl / avatar download-URL pin.
out = replaceExact(
  out,
  "return '^https://firebasestorage\\\\.googleapis\\\\.com/v0/b/sk8hub-d7806\\\\.firebasestorage\\\\.app/.+';",
  `return '^${EMU_PREFIX}${EMU_BUCKET}/.+';`,
  1,
  "BUCKET_DL_URL_RE() body",
);

// 3. BUCKET_BOTH_FORMS_RE() — currentTrickVideoUrl / clips.videoUrl pin.
//    The bucket-as-host CDN form does not exist in the emulator, so the
//    variant carries the download-URL form only.
out = replaceExact(
  out,
  "return '^https://(firebasestorage\\\\.googleapis\\\\.com/v0/b/sk8hub-d7806\\\\.firebasestorage\\\\.app|sk8hub-d7806\\\\.firebasestorage\\\\.app)/.+';",
  `return '^${EMU_PREFIX}${EMU_BUCKET}/.+';`,
  1,
  "BUCKET_BOTH_FORMS_RE() body",
);

// 4. The concat-site prefixes (userClipVideoUrlOk + the two profile-image
//    pins) hardcode the production host ahead of FIREBASE_BUCKET().
out = replaceExact(
  out,
  "'^https://firebasestorage\\\\.googleapis\\\\.com/v0/b/' + FIREBASE_BUCKET() +",
  `'^${EMU_PREFIX}' + FIREBASE_BUCKET() +`,
  3,
  "concat-site URL prefix",
);

if (out === src) {
  console.error("make-emulator-rules: no replacements applied — refusing to write a copy of production rules.");
  process.exit(1);
}

const banner =
  "// GENERATED FILE — do not edit, do not deploy.\n" +
  "// Emulator variant of firestore.rules produced by scripts/make-emulator-rules.mjs\n" +
  "// for `npm run test:e2e`. Bucket pins point at the Storage emulator\n" +
  "// (http://localhost:9199 / demo-skatehubba.appspot.com); everything else is\n" +
  "// byte-identical to firestore.rules.\n";
writeFileSync(resolve(root, "firestore.emulator.rules"), banner + out);

// firebase.emulator.json: firebase.json with only the Firestore rules path
// swapped. Derived (not hand-copied) so port/emulator config can never drift.
const config = JSON.parse(readFileSync(resolve(root, "firebase.json"), "utf8"));
config.firestore.rules = "firestore.emulator.rules";
writeFileSync(resolve(root, "firebase.emulator.json"), JSON.stringify(config, null, 2) + "\n");

console.log("make-emulator-rules: wrote firestore.emulator.rules + firebase.emulator.json");
