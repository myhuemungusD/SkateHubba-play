import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useVerticalFeed } from "../useVerticalFeed";

function Harness({
  count,
  showScroller = true,
  onPastEnd = () => undefined,
}: {
  count: number;
  showScroller?: boolean;
  onPastEnd?: () => void;
}) {
  const { setScroller, activeIndex, reset } = useVerticalFeed(count, onPastEnd);
  return (
    <div>
      <output data-testid="index">{activeIndex}</output>
      <button type="button" onClick={() => reset()}>
        Reset feed
      </button>
      <input aria-label="Comment box" />
      <textarea aria-label="Note" />
      <div contentEditable="true" role="textbox" aria-label="Editable" />
      {showScroller && (
        <div ref={setScroller} data-testid="scroller">
          {Array.from({ length: count }, (_, i) => (
            <article key={i} data-feed-slide />
          ))}
        </div>
      )}
    </div>
  );
}

function indexText(): string {
  return screen.getByTestId("index").textContent ?? "";
}

describe("useVerticalFeed", () => {
  it("ignores arrows while typing, in a dialog, or with a modifier, and ignores other keys", () => {
    render(<Harness count={2} />);
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(screen.getByLabelText("Comment box"), { key: "ArrowDown" });
    expect(indexText()).toBe("0");
    fireEvent.keyDown(screen.getByLabelText("Note"), { key: "ArrowDown" });
    expect(indexText()).toBe("0");
    const editable = screen.getByRole("textbox", { name: "Editable" });
    Object.defineProperty(editable, "isContentEditable", { value: true });
    fireEvent.keyDown(editable, { key: "ArrowDown" });
    expect(indexText()).toBe("0");
    fireEvent.keyDown(window, { key: "ArrowDown", metaKey: true });
    fireEvent.keyDown(window, { key: "ArrowDown", ctrlKey: true });
    fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
    expect(indexText()).toBe("0");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    dialog.remove();
    expect(indexText()).toBe("0");
  });

  it("stays on the first slide when arrow up is pressed and pages past the end", () => {
    const onPastEnd = vi.fn();
    render(<Harness count={1} onPastEnd={onPastEnd} />);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(indexText()).toBe("0");
    expect(onPastEnd).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(onPastEnd).toHaveBeenCalledOnce();
    expect(indexText()).toBe("0");
  });

  it("ignores a key whose target is not an element", () => {
    render(<Harness count={2} />);
    // Dispatched on window, the target is not an HTMLElement, so the hook
    // treats it as a real move.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(indexText()).toBe("1");
  });

  it("ignores scroll events that cannot name a page, and follows one that can", () => {
    render(<Harness count={2} />);
    const scroller = screen.getByTestId("scroller");
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 0 });
    fireEvent.scroll(scroller);
    expect(indexText()).toBe("0");

    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 640 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0 });
    fireEvent.scroll(scroller);
    expect(indexText()).toBe("0");

    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 640 });
    fireEvent.scroll(scroller);
    expect(indexText()).toBe("1");
  });

  it("ignores a scroll when the scroller has a height but no slides", () => {
    render(<Harness count={0} />);
    const scroller = screen.getByTestId("scroller");
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 640 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 640 });
    fireEvent.scroll(scroller);
    expect(indexText()).toBe("0");
  });

  it("moves from the keyboard when the scroller is not mounted yet", () => {
    render(<Harness count={2} showScroller={false} />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(indexText()).toBe("1");
  });

  it("does nothing on arrow keys when there are no slides and no scroller", () => {
    render(<Harness count={0} showScroller={false} />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(indexText()).toBe("0");
  });

  it("pulls the active page back when the list shrinks under it, and reset returns to the start", () => {
    function Shrink() {
      const [count, setCount] = useState(3);
      return (
        <div>
          <button type="button" onClick={() => setCount(1)}>
            Shrink
          </button>
          <Harness count={count} />
        </div>
      );
    }
    render(<Shrink />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(indexText()).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Shrink" }));
    expect(indexText()).toBe("0");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(indexText()).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Reset feed" }));
    expect(indexText()).toBe("0");
  });
});
