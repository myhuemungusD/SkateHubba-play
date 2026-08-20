/**
 * User-posted clip creation — `src/services/clips.userWrites.ts`.
 *
 * The create rule makes the `users/{uid}.lastClipCreatedAt` companion write
 * MANDATORY (it `getAfter()`s the field), so the pairing of the two writes
 * inside one transaction is the contract these tests hold, alongside the
 * typed refusals that let the UI say WHY a post was rejected.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCollection, mockDoc, mockRunTransaction, mockServerTimestamp } = vi.hoisted(() => ({
  mockCollection: vi.fn((_db: unknown, name: string) => ({ __collection: name })),
  // Two arities: `doc(collection)` mints an id, `doc(db, "clips", id)` addresses one.
  mockDoc: vi.fn((_first: unknown, ...rest: string[]) =>
    rest.length === 0 ? { id: "minted-id" } : { __path: rest.join("/"), id: rest[rest.length - 1] },
  ),
  mockRunTransaction: vi.fn(),
  mockServerTimestamp: vi.fn(() => "SERVER_TS"),
}));

vi.mock("firebase/firestore", () => ({
  collection: mockCollection,
  doc: mockDoc,
  runTransaction: mockRunTransaction,
  serverTimestamp: mockServerTimestamp,
}));

const { mockCurrentUser } = vi.hoisted(() => ({
  mockCurrentUser: { value: { uid: "me" } as { uid: string } | null },
}));

vi.mock("../../firebase", () => ({
  requireDb: () => ({}),
  requireAuth: () => ({ currentUser: mockCurrentUser.value }),
}));

import {
  ClipCooldownError,
  USER_CLIP_COOLDOWN_MS,
  UserBannedError,
  createUserClip,
  newUserClipId,
} from "../clips.userWrites";
import { logger } from "../logger";
import { absent, captureTx, present, type CapturedTx } from "./txCapture.test-helpers";

/** A download URL in the exact form the rules pin for user clips. */
const VIDEO_URL =
  "https://firebasestorage.googleapis.com/v0/b/skatehubba.appspot.com/o/userClips%2Fme%2Fuc1.webm?alt=media";

/**
 * Wire one transaction whose `tx.get(users/me)` resolves to the supplied
 * profile state. `"missing"` models an account with no profile doc yet.
 */
function wireTx(profile: "missing" | Record<string, unknown>): { observed: () => CapturedTx } {
  return captureTx(mockRunTransaction, () => (profile === "missing" ? absent() : present(profile)));
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    clipId: "uc1",
    playerUsername: "alice",
    trickName: "nollie heel",
    videoUrl: VIDEO_URL,
    spotId: null,
    ...overrides,
  } as Parameters<typeof createUserClip>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentUser.value = { uid: "me" };
});

describe("newUserClipId", () => {
  it("mints an id from the clips collection without writing anything", () => {
    expect(newUserClipId()).toBe("minted-id");
    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "clips");
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });
});

