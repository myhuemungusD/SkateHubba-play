import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const { auth, svc, flag } = vi.hoisted(() => ({
  auth: { current: { user: { uid: "u1" }, activeProfile: { uid: "u1" } } as Record<string, unknown> },
  flag: { on: true },
  svc: {
    loadTips: vi.fn(),
    markTipSeen: vi.fn().mockResolvedValue(undefined),
    setTipsDisabled: vi.fn().mockResolvedValue(undefined),
    resetTips: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../AuthContext", () => ({ useAuthContext: () => auth.current }));
vi.mock("../../lib/featureFlags", () => ({ isTipsEnabled: () => flag.on }));
vi.mock("../../services/tips", () => svc);

import { TipsProvider, useTipsContext } from "../TipsContext";

const wrapper = ({ children }: { children: ReactNode }) => <TipsProvider>{children}</TipsProvider>;

beforeEach(() => {
  flag.on = true;
  auth.current = { user: { uid: "u1" }, activeProfile: { uid: "u1" } };
  svc.loadTips.mockResolvedValue({ seen: ["map"], disabled: false });
  vi.clearAllMocks();
  svc.loadTips.mockResolvedValue({ seen: ["map"], disabled: false });
});

describe("TipsContext", () => {
  it("is off outside the provider and its no-ops are safe", async () => {
    const { result } = renderHook(() => useTipsContext());
    expect(result.current.available).toBe(false);
    result.current.markSeen("x");
    result.current.setDisabled(true);
    await result.current.replay();
  });

  it("is off when the flag is off or nobody is signed in", () => {
    flag.on = false;
    expect(renderHook(() => useTipsContext(), { wrapper }).result.current.available).toBe(false);
    flag.on = true;
    auth.current = { user: null, activeProfile: null };
    expect(renderHook(() => useTipsContext(), { wrapper }).result.current.available).toBe(false);
    expect(svc.loadTips).not.toHaveBeenCalled();
  });

  it("loads, marks seen, toggles and replays", async () => {
    const { result } = renderHook(() => useTipsContext(), { wrapper });
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.seen).toEqual(["map"]);
    act(() => result.current.markSeen("lobby"));
    act(() => result.current.markSeen("lobby"));
    expect(result.current.seen).toEqual(["map", "lobby"]);
    expect(svc.markTipSeen).toHaveBeenCalledWith("u1", "lobby");
    act(() => result.current.setDisabled(true));
    expect(result.current.disabled).toBe(true);
    expect(svc.setTipsDisabled).toHaveBeenCalledWith("u1", true);
    await act(() => result.current.replay());
    expect(result.current.seen).toEqual([]);
    expect(result.current.disabled).toBe(false);
    expect(svc.resetTips).toHaveBeenCalledWith("u1");
  });

  it("ignores a load that lands after unmount and writes before load", () => {
    svc.loadTips.mockReturnValue(new Promise(() => undefined));
    const { result, unmount } = renderHook(() => useTipsContext(), { wrapper });
    act(() => result.current.markSeen("a"));
    act(() => result.current.setDisabled(true));
    expect(result.current.seen).toEqual([]);
    unmount();
  });

  it("drops a stale load after unmount", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    svc.loadTips.mockReturnValue(new Promise((r) => (resolve = r)));
    const { unmount } = renderHook(() => useTipsContext(), { wrapper });
    unmount();
    await act(async () => resolve({ seen: [], disabled: false }));
  });
});
