import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Dispute } from "../../../services/disputes";
import { useCommunityDispute } from "../useCommunityDispute";

type OnNext = (d: Dispute | null) => void;
type OnError = (e: Error) => void;
const subs = vi.hoisted(() => ({ calls: [] as Array<{ onNext: OnNext; onError: OnError; unsub: () => void }> }));

vi.mock("../../../services/disputes", () => ({
  subscribeToGameDispute: (_gameId: string, _turn: number, onNext: OnNext, onError: OnError) => {
    const unsub = vi.fn();
    subs.calls.push({ onNext, onError, unsub });
    return unsub;
  },
}));

const openDispute = { status: "open", landVotes: 2, bailVotes: 1 } as unknown as Dispute;

function denied(): Error {
  return Object.assign(new Error("denied"), { code: "permission-denied" });
}

beforeEach(() => {
  subs.calls.length = 0;
});

describe("useCommunityDispute", () => {
  it("keeps the last tally when the listener later fails", () => {
    const { result } = renderHook(() => useCommunityDispute(true, "g1", 3));
    act(() => subs.calls[0].onNext(openDispute));
    expect(result.current).toMatchObject({ dispute: openDispute, state: "ready" });

    act(() => subs.calls[0].onError(denied()));
    expect(result.current).toMatchObject({ dispute: openDispute, state: "denied" });
  });

  it("ignores snapshots and errors from a listener for a previous turn", () => {
    const { result, rerender } = renderHook(({ turn }) => useCommunityDispute(true, "g1", turn), {
      initialProps: { turn: 3 },
    });
    const stale = subs.calls[0];
    rerender({ turn: 4 });
    expect(stale.unsub).toHaveBeenCalledTimes(1);

    act(() => subs.calls[1].onNext(null));
    expect(result.current.state).toBe("missing");

    act(() => {
      stale.onNext(openDispute);
      stale.onError(denied());
    });
    expect(result.current).toMatchObject({ dispute: null, state: "missing" });
  });
});