describe("createUserClip", () => {
  it("writes the clip and the mandatory cooldown anchor in one transaction", async () => {
    const cap = wireTx({ username: "alice" });

    await expect(createUserClip(params({ spotId: "spot-1" }))).resolves.toBe("uc1");

    const tx = cap.observed();
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "clips", "uc1");
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ __path: "clips/uc1" }), {
      source: "user",
      gameId: null,
      turnNumber: null,
      role: null,
      playerUid: "me",
      playerUsername: "alice",
      trickName: "nollie heel",
      videoUrl: VIDEO_URL,
      spotId: "spot-1",
      createdAt: "SERVER_TS",
      moderationStatus: "active",
      upvoteCount: 0,
      downvoteCount: 0,
    });
    // Omitting this write is denied by the rule's getAfter() — it is not an
    // optimisation, it is the rate limit.
    expect(tx.update).toHaveBeenCalledWith(expect.objectContaining({ __path: "users/me" }), {
      lastClipCreatedAt: "SERVER_TS",
    });
  });

  it("posts when the previous clip is older than the cooldown", async () => {
    const cap = wireTx({ lastClipCreatedAt: { toMillis: () => Date.now() - USER_CLIP_COOLDOWN_MS - 1 } });

    await expect(createUserClip(params())).resolves.toBe("uc1");
    expect(cap.observed().set).toHaveBeenCalled();
  });

  it("throws ClipCooldownError with the remaining wait inside the window", async () => {
    const cap = wireTx({ lastClipCreatedAt: { toMillis: () => Date.now() - 10_000 } });

    const err: unknown = await createUserClip(params()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClipCooldownError);
    expect((err as ClipCooldownError).retryAfterMs).toBeGreaterThan(0);
    expect((err as ClipCooldownError).retryAfterMs).toBeLessThanOrEqual(USER_CLIP_COOLDOWN_MS);
    expect(cap.observed().set).not.toHaveBeenCalled();
  });

  it("never reports a wait longer than the cooldown when the anchor is in the future", async () => {
    wireTx({ lastClipCreatedAt: { toMillis: () => Date.now() + 60_000 } });

    const err: unknown = await createUserClip(params()).catch((e: unknown) => e);

    // Clock skew must not make the UI count down from 90 seconds.
    expect((err as ClipCooldownError).retryAfterMs).toBe(USER_CLIP_COOLDOWN_MS);
  });

  // A profile whose cooldown anchor cannot be read as a number must not wedge
  // the account out of posting. Each shape breaks the Timestamp contract at a
  // different point, and every one of them has to degrade to "no anchor" —
  // the rule is still the real limit, so failing open here is safe.
  it.each([
    ["a non-object scalar", "not-a-timestamp"],
    ["an object with no toMillis", { seconds: 12, nanoseconds: 0 }],
    ["a toMillis that is not callable", { toMillis: "soon" }],
    ["a toMillis returning NaN", { toMillis: () => Number.NaN }],
    ["a toMillis returning a non-number", { toMillis: () => "later" }],
  ])("ignores a cooldown anchor that is %s rather than blocking forever", async (_label, lastClipCreatedAt) => {
    const cap = wireTx({ lastClipCreatedAt });

    await expect(createUserClip(params())).resolves.toBe("uc1");

    expect(cap.observed().set).toHaveBeenCalled();
  });

  it("throws UserBannedError for a banned account", async () => {
    const cap = wireTx({ banned: true });

    await expect(createUserClip(params())).rejects.toBeInstanceOf(UserBannedError);
    expect(cap.observed().set).not.toHaveBeenCalled();
  });

  it("refuses when the profile doc does not exist yet", async () => {
    wireTx("missing");

    await expect(createUserClip(params())).rejects.toThrow(/Failed to post your clip/);
  });

  it("takes playerUid from the signed-in user and refuses to post as somebody else", async () => {
    const cap = wireTx({});
    await createUserClip(params({ playerUid: "me" }));
    expect(cap.observed().set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ playerUid: "me" }));

    await expect(createUserClip(params({ playerUid: "someone-else" }))).rejects.toThrow(/only post clips as yourself/);
  });

  it("requires a signed-in user", async () => {
    mockCurrentUser.value = null;

    await expect(createUserClip(params())).rejects.toThrow(/must be signed in/);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("rejects an unusable clip id", async () => {
    await expect(createUserClip(params({ clipId: "" }))).rejects.toThrow(/Invalid clip id/);
    await expect(createUserClip(params({ clipId: "a/b" }))).rejects.toThrow(/Invalid clip id/);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("trims and bounds the trick name", async () => {
    const cap = wireTx({});
    await createUserClip(params({ trickName: "  switch flip  " }));
    expect(cap.observed().set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trickName: "switch flip" }),
    );

    await expect(createUserClip(params({ trickName: "   " }))).rejects.toThrow(/Name the trick/);
    await expect(createUserClip(params({ trickName: "x".repeat(81) }))).rejects.toThrow(/80 characters/);
    // A non-string slips past `validateTrickName` only if a caller bypasses
    // the form; it must land on the same refusal, not `trickName.trim is not
    // a function` inside the transaction.
    await expect(createUserClip(params({ trickName: 7 }))).rejects.toThrow(/Name the trick/);
    await expect(createUserClip(params({ trickName: null }))).rejects.toThrow(/Name the trick/);
  });

  it("rejects a video url that is missing, over-long, or off the caller's own prefix", async () => {
    await expect(createUserClip(params({ videoUrl: "" }))).rejects.toThrow(/could not be attached/);
    await expect(createUserClip(params({ videoUrl: "x".repeat(2049) }))).rejects.toThrow(/could not be attached/);
    // Somebody else's storage prefix — the rule pins it to request.auth.uid.
    await expect(
      createUserClip(
        params({
          videoUrl: VIDEO_URL.replace("userClips%2Fme", "userClips%2Fyou"),
        }),
      ),
    ).rejects.toThrow(/could not be attached/);
    // The bucket-as-host CDN form is accepted for game clips, not user ones.
    await expect(
      createUserClip(params({ videoUrl: "https://skatehubba.appspot.com/userClips/me/uc1.webm" })),
    ).rejects.toThrow(/could not be attached/);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("accepts the mp4 form of the pinned url", async () => {
    const cap = wireTx({});

    await createUserClip(params({ videoUrl: VIDEO_URL.replace(".webm?alt=media", ".mp4") }));

    expect(cap.observed().set).toHaveBeenCalled();
  });

  it("requires a username and truncates it to the rule's cap", async () => {
    await expect(createUserClip(params({ playerUsername: "  " }))).rejects.toThrow(/Set a username/);
    await expect(createUserClip(params({ playerUsername: 7 }))).rejects.toThrow(/Set a username/);

    const cap = wireTx({});
    await createUserClip(params({ playerUsername: "a".repeat(30) }));
    expect(cap.observed().set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ playerUsername: "a".repeat(20) }),
    );
  });

  it("normalises the spot id: truncates an over-long one, nulls a non-string", async () => {
    const cap = wireTx({});
    await createUserClip(params({ spotId: "s".repeat(80) }));
    expect(cap.observed().set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ spotId: "s".repeat(64) }),
    );

    const cap2 = wireTx({});
    await createUserClip(params({ spotId: 7 }));
    expect(cap2.observed().set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ spotId: null }));
  });

  it("converts a rejected commit into a user-facing message and logs the cause", async () => {
    mockRunTransaction.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(createUserClip(params())).rejects.toThrow(/Failed to post your clip/);

    expect(warn).toHaveBeenCalledWith("user_clip_create_failed", expect.objectContaining({ clipId: "uc1" }));
    warn.mockRestore();
  });

  it("does not mask a typed refusal as a generic failure", async () => {
    wireTx({ banned: true });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(createUserClip(params())).rejects.toBeInstanceOf(UserBannedError);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
