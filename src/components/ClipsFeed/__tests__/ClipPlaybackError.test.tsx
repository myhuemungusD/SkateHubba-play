import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock("../../../hooks/useReducedMotion", () => ({ useReducedMotion: () => reduced.value }));

import { ClipPlaybackError } from "../ClipPlaybackError";

function renderInFeed() {
  const scrollIntoView = vi.fn();
  const { container } = render(
    <div>
      <div data-feed-slide>
        <ClipPlaybackError onRetry={vi.fn()} />
      </div>
      <div data-feed-slide data-testid="next" />
    </div>,
  );
  const next = container.querySelector('[data-testid="next"]') as HTMLElement;
  next.scrollIntoView = scrollIntoView;
  return scrollIntoView;
}

describe("ClipPlaybackError skip", () => {
  afterEach(() => {
    reduced.value = false;
  });

  it("glides to the next clip by default", async () => {
    const scrollIntoView = renderInFeed();
    await userEvent.click(screen.getByRole("button", { name: "Skip to next" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  });

  it("jumps without animation under Reduce Motion (SF-C3)", async () => {
    reduced.value = true;
    const scrollIntoView = renderInFeed();
    await userEvent.click(screen.getByRole("button", { name: "Skip to next" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
  });
});
