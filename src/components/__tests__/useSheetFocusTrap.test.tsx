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
});
