/**
 * Storage rules tests for the avatar upload block (PR-B, plan §4.4).
 *
 * Verifies:
 *  - owner allowed
 *  - stranger denied
 *  - PDF / wrong content-type denied
 *  - 3 MB (over cap) denied
 *  - update-existing denied (force delete-then-create)
 *  - anyone-auth read allowed
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ID = "demo-skatehubba-rules-avatar-storage";
const OWNER_UID = "owner-uid";
const STRANGER_UID = "stranger-uid";

let testEnv: RulesTestEnvironment;

/** A 2 KB payload — comfortably above the 1 KB minimum and under 2 MB. */
function smallPayload(): Uint8Array {
  return new Uint8Array(2048).fill(0x42);
}

/** A 3 MB payload — over the 2 MB cap so the rule must reject. */
function oversizedPayload(): Uint8Array {
  return new Uint8Array(3 * 1024 * 1024).fill(0x42);
}

function asOwner(): RulesTestContext {
  return testEnv.authenticatedContext(OWNER_UID, { email_verified: true });
}

function asStranger(): RulesTestContext {
  return testEnv.authenticatedContext(STRANGER_UID, { email_verified: true });
}

function ownerAvatarPath(ext = "webp"): string {
  return `users/${OWNER_UID}/avatar.${ext}`;
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      host: "127.0.0.1",
      port: 9199,
      rules: readFileSync(resolve(process.cwd(), "storage.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearStorage();
});

describe("avatar storage rules — owner can upload", () => {
  it("owner CAN upload a valid webp at users/{uid}/avatar.webp", async () => {
    await assertSucceeds(
      asOwner()
        .storage()
        .ref(ownerAvatarPath())
        .put(smallPayload(), { contentType: "image/webp" }),
    );
  });

  it("owner CAN upload jpeg + png variants", async () => {
    await assertSucceeds(
      asOwner()
        .storage()
        .ref(ownerAvatarPath("jpeg"))
        .put(smallPayload(), { contentType: "image/jpeg" }),
    );
    await assertSucceeds(
      asOwner()
        .storage()
        .ref(ownerAvatarPath("png"))
        .put(smallPayload(), { contentType: "image/png" }),
    );
  });
});

describe("avatar storage rules — strangers + anonymous denied", () => {
  it("stranger CANNOT upload at another user's path", async () => {
    await assertFails(
      asStranger()
        .storage()
        .ref(ownerAvatarPath())
        .put(smallPayload(), { contentType: "image/webp" }),
    );
  });

  it("anonymous CANNOT upload at any avatar path", async () => {
    await assertFails(
      testEnv
        .unauthenticatedContext()
        .storage()
        .ref(ownerAvatarPath())
        .put(smallPayload(), { contentType: "image/webp" }),
    );
  });
});

describe("avatar storage rules — content-type pinning", () => {
  it("denies a PDF upload at the avatar path", async () => {
    await assertFails(
      asOwner()
        .storage()
        .ref(ownerAvatarPath())
        .put(smallPayload(), { contentType: "application/pdf" }),
    );
  });

  it("denies an extension outside the allowlist (gif)", async () => {
    await assertFails(
      asOwner()
        .storage()
        .ref(`users/${OWNER_UID}/avatar.gif`)
        .put(smallPayload(), { contentType: "image/gif" }),
    );
  });
});

describe("avatar storage rules — size cap", () => {
  it("denies a 3 MB upload (>2 MB cap)", async () => {
    await assertFails(
      asOwner()
        .storage()
        .ref(ownerAvatarPath())
        .put(oversizedPayload(), { contentType: "image/webp" }),
    );
  });
});

describe("avatar storage rules — update-existing denied", () => {
  it("denies updateMetadata against an existing avatar (force delete-then-create)", async () => {
    // Seed the file via the legitimate create path.
    await asOwner().storage().ref(ownerAvatarPath()).put(smallPayload(), { contentType: "image/webp" });
    // updateMetadata routes to the UPDATE rule, which is `if false`.
    await assertFails(asOwner().storage().ref(ownerAvatarPath()).updateMetadata({ contentType: "image/jpeg" }));
  });

  it("allows owner to delete their own avatar", async () => {
    await asOwner().storage().ref(ownerAvatarPath()).put(smallPayload(), { contentType: "image/webp" });
    await assertSucceeds(asOwner().storage().ref(ownerAvatarPath()).delete());
  });

  it("denies stranger deletion of another user's avatar", async () => {
    await asOwner().storage().ref(ownerAvatarPath()).put(smallPayload(), { contentType: "image/webp" });
    await assertFails(asStranger().storage().ref(ownerAvatarPath()).delete());
  });
});

describe("avatar storage rules — anyone-auth read", () => {
  it("any signed-in user CAN read an avatar", async () => {
    await asOwner().storage().ref(ownerAvatarPath()).put(smallPayload(), { contentType: "image/webp" });
    await assertSucceeds(asStranger().storage().ref(ownerAvatarPath()).getDownloadURL());
  });

  it("anonymous CANNOT read an avatar", async () => {
    await asOwner().storage().ref(ownerAvatarPath()).put(smallPayload(), { contentType: "image/webp" });
    await assertFails(testEnv.unauthenticatedContext().storage().ref(ownerAvatarPath()).getDownloadURL());
  });
});
