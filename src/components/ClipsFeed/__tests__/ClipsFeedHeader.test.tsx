import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClipsFeedHeader } from "../ClipsFeedHeader";

const base = { sort: "top" as const, onSortChange: vi.fn(), onPostClip: vi.fn() };

describe("ClipsFeedHeader", () => {
  it("shows Camera (post) as the only create action — no Edit in the feed", () => {
    render(<ClipsFeedHeader {...base} />);
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Post a clip to the feed" }));
    expect(base.onPostClip).toHaveBeenCalledTimes(1);
  });
});
