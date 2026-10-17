import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  mockDoc: vi.fn((...args: unknown[]) => ({ __path: args.slice(1).join("/") })),
  mockCollection: vi.fn((...args: unknown[]) => ({ __path: args.slice(1).join("/") })),
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(),
  mockSetDoc: vi.fn(),
  mockQuery: vi.fn((...args: unknown[]) => ({ __query: args })),
  mockWhere: vi.fn((field: unknown, op: unknown, value: unknown) => ({ __where: { field, op, value } })),
  mockLimit: vi.fn((n: unknown) => ({ __limit: n })),
  mockServerTimestamp: vi.fn(() => "SERVER_TS"),
  warn: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  doc: h.mockDoc,
  collection: h.mockCollection,
  getDocs: h.mockGetDocs,
  getDoc: h.mockGetDoc,
  setDoc: h.mockSetDoc,
  query: h.mockQuery,
  where: h.mockWhere,
  limit: h.mockLimit,
  serverTimestamp: h.mockServerTimestamp,
}));

vi.mock("../../firebase", () => ({
  requireDb: () => ({}),
}));

vi.mock("../logger", () => ({
  logger: { warn: (...args: unknown[]) => h.warn(...args), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { getMyBan, listMyAppeals, listMyReports, listMyStatements, submitAppeal } from "../moderation";

function dated(iso: string) {
  return { toDate: () => new Date(iso) };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.mockSetDoc.mockResolvedValue(undefined);
});

describe("listMyReports", () => {
  it("returns nothing for an unusable uid without querying", async () => {
    await expect(listMyReports("")).resolves.toEqual([]);
    await expect(listMyReports("a/b")).resolves.toEqual([]);
    await expect(listMyReports(1 as unknown as string)).resolves.toEqual([]);
    expect(h.mockGetDocs).not.toHaveBeenCalled();
  });

  it("queries the reporter's reports and sorts newest first", async () => {
    h.mockGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: "old",
          data: () => ({
            reporterUid: "u1",
            reason: "spam",
            status: "pending",
            createdAt: dated("2025-01-01T00:00:00Z"),
            gameId: "g1",
          }),
        },
        {
          id: "new",
          data: () => ({
            reporterUid: "u1",
            reason: "illegal_content",
            status: "resolved",
            createdAt: dated("2026-06-01T00:00:00Z"),
            clipId: "clip-1",
          }),
        },
        {
          id: "undated",
          data: () => ({ reporterUid: "u1", reason: "other", status: "dismissed", gameId: "", clipId: "" }),
        },
        {
          id: "bad-date",
          data: () => ({
            reporterUid: "u1",
            reason: "cheating",
            status: "pending",
            createdAt: "yesterday",
          }),
        },
        {
          id: "no-todate",
          data: () => ({ reporterUid: "u1", reason: "cheating", status: "pending", createdAt: {} }),
        },
        {
          id: "todate-string",
          data: () => ({
            reporterUid: "u1",
            reason: "cheating",
            status: "pending",
            createdAt: { toDate: "nope" },
          }),
        },
        {
          id: "todate-not-date",
          data: () => ({
            reporterUid: "u1",
            reason: "cheating",
            status: "pending",
            createdAt: { toDate: () => "nope" },
          }),
        },
        {
          id: "invalid-date",
          data: () => ({
            reporterUid: "u1",
            reason: "cheating",
            status: "pending",
            createdAt: { toDate: () => new Date(Number.NaN) },
          }),
        },
        { id: "wrong-user", data: () => ({ reporterUid: "other", reason: "spam", status: "pending" }) },
        { id: "malformed", data: () => ({ reporterUid: "u1", reason: 1, status: "pending" }) },
        { id: "empty", data: () => null },
        {
          id: "throws",
          data: () => {
            throw new Error("bad doc");
          },
        },
      ],
    });

    const rows = await listMyReports("u1");

    expect(h.mockWhere).toHaveBeenCalledWith("reporterUid", "==", "u1");
    expect(h.mockLimit).toHaveBeenCalledWith(50);
    expect(rows.map((row) => row.id)).toEqual([
      "new",
      "old",
      "undated",
      "bad-date",
      "no-todate",
      "todate-string",
      "todate-not-date",
      "invalid-date",
    ]);
    expect(rows[0].contentRef).toBe("clip-1");
    expect(rows[1].contentRef).toBe("g1");
    expect(rows[2].contentRef).toBe("account");
    expect(h.warn).toHaveBeenCalledWith("malformed_my_report", { docId: "malformed" });
    expect(h.warn).toHaveBeenCalledWith("my_report_parse_failed", expect.objectContaining({ docId: "throws" }));
  });
});

