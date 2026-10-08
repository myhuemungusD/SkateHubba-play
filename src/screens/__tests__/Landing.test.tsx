import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Landing, __resetHeroEntranceForTest } from "../Landing";
import { SOCIAL_LINKS } from "../../constants/socialLinks";

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
    onApple: vi.fn(),
    appleLoading: false,
    onNav: vi.fn(),
  };

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

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

  it("hides Sign in with Apple unless the flag is the literal true", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();

    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "TRUE");
    render(<Landing {...defaultProps} appleLoading />);
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Continue with Google" }).at(-1)).toBeEnabled();
  });

  it("calls onApple when Apple button is clicked", async () => {
    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "true");
    const onApple = vi.fn();
    render(<Landing {...defaultProps} onApple={onApple} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(onApple).toHaveBeenCalled();
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

  it("lazy-loads the below-the-fold footer logo but keeps the nav logo eager", () => {
    render(<Landing {...defaultProps} />);
    // Nav logo is the above-the-fold LCP-adjacent image: must NOT lazy-load.
    const navLogo = screen.getByAltText("SkateHubba");
    expect(navLogo).not.toHaveAttribute("loading", "lazy");
    expect(navLogo).toHaveAttribute("fetchpriority", "high");
    // Footer logo sits far below the fold: defer it to protect initial transfer.
    const footerLogo = document.querySelector('footer img[src="/logonew.webp"]');
    expect(footerLogo).toHaveAttribute("loading", "lazy");
    // Both carry intrinsic dimensions so deferral introduces no layout shift.
    expect(navLogo).toHaveAttribute("width", "1536");
    expect(footerLogo).toHaveAttribute("height", "1024");
  });

  it("renders social media links", () => {
    render(<Landing {...defaultProps} />);
    // Every footer social/store anchor must point at the shared source of
    // truth — a mismatched handle would send users to the wrong account.
    const socials: Array<{ label: string; href: string }> = [
      { label: "Follow on X", href: SOCIAL_LINKS.x },
      { label: "Follow on Instagram", href: SOCIAL_LINKS.instagram },
      { label: "Follow on Facebook", href: SOCIAL_LINKS.facebook },
      { label: "Follow on TikTok", href: SOCIAL_LINKS.tiktok },
      { label: "SkateHubba store", href: SOCIAL_LINKS.store },
    ];
    for (const { label, href } of socials) {
      const link = screen.getByLabelText(label);
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", href);
    }
    // The newly added TikTok and store anchors open off-site, so they must
    // carry target/rel that prevents reverse-tabnabbing.
    for (const label of ["Follow on TikTok", "SkateHubba store"]) {
      const link = screen.getByLabelText(label);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
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

  it("hardens the demo video against download and picture-in-picture", () => {
    render(<Landing {...defaultProps} />);
    const video = screen.getByLabelText("SkateHubba gameplay demo");
    expect(video).toHaveAttribute("disablepictureinpicture");
    expect(video.getAttribute("controlslist")).toContain("nodownload");
  });

  // Feature freeze: the spot-map teaser was removed outright (not gated) so
  // mapbox-gl and map tiles never load on the landing page. jsdom has no
  // IntersectionObserver, which made the old teaser mount LandingMap
  // immediately — so the stub staying absent here proves nothing imports it.
  it("renders no spot-map teaser and never mounts LandingMap", () => {
    render(<Landing {...defaultProps} />);
    expect(screen.queryByRole("heading", { name: /30\+ spots/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Unlock the Map/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("landing-map-sentinel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("landing-map-stub")).not.toBeInTheDocument();
    expect(document.getElementById("spots")).toBeNull();
  });

  it("keeps the map teaser off even when the extras flag is on", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    try {
      render(<Landing {...defaultProps} />);
      expect(screen.queryByTestId("landing-map-stub")).not.toBeInTheDocument();
      expect(screen.queryByText(/Unlock the Map/i)).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("plays the hero entrance only on the first mount of the page", () => {
    __resetHeroEntranceForTest();
    const first = render(<Landing {...defaultProps} />);
    const heroOf = () => screen.getByRole("heading", { level: 1 }).parentElement!;
    expect(heroOf()).toHaveClass("hero-stagger");
    // The LCP heading is never hidden by the entrance (see .hero-lcp).
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("hero-lcp");
    first.unmount();
    render(<Landing {...defaultProps} />);
    expect(heroOf()).not.toHaveClass("hero-stagger");
  });
});
