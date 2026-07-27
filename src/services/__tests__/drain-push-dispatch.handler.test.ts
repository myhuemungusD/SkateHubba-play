/**
 * Server-layer tests for the push drain cron handler
 * (`api/cron/drain-push-dispatch.ts`).
 *
 * This handler is the only consumer of /push_dispatch — the Firebase Extension
 * it replaced never existed — so these guard the invariants that decide whether
 * a user's push arrives at all: fail-closed auth, "no DB touch on auth
 * failure", dry-run never writing, at-least-once delivery (a doc is deleted
 * only after FCM accepts it), the 24h TTL, and dead-token pruning scoped to the
 * dispatch's own recipient. firebase-admin is fully mocked — no real network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── firebase-admin mocks ───────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  getAppsMock: vi.fn(),
  initializeAppMock: vi.fn(),
  certMock: vi.fn((sa: unknown) => ({ __cert: sa })),
  getFirestoreMock: vi.fn(),
  getMessagingMock: vi.fn(),
  serverTimestampSentinel: { __srv: true },
  arrayRemoveMock: vi.fn((...v: unknown[]) => ({ __arrayRemove: v })),
}));

vi.mock("firebase-admin/app", () => ({
  getApps: h.getAppsMock,
  initializeApp: h.initializeAppMock,
  cert: h.certMock,
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: h.getFirestoreMock,
  FieldValue: {
    serverTimestamp: () => h.serverTimestampSentinel,
    arrayRemove: h.arrayRemoveMock,
  },
}));

vi.mock("firebase-admin/messaging", () => ({
  getMessaging: h.getMessagingMock,
}));

import handler from "../../../api/cron/drain-push-dispatch";
import { makeRes, makeReq, VALID_SERVICE_ACCOUNT } from "./cron.test-helpers";

const SECRET = "s3cret";
const AUTH = `Bearer ${SECRET}`;

/** Build a /push_dispatch doc payload with sane defaults. */
function dispatchDoc(overrides: Record<string, unknown> = {}) {
  return {
    tokens: ["tok-a"],
    notification: { title: "Your Turn!", body: "vs @bob" },
    data: { gameId: "g1", type: "your_turn", click_action: "/?game=g1" },
    senderUid: "u2",
    recipientUid: "u1",
    gameId: "g1",
    type: "your_turn",
    createdAt: { toMillis: () => Date.now() },
    ...overrides,
  };
}

interface FakeDoc {
  id: string;
  data: () => Record<string, unknown>;
  ref: { delete: ReturnType<typeof vi.fn> };
}

/** Track every write the handler makes so tests can assert scoping. */
interface Recorder {
  pushTargetSets: { uid: string; data: unknown }[];
  privateSets: { uid: string; data: unknown }[];
  deletes: string[];
}

function makeDb(docs: FakeDoc[], rec: Recorder, opts: { queryThrows?: boolean } = {}) {
  const privateDoc = (uid: string) => ({
    set: vi.fn((data: unknown) => {
      rec.privateSets.push({ uid, data });
      return Promise.resolve();
    }),
  });

  return {
    collection: vi.fn((name: string) => {
      if (name === "push_dispatch") {
        return {
          orderBy: () => ({
            limit: () => ({
              get: () => (opts.queryThrows ? Promise.reject(new Error("index missing")) : Promise.resolve({ docs })),
            }),
          }),
        };
      }
      if (name === "pushTargets") {
        return {
          doc: (uid: string) => ({
            set: vi.fn((data: unknown) => {
              rec.pushTargetSets.push({ uid, data });
              return Promise.resolve();
            }),
          }),
        };
      }
      // users/{uid}/private/profile
      return {
        doc: (uid: string) => ({
          collection: () => ({ doc: () => privateDoc(uid) }),
        }),
      };
    }),
  };
}

function makeFakeDoc(id: string, data: Record<string, unknown>, rec: Recorder): FakeDoc {
  return {
    id,
    data: () => data,
    ref: {
      delete: vi.fn(() => {
        rec.deletes.push(id);
        return Promise.resolve();
      }),
    },
  };
}

