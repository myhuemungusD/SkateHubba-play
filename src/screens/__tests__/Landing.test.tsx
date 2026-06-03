import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Landing } from "../Landing";
import { playOlliePop } from "../../utils/ollieSound";

vi.mock("../../utils/ollieSound", () => ({
  playOlliePop: vi.fn(),
}));

// Stub the lazy LandingMap so these tests don't pull mapbox-gl through the
// dynamic import. The marker test surface lives in LandingMap.test.tsx.
vi.mock("../../components/map/LandingMap", () => ({
  default: ({ onSignUpPrompt }: { onSignUpPrompt: () => void }) => (
    <button type="button" data-testid="landing-map-stub" onClick={onSignUpPrompt}>
      landing-map-stub
    </button>
  ),
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
    // Hero offers explicit "Sign in" and "Create account" peers so returning
    // users (Bryan's failure mode: had an account, got pushed into signup,
    // hit email-already-in-use) have a first-class path that isn't buried.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
  });

  it("calls onGo with signup when Create account is clicked", async () => {
    const onGo = vi.fn();
    render(<Landing {...defaultProps} onGo={onGo} />);
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(onGo).toHaveBeenCalledWith("signup");
  });

  it("calls onGo with signin from the hero Sign in button", async () => {
    const onGo = vi.fn();
    render(<Landing {...defaultProps} onGo={onGo} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onGo).toHaveBeenCalledWith("signin");
  });

  it("calls onGo with signin via Account nav button", async () => {
    const onGo = vi.fn();
    render(<Landing {...defaultProps} onGo={onGo} />);
    await userEvent.click(screen.getByText("Account"));
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

  it("plays the ollie pop sound when the Account nav button is clicked", async () => {
    render(<Landing {...defaultProps} />);
    await userEvent.click(screen.getByText("Account"));
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

  it("uses honest LA-scoped copy for the spot map teaser", () => {
    render(<Landing {...defaultProps} />);
    // Investor-facing honesty: pins are LA-only today, so the heading must
    // not claim "your city" universally. Regressing this would re-introduce
    // the misleading copy at Landing.tsx:222.
    expect(screen.getByRole("heading", { name: /30\+ spots, live in LA — your city next/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Spots in your city$/ })).not.toBeInTheDocument();
  });

  it("defers the LandingMap mount behind a sentinel until IntersectionObserver fires", async () => {
    // Stand up a minimal IntersectionObserver shim so the gate stays closed
    // until we deliberately fire an intersecting entry.
    type ObserverCb = (entries: Array<{ isIntersecting: boolean }>) => void;
    const observers: Array<{ cb: ObserverCb; disconnect: () => void }> = [];
    class FakeIO {
      cb: ObserverCb;
      constructor(cb: ObserverCb) {
        this.cb = cb;
      }
      observe() {
        observers.push({ cb: this.cb, disconnect: () => {} });
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    const original = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;

    try {
      render(<Landing {...defaultProps} />);
      // Map starts UN-mounted: sentinel present, stub absent.
      expect(screen.getByTestId("landing-map-sentinel")).toBeInTheDocument();
      expect(screen.queryByTestId("landing-map-stub")).not.toBeInTheDocument();

      // Trigger the intersection — the gate should flip and the map mounts.
      expect(observers.length).toBe(1);
      observers[0].cb([{ isIntersecting: true }]);
      expect(await screen.findByTestId("landing-map-stub")).toBeInTheDocument();
      expect(screen.queryByTestId("landing-map-sentinel")).not.toBeInTheDocument();
    } finally {
      if (original === undefined) {
        delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
      } else {
        (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = original;
      }
    }
  });
});
