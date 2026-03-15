import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Btn } from "../Btn";

describe("Btn", () => {
  it("uses primary variant when variant is null", () => {
    render(<Btn variant={null as any}>Click</Btn>);
    const btn = screen.getByRole("button", { name: "Click" });
    expect(btn.className).toContain("bg-brand-orange");
  });
});
