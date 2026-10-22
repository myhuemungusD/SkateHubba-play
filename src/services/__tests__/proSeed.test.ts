import { beforeEach, describe, expect, it, vi } from "vitest";

const callable = vi.fn();
const connect = vi.fn();
const record = vi.fn();
vi.mock("firebase/functions", () => ({
  getFunctions: vi.fn(() => ({})),
  connectFunctionsEmulator: (...a: unknown[]) => connect(...a),
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => callable(name, payload),
}));
const fb = vi.hoisted(() => ({ app: {} as object | null, emulator: false }));
vi.mock("../../firebase", () => ({
  get default() {
    return fb.app;
  },
  ensureAppCheck: () => Promise.resolve(),
  get isEmulatorMode() {
    return fb.emulator;
  },
}));
vi.mock("../../lib/sentry", () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn() }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../admin.audit", () => ({ recordAdminAction: (...a: unknown[]) => record(...a) }));

import { proSeedErrorMessage, seedInputReady, seedVerifiedPro } from "../proSeed";

const EVIDENCE = { company: "Baker", url: "https://bakerskateboards.com/team" };
const REASON = "Pro for Baker since 2019.";

beforeEach(() => {
  vi.clearAllMocks();
  fb.app = {};
  fb.emulator = false;
});

describe("seedVerifiedPro", () => {
  it("calls proSeed with target, reason and evidence and returns the audit id", async () => {
    callable.mockResolvedValue({ data: { auditId: "a1", status: "seeded" } });
    await expect(seedVerifiedPro("sk8", REASON, EVIDENCE)).resolves.toBe("a1");
    expect(callable).toHaveBeenCalledWith("proSeed", { targetUid: "sk8", reason: REASON, evidence: EVIDENCE });
    expect(record).toHaveBeenCalledWith("grant_pro", "sk8");
    expect(connect).not.toHaveBeenCalled();
  });

  it("uses the functions emulator in emulator mode", async () => {
    fb.emulator = true;
    callable.mockResolvedValue({ data: { auditId: "a1" } });
    await seedVerifiedPro("sk8", REASON, EVIDENCE);
    expect(connect).toHaveBeenCalledWith({}, "127.0.0.1", 5001);
  });

  it("rejects a malformed response and an uninitialized app", async () => {
    callable.mockResolvedValue({ data: {} });
    await expect(seedVerifiedPro("sk8", REASON, EVIDENCE)).rejects.toThrow("bad response");
    fb.app = null;
    await expect(seedVerifiedPro("sk8", REASON, EVIDENCE)).rejects.toThrow("Firebase not initialized");
    expect(record).not.toHaveBeenCalled();
  });

  it("propagates the server's error", async () => {
    callable.mockRejectedValue(new Error("not_admin"));
    await expect(seedVerifiedPro("sk8", REASON, EVIDENCE)).rejects.toThrow("not_admin");
  });
});

describe("proSeedErrorMessage / seedInputReady", () => {
  it("maps known codes and falls back for the rest", () => {
    expect(proSeedErrorMessage(new Error("bad_evidence_url"))).toMatch(/https link/);
    expect(proSeedErrorMessage(new Error("target_is_admin"))).toMatch(/never admins/);
    expect(proSeedErrorMessage(new Error("weird"))).toMatch(/Seeding failed/);
    expect(proSeedErrorMessage("nope")).toMatch(/Seeding failed/);
  });

  it.each([
    [REASON, EVIDENCE, true],
    ["short", EVIDENCE, false],
    [REASON, { ...EVIDENCE, company: "B" }, false],
    [REASON, { ...EVIDENCE, url: "http://baker.com" }, false],
    [REASON, { ...EVIDENCE, url: "not a url" }, false],
    [REASON, { ...EVIDENCE, url: "https://localhost" }, false],
    [REASON, { ...EVIDENCE, url: "https://203.0.113.7/team" }, false],
    [REASON, { ...EVIDENCE, url: "https://[2001:db8::1]/team" }, false],
  ])("ready(%s, %o) = %s", (reason, evidence, expected) => {
    expect(seedInputReady(reason, evidence)).toBe(expected);
  });
});
