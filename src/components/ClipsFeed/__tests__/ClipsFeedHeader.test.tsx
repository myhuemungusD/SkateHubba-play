import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClipsFeedHeader } from "../ClipsFeedHeader";

const base = { sort: "top" as const, onSortChange: vi.fn(), onPostClip: vi.fn() };

describe("ClipsFeedHeader", () => {
  it("shows no edit icon without onEditClip", () => {
    render(<ClipsFeedHeader {...base} />);
    expect(screen.queryByRole("button", { name: "Edit a clip" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post a clip to the feed" })).toBeInTheDocument();
  });

  it("renders the edit icon next to post and fires onEditClip", () => {
    const onEditClip = vi.fn();
    render(<ClipsFeedHeader {...base} onEditClip={onEditClip} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit a clip" }));
    expect(onEditClip).toHaveBeenCalledTimes(1);
  });
});