/** Default multicast response: every token delivered. */
function allOk(count: number) {
  return {
    successCount: count,
    failureCount: 0,
    responses: Array.from({ length: count }, () => ({ success: true })),
  };
}

let sendEachForMulticast: ReturnType<typeof vi.fn>;
let rec: Recorder;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SERVICE_ACCOUNT;
  delete process.env.DRY_RUN;
  // A pre-existing app short-circuits initializeApp; each test that cares about
  // init overrides this.
  h.getAppsMock.mockReturnValue([{ __app: true }]);
  rec = { pushTargetSets: [], privateSets: [], deletes: [] };
  sendEachForMulticast = vi.fn(() => Promise.resolve(allOk(1)));
  h.getMessagingMock.mockReturnValue({ sendEachForMulticast });
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  // The mangled-env regression below imports a fresh module instance; clear
  // the registry so no future dynamic import inherits its populated
  // module-scope cache and short-circuits the init path vacuously.
  vi.resetModules();
});

describe("auth", () => {
  it("401s without an Authorization header and never touches Firestore", async () => {
    const { res, out } = makeRes();
    await handler(makeReq(), res);
    expect(out.code).toBe(401);
    expect(h.getFirestoreMock).not.toHaveBeenCalled();
  });

  it("401s on a wrong secret", async () => {
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer wrong-but-same-len" }), res);
    expect(out.code).toBe(401);
  });

  it("401s when CRON_SECRET is unset — fail closed", async () => {
    delete process.env.CRON_SECRET;
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);
    expect(out.code).toBe(401);
  });

  it("401s on a length-mismatched token without throwing", async () => {
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer x" }), res);
    expect(out.code).toBe(401);
  });
});

describe("init", () => {
  it("500s when the service account env is missing", async () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    h.getAppsMock.mockReturnValue([]);
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);
    expect(out.code).toBe(500);
    expect(out.body).toMatchObject({ error: "init_failed" });
  });

  it("500s when the service account env is missing required fields", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: "demo" });
    h.getAppsMock.mockReturnValue([]);
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);
    expect(out.code).toBe(500);
    expect(out.body).toMatchObject({ error: "init_failed" });
  });

  it("initializes an app when none exists", async () => {
    h.getAppsMock.mockReturnValue([]);
    h.initializeAppMock.mockReturnValue({ __app: "new" });
    h.getFirestoreMock.mockReturnValue(makeDb([], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);
    expect(h.initializeAppMock).toHaveBeenCalled();
    expect(out.code).toBe(200);
  });

  it("initializes despite a hand-paste-mangled private_key (2026-07-27 outage)", async () => {
    // The production shape: pretty-printed service account whose `\n`
    // escapes all became real newlines in the Vercel dashboard paste.
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(JSON.parse(VALID_SERVICE_ACCOUNT), null, 2).replace(
      /\\n/g,
      "\n",
    );
    h.getAppsMock.mockReturnValue([]);
    h.initializeAppMock.mockReturnValue({ __app: "new" });
    h.getFirestoreMock.mockReturnValue(makeDb([], rec));
    // The module caches its admin app after the first init; a fresh module
    // instance is the only way to exercise the init path again mid-file.
    vi.resetModules();
    const { default: freshHandler } = await import("../../../api/cron/drain-push-dispatch");
    const { res, out } = makeRes();
    await freshHandler(makeReq({ authorization: AUTH }), res);
    expect(out.code).toBe(200);
    // The credential handed to cert() must carry the repaired PEM —
    // real newlines, exactly as Google's file encodes them.
    const sa = h.certMock.mock.calls.at(-1)?.[0] as { privateKey: string };
    expect(sa.privateKey).toBe("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n");
    // The repair must announce itself — a silently absorbed misconfiguration
    // would outlive everyone's memory of this outage.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("service_account_json_repaired"));
  });
});

