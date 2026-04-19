import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockIsUsernameAvailable = vi.fn();

vi.mock("../../services/users", () => ({
  isUsernameAvailable: (...args: unknown[]) => mockIsUsernameAvailable(...args),
  USERNAME_MIN: 3,
}));

import { useUsernameAvailability } from "../useUsernameAvailability";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useUsernameAvailability", () => {
  it("returns null and no error when username is too short", () => {
    const { result } = renderHook(() => useUsernameAvailability("ab"));
    expect(result.current.available).toBeNull();
    expect(result.current.error).toBe("");
    expect(mockIsUsernameAvailable).not.toHaveBeenCalled();
  });

  it("reports available=true for a free username after debounce", async () => {
    mockIsUsernameAvailable.mockResolvedValue(true);
    const { result } = renderHook(() => useUsernameAvailability("newuser"));

    await waitFor(() => expect(result.current.available).toBe(true), { timeout: 3000 });
    expect(mockIsUsernameAvailable).toHaveBeenCalledWith("newuser");
  });

  it("reports available=false when username is taken", async () => {
    mockIsUsernameAvailable.mockResolvedValue(false);
    const { result } = renderHook(() => useUsernameAvailability("taken"));

    await waitFor(() => expect(result.current.available).toBe(false), { timeout: 3000 });
  });

  it("retries once on transient failure then succeeds", async () => {
    mockIsUsernameAvailable.mockRejectedValueOnce(new Error("permission-denied")).mockResolvedValueOnce(true);

    const { result } = renderHook(() => useUsernameAvailability("newuser"));

    await waitFor(() => expect(result.current.available).toBe(true), { timeout: 5000 });
    expect(mockIsUsernameAvailable).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe("");
  });

  it("surfaces an error when both the initial check and retry fail", async () => {
    mockIsUsernameAvailable.mockRejectedValue(new Error("down"));

    const { result } = renderHook(() => useUsernameAvailability("newuser"));

    await waitFor(() => expect(result.current.error).toBe("Could not check username — try again"), { timeout: 5000 });
    expect(result.current.available).toBeNull();
  });

  it("clearError resets the error message", async () => {
    mockIsUsernameAvailable.mockRejectedValue(new Error("down"));

    const { result } = renderHook(() => useUsernameAvailability("newuser"));

    await waitFor(() => expect(result.current.error).not.toBe(""), { timeout: 5000 });

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBe("");
  });

  it("resets available to null immediately when username changes", async () => {
    mockIsUsernameAvailable.mockResolvedValue(true);

    const { result, rerender } = renderHook(({ u }) => useUsernameAvailability(u), {
      initialProps: { u: "first" },
    });

    await waitFor(() => expect(result.current.available).toBe(true), { timeout: 3000 });

    // Change to a new username — available should reset to null synchronously
    rerender({ u: "second" });
    expect(result.current.available).toBeNull();

    await waitFor(() => expect(result.current.available).toBe(true), { timeout: 3000 });
    expect(mockIsUsernameAvailable).toHaveBeenCalledWith("second");
  });

  it("debounces rapid username changes and only queries the latest", async () => {
    mockIsUsernameAvailable.mockResolvedValue(true);
    const { rerender, result } = renderHook(({ u }) => useUsernameAvailability(u), {
      initialProps: { u: "abc" },
    });
    rerender({ u: "abcd" });
    rerender({ u: "abcde" });

    await waitFor(() => expect(result.current.available).toBe(true), { timeout: 3000 });

    // Only the latest value is checked — previous timeouts were cancelled.
    expect(mockIsUsernameAvailable).toHaveBeenCalledTimes(1);
    expect(mockIsUsernameAvailable).toHaveBeenCalledWith("abcde");
  });
});
