import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for `api/player-meta.ts` — the per-profile social card served to
 * crawlers at `/player/{uid}`.
 *
 * Two properties carry real risk and get the most attention:
 *
 *   1. Usernames are user-chosen and land inside HTML attributes. Escaping is
 *      the only thing between a username and markup injection into every
 *      preview of that profile.
 *   2. The uid is interpolated into a Firestore REST URL. An unvalidated value
 *      could redirect the fetch somewhere else entirely, so a bad uid must be
 *      rejected *before* any request goes out.
 *
 * Everything else is degradation behaviour: a crawler that gets a 4xx drops the
 * preview completely, so every failure path must still return 200 with the
 * generic card rather than an error.
 */

const PROJECT_ID = "sk8hub-test";
const UID = "abc123XYZ_-";

interface CapturedResponse {
  statusCode: number | null;
  headers: Record<string, string>;
  body: string | null;
}

/** Minimal res double matching the handler's structural type. */
function makeRes(): { res: unknown; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: null, headers: {}, body: null };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
    },
    send(body: string) {
      captured.body = body;
    },
  };
  return { res, captured };
}

/** Firestore REST wraps every scalar in a typed envelope. */
function firestoreDoc(fields: Record<string, unknown>): { fields: Record<string, unknown> } {
  return { fields };
}

const mockFetch = vi.fn();