describe("drain", () => {
  it("returns a zeroed summary when the queue is empty", async () => {
    h.getFirestoreMock.mockReturnValue(makeDb([], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);

    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ scanned: 0, sent: 0, expired: 0, malformed: 0, errors: 0, dryRun: false });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("sends a well-formed doc and deletes it", async () => {
    const doc = makeFakeDoc("d1", dispatchDoc(), rec);
    h.getFirestoreMock.mockReturnValue(makeDb([doc], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);

    expect(sendEachForMulticast).toHaveBeenCalledWith({
      tokens: ["tok-a"],
      notification: { title: "Your Turn!", body: "vs @bob" },
      data: { gameId: "g1", type: "your_turn", click_action: "/?game=g1" },
    });
    expect(rec.deletes).toEqual(["d1"]);
    expect(out.body).toMatchObject({ scanned: 1, sent: 1, failedTokens: 0 });
  });

  it("delivers a nudge dispatch — nudges ride the same queue", async () => {
    const doc = makeFakeDoc(
      "d1",
      dispatchDoc({
        type: "nudge",
        notification: { title: "You got nudged!", body: "@alice is waiting for your move" },
        data: { gameId: "g1", type: "nudge", click_action: "/?game=g1" },
      }),
      rec,
    );
    h.getFirestoreMock.mockReturnValue(makeDb([doc], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);

    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ notification: { title: "You got nudged!", body: "@alice is waiting for your move" } }),
    );
    expect(out.body).toMatchObject({ sent: 1 });
  });

  it("deletes a doc older than the 24h TTL without sending it", async () => {
    // A stale "your turn" must never wake a phone the day after the turn
    // already auto-forfeited.
    const stale = dispatchDoc({ createdAt: { toMillis: () => Date.now() - 25 * 60 * 60 * 1000 } });
    const doc = makeFakeDoc("old", stale, rec);
    h.getFirestoreMock.mockReturnValue(makeDb([doc], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);

    expect(sendEachForMulticast).not.toHaveBeenCalled();
    expect(rec.deletes).toEqual(["old"]);
    expect(out.body).toMatchObject({ expired: 1, sent: 0 });
  });

  it("sends a doc sitting just inside the TTL", async () => {
    const fresh = dispatchDoc({ createdAt: { toMillis: () => Date.now() - 23 * 60 * 60 * 1000 } });
    h.getFirestoreMock.mockReturnValue(makeDb([makeFakeDoc("d1", fresh, rec)], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);
    expect(out.body).toMatchObject({ sent: 1, expired: 0 });
  });

  it("treats an unresolved createdAt as too new to expire", async () => {
    const pending = dispatchDoc({ createdAt: null });
    h.getFirestoreMock.mockReturnValue(makeDb([makeFakeDoc("d1", pending, rec)], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);
    expect(out.body).toMatchObject({ sent: 1, expired: 0 });
  });

  it.each([
    ["tokens missing", { tokens: undefined }],
    ["tokens empty", { tokens: [] }],
    ["tokens all non-string", { tokens: [null, 7] }],
    ["notification missing", { notification: undefined }],
    ["notification title non-string", { notification: { title: 1, body: "b" } }],
    ["recipientUid missing", { recipientUid: undefined }],
  ])("deletes a malformed doc (%s) without sending", async (_label, override) => {
    const doc = makeFakeDoc("bad", dispatchDoc(override), rec);
    h.getFirestoreMock.mockReturnValue(makeDb([doc], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);

    expect(sendEachForMulticast).not.toHaveBeenCalled();
    expect(rec.deletes).toEqual(["bad"]);
    expect(out.body).toMatchObject({ malformed: 1 });
  });

  it("drops non-string data values rather than failing the whole send", async () => {
    const doc = makeFakeDoc("d1", dispatchDoc({ data: { gameId: "g1", bad: 42, type: "your_turn" } }), rec);
    h.getFirestoreMock.mockReturnValue(makeDb([doc], rec));
    const { res } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);

    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ data: { gameId: "g1", type: "your_turn" } }),
    );
  });

  it("tolerates a doc with no data map at all", async () => {
    const doc = makeFakeDoc("d1", dispatchDoc({ data: undefined }), rec);
    h.getFirestoreMock.mockReturnValue(makeDb([doc], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);
    expect(sendEachForMulticast).toHaveBeenCalledWith(expect.objectContaining({ data: {} }));
    expect(out.body).toMatchObject({ sent: 1 });
  });

  it("KEEPS the doc when the send throws, so the next run retries it", async () => {
    // At-least-once: a transient FCM/network fault must never silently drop a
    // notification.
    sendEachForMulticast.mockRejectedValueOnce(new Error("FCM unavailable"));
    const doc = makeFakeDoc("d1", dispatchDoc(), rec);
    h.getFirestoreMock.mockReturnValue(makeDb([doc], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);

    expect(rec.deletes).toEqual([]);
    expect(out.body).toMatchObject({ errors: 1, sent: 0 });
  });

  it("isolates a failing doc from the rest of the batch", async () => {
    sendEachForMulticast.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(allOk(1));
    const docs = [makeFakeDoc("bad", dispatchDoc(), rec), makeFakeDoc("good", dispatchDoc(), rec)];
    h.getFirestoreMock.mockReturnValue(makeDb(docs, rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);

    expect(rec.deletes).toEqual(["good"]);
    expect(out.body).toMatchObject({ scanned: 2, sent: 1, errors: 1 });
  });

  it("500s but never throws when the queue query fails", async () => {
    h.getFirestoreMock.mockReturnValue(makeDb([], rec, { queryThrows: true }));
    const { res, out } = makeRes();
    await expect(handler(makeReq({ authorization: AUTH }), res)).resolves.toBeUndefined();
    expect(out.code).toBe(500);
    expect(out.body).toMatchObject({ error: "drain_failed" });
  });
});

describe("dead-token pruning", () => {
  function unregistered(deadIndexes: number[], total: number) {
    return {
      successCount: total - deadIndexes.length,
      failureCount: deadIndexes.length,
      responses: Array.from({ length: total }, (_, i) =>
        deadIndexes.includes(i)
          ? { success: false, error: { code: "messaging/registration-token-not-registered" } }
          : { success: true },
      ),
    };
  }

  it("removes a dead token from both the mirror and the private profile", async () => {
    sendEachForMulticast.mockResolvedValueOnce(unregistered([1], 3));
    const doc = makeFakeDoc("d1", dispatchDoc({ tokens: ["live-1", "dead", "live-2"] }), rec);
    h.getFirestoreMock.mockReturnValue(makeDb([doc], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);

    expect(h.arrayRemoveMock).toHaveBeenCalledWith("dead");
    expect(rec.pushTargetSets).toHaveLength(1);
    expect(rec.privateSets).toHaveLength(1);
    expect(out.body).toMatchObject({ pruned: 1, failedTokens: 1 });
  });

  it("prunes only against the dispatch's own recipient", async () => {
    // The /push_dispatch create rule enforces tokens.hasOnly(<recipient mirror>),
    // so the tokens here always belong to recipientUid — a crafted doc must not
    // be able to mutate an unrelated user's device list.
    sendEachForMulticast.mockResolvedValueOnce(unregistered([0], 1));
    const doc = makeFakeDoc("d1", dispatchDoc({ recipientUid: "victim", tokens: ["dead"] }), rec);
    h.getFirestoreMock.mockReturnValue(makeDb([doc], rec));
    const { res } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);

    expect(rec.pushTargetSets.map((s) => s.uid)).toEqual(["victim"]);
    expect(rec.privateSets.map((s) => s.uid)).toEqual(["victim"]);
  });

  it("does NOT prune on a transient failure code", async () => {
    // A quota blip must never cost the user a registered device.
    sendEachForMulticast.mockResolvedValueOnce({
      successCount: 0,
      failureCount: 1,
      responses: [{ success: false, error: { code: "messaging/server-unavailable" } }],
    });
    const doc = makeFakeDoc("d1", dispatchDoc(), rec);
    h.getFirestoreMock.mockReturnValue(makeDb([doc], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);

    expect(rec.pushTargetSets).toHaveLength(0);
    expect(out.body).toMatchObject({ pruned: 0, failedTokens: 1 });
    // Still deleted — FCM accepted the request; the token just isn't reachable.
    expect(rec.deletes).toEqual(["d1"]);
  });

  it("does not prune when a failure carries no error object", async () => {
    sendEachForMulticast.mockResolvedValueOnce({
      successCount: 0,
      failureCount: 1,
      responses: [{ success: false }],
    });
    h.getFirestoreMock.mockReturnValue(makeDb([makeFakeDoc("d1", dispatchDoc(), rec)], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);
    expect(out.body).toMatchObject({ pruned: 0 });
  });

  it("still deletes the dispatch doc when pruning itself fails", async () => {
    sendEachForMulticast.mockResolvedValueOnce(unregistered([0], 1));
    const db = makeDb([makeFakeDoc("d1", dispatchDoc(), rec)], rec);
    db.collection = vi.fn((name: string) => {
      if (name === "push_dispatch") {
        return {
          orderBy: () => ({
            limit: () => ({
              get: () => Promise.resolve({ docs: [makeFakeDoc("d1", dispatchDoc(), rec)] }),
            }),
          }),
        };
      }
      return {
        doc: () => ({
          set: () => Promise.reject(new Error("prune denied")),
          collection: () => ({ doc: () => ({ set: () => Promise.reject(new Error("prune denied")) }) }),
        }),
      };
    }) as unknown as typeof db.collection;
    h.getFirestoreMock.mockReturnValue(db);
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);

    expect(out.body).toMatchObject({ sent: 1, pruned: 0 });
    expect(rec.deletes).toEqual(["d1"]);
  });
});

describe("dry run", () => {
  it("counts what it would send but writes nothing", async () => {
    const doc = makeFakeDoc("d1", dispatchDoc(), rec);
    h.getFirestoreMock.mockReturnValue(makeDb([doc], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH, query: { dryRun: "1" } }), res);

    expect(sendEachForMulticast).not.toHaveBeenCalled();
    expect(rec.deletes).toEqual([]);
    expect(out.body).toMatchObject({ scanned: 1, sent: 1, dryRun: true });
  });

  it("does not delete an expired doc under dry run", async () => {
    const stale = dispatchDoc({ createdAt: { toMillis: () => Date.now() - 48 * 60 * 60 * 1000 } });
    h.getFirestoreMock.mockReturnValue(makeDb([makeFakeDoc("old", stale, rec)], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH, query: { dryRun: "true" } }), res);
    expect(rec.deletes).toEqual([]);
    expect(out.body).toMatchObject({ expired: 1 });
  });

  it("does not delete a malformed doc under dry run", async () => {
    h.getFirestoreMock.mockReturnValue(makeDb([makeFakeDoc("bad", dispatchDoc({ tokens: [] }), rec)], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH, query: { dryRun: "1" } }), res);
    expect(rec.deletes).toEqual([]);
    expect(out.body).toMatchObject({ malformed: 1, dryRun: true });
  });

  it("honours the DRY_RUN env var", async () => {
    process.env.DRY_RUN = "1";
    h.getFirestoreMock.mockReturnValue(makeDb([makeFakeDoc("d1", dispatchDoc(), rec)], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH }), res);
    expect(out.body).toMatchObject({ dryRun: true });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("honours dryRun in a raw URL when query is not pre-parsed", async () => {
    h.getFirestoreMock.mockReturnValue(makeDb([], rec));
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: AUTH, url: "/api/cron/drain-push-dispatch?dryRun=1" }), res);
    expect(out.body).toMatchObject({ dryRun: true });
  });
});
