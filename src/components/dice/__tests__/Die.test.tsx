import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Die } from "../Die";
import { __resetCachedMqlForTest } from "../../../hooks/useReducedMotion";

function motion(matches: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({
      matches,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

describe("Die", () => {
  beforeEach(() => {
    __resetCachedMqlForTest();
    motion(false);
  });

  it.each([1, 2, 3, 4, 5, 6])("shows %i pips", (face) => {
    render(<Die face={face} tumbling={false} />);
    expect(screen.getByRole("img", { name: `Die showing ${face}` })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-pip]")).toHaveLength(face);
  });

  it("falls back to ace when the face is not 1–6", () => {
    render(<Die face={0} tumbling={false} />);
    expect(screen.getByRole("img", { name: "Die showing 1" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-pip]")).toHaveLength(1);
  });

  it("tumbles while a roll is in flight", () => {
    render(<Die face={5} tumbling />);
    expect(screen.getByRole("img", { name: "Rolling" }).className).toContain("animate-dice-tumble");
  });

  it("holds still when the reader asked for reduced motion", () => {
    __resetCachedMqlForTest();
    motion(true);
    render(<Die face={5} tumbling />);
    expect(screen.getByRole("img", { name: "Die showing 5" }).className).not.toContain("animate-dice-tumble");
  });
});
