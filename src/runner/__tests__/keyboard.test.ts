import { describe, expect, it } from "vitest";
import { actionForKey, isTypingTarget } from "../keyboard";

describe("keyboard", () => {
  it("maps arrows and WASD, and ignores everything else", () => {
    expect(actionForKey("ArrowLeft")).toBe("left");
    expect(actionForKey("a")).toBe("left");
    expect(actionForKey("A")).toBe("left");
    expect(actionForKey("ArrowRight")).toBe("right");
    expect(actionForKey("d")).toBe("right");
    expect(actionForKey("ArrowUp")).toBe("ollie");
    expect(actionForKey("w")).toBe("ollie");
    expect(actionForKey(" ")).toBe("ollie");
    expect(actionForKey("ArrowDown")).toBe("duck");
    expect(actionForKey("s")).toBe("duck");
    expect(actionForKey("Escape")).toBe("pause");
    expect(actionForKey("p")).toBe("pause");
    expect(actionForKey("P")).toBe("pause");
    expect(actionForKey("q")).toBeNull();
  });

  it("treats inputs, textareas, and editable nodes as typing", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    const editable = document.createElement("div");
    // jsdom does not flip isContentEditable when the attribute is set.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isTypingTarget(editable)).toBe(true);
  });
});
