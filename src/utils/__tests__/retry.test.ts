import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../retry";

describe("withRetry", () => {
  it("returns the result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient errors and succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 1);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(withRetry(fn, 2, 1)).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent Firebase errors (permission-denied)", async () => {
    const err = new Error("Permission denied");
    (err as unknown as { code: string }).code = "permission-denied";
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, 1)).rejects.toThrow("Permission denied");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry unauthenticated errors", async () => {
    const err = new Error("Unauthenticated");
    (err as unknown as { code: string }).code = "unauthenticated";
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, 1)).rejects.toThrow("Unauthenticated");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry not-found errors", async () => {
    const err = new Error("Not found");
    (err as unknown as { code: string }).code = "not-found";
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, 1)).rejects.toThrow("Not found");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry storage/unauthorized errors", async () => {
    const err = new Error("Storage unauthorized");
    (err as unknown as { code: string }).code = "storage/unauthorized";
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, 1)).rejects.toThrow("Storage unauthorized");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry errors with 403 in message", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("HTTP 403 Forbidden"));
    await expect(withRetry(fn, 3, 1)).rejects.toThrow("403");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry errors with 401 in message", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("HTTP 401 Unauthorized"));
    await expect(withRetry(fn, 3, 1)).rejects.toThrow("401");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry errors with 404 in message", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("HTTP 404 Not Found"));
    await expect(withRetry(fn, 3, 1)).rejects.toThrow("404");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries non-Error throwables optimistically", async () => {
    const fn = vi.fn().mockRejectedValueOnce("string error").mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 1);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("applies exponential backoff between retries", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, 3, 100);

    // First retry: 100ms delay
    await vi.advanceTimersByTimeAsync(100);
    // Second retry: 200ms delay
    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
