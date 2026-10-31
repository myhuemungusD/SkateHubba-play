import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClipDoc, ClipsFeedCursor } from "../../../services/clips";
import { fetchFeedPage } from "../feedPaging";

const mockFetchClipsFeed = vi.hoisted(() => vi.fn());
vi.mock("../../../services/clips", () => ({
  fetchClipsFeed: (...args: unknown[]) => mockFetchClipsFeed(...args),
}));

const ts = { toMillis: () => 0 } as ClipsFeedCursor["createdAt"];
const at = (id: string): ClipsFeedCursor => ({ createdAt: ts, id });
const clip = (id: string) => ({ id }) as ClipDoc;

beforeEach(() => {
  mockFetchClipsFeed.mockReset();
});

describe("fetchFeedPage", () => {
  it("returns a page with a new clip without following its cursor", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce({ clips: [clip("a"), clip("b")], cursor: at("b") });

    const page = await fetchFeedPage(at("x"), "new", new Set(["a"]));

    expect(mockFetchClipsFeed).toHaveBeenCalledTimes(1);
    expect(mockFetchClipsFeed).toHaveBeenCalledWith(at("x"), 12, "new");
    expect(page).toEqual({ clips: [clip("a"), clip("b")], cursor: at("b"), more: true });
  });

  it("follows past a page of clips already shown", async () => {
    mockFetchClipsFeed
      .mockResolvedValueOnce({ clips: [clip("a")], cursor: at("a") })
      .mockResolvedValueOnce({ clips: [clip("c")], cursor: null });

    const page = await fetchFeedPage(at("x"), "top", new Set(["a"]));

    expect(mockFetchClipsFeed.mock.calls.map((c) => c[0])).toEqual([at("x"), at("a")]);
    expect(page).toEqual({ clips: [clip("c")], cursor: null, more: false });
  });

  it("ends the feed when the cursor comes back unchanged (top-index fallback)", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce({ clips: [clip("a")], cursor: at("x") });

    const page = await fetchFeedPage(at("x"), "top", new Set(["a"]));

    expect(mockFetchClipsFeed).toHaveBeenCalledTimes(1);
    expect(page.more).toBe(false);
  });

  it("stops after three follow-ups even while the cursor keeps moving", async () => {
    for (const id of ["c1", "c2", "c3", "c4", "c5"]) {
      mockFetchClipsFeed.mockResolvedValueOnce({ clips: [], cursor: at(id) });
    }

    const page = await fetchFeedPage(null, "new", new Set());

    // One call plus the 3-follow cap: the fifth answer is never asked for.
    expect(mockFetchClipsFeed.mock.calls.map((c) => c[0])).toEqual([null, at("c1"), at("c2"), at("c3")]);
    expect(page).toEqual({ clips: [], cursor: at("c4"), more: true });
  });
});
