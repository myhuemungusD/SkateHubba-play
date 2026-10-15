import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const games = vi.hoisted(() => ({
  acceptJudgeInvite: vi.fn(),
  acceptLanded: vi.fn(),
  callBSOnSetTrick: vi.fn(),
  declineJudgeInvite: vi.fn(),
  judgeRuleSetTrick: vi.fn(),
  resolveDispute: vi.fn(),
}));
const disputes = vi.hoisted(() => ({ raiseDispute: vi.fn() }));
const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));

vi.mock("../../../services/games", () => games);
vi.mock("../../../services/disputes", () => disputes);
vi.mock("../../../lib/sentry", () => sentry);

import { useGameReviewActions } from "../useGameReviewActions";

type Actions = ReturnType<typeof useGameReviewActions>;

interface Case {
  name: string;
  service: ReturnType<typeof vi.fn>;
  run: (a: Actions) => Promise<void>;
  submitting: (a: Actions) => boolean;
  fallback: string;
}

const CASES: Case[] = [
  {
    name: "handleResolveDispute",
    service: games.resolveDispute,
    run: (a) => a.handleResolveDispute(true),
    submitting: (a) => a.disputeSubmitting,
    fallback: "Failed to resolve dispute",
  },
  {
    name: "handleRuleSetTrick",
    service: games.judgeRuleSetTrick,
    run: (a) => a.handleRuleSetTrick(false),
    submitting: (a) => a.setReviewSubmitting,
    fallback: "Failed to rule",
  },
  {
    name: "handleCallBS",
    service: games.callBSOnSetTrick,
    run: (a) => a.handleCallBS(),
    submitting: (a) => a.callBSSubmitting,
    fallback: "Failed to call BS",
  },
  {
    name: "handleAcceptLanded",
    service: games.acceptLanded,
    run: (a) => a.handleAcceptLanded(),
    submitting: (a) => a.reviewActionSubmitting,
    fallback: "Failed to accept the landed claim",
  },
  {
    name: "handleRaiseDispute",
    service: disputes.raiseDispute,
    run: (a) => a.handleRaiseDispute(),
    submitting: (a) => a.reviewActionSubmitting,
    fallback: "Failed to send the call to the community",
  },
  {
    name: "handleJudgeAccept",
    service: games.acceptJudgeInvite,
    run: (a) => a.handleJudgeAccept(),
    submitting: (a) => a.judgeActionSubmitting,
    fallback: "Failed to accept referee invite",
  },
  {
    name: "handleJudgeDecline",
    service: games.declineJudgeInvite,
    run: (a) => a.handleJudgeDecline(),
    submitting: (a) => a.judgeActionSubmitting,
    fallback: "Failed to decline referee invite",
  },
];

function setup() {
  const setError = vi.fn();
  const hook = renderHook(() => useGameReviewActions("g1", setError));
  return { setError, hook };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useGameReviewActions", () => {
  it.each(CASES)("$name calls the service once and ignores a second tap", async (c) => {
    c.service.mockResolvedValue(undefined);
    const { setError, hook } = setup();
    await act(async () => {
      await c.run(hook.result.current);
      await c.run(hook.result.current);
    });
    expect(c.service).toHaveBeenCalledTimes(1);
    expect(c.service.mock.calls[0][0]).toBe("g1");
    expect(setError).toHaveBeenCalledWith("");
    expect(c.submitting(hook.result.current)).toBe(false);
  });

  it.each(CASES)("$name surfaces an Error message and re-arms after a failure", async (c) => {
    c.service.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);
    const { setError, hook } = setup();
    await act(async () => {
      await c.run(hook.result.current);
    });
    expect(setError).toHaveBeenLastCalledWith("boom");
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    await act(async () => {
      await c.run(hook.result.current);
    });
    expect(c.service).toHaveBeenCalledTimes(2);
  });

  it.each(CASES)("$name falls back to fixed copy for a non-Error rejection", async (c) => {
    c.service.mockRejectedValueOnce("nope");
    const { setError, hook } = setup();
    await act(async () => {
      await c.run(hook.result.current);
    });
    expect(setError).toHaveBeenLastCalledWith(c.fallback);
  });

  it("records the last ruling for each review action", async () => {
    for (const c of CASES) c.service.mockResolvedValue(undefined);
    const { hook } = setup();
    await act(async () => {
      await hook.result.current.handleResolveDispute(false);
      await hook.result.current.handleRuleSetTrick(true);
      await hook.result.current.handleRaiseDispute();
    });
    expect(hook.result.current.lastDisputeAction).toBe(false);
    expect(hook.result.current.lastSetReviewAction).toBe(true);
    expect(hook.result.current.lastReviewAction).toBe("dispute");
  });
});
