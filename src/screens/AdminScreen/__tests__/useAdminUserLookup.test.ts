import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

const mockGetUidByUsername = vi.fn();
const mockGetUserProfile = vi.fn();

vi.mock("../../../services/users", () => ({
  getUidByUsername: (...args: unknown[]) => mockGetUidByUsername(...args),
  getUserProfile: (...args: unknown[]) => mockGetUserProfile(...args),
}));

vi.mock("../../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { useAdminUserLookup } from "../useAdminUserLookup";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAdminUserLookup refresh", () => {
  it("does nothing before a player has been looked up", async () => {
    const { result } = renderHook(() => useAdminUserLookup());

    await act(() => result.current.refresh());

    expect(mockGetUidByUsername).not.toHaveBeenCalled();
    expect(result.current.error).toBe("");
    expect(result.current.target).toBeNull();
  });

  it("re-reads the looked-up player by their username", async () => {
    mockGetUidByUsername.mockResolvedValue("u1");
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "nyjah", isVerifiedPro: false });
    const { result } = renderHook(() => useAdminUserLookup());
    act(() => result.current.setQuery("  NYJAH "));
    await act(() => result.current.lookup());
    expect(result.current.target?.isVerifiedPro).toBe(false);

    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "nyjah", isVerifiedPro: true });
    await act(() => result.current.refresh());

    expect(mockGetUidByUsername).toHaveBeenLastCalledWith("nyjah");
    expect(result.current.target).toEqual({ uid: "u1", username: "nyjah", isVerifiedPro: true });
  });
});
