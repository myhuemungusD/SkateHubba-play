import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { _resetUserClipCooldown, useUserClipUpload } from "../useUserClipUpload";
import { ClipCooldownError, UserBannedError } from "../../../services/clips.userWrites";

const { mockUpload, mockCreate, mockProbe } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockCreate: vi.fn(),
  mockProbe: vi.fn(),
}));

vi.mock("../../../services/storage", () => ({
  uploadUserClip: (...args: unknown[]) => mockUpload(...args),
}));

// The typed refusals are re-exported from the real module: the hook branches
// on `instanceof`, so a hand-rolled stand-in class would make these tests
// agree with themselves and not with the service.
vi.mock("../../../services/clips.userWrites", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/clips.userWrites")>();
  return {
    ClipCooldownError: actual.ClipCooldownError,
    UserBannedError: actual.UserBannedError,
    createUserClip: (...args: unknown[]) => mockCreate(...args),
    newUserClipId: () => "clip123",
  };
});

vi.mock("../../../services/analytics", () => ({ trackEvent: vi.fn() }));

vi.mock("../../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../validation")>();
  return { ...actual, probeVideoDuration: (...args: unknown[]) => mockProbe(...args) };
});

function mount(onPosted = vi.fn()) {
  const hook = renderHook(() => useUserClipUpload("me", "viewer", onPosted));
  return { ...hook, onPosted };
}

function videoFile(): File {
  const f = new File(["x"], "c.mp4", { type: "video/mp4" });
  Object.defineProperty(f, "size", { value: 5_000_000 });
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetUserClipCooldown();
  mockProbe.mockResolvedValue(10);
  mockUpload.mockResolvedValue("https://cdn/c.mp4");
  mockCreate.mockResolvedValue("clip123");
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() });
});

