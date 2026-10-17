import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HubbaIcon } from "../HubbaIcon";
import { GLYPHS, glyphToSvg, type GlyphName } from "../glyphs";

const NAMES = Object.keys(GLYPHS) as GlyphName[];

describe("HubbaIcon", () => {
  it.each(NAMES)("%s renders outline and filled forms on the 24 grid", (name) => {
    const { container, rerender } = render(<HubbaIcon name={name} />);
    let svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.dataset.state).toBe("idle");
    expect(svg.querySelector("mask")).toBeNull();
    rerender(<HubbaIcon name={name} active size={28} />);
    svg = container.querySelector("svg")!;
    expect(svg.dataset.state).toBe("active");
    expect(svg.getAttribute("width")).toBe("28");
    expect(svg.classList.contains("hb-icon-active")).toBe(true);
    const mask = svg.querySelector("mask")!;
    expect(svg.querySelector("g")!.getAttribute("mask")).toBe(`url(#${mask.id})`);
  });

  it("is decorative by default and labelled when asked", () => {
    const { container } = render(<HubbaIcon name="bell" />);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    render(<HubbaIcon name="settings" label="Settings" />);
    expect(screen.getByRole("img", { name: "Settings" })).toBeInTheDocument();
  });

  it("gives every filled instance a unique mask id", () => {
    const { container } = render(
      <>
        <HubbaIcon name="home" active />
        <HubbaIcon name="home" active />
      </>,
    );
    const ids = [...container.querySelectorAll("mask")].map((m) => m.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("serialises standalone SVG for previews", () => {
    expect(glyphToSvg("challenge", false, "x")).toContain('stroke-width="1.75"');
    expect(glyphToSvg("settings", true, "y", 20, "#FF6B00")).toContain('mask="url(#y)"');
    expect(glyphToSvg("challenge", true, "z")).toContain("rotate(45 12 12)");
  });
});
