/**
 * Storage rules for `userClips/{uid}/{fileName}` — the user-uploaded clip
 * prefix.
 *
 * The uid IS the path prefix here, so ownership is structural: the probes
 * below cover cross-uid writes, path traversal out of the prefix,
 * content-type lies (an HTML payload behind a .webm name), the missing /
 * forged uploaderUid metadata binding, size bounds, and the
 * delete-then-create-only overwrite policy.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { setupStorageRulesTestEnv } from "./_fixtures";

const UID_A = "clipper-alice";
const UID_B = "victim-bob";

const getEnv = setupStorageRulesTestEnv("demo-skatehubba-rules-storage-userclips");

function payload(bytes = 2048): Uint8Array {
  return new Uint8Array(bytes).fill(0x42);
}

function asUser(uid: string): RulesTestContext {
  return getEnv().authenticatedContext(uid, { email_verified: true });
}

/** Upload with NO customMetadata at all — probes the uploaderUid binding. */
function uploadWithoutMetadata(ctx: RulesTestContext, path: string): Promise<unknown> {
  return ctx
    .storage()
    .ref(path)
    .put(payload(), { contentType: "video/webm" } as never);
}

/** Upload with the uploaderUid metadata explicitly bound to `uid`. */
function uploadAs(uid: string, path: string, opts: Record<string, unknown> = {}): Promise<unknown> {
  const ctx = asUser(uid);
  return ctx
    .storage()
    .ref(path)
    .put(payload((opts.bytes as number) ?? 2048), {
      contentType: (opts.contentType as string) ?? "video/webm",
      customMetadata: { uploaderUid: (opts.uploaderUid as string) ?? uid },
    } as never);
}

describe("storage userClips — create (positive)", () => {
  it("a user CAN upload a .webm to their own prefix", async () => {
    await assertSucceeds(uploadAs(UID_A, `userClips/${UID_A}/clip1.webm`));
  });

  it("a user CAN upload an .mp4 (native) to their own prefix", async () => {
    await assertSucceeds(uploadAs(UID_A, `userClips/${UID_A}/clip1.mp4`, { contentType: "video/mp4" }));
  });
});

describe("storage userClips — create (red team)", () => {
  it("attack: CANNOT upload into ANOTHER user's prefix", async () => {
    await assertFails(uploadAs(UID_A, `userClips/${UID_B}/clip1.webm`));
  });

  it("attack: anonymous callers CANNOT upload", async () => {
    await assertFails(uploadWithoutMetadata(getEnv().unauthenticatedContext(), `userClips/${UID_A}/clip1.webm`));
  });

  it("attack: content-type lie — HTML payload behind a .webm name", async () => {
    await assertFails(uploadAs(UID_A, `userClips/${UID_A}/clip1.webm`, { contentType: "text/html" }));
  });

  it("attack: content-type lie — .mp4 name declared as video/webm", async () => {
    await assertFails(uploadAs(UID_A, `userClips/${UID_A}/clip1.mp4`, { contentType: "video/webm" }));
  });

  it("attack: content-type lie — .webm name declared as video/mp4", async () => {
    await assertFails(uploadAs(UID_A, `userClips/${UID_A}/clip1.webm`, { contentType: "video/mp4" }));
  });

  it("attack: an unlisted extension is rejected", async () => {
    await assertFails(uploadAs(UID_A, `userClips/${UID_A}/clip1.svg`, { contentType: "image/svg+xml" }));
  });

  it("attack: path traversal out of the prefix is rejected", async () => {
    await assertFails(uploadAs(UID_A, `userClips/${UID_A}/../${UID_B}/clip1.webm`));
  });

  it("attack: a nested sub-path under the prefix is rejected (single-segment filename only)", async () => {
    await assertFails(uploadAs(UID_A, `userClips/${UID_A}/sub/clip1.webm`));
  });

  it("attack: a dotted filename stem is rejected (charset pin)", async () => {
    await assertFails(uploadAs(UID_A, `userClips/${UID_A}/clip.1.webm`));
  });

  it("attack: uploaderUid metadata pointing at another user is rejected", async () => {
    await assertFails(uploadAs(UID_A, `userClips/${UID_A}/clip1.webm`, { uploaderUid: UID_B }));
  });

  it("attack: missing uploaderUid metadata is rejected", async () => {
    await assertFails(uploadWithoutMetadata(asUser(UID_A), `userClips/${UID_A}/clip1.webm`));
  });

  it("attack: a sub-1KB stub upload is rejected", async () => {
    await assertFails(uploadAs(UID_A, `userClips/${UID_A}/clip1.webm`, { bytes: 512 }));
  });
});

describe("storage userClips — overwrite + delete", () => {
  // Emulator quirk (documented in storage-overwrite-redteam): a re-upload
  // routes to the CREATE rule under the emulator, not UPDATE. updateMetadata()
  // is the call that deterministically hits UPDATE, so the "no in-place
  // mutation" invariant is asserted through it.
  it("attack: an existing object CANNOT be mutated in place (update: false)", async () => {
    await assertSucceeds(uploadAs(UID_A, `userClips/${UID_A}/clip1.webm`));
    await assertFails(
      asUser(UID_A)
        .storage()
        .ref(`userClips/${UID_A}/clip1.webm`)
        .updateMetadata({ customMetadata: { uploaderUid: UID_A } }),
    );
  });

  it("the owner CAN delete their own object, then re-create it", async () => {
    await assertSucceeds(uploadAs(UID_A, `userClips/${UID_A}/clip1.webm`));
    await assertSucceeds(asUser(UID_A).storage().ref(`userClips/${UID_A}/clip1.webm`).delete());
    await assertSucceeds(uploadAs(UID_A, `userClips/${UID_A}/clip1.webm`));
  });

  it("attack: another user CANNOT delete someone else's object", async () => {
    await assertSucceeds(uploadAs(UID_A, `userClips/${UID_A}/clip1.webm`));
    await assertFails(asUser(UID_B).storage().ref(`userClips/${UID_A}/clip1.webm`).delete());
  });
});

describe("storage userClips — read", () => {
  it("any signed-in user CAN read (the feed is app-wide); anonymous CANNOT", async () => {
    await assertSucceeds(uploadAs(UID_A, `userClips/${UID_A}/clip1.webm`));
    await assertSucceeds(asUser(UID_B).storage().ref(`userClips/${UID_A}/clip1.webm`).getDownloadURL());
    await assertFails(
      getEnv().unauthenticatedContext().storage().ref(`userClips/${UID_A}/clip1.webm`).getDownloadURL(),
    );
  });
});