describe("useUserClipUpload", () => {
  it("ignores a cancelled file picker (no file chosen)", async () => {
    const { result } = mount();

    await act(async () => {
      await result.current.handleFilePicked(null);
    });

    expect(mockProbe).not.toHaveBeenCalled();
    expect(result.current.blob).toBeNull();
    expect(result.current.error).toBe("");
  });

  it("reports a failed duration probe as an unreadable file", async () => {
    mockProbe.mockRejectedValueOnce(new Error("decoder gave up"));
    const { result } = mount();

    await act(async () => {
      await result.current.handleFilePicked(videoFile());
    });

    expect(result.current.error).toBe("decoder gave up");
    expect(result.current.blob).toBeNull();
  });

  it("falls back to generic copy when the probe rejects with a non-Error value", async () => {
    mockProbe.mockRejectedValueOnce("nope");
    const { result } = mount();

    await act(async () => {
      await result.current.handleFilePicked(videoFile());
    });

    expect(result.current.error).toMatch(/couldn't read that video/i);
  });

  it("refuses to submit with nothing staged", async () => {
    const { result } = mount();

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toMatch(/record or pick a clip first/i);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("refuses to submit a staged clip with no trick name", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.handleFilePicked(videoFile());
    });

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toMatch(/name the trick/i);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("falls back to generic copy when the write rejects with a non-Error value", async () => {
    mockCreate.mockRejectedValueOnce({ code: "permission-denied" });
    const { result } = mount();
    await act(async () => {
      await result.current.handleFilePicked(videoFile());
    });
    act(() => result.current.setTrickName("Kickflip"));

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toMatch(/couldn't post that clip/i);
  });

  it("clearError dismisses a surfaced message", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.error).not.toBe("");

    act(() => result.current.clearError());
    expect(result.current.error).toBe("");
  });

  it("chooseMode switches the source and clears a stale error", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.error).not.toBe("");

    act(() => result.current.chooseMode("record"));

    expect(result.current.mode).toBe("record");
    expect(result.current.error).toBe("");
  });

  it("reset drops the staged clip and its preview", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.handleFilePicked(videoFile());
    });
    expect(result.current.previewUrl).not.toBeNull();

    act(() => result.current.reset());

    expect(result.current.blob).toBeNull();
    expect(result.current.previewUrl).toBeNull();
    expect(result.current.mode).toBe("choose");
  });

  it("arms the cooldown after a successful post and blocks the next submit", async () => {
    const { result, onPosted } = mount();
    await act(async () => {
      await result.current.handleFilePicked(videoFile());
    });
    act(() => result.current.setTrickName("Kickflip"));
    await act(async () => {
      await result.current.submit();
    });
    expect(onPosted).toHaveBeenCalled();

    // Second attempt on a fresh mount, as happens when the modal reopens.
    const second = mount();
    await act(async () => {
      await second.result.current.handleFilePicked(videoFile());
    });
    act(() => second.result.current.setTrickName("Heelflip"));
    await act(async () => {
      await second.result.current.submit();
    });

    await waitFor(() => expect(second.result.current.error).toMatch(/please wait \d+s/i));
    expect(second.result.current.cooldownSeconds).toBeGreaterThan(0);
    expect(second.result.current.canSubmit).toBe(false);
    // Only the first post reached the services.
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  /** Stage a clip and a trick name, then submit. */
  async function submitOnce(hook: ReturnType<typeof mount>): Promise<void> {
    await act(async () => {
      await hook.result.current.handleFilePicked(videoFile());
    });
    act(() => hook.result.current.setTrickName("Kickflip"));
    await act(async () => {
      await hook.result.current.submit();
    });
  }

  // The service throws `ClipCooldownError("clip_cooldown:12000")` and
  // `UserBannedError("user_banned")` — machine strings meant to be branched
  // on, never rendered. A generic `err.message` passthrough would put
  // "clip_cooldown:12000" in front of a skater.
  it("renders a countdown, not the raw error message, when the server refuses on cooldown", async () => {
    mockCreate.mockRejectedValueOnce(new ClipCooldownError(12_000));
    const hook = mount();

    await submitOnce(hook);

    await waitFor(() => expect(hook.result.current.error).toMatch(/please wait 12s/i));
    expect(hook.result.current.error).not.toMatch(/clip_cooldown/);
    expect(hook.onPosted).not.toHaveBeenCalled();
  });

  it("adopts the server's remaining wait so the local cooldown stops disagreeing with the rule", async () => {
    mockCreate.mockRejectedValueOnce(new ClipCooldownError(12_000));
    const hook = mount();

    await submitOnce(hook);

    // The client's own anchor was clear — only the server knew about the
    // earlier post (another device, or a reload). The countdown has to come
    // from the rule's answer, and it has to gate the retry.
    await waitFor(() => expect(hook.result.current.cooldownSeconds).toBe(12));
    expect(hook.result.current.canSubmit).toBe(false);
  });

  it("explains a ban in plain language rather than echoing 'user_banned'", async () => {
    mockCreate.mockRejectedValueOnce(new UserBannedError());
    const hook = mount();

    await submitOnce(hook);

    await waitFor(() => expect(hook.result.current.error).toMatch(/can't post clips/i));
    expect(hook.result.current.error).not.toMatch(/user_banned/);
    // A ban is not a rate limit — it must not arm a countdown that implies
    // the post will go through in 30 seconds.
    expect(hook.result.current.cooldownSeconds).toBe(0);
    expect(hook.onPosted).not.toHaveBeenCalled();
  });

  it("still passes an ordinary service message straight through", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Failed to post your clip. Please try again."));
    const hook = mount();

    await submitOnce(hook);

    await waitFor(() => expect(hook.result.current.error).toMatch(/failed to post your clip/i));
  });

  it("falls back to generic copy when the upload rejects with a non-Error value", async () => {
    mockUpload.mockRejectedValueOnce("boom");
    const hook = mount();

    await submitOnce(hook);

    await waitFor(() => expect(hook.result.current.error).toMatch(/couldn't post that clip/i));
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
