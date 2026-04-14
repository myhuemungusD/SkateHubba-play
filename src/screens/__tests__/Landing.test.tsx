import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Landing } from "../Landing";
import { playOlliePop } from "../../utils/ollieSound";

vi.mock("../../utils/ollieSound", () => ({
  playOlliePop: vi.fn(),
}));

describe("Landing", () => {
  const defaultProps = {
    onGo: vi.fn(),
    onGoogle: vi.fn(),
    googleLoading: false,
    onNav: vi.fn(),
  };

  beforeEach(() => vi.clearAllMocks());

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

  it("calls onGo with signup when Sign up nav button is clicked", async () => {
    const onGo = vi.fn();
    render(<Landing {...defaultProps} onGo={onGo} />);
    await userEvent.click(screen.getByText("Sign up"));
    expect(onGo).toHaveBeenCalledWith("signup");
  });

  it("calls onGo with signup when Start Playing is clicked", async () => {
    const onGo = vi.fn();
    render(<Landing {...defaultProps} onGo={onGo} />);
    await userEvent.click(screen.getByText("Start Playing"));
    expect(onGo).toHaveBeenCalledWith("signup");
  });

  it("calls onGoogle when Google button is clicked", async () => {
    const onGoogle = vi.fn();
    render(<Landing {...defaultProps} onGoogle={onGoogle} />);
    await userEvent.click(screen.getByText("Continue with Google"));
    expect(onGoogle).toHaveBeenCalled();
  });

  it("renders features section", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.getByText("One Take")).toBeInTheDocument();
    expect(screen.getByText("Run It With Anyone")).toBeInTheDocument();
  });

  it("renders hero subtitle", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.getAllByText(/For the love of the game/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders free to play badge", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.getByText("Free to play")).toBeInTheDocument();
  });

  it("renders SKATEHUBBA FOR THE LOVE OF THE GAME headline", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.getAllByText("SKATEHUBBA").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("FOR THE LOVE OF THE GAME.")).toBeInTheDocument();
  });

  it("calls onNav for privacy link", async () => {
    const onNav = vi.fn();
    render(<Landing {...defaultProps} onNav={onNav} />);
    await userEvent.click(screen.getByText("Privacy"));
    expect(onNav).toHaveBeenCalledWith("privacy");
  });

  it("calls onNav for terms link", async () => {
    const onNav = vi.fn();
    render(<Landing {...defaultProps} onNav={onNav} />);
    await userEvent.click(screen.getByText("Terms"));
    expect(onNav).toHaveBeenCalledWith("terms");
  });

  it("renders social media links", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.getByLabelText("Follow on X")).toBeInTheDocument();
    expect(screen.getByLabelText("Follow on Instagram")).toBeInTheDocument();
  });

  it("renders Data Deletion link", async () => {
    const onNav = vi.fn();
    render(<Landing {...defaultProps} onNav={onNav} />);
    await userEvent.click(screen.getByText("Data Deletion"));
    expect(onNav).toHaveBeenCalledWith("datadeletion");
  });

  it("exposes a labelled primary nav", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("links the logo back to the hero", () => {
    render(<Landing {...defaultProps} />);
    const logoLink = screen.getByRole("link", { name: "SkateHubba home" });
    expect(logoLink).toHaveAttribute("href", "#hero");
  });

  it("renders an interactive scroll indicator that targets the demo section", () => {
    render(<Landing {...defaultProps} />);
    const scrollLink = screen.getByRole("link", { name: "Scroll to demo" });
    expect(scrollLink).toHaveAttribute("href", "#demo");
  });

  it("labels the demo section with a visually hidden heading", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.getByRole("heading", { name: "Gameplay demo" })).toBeInTheDocument();
  });

  it("plays the ollie pop sound when the Log in nav button is clicked", async () => {
    render(<Landing {...defaultProps} />);
    await userEvent.click(screen.getByText("Log in"));
    expect(playOlliePop).toHaveBeenCalled();
  });

  it("plays the ollie pop sound when the Google button is clicked", async () => {
    render(<Landing {...defaultProps} />);
    await userEvent.click(screen.getByText("Continue with Google"));
    expect(playOlliePop).toHaveBeenCalled();
  });

  it("hardens the demo video against download and picture-in-picture", () => {
    render(<Landing {...defaultProps} />);
    const video = screen.getByLabelText("SkateHubba gameplay demo");
    expect(video).toHaveAttribute("disablepictureinpicture");
    expect(video.getAttribute("controlslist")).toContain("nodownload");
  });
});
