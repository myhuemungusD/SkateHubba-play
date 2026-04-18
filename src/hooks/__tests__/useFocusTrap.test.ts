import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { useFocusTrap } from "../useFocusTrap";

function createContainer(): HTMLDivElement {
  const container = document.createElement("div");
  const btn1 = document.createElement("button");
  btn1.textContent = "First";
  const btn2 = document.createElement("button");
  btn2.textContent = "Second";
  const btn3 = document.createElement("button");
  btn3.textContent = "Third";
  container.append(btn1, btn2, btn3);
  document.body.appendChild(container);
  return container;
}

function dispatchTab(shift = false) {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true });
  document.dispatchEvent(event);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useFocusTrap", () => {
  it("wraps focus from last to first on Tab", () => {
    const container = createContainer();
    const buttons = container.querySelectorAll("button");
    (buttons[2] as HTMLElement).focus();

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useFocusTrap(ref);
    });

    dispatchTab();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("wraps focus from first to last on Shift+Tab", () => {
    const container = createContainer();
    const buttons = container.querySelectorAll("button");
    (buttons[0] as HTMLElement).focus();

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useFocusTrap(ref);
    });

    dispatchTab(true);
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("does not interfere with forward Tab between middle elements", () => {
    const container = createContainer();
    const buttons = container.querySelectorAll("button");
    (buttons[1] as HTMLElement).focus();

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useFocusTrap(ref);
    });

    dispatchTab();
    // Not the last element, so event should not be prevented — focus stays on middle
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("does not interfere with Shift+Tab between middle elements", () => {
    const container = createContainer();
    const buttons = container.querySelectorAll("button");
    (buttons[1] as HTMLElement).focus();

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useFocusTrap(ref);
    });

    dispatchTab(true);
    // Not the first element, so Shift+Tab should not be prevented
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("restores focus to previously focused element on unmount", () => {
    const outer = document.createElement("button");
    outer.textContent = "Outer";
    document.body.appendChild(outer);
    outer.focus();

    const container = createContainer();

    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useFocusTrap(ref);
    });

    unmount();
    expect(document.activeElement).toBe(outer);
  });

  it("does nothing when enabled is false", () => {
    const container = createContainer();
    const buttons = container.querySelectorAll("button");
    (buttons[2] as HTMLElement).focus();

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useFocusTrap(ref, false);
    });

    dispatchTab();
    // No trap — focus is not moved
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("does nothing when container ref is null", () => {
    const spy = vi.spyOn(document, "addEventListener");
    const callsBefore = spy.mock.calls.filter(([e]) => e === "keydown").length;

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref);
    });

    const callsAfter = spy.mock.calls.filter(([e]) => e === "keydown").length;
    // Should still add the listener (cleanup handles removal), but the handler is a no-op
    // The key assertion is no error is thrown
    expect(callsAfter).toBeGreaterThanOrEqual(callsBefore);
    spy.mockRestore();
  });

  it("ignores non-Tab keys", () => {
    const container = createContainer();
    const buttons = container.querySelectorAll("button");
    (buttons[2] as HTMLElement).focus();

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useFocusTrap(ref);
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("handles container with no focusable elements", () => {
    const container = document.createElement("div");
    container.innerHTML = "<span>Not focusable</span>";
    document.body.appendChild(container);

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useFocusTrap(ref);
    });

    // Should not throw
    dispatchTab();
  });

  it("pulls focus onto the first focusable when focus started outside the container", () => {
    const outer = document.createElement("button");
    outer.textContent = "Outer";
    document.body.appendChild(outer);
    outer.focus();

    const container = createContainer();
    const buttons = container.querySelectorAll("button");

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useFocusTrap(ref);
    });

    // Focus gets pulled onto the first focusable child so keyboard users land
    // inside the trap instead of on the now-obscured trigger button.
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("leaves focus alone when an element inside the container is already focused", () => {
    const container = createContainer();
    const buttons = container.querySelectorAll("button");
    (buttons[1] as HTMLElement).focus();

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useFocusTrap(ref);
    });

    // Already inside the trap — respects explicit autoFocus on consumer components.
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("does not throw when container has no focusable children and focus starts outside", () => {
    const outer = document.createElement("button");
    outer.textContent = "Outer";
    document.body.appendChild(outer);
    outer.focus();

    const container = document.createElement("div");
    container.innerHTML = "<span>Nothing to focus</span>";
    document.body.appendChild(container);

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useFocusTrap(ref);
    });

    // No focusable descendants — focus remains wherever it was.
    expect(document.activeElement).toBe(outer);
  });
});
