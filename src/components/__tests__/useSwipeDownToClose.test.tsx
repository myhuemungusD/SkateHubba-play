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

function ScrollingSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useSwipeDownToClose(ref, onClose);
  return (
    <div ref={ref} data-testid="panel">
      <div data-testid="list" style={{ overflowY: "auto" }}>
        <p data-testid="row">comment</p>
      </div>
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

  it("ignores a pull-down while an inner list is scrolled, and closes once it is back at the top (SF-C1)", () => {
    const onClose = vi.fn();
    render(<ScrollingSheet onClose={onClose} />);
    const list = screen.getByTestId("list");
    const row = screen.getByTestId("row");
    list.scrollTop = 120;
    drag(row, 100, 400);
    expect(onClose).not.toHaveBeenCalled();

    list.scrollTop = 0;
    drag(row, 100, 400);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
