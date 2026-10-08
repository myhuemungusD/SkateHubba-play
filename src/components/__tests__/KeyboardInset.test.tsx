import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyboardInset } from "../KeyboardInset";

describe("KeyboardInset", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--keyboard-inset");
    vi.unstubAllGlobals();
  });

  it("publishes the visual-viewport overlap and scrolls a focused field", async () => {
    const scrollIntoView = vi.fn();
    const listeners = new Map<string, () => void>();
    const viewport = {
      height: 400,
      offsetTop: 0,
      addEventListener: (type: string, fn: () => void) => {
        listeners.set(type, fn);
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("visualViewport", viewport);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });

    render(
      <>
        <KeyboardInset />
        <input aria-label="handle" />
      </>,
    );

    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("400px");

    viewport.height = 800;
    listeners.get("resize")?.();
    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("");

    const field = screen.getByLabelText("handle");
    field.scrollIntoView = scrollIntoView;
    await userEvent.click(field);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest" });
    raf.mockRestore();
  });
});
