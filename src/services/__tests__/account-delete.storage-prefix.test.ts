/**
 * G8: account deletion must erase the whole `users/{uid}/` Storage folder,
 * including the Resize Images extension's `*_200x200.*` thumbnails, and must
 * never reach into another account whose uid merely shares a string prefix.
 */
import { describe, it, expect, vi } from "vitest";

const fp = vi.hoisted(() => ({ documentId: { __fieldPath: "__name__" } }));

vi.mock("firebase-admin/firestore", () => ({
  FieldPath: { documentId: () => fp.documentId },
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}));

import { deleteUserDataAsAdmin } from "../../../api/account/_deleteUserData";
import { deletePrefix, userStoragePrefix } from "../../../api/account/_cascadeUtil";
import { makeFakeStore } from "./account-delete.test-helpers";

const UID = "abc";
const SIBLING = "abcd";

/** Everything the app and the resize extension write under one profile folder. */
function profileFolder(uid: string): string[] {
  return [
    `users/${uid}/avatar.webp`,
    `users/${uid}/avatar_200x200.webp`,
    `users/${uid}/banner.webp`,
    `users/${uid}/banner_200x200.webp`,
    // A future extension size or RESIZED_IMAGES_PATH subfolder stays covered.
    `users/${uid}/thumbnails/avatar_400x400.webp`,
  ];
}

describe("userStoragePrefix", () => {
  it("always ends with a slash so uid 'abc' cannot match 'abcd/'", () => {
    expect(userStoragePrefix(UID)).toBe("users/abc/");
    expect(`users/${SIBLING}/avatar.webp`.startsWith(userStoragePrefix(UID))).toBe(false);
  });

  it.each(["", "a/b", "../x"])("refuses a uid that would widen the prefix (%j)", (uid) => {
    expect(() => userStoragePrefix(uid)).toThrow(/refusing/);
  });
});

describe("account delete erases the users/{uid}/ folder (G8)", () => {
  it("deletes the _200x200 resize thumbnails along with the originals", async () => {
    const store = makeFakeStore({}, profileFolder(UID));

    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect([...store.objects].filter((o) => o.startsWith("users/abc/"))).toEqual([]);
    expect(store.fileDeletes.map((f) => f.name)).toEqual(
      expect.arrayContaining(["users/abc/avatar_200x200.webp", "users/abc/banner_200x200.webp"]),
    );
    // banner.webp goes in Phase 3c (owned media); the rest in Phase 5.
    expect(summary.content.mediaObjects).toBe(1);
    expect(summary.avatarObjects).toBe(4);
  });

  it("leaves a sibling account whose uid shares the string prefix untouched", async () => {
    const store = makeFakeStore({}, [...profileFolder(UID), ...profileFolder(SIBLING), "users/abc.webp"]);

    await deleteUserDataAsAdmin(store.deps, UID);

    expect([...store.objects].sort()).toEqual([...profileFolder(SIBLING), "users/abc.webp"].sort());
    expect(store.getFilesCalls.map((c) => c.prefix)).toContain("users/abc/");
    expect(store.getFilesCalls.every((c) => !c.prefix.startsWith("users/abcd"))).toBe(true);
  });

  it("is a no-op, not an error, when the folder is empty or already gone", async () => {
    const store = makeFakeStore({}, profileFolder(SIBLING));

    const first = await deleteUserDataAsAdmin(store.deps, UID);
    const second = await deleteUserDataAsAdmin(store.deps, UID);

    expect(first.avatarObjects).toBe(0);
    expect(second.avatarObjects).toBe(0);
    expect(store.objects.size).toBe(profileFolder(SIBLING).length);
  });

  it("surfaces a listing failure instead of reporting success", async () => {
    const store = makeFakeStore({}, profileFolder(UID));
    store.failGetFilesPrefix = "users/abc/";

    await expect(deleteUserDataAsAdmin(store.deps, UID)).rejects.toThrow(/storage list failed/);
  });
});

describe("deletePrefix pagination", () => {
  it("walks every page with pageToken and deletes all objects", async () => {
    const names = Array.from({ length: 7 }, (_, i) => `users/abc/thumb_${i}.webp`);
    const store = makeFakeStore({}, [...names, "users/abcd/keep.webp"]);
    store.getFilesPageSize = 3;

    const deleted = await deletePrefix(store.deps, "users/abc/");

    expect(deleted).toBe(7);
    expect([...store.objects]).toEqual(["users/abcd/keep.webp"]);
    // 3 + 3 + 1: three pages, the first without a token, the rest with one.
    expect(store.getFilesCalls).toHaveLength(3);
    expect(store.getFilesCalls[0]).toMatchObject({ prefix: "users/abc/", autoPaginate: false });
    expect(store.getFilesCalls[0].pageToken).toBeUndefined();
    expect(store.getFilesCalls.slice(1).every((c) => typeof c.pageToken === "string")).toBe(true);
  });

  it("makes exactly one list call and deletes nothing for an empty prefix", async () => {
    const store = makeFakeStore({}, []);

    expect(await deletePrefix(store.deps, "users/abc/")).toBe(0);
    expect(store.getFilesCalls).toHaveLength(1);
    expect(store.fileDeleteAttempts).toEqual([]);
  });
});
