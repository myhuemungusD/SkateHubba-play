import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const getUserProfile = vi.fn();
vi.mock("../../../services/users", () => ({ getUserProfile: (uid: string) => getUserProfile(uid) }));
import { useMyUsername } from "../useMyUsername";

describe("useMyUsername", () => {
  it("is empty without a uid", () => {
    expect(renderHook(() => useMyUsername(null)).result.current).toBe("");
  });
  it("loads the username, tolerates missing profiles and errors", async () => {
    getUserProfile
      .mockResolvedValueOnce({ username: "mike" })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("x"));
    const a = renderHook(() => useMyUsername("p"));
    await waitFor(() => expect(a.result.current).toBe("mike"));
    const b = renderHook(() => useMyUsername("q"));
    await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(2));
    expect(b.result.current).toBe("");
    renderHook(() => useMyUsername("r")).unmount();
    await Promise.resolve();
  });
});
