import { describe, it, expect, beforeEach } from "vitest";
import { render, renderHook, act } from "@testing-library/react";
import {
  TipZone,
  enterTipZone,
  getActiveTipZone,
  isCameraLive,
  resetTipSignals,
  setCameraLive,
  subscribeTipSignals,
  useActiveTipZone,
  useCameraLive,
  useCameraLiveSignal,
} from "../tipSignals";

beforeEach(() => resetTipSignals());

describe("tipSignals", () => {
  it("keeps the newest zone on top and removes the right one", () => {
    const leaveA = enterTipZone("a");
    const leaveB = enterTipZone("b");
    expect(getActiveTipZone()).toBe("b");
    leaveA();
    expect(getActiveTipZone()).toBe("b");
    leaveB();
    leaveB();
    expect(getActiveTipZone()).toBeNull();
  });

  it("notifies listeners only on camera changes", () => {
    let calls = 0;
    const off = subscribeTipSignals(() => calls++);
    setCameraLive(true);
    setCameraLive(true);
    expect(isCameraLive()).toBe(true);
    expect(calls).toBe(1);
    off();
    setCameraLive(false);
    expect(calls).toBe(1);
  });

  it("hooks track the store and TipZone registers while mounted", () => {
    const zone = renderHook(() => useActiveTipZone());
    const cam = renderHook(() => useCameraLive());
    const { unmount } = render(<TipZone id="shoe360" />);
    expect(zone.result.current).toBe("shoe360");
    act(() => setCameraLive(true));
    expect(cam.result.current).toBe(true);
    unmount();
    expect(zone.result.current).toBeNull();
  });

  it("useCameraLiveSignal publishes and clears on unmount", () => {
    const { rerender, unmount } = renderHook(({ live }) => useCameraLiveSignal(live), { initialProps: { live: true } });
    expect(isCameraLive()).toBe(true);
    rerender({ live: false });
    expect(isCameraLive()).toBe(false);
    rerender({ live: true });
    unmount();
    expect(isCameraLive()).toBe(false);
  });
});
