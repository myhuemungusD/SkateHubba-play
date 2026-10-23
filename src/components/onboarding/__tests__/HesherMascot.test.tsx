import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HesherMascot, HESHER_LABEL } from "../HesherMascot";

describe("HesherMascot", () => {
  it("renders Hesher's portrait as an accessible image by default", () => {
    render(<HesherMascot />);
    const img = screen.getByRole("img", { name: /hesher the skate buddy/i });
    expect(img.tagName.toLowerCase()).toBe("img");
    expect(img).toHaveAttribute("alt", HESHER_LABEL);
    expect(img).toHaveAttribute("src", "/assets/hesher/hesher-v1-48.png");
    expect(img.getAttribute("srcset")).toContain("/assets/hesher/hesher-v1-144.png 3x");
  });

  it("offers WebP at 1x/2x/3x with the PNG as fallback", () => {
    const { container } = render(<HesherMascot />);
    const source = container.querySelector("picture > source");
    expect(source).toHaveAttribute("type", "image/webp");
    expect(source?.getAttribute("srcset")).toBe(
      "/assets/hesher/hesher-v1-48.webp 1x, /assets/hesher/hesher-v1-96.webp 2x, /assets/hesher/hesher-v1-144.webp 3x",
    );
  });

  it("draws the portrait in a circle with the orange ring", () => {
    const { container } = render(<HesherMascot />);
    const cls = container.querySelector("img")?.getAttribute("class") ?? "";
    expect(cls).toContain("rounded-full");
    expect(cls).toContain("ring-brand-orange");
  });

  it("hides itself from assistive tech when decorative=true", () => {
    const { container } = render(<HesherMascot decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    const root = screen.getByTestId("hesher-mascot");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it.each([
    ["idle", "animate-float"],
    ["talking", "animate-float"],
    ["cheer", "animate-ollie"],
  ] as const)("applies the expected animation class for state=%s", (state, expectedClass) => {
    render(<HesherMascot state={state} />);
    const root = screen.getByTestId("hesher-mascot");
    expect(root.getAttribute("class") ?? "").toContain(expectedClass);
    expect(root.getAttribute("data-state")).toBe(state);
  });

  it("renders the cheer-state glow ring only for cheer", () => {
    const { rerender } = render(<HesherMascot state="idle" />);
    expect(screen.queryByTestId("hesher-glow")).toBeNull();
    rerender(<HesherMascot state="cheer" />);
    expect(screen.getByTestId("hesher-glow").getAttribute("class")).toContain("animate-glow-pulse");
  });

  it("merges a custom className with the animation class", () => {
    render(<HesherMascot state="idle" className="w-24 h-24" />);
    const cls = screen.getByTestId("hesher-mascot").getAttribute("class") ?? "";
    expect(cls).toContain("w-24");
    expect(cls).toContain("h-24");
    expect(cls).toContain("animate-float");
  });
});
