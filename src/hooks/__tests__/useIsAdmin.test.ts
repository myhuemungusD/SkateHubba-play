import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockGetAdminClaim = vi.fn();

vi.mock("../../services/auth", () => ({
  getAdminClaim: () => mockGetAdminClaim(),
}));

vi.mock("../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { useIsAdmin } from "../useIsAdmin";
import { logger } from "../../services/logger";

const loggerMock = vi.mocked(logger);

/** Promise whose settlement the test controls, for stale-resolution cases. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useIsAdmin", () => {
  it("settles immediately as non-admin for a signed-out caller", () => {
    const { result } = renderHook(() => useIsAdmin(""));

    expect(result.current).toEqual({ isAdmin: false, loading: false });
    expect(mockGetAdminClaim).not.toHaveBeenCalled();
  });

  it("reports loading while the claim is in flight", () => {
    mockGetAdminClaim.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useIsAdmin("u1"));

    expect(result.current).toEqual({ isAdmin: false, loading: true });
    expect(mockGetAdminClaim).toHaveBeenCalledTimes(1);
  });

  it("resolves to admin when the claim is present", async () => {
    mockGetAdminClaim.mockResolvedValue(true);

    const { result } = renderHook(() => useIsAdmin("u1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAdmin).toBe(true);
  });

  it("resolves to non-admin when the claim is absent", async () => {
    mockGetAdminClaim.mockResolvedValue(false);

    const { result } = renderHook(() => useIsAdmin("u1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAdmin).toBe(false);
  });

  it("fails closed and logs when the claim read rejects", async () => {
    mockGetAdminClaim.mockRejectedValue(new Error("token unavailable"));

    const { result } = renderHook(() => useIsAdmin("u1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAdmin).toBe(false);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "admin_claim_check_failed",
      expect.objectContaining({ uid: "u1", error: expect.stringContaining("token unavailable") }),
    );
  });

  it("re-checks when the uid changes and does not report the previous answer", async () => {
    mockGetAdminClaim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const { result, rerender } = renderHook((props: { uid: string }) => useIsAdmin(props.uid), {
      initialProps: { uid: "admin1" },
    });
    await waitFor(() => expect(result.current.isAdmin).toBe(true));

    rerender({ uid: "u2" });
    // The stored answer belongs to admin1, so the new uid must read as
    // "still loading" rather than inheriting the admin verdict.
    expect(result.current).toEqual({ isAdmin: false, loading: true });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAdmin).toBe(false);
    expect(mockGetAdminClaim).toHaveBeenCalledTimes(2);
  });

  it("ignores a resolution that lands after unmount", async () => {
    const pending = deferred<boolean>();
    mockGetAdminClaim.mockReturnValue(pending.promise);

    const { unmount } = renderHook(() => useIsAdmin("u1"));
    unmount();
    pending.resolve(true);
    await pending.promise;

    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it("ignores a rejection that lands after unmount", async () => {
    const pending = deferred<boolean>();
    mockGetAdminClaim.mockReturnValue(pending.promise);

    const { unmount } = renderHook(() => useIsAdmin("u1"));
    unmount();
    pending.reject(new Error("too late"));
    await pending.promise.catch(() => {});

    expect(loggerMock.warn).not.toHaveBeenCalled();
  });
});
