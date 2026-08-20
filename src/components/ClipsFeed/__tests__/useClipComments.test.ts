import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ClipComment } from "../../../services/clips.comments";
import { isPostableComment, useClipComments } from "../useClipComments";
import { clipCommentsMocks, makeClipComment, resetClipCommentsMocks } from "./clipComments.test-helpers";

vi.mock("../../../services/clips.comments", async () =>
  (await import("./clipComments.test-helpers")).clipCommentsModuleMock(),
);
vi.mock("../../../services/logger", async () => (await import("./clipComments.test-helpers")).loggerModuleMock());

const { fetch: mockFetch, create: mockCreate, remove: mockDelete } = clipCommentsMocks;

/** Defaults to the viewer's own comment — this suite is mostly about `remove`. */
function comment(overrides: Partial<ClipComment> = {}): ClipComment {
  return makeClipComment({ userId: "me", username: "viewer", text: "hi", ...overrides });
}

function mount() {
  return renderHook(() => useClipComments("c1", "me", "viewer"));
}

beforeEach(resetClipCommentsMocks);

describe("isPostableComment", () => {
  it("requires non-whitespace content within the cap", () => {
    expect(isPostableComment("hi")).toBe(true);
    expect(isPostableComment("")).toBe(false);
    expect(isPostableComment("   ")).toBe(false);
    expect(isPostableComment("a".repeat(300))).toBe(true);
    expect(isPostableComment("a".repeat(301))).toBe(false);
  });
});

describe("useClipComments", () => {
  it("ignores a submit with an unpostable draft without calling the service", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setDraft("   "));
    await act(async () => {
      await result.current.submit();
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses to delete a comment the viewer did not write — a write that could only be denied", async () => {
    mockFetch.mockResolvedValueOnce({ comments: [comment({ id: "theirs", userId: "someone-else" })], cursor: null });
    const { result } = mount();
    await waitFor(() => expect(result.current.comments).toHaveLength(1));

    await act(async () => {
      await result.current.remove(result.current.comments[0]);
    });

    expect(mockDelete).not.toHaveBeenCalled();
    expect(result.current.comments).toHaveLength(1);
  });

  it("falls back to generic copy when a post rejects with a non-Error value", async () => {
    mockCreate.mockRejectedValueOnce("just a string");
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setDraft("nice"));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toMatch(/couldn't post that comment/i);
  });

  it("exposes the in-flight delete id so the row can show its own spinner", async () => {
    mockFetch.mockResolvedValueOnce({ comments: [comment({ id: "mine" })], cursor: null });
    let release: () => void = () => {};
    mockDelete.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = mount();
    await waitFor(() => expect(result.current.comments).toHaveLength(1));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.remove(result.current.comments[0]);
    });
    await waitFor(() => expect(result.current.deletingId).toBe("mine"));

    await act(async () => {
      release();
      await pending;
    });
    expect(result.current.deletingId).toBeNull();
  });

  it("reload refetches the thread", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockFetch.mockResolvedValueOnce({ comments: [comment({ text: "later" })], cursor: null });

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.comments[0].text).toBe("later");
  });
});
