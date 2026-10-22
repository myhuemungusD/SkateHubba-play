import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleClipCreated = vi.fn(async () => "approved" as const);
const initializeApp = vi.fn();
const getAccessToken = vi.fn(async () => ({ access_token: "tok", expires_in: 3600 }));
const applicationDefault = vi.fn(() => ({ getAccessToken }));
const fakeDb = { __db: true, collection: () => ({}) };
const getFirestore = vi.fn(() => fakeDb);
const media = { __media: true };

vi.mock("./handlers.js", () => ({ handleClipCreated: (...args: unknown[]) => handleClipCreated(...(args as [])) }));
vi.mock("./publish.js", () => ({ adminClipStore: () => media }));
vi.mock("firebase-admin/app", () => ({
  initializeApp: (...args: unknown[]) => initializeApp(...args),
  applicationDefault: () => applicationDefault(),
}));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: (...args: unknown[]) => getFirestore(...(args as [])) }));

const { adminRescreenRuntime, firestoreRescreenDeps } = await import("./rescreen.js");

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rescreen-"));
  vi.clearAllMocks();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("adminRescreenRuntime", () => {
  it("screens through handleClipCreated with the trigger's options plus the ADC token", async () => {
    const runtime = adminRescreenRuntime({ databaseId: "skatehubba", projectId: "demo-skatehubba", sentryDsn: "" });
    expect(runtime.projectId).toBe("demo-skatehubba");
    expect(applicationDefault).toHaveBeenCalledTimes(1);
    expect(initializeApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: "demo-skatehubba" }));
    expect(getFirestore).toHaveBeenCalledWith("skatehubba");

    const data = { source: "user", moderation: "pending" };
    await expect(runtime.deps.screen("clip1", data)).resolves.toBe("approved");
    expect(handleClipCreated).toHaveBeenCalledWith(
      expect.objectContaining({ db: fakeDb, enabled: true, sentryDsn: "", media, getToken: expect.any(Function) }),
      "clip1",
      data,
    );
    const opts = (handleClipCreated.mock.calls[0] as unknown as [{ getToken: () => Promise<string> }])[0];
    await expect(opts.getToken()).resolves.toBe("tok");
    await expect(runtime.checkToken()).resolves.toBeUndefined();
  });

  it("never takes a key-file path: a Workload Identity config in GOOGLE_APPLICATION_CREDENTIALS still goes through ADC", () => {
    const prior = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const wif = join(dir, "external-account.json");
    writeFileSync(wif, JSON.stringify({ type: "external_account", audience: "//iam.googleapis.com/x" }));
    process.env.GOOGLE_APPLICATION_CREDENTIALS = wif;
    try {
      adminRescreenRuntime({ databaseId: "skatehubba", projectId: "demo-skatehubba", sentryDsn: "" });
      expect(applicationDefault).toHaveBeenCalledTimes(1);
    } finally {
      if (prior === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      else process.env.GOOGLE_APPLICATION_CREDENTIALS = prior;
    }
  });

  it("lets ADC find the project when none is pinned and fails fast on an empty token", async () => {
    const runtime = adminRescreenRuntime({ databaseId: "skatehubba", projectId: "", sentryDsn: "" });
    expect(applicationDefault).toHaveBeenCalled();
    expect(initializeApp).toHaveBeenCalledWith({ credential: expect.anything() });
    expect(runtime.projectId).toBe("");
    getAccessToken.mockResolvedValueOnce({ access_token: "", expires_in: 0 });
    await expect(runtime.checkToken()).rejects.toThrow("empty access token");
  });
});

describe("firestoreRescreenDeps", () => {
  function doc(id: string, data: Record<string, unknown>) {
    return { id, data: () => data };
  }
  function db() {
    const queries: Array<[string, string, string]> = [];
    const clipDocs: Record<string, Record<string, unknown> | undefined> = {
      a: { moderation: "pending" },
      gone: undefined,
    };
    const fake = {
      collection: (name: string) => ({
        where: (field: string, op: string, value: string) => {
          queries.push([field, op, value]);
          return {
            get: async () => ({
              docs:
                field === "moderation"
                  ? [doc("a", { moderation: "pending" })]
                  : [doc("a", { moderation: "pending" }), doc("b", { moderationStatus: "pending" })],
            }),
          };
        },
        doc: (id: string) => ({
          get: async () =>
            name === "users"
              ? { get: () => (id === "known" ? "real_handle" : undefined) }
              : { exists: clipDocs[id] !== undefined, data: () => clipDocs[id] },
        }),
      }),
    };
    return { fake, queries };
  }

  it("unions both pending fields, reads fresh, and resolves the owner handle", async () => {
    const { fake, queries } = db();
    const screen = vi.fn();
    const deps = firestoreRescreenDeps(fake as never, screen);
    const listed = await deps.listPending();
    expect(queries).toEqual([
      ["moderation", "==", "pending"],
      ["moderationStatus", "==", "pending"],
    ]);
    expect(listed.map((c) => c.id)).toEqual(["a", "b"]);
    await expect(deps.read("a")).resolves.toEqual({ moderation: "pending" });
    await expect(deps.read("gone")).resolves.toBeNull();
    await expect(deps.ownerHandle({ playerUsername: "on_clip" })).resolves.toBe("on_clip");
    await expect(deps.ownerHandle({ playerUid: "known" })).resolves.toBe("real_handle");
    await expect(deps.ownerHandle({ playerUid: "other" })).resolves.toBe("");
    await expect(deps.ownerHandle({})).resolves.toBe("");
    expect(deps.screen).toBe(screen);
    vi.useFakeTimers();
    const slept = deps.sleep(10);
    vi.advanceTimersByTime(10);
    await expect(slept).resolves.toBeUndefined();
    vi.useRealTimers();
    expect(Math.abs(deps.now() - Date.now())).toBeLessThan(1000);
  });
});