async function invoke(query: Record<string, string | string[] | undefined>): Promise<CapturedResponse> {
  const { res, captured } = makeRes();
  vi.resetModules();
  const mod = await import("../../../api/player-meta");
  await (mod.default as (req: unknown, res: unknown) => Promise<void>)({ method: "GET", query }, res);
  return captured;
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", PROJECT_ID);
  vi.stubEnv("VITE_FIREBASE_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Queue a successful Firestore REST response. */
function profileResponds(fields: Record<string, unknown>): void {
  mockFetch.mockResolvedValue({ ok: true, json: async () => firestoreDoc(fields) });
}

describe("player-meta handler", () => {
  describe("card content", () => {
    it("renders username, record, and avatar into the OG tags", async () => {
      profileResponds({
        username: { stringValue: "tonyhawk" },
        wins: { integerValue: "12" },
        losses: { integerValue: "3" },
        profileImageUrl: { stringValue: "https://firebasestorage.googleapis.com/a.webp" },
      });

      const out = await invoke({ uid: UID });

      expect(out.statusCode).toBe(200);
      expect(out.body).toContain('content="@tonyhawk on SkateHubba"');
      expect(out.body).toContain("12W – 3L");
      expect(out.body).toContain('content="https://firebasestorage.googleapis.com/a.webp"');
      expect(out.body).toContain(`content="https://skatehubba.com/player/${UID}"`);
    });

    it("reads a brand-new account as an invitation rather than 0W – 0L", async () => {
      profileResponds({ username: { stringValue: "rookie" } });
      const out = await invoke({ uid: UID });
      expect(out.body).toContain("New to SkateHubba");
      expect(out.body).not.toContain("0W");
    });

    it("marks verified pros", async () => {
      profileResponds({
        username: { stringValue: "pro" },
        wins: { integerValue: "1" },
        isVerifiedPro: { booleanValue: true },
      });
      const out = await invoke({ uid: UID });
      expect(out.body).toContain("Verified Pro");
    });

    it("falls back to the site image when the avatar is not an absolute https URL", async () => {
      // A relative or http value is useless to a crawler, which fetches the
      // image out-of-band with no page context to resolve it against.
      profileResponds({
        username: { stringValue: "someone" },
        profileImageUrl: { stringValue: "/local/avatar.webp" },
      });
      const out = await invoke({ uid: UID });
      expect(out.body).toContain("https://skatehubba.com/og-image.png");
      expect(out.body).not.toContain("/local/avatar.webp");
    });
  });

  describe("escaping — usernames are user-controlled", () => {
    it("neutralises a username crafted to break out of the attribute", async () => {
      profileResponds({ username: { stringValue: '"><script>alert(1)</script>' } });

      const out = await invoke({ uid: UID });

      // The raw sequence must not survive anywhere in the document.
      expect(out.body).not.toContain("<script>");
      expect(out.body).not.toContain('"><');
      // And it must still render as visible text, escaped.
      expect(out.body).toContain("&lt;script&gt;");
      expect(out.body).toContain("&quot;");
    });

    it("escapes ampersands so the markup stays well-formed", async () => {
      profileResponds({ username: { stringValue: "a&b" } });
      const out = await invoke({ uid: UID });
      expect(out.body).toContain("a&amp;b");
    });
  });

  describe("uid validation — guards the outbound URL", () => {
    it.each([
      ["path traversal", "../../../etc/passwd"],
      ["slash", "abc/def"],
      ["query injection", "abc?key=leak"],
      ["url", "https://evil.example.com/x"],
      ["empty", ""],
    ])("rejects %s without issuing any request", async (_label, badUid) => {
      const out = await invoke({ uid: badUid });

      // The critical assertion: nothing was fetched with the crafted value.
      expect(mockFetch).not.toHaveBeenCalled();
      expect(out.statusCode).toBe(200);
      expect(out.body).toContain("SkateHubba™ — For the Love of the Game");
    });

    it("serves the generic card when uid is absent entirely", async () => {
      const out = await invoke({});
      expect(mockFetch).not.toHaveBeenCalled();
      expect(out.body).toContain("SkateHubba™ — For the Love of the Game");
    });

    it("uses the first value when uid is repeated", async () => {
      profileResponds({ username: { stringValue: "first" } });
      await invoke({ uid: [UID, "second"] });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(String(mockFetch.mock.calls[0][0])).toContain(`/users/${UID}`);
    });
  });

  describe("degradation — a crawler must never receive an error", () => {
    it("serves the generic card when the rules still deny the read (403)", async () => {
      // This is the state before the public-get rule is published, so it is the
      // behaviour on day one of shipping this handler.
      mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
      const out = await invoke({ uid: UID });
      expect(out.statusCode).toBe(200);
      expect(out.body).toContain("SkateHubba™ — For the Love of the Game");
    });

    it("serves the generic card for an unknown uid (404)", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
      const out = await invoke({ uid: UID });
      expect(out.statusCode).toBe(200);
    });

    it("serves the generic card when the fetch rejects", async () => {
      mockFetch.mockRejectedValue(new Error("network down"));
      const out = await invoke({ uid: UID });
      expect(out.statusCode).toBe(200);
      expect(out.body).toContain("SkateHubba™ — For the Love of the Game");
    });

    it("serves the generic card when the document has no username", async () => {
      profileResponds({ wins: { integerValue: "5" } });
      const out = await invoke({ uid: UID });
      expect(out.body).toContain("SkateHubba™ — For the Love of the Game");
    });

    it("serves the generic card without fetching when the project id is unset", async () => {
      vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "");
      vi.stubEnv("FIREBASE_PROJECT_ID", "");
      const out = await invoke({ uid: UID });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(out.statusCode).toBe(200);
    });

    it("ignores a malformed counter rather than rendering NaN", async () => {
      profileResponds({
        username: { stringValue: "weird" },
        wins: { integerValue: "not-a-number" },
        losses: { integerValue: "2" },
      });
      const out = await invoke({ uid: UID });
      expect(out.body).not.toContain("NaN");
      expect(out.body).toContain("0W – 2L");
    });
  });

  describe("response headers", () => {
    it("declares HTML and an edge cache so a busy channel doesn't hammer Firestore", async () => {
      profileResponds({ username: { stringValue: "cacheme" } });
      const out = await invoke({ uid: UID });
      expect(out.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(out.headers["cache-control"]).toContain("s-maxage=3600");
    });
  });
});
