/**
 * checkInlineDob's log lines are a COPPA surface: they must never carry the
 * age or the date of birth, so each one is asserted with its exact arguments.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("../../services/logger", () => ({ logger: { info: log.info, warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

import { checkInlineDob } from "../authScreenHelpers";

const thisYear = new Date().getFullYear();
const dobFor = (age: number) => ["01", "01", String(thisYear - age - 1)] as const;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("checkInlineDob logs", () => {
  it.each(["email_signup", "profile_setup"] as const)("a %s block logs only its source", (source) => {
    expect(checkInlineDob(...dobFor(10), false, source)).toEqual({ kind: "blocked" });
    expect(log.info.mock.calls).toEqual([["age_gate_blocked", { source }]]);
  });

  it("a sticky re-block logs its source and that it was sticky", () => {
    checkInlineDob(...dobFor(10), false, "profile_setup");
    log.info.mockClear();
    expect(checkInlineDob(...dobFor(30), false, "email_signup")).toEqual({ kind: "blocked" });
    expect(log.info.mock.calls).toEqual([["age_gate_blocked", { source: "email_signup", sticky: true }]]);
  });

  it.each([
    [30, false, false],
    [15, true, true],
  ])("a pass at %i logs only source and parentalConsent", (age, consent, parentalConsent) => {
    expect(checkInlineDob(...dobFor(age), consent, "profile_setup")).toMatchObject({ kind: "ok" });
    expect(log.info.mock.calls).toEqual([["age_gate_passed_inline", { source: "profile_setup", parentalConsent }]]);
  });
});
