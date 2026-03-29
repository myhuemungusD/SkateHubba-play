import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProUsername } from "../ProUsername";

describe("ProUsername", () => {
  it("renders username with @ prefix", () => {
    render(<ProUsername username="mikewhite" />);
    expect(screen.getByText(/@mikewhite/)).toBeInTheDocument();
  });

  it("does not apply gold class when not verified pro", () => {
    const { container } = render(<ProUsername username="regular_user" />);
    expect(container.querySelector(".pro-username")).toBeNull();
  });

  it("applies gold class and shows badge when verified pro", () => {
    const { container } = render(<ProUsername username="mikewhite" isVerifiedPro={true} />);
    const proElements = container.querySelectorAll(".pro-username");
    expect(proElements.length).toBeGreaterThan(0);
    expect(screen.getByTitle("Verified Pro")).toBeInTheDocument();
    expect(screen.getByText("✦")).toBeInTheDocument();
  });

  it("does not show badge when isVerifiedPro is false", () => {
    render(<ProUsername username="mikewhite" isVerifiedPro={false} />);
    expect(screen.queryByTitle("Verified Pro")).toBeNull();
    expect(screen.queryByText("✦")).toBeNull();
  });

  it("passes through className prop", () => {
    const { container } = render(<ProUsername username="test" className="font-display text-xl" />);
    const span = container.firstElementChild;
    expect(span?.className).toContain("font-display");
    expect(span?.className).toContain("text-xl");
  });
});
