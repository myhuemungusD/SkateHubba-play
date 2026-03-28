import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFocusTrap } from "../useFocusTrap";

function createContainer(...tags: string[]): HTMLDivElement {
  const container = document.createElement("div");
  for (const tag of tags) {
    const el = document.createElement(tag);
    if (tag === "a") el.setAttribute("href", "#");
    container.appendChild(el);
  }
  document.body.appendChild(container);
  return container;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("useFocusTrap", () => {
  it("wraps focus from last to first on Tab", () => {
    const container = createContainer("button", "button", "button");
    const ref = { current: container };
    const buttons = container.querySelectorAll("button");
    (buttons[2] as HTMLElement).focus();

    renderHook(() => useFocusTrap(ref));

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    const prevented = vi.spyOn(event, "preventDefault");
    container.dispatchEvent(event);

    expect(prevented).toHaveBeenCalled();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("wraps focus from first to last on Shift+Tab", () => {
    const container = createContainer("button", "button", "button");
    const ref = { current: container };
    const buttons = container.querySelectorAll("button");
    (buttons[0] as HTMLElement).focus();

    renderHook(() => useFocusTrap(ref));

    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true });
    const prevented = vi.spyOn(event, "preventDefault");
    container.dispatchEvent(event);

    expect(prevented).toHaveBeenCalled();
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("restores focus to previously focused element on unmount", () => {
    const outer = document.createElement("button");
    document.body.appendChild(outer);
    outer.focus();

    const container = createContainer("button");
    const ref = { current: container };

    const { unmount } = renderHook(() => useFocusTrap(ref));
    unmount();

    expect(document.activeElement).toBe(outer);
  });

  it("does nothing when enabled is false", () => {
    const container = createContainer("button", "button");
    const ref = { current: container };
    const buttons = container.querySelectorAll("button");
    (buttons[1] as HTMLElement).focus();

    renderHook(() => useFocusTrap(ref, false));

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    const prevented = vi.spyOn(event, "preventDefault");
    container.dispatchEvent(event);

    expect(prevented).not.toHaveBeenCalled();
  });

  it("handles container with no focusable elements", () => {
    const container = document.createElement("div");
    container.appendChild(document.createElement("span"));
    document.body.appendChild(container);
    const ref = { current: container };

    renderHook(() => useFocusTrap(ref));

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    expect(() => container.dispatchEvent(event)).not.toThrow();
  });

  it("does not prevent default when Tab is pressed and focus is not at last", () => {
    const container = createContainer("button", "button", "button");
    const ref = { current: container };
    const buttons = container.querySelectorAll("button");
    (buttons[0] as HTMLElement).focus();

    renderHook(() => useFocusTrap(ref));

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    const prevented = vi.spyOn(event, "preventDefault");
    container.dispatchEvent(event);

    expect(prevented).not.toHaveBeenCalled();
  });

  it("does not prevent default when Shift+Tab is pressed and focus is not at first", () => {
    const container = createContainer("button", "button", "button");
    const ref = { current: container };
    const buttons = container.querySelectorAll("button");
    (buttons[2] as HTMLElement).focus();

    renderHook(() => useFocusTrap(ref));

    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true });
    const prevented = vi.spyOn(event, "preventDefault");
    container.dispatchEvent(event);

    expect(prevented).not.toHaveBeenCalled();
  });

  it("ignores non-Tab keys", () => {
    const container = createContainer("button", "button");
    const ref = { current: container };

    renderHook(() => useFocusTrap(ref));

    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    const prevented = vi.spyOn(event, "preventDefault");
    container.dispatchEvent(event);

    expect(prevented).not.toHaveBeenCalled();
  });

  it("handles null ref gracefully", () => {
    const ref = { current: null };
    expect(() => renderHook(() => useFocusTrap(ref))).not.toThrow();
  });
});