describe("listMyStatements", () => {
  it("returns nothing for an unusable uid", async () => {
    await expect(listMyStatements("")).resolves.toEqual([]);
    expect(h.mockGetDocs).not.toHaveBeenCalled();
  });

  it("keeps well-formed statements about this user", async () => {
    h.mockGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: "s1",
          data: () => ({
            subjectUid: "u1",
            action: "content_restricted",
            explanation: "Removed.",
            reason: "spam",
            reportId: "r1",
            contentRef: "clip-9",
            createdAt: dated("2026-02-01T00:00:00Z"),
          }),
        },
        {
          id: "other",
          data: () => ({
            subjectUid: "u2",
            action: "content_restricted",
            explanation: "x",
            reason: "spam",
            reportId: "r2",
            contentRef: "c",
          }),
        },
        { id: "bad-action", data: () => ({ subjectUid: "u1", action: "noted", explanation: "x" }) },
        {
          id: "throws",
          data: () => {
            throw new Error("bad");
          },
        },
      ],
    });

    const rows = await listMyStatements("u1");
    expect(rows).toEqual([
      {
        id: "s1",
        reportId: "r1",
        reason: "spam",
        explanation: "Removed.",
        contentRef: "clip-9",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    expect(h.warn).toHaveBeenCalledWith("malformed_moderation_statement", { docId: "bad-action" });
    expect(h.warn).toHaveBeenCalledWith(
      "moderation_statement_parse_failed",
      expect.objectContaining({ docId: "throws" }),
    );
  });
});

describe("getMyBan", () => {
  it("returns null for an unusable uid", async () => {
    await expect(getMyBan("")).resolves.toBeNull();
    await expect(getMyBan("a/b")).resolves.toBeNull();
    expect(h.mockGetDoc).not.toHaveBeenCalled();
  });

  it("returns null when no ban doc exists", async () => {
    h.mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    await expect(getMyBan("u1")).resolves.toBeNull();
  });

  it("returns the reason, or an empty string when the field is missing", async () => {
    h.mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ reason: "Spam" }) });
    await expect(getMyBan("u1")).resolves.toEqual({ reason: "Spam" });

    h.mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({}) });
    await expect(getMyBan("u1")).resolves.toEqual({ reason: "" });

    h.mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => null });
    await expect(getMyBan("u1")).resolves.toEqual({ reason: "" });
  });
});

describe("listMyAppeals", () => {
  it("returns nothing for an unusable uid", async () => {
    await expect(listMyAppeals("")).resolves.toEqual([]);
  });

  it("keeps statement and ban appeals and skips the rest", async () => {
    h.mockGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: "statement_r1",
          data: () => ({
            appellantUid: "u1",
            targetKind: "statement",
            targetId: "r1",
            status: "pending",
            createdAt: dated("2026-03-01T00:00:00Z"),
          }),
        },
        {
          id: "ban_u1",
          data: () => ({ appellantUid: "u1", targetKind: "ban", targetId: "u1", status: "upheld" }),
        },
        { id: "weird", data: () => ({ appellantUid: "u1", targetKind: "other", targetId: "x", status: "pending" }) },
        { id: "not-mine", data: () => ({ appellantUid: "u2", targetKind: "ban", targetId: "u2", status: "pending" }) },
        {
          id: "throws",
          data: () => {
            throw new Error("bad");
          },
        },
      ],
    });

    const rows = await listMyAppeals("u1");
    expect(rows.map((row) => row.id)).toEqual(["statement_r1", "ban_u1"]);
    expect(h.warn).toHaveBeenCalledWith("malformed_appeal", { docId: "weird" });
    expect(h.warn).toHaveBeenCalledWith("appeal_parse_failed", expect.objectContaining({ docId: "throws" }));
  });
});

describe("submitAppeal", () => {
  it("rejects an unusable caller, target, or explanation before writing", async () => {
    await expect(submitAppeal("", "statement", "r1", "please review")).rejects.toThrow(/Invalid appeal/);
    await expect(submitAppeal("u1", "nope" as "statement", "r1", "please review")).rejects.toThrow(/Invalid appeal/);
    await expect(submitAppeal("u1", "statement", "", "please review")).rejects.toThrow(/Invalid appeal/);
    await expect(submitAppeal("u1", "statement", "a/b", "please review")).rejects.toThrow(/Invalid appeal/);
    await expect(submitAppeal("u1", "ban", 1 as unknown as string, "please review")).rejects.toThrow(/Invalid appeal/);
    await expect(submitAppeal("u1", "statement", "r1", "   ")).rejects.toThrow(/Explain why/);
    await expect(submitAppeal("u1", "statement", "r1", 4 as unknown as string)).rejects.toThrow(/Explain why/);
    await expect(submitAppeal("u1", "statement", "r1", "x".repeat(1001))).rejects.toThrow(/1,000 characters/);
    expect(h.mockSetDoc).not.toHaveBeenCalled();
  });

  it("writes one pending appeal at the deterministic id", async () => {
    await submitAppeal("u1", "statement", "r1", "  Please look again.  ");
    expect(h.mockSetDoc).toHaveBeenCalledWith(expect.objectContaining({ __path: "appeals/statement_r1" }), {
      appellantUid: "u1",
      targetKind: "statement",
      targetId: "r1",
      explanation: "Please look again.",
      status: "pending",
      createdAt: "SERVER_TS",
    });
  });

  it("maps a write failure to a friendly error", async () => {
    h.mockSetDoc.mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "permission-denied" }));
    await expect(submitAppeal("u1", "ban", "u1", "Please review the ban.")).rejects.toThrow(/Failed to submit appeal/);
    expect(h.warn).toHaveBeenCalledWith("appeal_submit_failed", expect.objectContaining({ targetKind: "ban" }));
  });
});
