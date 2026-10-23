import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { useSheetFocusTrap } from "../useSheetFocusTrap";

function Sheet({ onClose, empty = false }: { onClose: () => void; empty?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useSheetFocusTrap(ref, onClose);
  return (
    <div ref={ref}>
      {!empty && (
        <>
          <button type="button">first</button>
          <button type="button">middle</button>
          <button type="button">last</button>
        </>
      )}
    </div>
  );
}

describe("useSheetFocusTrap", () => {
  it("focuses the first control on mount and wraps Tab from the last back to the first", () => {
    const { getByText } = render(<Sheet onClose={vi.fn()} />);
    expect(document.activeElement).toBe(getByText("first"));
    getByText("last").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(getByText("first"));
  });

  it("leaves Tab alone mid-sheet and ignores other keys", () => {
    const onClose = vi.fn();
    const { getByText } = render(<Sheet onClose={onClose} />);
    getByText("middle").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    fireEvent.keyDown(document, { key: "a" });
    expect(document.activeElement).toBe(getByText("middle"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing on Tab when the sheet has no focusable controls", () => {
    render(<Sheet onClose={vi.fn()} empty />);
    expect(() => fireEvent.keyDown(document, { key: "Tab" })).not.toThrow();
  });

  it("wraps Shift+Tab from the first control to the last and closes on Escape", () => {
    const onClose = vi.fn();
    const { getByText } = render(<Sheet onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getByText("last"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("returns focus to the opener on close", () => {
    function Host({ open, onClose = vi.fn() }: { open: boolean; onClose?: () => void }) {
      return (
        <>
          <button type="button">opener</button>
          <button type="button">elsewhere</button>
          {open && <Sheet onClose={onClose} />}
        </>
      );
    }

    it("refocuses the button that opened the sheet", () => {
      const { getByText, rerender } = render(<Host open={false} />);
      getByText("opener").focus();
      rerender(<Host open />);
      expect(document.activeElement).toBe(getByText("first"));
      rerender(<Host open={false} />);
      expect(document.activeElement).toBe(getByText("opener"));
    });

    it("leaves focus alone when something else already took it", () => {
      const { getByText, rerender } = render(<Host open={false} />);
      getByText("opener").focus();
      rerender(<Host open />);
      getByText("elsewhere").focus();
      rerender(<Host open={false} />);
      expect(document.activeElement).toBe(getByText("elsewhere"));
    });

    it("does nothing when nothing was focused, or the opener is gone", () => {
      const first = render(<Host open />);
      first.rerender(<Host open={false} />);
      expect(document.activeElement).toBe(document.body);
      first.unmount();

      function Gone({ open, withOpener }: { open: boolean; withOpener: boolean }) {
        return (
          <>
            {withOpener && <button type="button">gone</button>}
            {open && <Sheet onClose={vi.fn()} />}
          </>
        );
      }
      const second = render(<Gone open={false} withOpener />);
      second.getByText("gone").focus();
      second.rerender(<Gone open withOpener />);
      second.rerender(<Gone open={false} withOpener={false} />);
      expect(document.activeElement).toBe(document.body);
    });
  });
});
