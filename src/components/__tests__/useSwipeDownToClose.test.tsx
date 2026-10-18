import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { SWIPE_CLOSE_THRESHOLD, useSwipeDownToClose } from "../useSwipeDownToClose";

function Sheet({ onClose, enabled = true }: { onClose: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useSwipeDownToClose(ref, onClose, enabled);
  return (
    <div ref={ref} data-testid="sheet">
      sheet
    </div>
  );
}

function drag(el: HTMLElement, from: number, to: number) {
  fireEvent.touchStart(el, { touches: [{ clientY: from }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientY: to }] });
}

describe("useSwipeDownToClose", () => {
  it("closes on a long pull-down from the top", () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    drag(screen.getByTestId("sheet"), 100, 100 + SWIPE_CLOSE_THRESHOLD);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores short drags, upward drags, stray touchends and scrolled sheets", () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    const el = screen.getByTestId("sheet");
    drag(el, 100, 120);
    drag(el, 300, 100);
    fireEvent.touchEnd(el, { changedTouches: [{ clientY: 900 }] });
    fireEvent.touchStart(el, { touches: [] });
    fireEvent.touchEnd(el, { changedTouches: [] });
    el.scrollTop = 50;
    drag(el, 100, 400);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} enabled={false} />);
    drag(screen.getByTestId("sheet"), 0, 500);
    expect(onClose).not.toHaveBeenCalled();
  });
});
