import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HesherMascot } from "../HesherMascot";

describe("HesherMascot", () => {
  it("renders an accessible SVG with the role=img label by default", () => {
    render(<HesherMascot />);
    const svg = screen.getByRole("img", { name: /hesher the skate buddy/i });
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("hides itself from assistive tech when decorative=true", () => {
    const { container } = render(<HesherMascot decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    ["idle", "animate-float"],
    ["talking", "animate-float"],
    ["cheer", "animate-ollie"],
  ] as const)("applies the expected animation class for state=%s", (state, expectedClass) => {
    const { container } = render(<HesherMascot state={state} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class") ?? "").toContain(expectedClass);
    expect(svg?.getAttribute("data-state")).toBe(state);
  });

  it("renders the cheer-state glow ring only for cheer", () => {
    const { container, rerender } = render(<HesherMascot state="idle" />);
    expect(container.querySelector("circle.text-brand-orange")).toBeNull();
    rerender(<HesherMascot state="cheer" />);
    expect(container.querySelector("circle.text-brand-orange")).not.toBeNull();
  });

  it("merges a custom className with the animation class", () => {
    const { container } = render(<HesherMascot state="idle" className="w-24 h-24" />);
    const cls = container.querySelector("svg")?.getAttribute("class") ?? "";
    expect(cls).toContain("w-24");
    expect(cls).toContain("h-24");
    expect(cls).toContain("animate-float");
  });
});
