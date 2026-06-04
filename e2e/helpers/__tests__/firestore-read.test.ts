/**
 * Unit coverage for `uidForEmail()` in `e2e/helpers/firestore-read.ts`.
 *
 * The Auth emulator does NOT expose a GET-based listing endpoint at
 * `/emulator/v1/projects/{project}/accounts` — that path is DELETE-only
 * (account wipe). The Identity Toolkit `accounts:query` POST endpoint is
 * the supported way to list users in the emulator. This test pins the
 * correct request shape (URL + method + headers + body) so a future
 * "drive-by" simplification can't silently regress to the wrong endpoint.
 *
 * Mocking `fetch` directly keeps the test hermetic — no emulator process
 * needed for the unit verification, and the assertion remains the same
 * shape Playwright sees at runtime.
 *
 * Run via:
 *   npx vitest run --config e2e/helpers/__tests__/vitest.config.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { uidForEmail } from "../firestore-read";

const ORIGINAL_FETCH = globalThis.fetch;

interface QueryRequestBody {
  returnUserInfo?: boolean;
  limit?: number;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("uidForEmail", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("POSTs to identitytoolkit accounts:query with owner bearer + returnUserInfo body", async () => {
    const fetchMock = vi
      .mocked(globalThis.fetch)
      .mockResolvedValue(jsonResponse({ userInfo: [{ localId: "uid-123", email: "alice@example.com" }] }));

    const uid = await uidForEmail("alice@example.com");

    expect(uid).toBe("uid-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    // URL must hit the Identity Toolkit accounts:query endpoint on the
    // Auth emulator (the GET-only /emulator/v1/.../accounts path is the bug).
    expect(calledUrl).toBe(
      "http://localhost:9099/identitytoolkit.googleapis.com/v1/projects/demo-skatehubba/accounts:query",
    );
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer owner");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(init.body)) as QueryRequestBody;
    expect(body.returnUserInfo).toBe(true);
    expect(typeof body.limit).toBe("number");
    expect((body.limit ?? 0) > 0).toBe(true);
  });

  it("returns the matching localId when multiple users are present", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        userInfo: [
          { localId: "uid-bob", email: "bob@example.com" },
          { localId: "uid-alice", email: "alice@example.com" },
        ],
      }),
    );

    await expect(uidForEmail("alice@example.com")).resolves.toBe("uid-alice");
  });

  it("throws when no user matches the requested email", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ userInfo: [{ localId: "uid-bob", email: "bob@example.com" }] }),
    );

    await expect(uidForEmail("missing@example.com")).rejects.toThrow(/No emulator user found for missing@example.com/);
  });

  it("throws when the emulator returns a non-2xx status", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(uidForEmail("anyone@example.com")).rejects.toThrow(/accounts lookup failed: 500/);
  });

  it("tolerates an empty userInfo field on the response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}));

    await expect(uidForEmail("anyone@example.com")).rejects.toThrow(/No emulator user found/);
  });
});
