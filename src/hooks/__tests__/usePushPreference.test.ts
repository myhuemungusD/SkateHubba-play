import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockGetPushEnabled = vi.fn();
const mockSetPushEnabled = vi.fn();

vi.mock("../../services/pushPreferences", () => ({
  getPushEnabled: (uid: string) => mockGetPushEnabled(uid),
  setPushEnabled: (uid: string, enabled: boolean) => mockSetPushEnabled(uid, enabled),
}));

const mockWarn = vi.fn();
vi.mock("../../services/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: (...a: unknown[]) => mockWarn(...a), error: vi.fn() },
}));

import { usePushPreference } from "../usePushPreference";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPushEnabled.mockResolvedValue(true);
  mockSetPushEnabled.mockResolvedValue(undefined);
});

describe("usePushPreference", () => {
  it("starts enabled + loading, then reflects the stored preference", async () => {
    mockGetPushEnabled.mockResolvedValue(false);
    const { result } = renderHook(() => usePushPreference("u1"));

    expect(result.current.enabled).toBe(true);
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(mockGetPushEnabled).toHaveBeenCalledWith("u1");
  });

  it("falls back to enabled when the read rejects", async () => {
    mockGetPushEnabled.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => usePushPreference("u1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(true);
  });

  it("re-reads when the uid changes", async () => {
    const { result, rerender } = renderHook(({ uid }) => usePushPreference(uid), {
      initialProps: { uid: "u1" },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockGetPushEnabled.mockResolvedValue(false);
    rerender({ uid: "u2" });

    await waitFor(() => expect(result.current.enabled).toBe(false));
    expect(mockGetPushEnabled).toHaveBeenCalledWith("u2");
  });

  it("ignores a read that resolves after unmount", async () => {
    let resolveRead: (v: boolean) => void = () => {};
    mockGetPushEnabled.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveRead = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => usePushPreference("u1"));
    unmount();
    await act(async () => {
      resolveRead(false);
    });

    // Last committed state is the pre-unmount default — no post-unmount update.
    expect(result.current.loading).toBe(true);
  });

  it("writes the new preference optimistically", async () => {
    const { result } = renderHook(() => usePushPreference("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setEnabled(false);
    });

    expect(mockSetPushEnabled).toHaveBeenCalledWith("u1", false);
    expect(result.current.enabled).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reverts, logs, and reports when the write throws", async () => {
    mockSetPushEnabled.mockRejectedValue(new Error("permission-denied"));
    const onError = vi.fn();
    const { result } = renderHook(() => usePushPreference("u1", onError));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setEnabled(false);
    });

    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(result.current.error).toMatch(/Couldn't save/);
    expect(onError).toHaveBeenCalledWith(result.current.error);
    expect(mockWarn).toHaveBeenCalledWith("push_pref_save_failed", expect.objectContaining({ uid: "u1" }));
  });

  it("survives a failed write with no onError callback and a non-Error rejection", async () => {
    mockSetPushEnabled.mockRejectedValue("nope");
    const { result } = renderHook(() => usePushPreference("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setEnabled(false);
    });

    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(mockWarn).toHaveBeenCalledWith("push_pref_save_failed", { uid: "u1", error: "nope" });
  });

  it("clears a previous error on the next attempt", async () => {
    mockSetPushEnabled.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => usePushPreference("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setEnabled(false);
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    await act(async () => {
      result.current.setEnabled(false);
    });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.enabled).toBe(false);
  });
});
