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

function mountWithBlocked(blocked: ReadonlySet<string>) {
  return renderHook(() => useClipComments("c1", "me", "viewer", blocked));
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

  it("hides comments by blocked authors while keeping the rest of the thread", async () => {
    mockFetch.mockResolvedValueOnce({
      comments: [
        comment({ id: "blocked", userId: "troll", username: "troll", text: "nope" }),
        comment({ id: "ok", userId: "p2", username: "bob", text: "Clean." }),
      ],
      cursor: null,
    });

    const { result } = mountWithBlocked(new Set(["troll"]));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.comments.map((c) => c.id)).toEqual(["ok"]);
  });

  it("reads as an empty thread when every comment is by a blocked author", async () => {
    mockFetch.mockResolvedValueOnce({
      comments: [comment({ id: "blocked", userId: "troll", username: "troll" })],
      cursor: null,
    });

    const { result } = mountWithBlocked(new Set(["troll"]));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.comments).toHaveLength(0);
  });

  it("never filters the viewer's own comment, even if their uid is in the block set", async () => {
    mockFetch.mockResolvedValueOnce({ comments: [comment({ id: "mine" })], cursor: null });

    const { result } = mountWithBlocked(new Set(["me"]));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.comments.map((c) => c.id)).toEqual(["mine"]);
  });

  it("applies a later block without refetching the thread", async () => {
    mockFetch.mockResolvedValueOnce({
      comments: [comment({ id: "theirs", userId: "troll", username: "troll" })],
      cursor: null,
    });

    const { result, rerender } = renderHook(({ blocked }) => useClipComments("c1", "me", "viewer", blocked), {
      initialProps: { blocked: new Set<string>() as ReadonlySet<string> },
    });
    await waitFor(() => expect(result.current.comments).toHaveLength(1));

    rerender({ blocked: new Set(["troll"]) as ReadonlySet<string> });

    expect(result.current.comments).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("switching to another clip shows the loading state and fetches that clip's thread", async () => {
    mockFetch.mockResolvedValueOnce({ comments: [comment({ text: "first clip" })], cursor: null });
    const { result, rerender } = renderHook(({ clipId }) => useClipComments(clipId, "me", "viewer"), {
      initialProps: { clipId: "c1" },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.comments[0].text).toBe("first clip");

    let resolveSecond: (page: { comments: ClipComment[]; cursor: null }) => void = () => {};
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve;
      }),
    );
    rerender({ clipId: "c2" });

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe("");
    expect(mockFetch).toHaveBeenLastCalledWith("c2");

    await act(async () => {
      resolveSecond({ comments: [comment({ text: "second clip" })], cursor: null });
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.comments[0].text).toBe("second clip");
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
