import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Landing } from "../Landing";

describe("Landing", () => {
  const defaultProps = {
    onGo: vi.fn(),
    onGoogle: vi.fn(),
    googleLoading: false,
    onNav: vi.fn(),
  };

  it("renders hero content", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
    expect(screen.getByText("Sign In / Sign Up")).toBeInTheDocument();
  });

  it("calls onGo with signup when Sign In / Sign Up is clicked", async () => {
    const onGo = vi.fn();
    render(<Landing {...defaultProps} onGo={onGo} />);
    await userEvent.click(screen.getByText("Sign In / Sign Up"));
    expect(onGo).toHaveBeenCalledWith("signup");
  });

  it("calls onGo with signin via Log in nav button", async () => {
    const onGo = vi.fn();
    render(<Landing {...defaultProps} onGo={onGo} />);
    await userEvent.click(screen.getByText("Log in"));
    expect(onGo).toHaveBeenCalledWith("signin");
  });

  it("renders How It Works section", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.getByText("Film It")).toBeInTheDocument();
    expect(screen.getByText("Send the Challenge")).toBeInTheDocument();
    expect(screen.getByText("Spell It Out")).toBeInTheDocument();
  });

  it("renders footer with legal links", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.getByText("Privacy")).toBeInTheDocument();
    expect(screen.getByText("Terms")).toBeInTheDocument();
  });
});
