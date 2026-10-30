import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { makeDispute } from "../../__tests__/disputeFixtures.test-helpers";
import { deferred } from "./deferred.test-helpers";
import type { Dispute, DisputeTally, DisputeViewerState } from "../../../types/dispute";

const svc = vi.hoisted(() => ({
  fetchOpenDisputes: vi.fn(),
  fetchDisputeViewerState: vi.fn(),
  castDisputeVerdict: vi.fn(),
}));
vi.mock("../../../services/disputes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/disputes")>()),
  ...svc,
}));
const blocked = vi.hoisted(() => new Set<string>());
// The block list has loaded (the controller holds the feed until it has).
const blockState = vi.hoisted(() => ({ blocked: blocked, ready: true, failed: false, retry: () => {} }));
vi.mock("../../../hooks/useBlockedUsers", () => ({ useBlockedUsersState: () => blockState }));
vi.mock("../../../services/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/analytics")>()),
  trackEvent: vi.fn(),
}));

import { useDisputeLaneController } from "../useDisputeLaneController";
import { logger } from "../../../services/logger";

const open = makeDispute({ id: "d1", landVotes: 2, bailVotes: 1 });
const canVote = (ids: string[]) =>
  new Map<string, DisputeViewerState>(ids.map((id) => [id, { ownVerdict: null, canVote: true }]));

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  svc.fetchOpenDisputes.mockResolvedValue([open]);
  svc.fetchDisputeViewerState.mockResolvedValue(canVote(["d1"]));
});
afterEach(() => warn.mockRestore());

async function ready(uid = "viewer") {
  const hook = renderHook(({ id }) => useDisputeLaneController(id), { initialProps: { id: uid } });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("useDisputeLaneController races", () => {
  it("reloads when the viewer changes", async () => {
    const hook = await ready("viewer");
    svc.fetchDisputeViewerState.mockResolvedValueOnce(new Map());
    hook.rerender({ id: "someone-else" });
    expect(hook.result.current.loading).toBe(true);
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(svc.fetchDisputeViewerState).toHaveBeenLastCalledWith("someone-else", [open]);
    // The new viewer's (empty) state replaces the previous viewer's permissions.
    expect(hook.result.current.viewerFor("d1")).toEqual({ ownVerdict: null, canVote: false });
  });

  it("logs a lane load failure that lands after unmount", async () => {
    const lane = deferred<Dispute[]>();
    svc.fetchOpenDisputes.mockReturnValueOnce(lane.promise);
    const second = renderHook(() => useDisputeLaneController("viewer"));
    second.unmount();
    await act(async () => lane.reject(new Error("offline")));
    expect(warn).toHaveBeenCalledWith("dispute_lane_load_failed", { error: expect.any(String) });
  });
});

describe("useDisputeLaneController verdicts", () => {
  it("ignores a verdict before the viewer state is known and reads unknown tallies as zero", async () => {
    svc.fetchDisputeViewerState.mockResolvedValueOnce(new Map());
    const { result } = await ready();
    await act(() => result.current.handleVerdict(open, "land"));
    expect(svc.castDisputeVerdict).not.toHaveBeenCalled();
    expect(result.current.tallyFor("nope")).toEqual({ land: 0, bail: 0 });
  });

  it("seeds the optimistic tally from the dispute doc when the lane has no tally for it", async () => {
    const stray = makeDispute({ id: "stray", landVotes: 4, bailVotes: 0 });
    svc.fetchDisputeViewerState.mockResolvedValueOnce(canVote(["d1", "stray"]));
    const { result } = await ready();
    const cast = deferred<DisputeTally>();
    svc.castDisputeVerdict.mockReturnValueOnce(cast.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleVerdict(stray, "bail");
    });
    expect(result.current.tallyFor("stray")).toEqual({ land: 4, bail: 1 });
    await act(async () => {
      cast.resolve({ land: 4, bail: 1 });
      await pending;
    });
    expect(result.current.isVoting("stray")).toBe(false);
  });

  it("stays quiet when a failed verdict lands after unmount", async () => {
    const { result, unmount } = await ready();
    const cast = deferred<DisputeTally>();
    svc.castDisputeVerdict.mockReturnValueOnce(cast.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleVerdict(open, "land");
    });
    unmount();
    await act(async () => {
      cast.reject(new Error("offline"));
      await pending;
    });
    expect(warn).not.toHaveBeenCalledWith("dispute_verdict_failed", expect.anything());
    expect(result.current.tallyFor("d1")).toEqual({ land: 3, bail: 1 });
  });

  it("keeps a reloaded tally rather than rolling back past it", async () => {
    const { result } = await ready();
    const cast = deferred<DisputeTally>();
    svc.castDisputeVerdict.mockReturnValueOnce(cast.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleVerdict(open, "land");
    });
    svc.fetchOpenDisputes.mockResolvedValueOnce([makeDispute({ id: "d1", landVotes: 10, bailVotes: 6 })]);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.tallyFor("d1")).toEqual({ land: 10, bail: 6 }));
    await act(async () => {
      cast.reject(new Error("offline"));
      await pending;
    });
    expect(warn).toHaveBeenCalledWith("dispute_verdict_failed", expect.objectContaining({ disputeId: "d1" }));
    expect(result.current.tallyFor("d1")).toEqual({ land: 10, bail: 6 });
  });
});
