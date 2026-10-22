import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ blocked: vi.fn(() => true), retry: vi.fn(async () => "pending") }));
vi.mock("../../utils/coppaNotice", () => ({ isAgeGateBlocked: h.blocked }));
vi.mock("../../services/auth.underage", () => ({ blockUnderageSignIn: h.retry }));

import { useStickyAgeBlock } from "../useStickyAgeBlock";

beforeEach(() => {
  h.blocked.mockReset().mockReturnValue(true);
  h.retry.mockClear();
});

describe("useStickyAgeBlock", () => {
  it("retries the deletion once, even if the profile lookup flips back and forth", () => {
    const { result, rerender } = renderHook(({ confirmed }) => useStickyAgeBlock(true, confirmed), {
      initialProps: { confirmed: false },
    });
    expect(result.current[0]).toBe(true);
    expect(h.retry).not.toHaveBeenCalled();
    rerender({ confirmed: true });
    rerender({ confirmed: false });
    rerender({ confirmed: true });
    expect(h.retry).toHaveBeenCalledTimes(1);
  });

  it("never retries when the screen did not open blocked", () => {
    h.blocked.mockReturnValue(false);
    const { result } = renderHook(() => useStickyAgeBlock(true, true));
    expect(result.current[0]).toBe(false);
    expect(h.retry).not.toHaveBeenCalled();
  });

  it("ignores the sticky block when this screen does not collect a date of birth", () => {
    const { result } = renderHook(() => useStickyAgeBlock(false, true));
    expect(result.current[0]).toBe(false);
    expect(h.blocked).not.toHaveBeenCalled();
    expect(h.retry).not.toHaveBeenCalled();
  });
});
