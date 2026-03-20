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
    expect(screen.getByText("READY TO PLAY?")).toBeInTheDocument();
    expect(screen.getByText("Get Started with Email")).toBeInTheDocument();
    expect(screen.getByText("I Have an Account")).toBeInTheDocument();
  });

  it("calls onGo with signup when Get Started is clicked", async () => {
    const onGo = vi.fn();
    render(<Landing {...defaultProps} onGo={onGo} />);
    await userEvent.click(screen.getByText("Get Started with Email"));
    expect(onGo).toHaveBeenCalledWith("signup");
  });

  it("calls onGo with signin when I Have an Account is clicked", async () => {
    const onGo = vi.fn();
    render(<Landing {...defaultProps} onGo={onGo} />);
    await userEvent.click(screen.getByText("I Have an Account"));
    expect(onGo).toHaveBeenCalledWith("signin");
  });

  it("renders How It Works section", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.getByText("Set a Trick")).toBeInTheDocument();
    expect(screen.getByText("Challenge an Opponent")).toBeInTheDocument();
    expect(screen.getByText("Earn Letters")).toBeInTheDocument();
  });

  it("renders footer with legal links", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.getByText("Privacy Policy")).toBeInTheDocument();
    expect(screen.getByText("Terms of Service")).toBeInTheDocument();
  });
});
