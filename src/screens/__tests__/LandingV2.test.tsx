import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Landing } from "../Landing";

const renderV2 = async (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  await screen.findByTestId("landing-v2");
  return r;
};

vi.mock("../../components/map/LandingMap", () => ({
  default: () => <div data-testid="landing-map-stub" />,
}));

const props = () => ({
  onGo: vi.fn(),
  onGoogle: vi.fn(),
  googleLoading: false,
  onApple: vi.fn(),
  appleLoading: false,
  onNav: vi.fn(),
});

describe("Landing v2 (VITE_FEATURE_LANDING_V2)", () => {
  beforeEach(() => vi.stubEnv("VITE_FEATURE_LANDING_V2", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("renders the v2 hero copy instead of the classic landing", async () => {
    await renderV2(<Landing {...props()} />);
    expect(screen.getByTestId("landing-v2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "FOR THE LOVE OF THE GAME." })).toBeInTheDocument();
    expect(screen.getByText("S.K.A.T.E. over video")).toBeInTheDocument();
    expect(screen.getByText("Film your trick. Send it. They match it or take a letter.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "SkateHubba painted on a graffiti wall" })).toBeInTheDocument();
    expect(screen.queryByText("QUIT SCROLLING.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /invite/i })).not.toBeInTheDocument();
  });

  it("renders the three sections in order", async () => {
    await renderV2(<Landing {...props()} />);
    const h2s = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2s).toEqual(["HOW IT WORKS", "NO EDITS. NO EXCUSES.", "YOUR TURN."]);
    expect(screen.getByText("FILM IT")).toBeInTheDocument();
    expect(screen.getByText("SPELL IT OUT")).toBeInTheDocument();
  });

  it("uses named placeholder icons for every feature", async () => {
    const { container } = await renderV2(<Landing {...props()} />);
    const names = [...container.querySelectorAll("[data-placeholder='true']")].map((el) =>
      el.getAttribute("data-icon"),
    );
    expect(names).toEqual(expect.arrayContaining(["icon-record", "icon-clock", "icon-rank", "icon-crew", "icon-shop"]));
  });

  it("routes Sign in and Use email instead to signin, and the deck to signup", async () => {
    const p = props();
    await renderV2(<Landing {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await userEvent.click(screen.getByRole("button", { name: "Use email instead" }));
    await userEvent.click(screen.getByTestId("landing-v2-deck"));
    expect(p.onGo.mock.calls).toEqual([["signin"], ["signin"], ["signup"]]);
  });

  it("starts Google sign-in and hides Apple when its flag is off", async () => {
    const p = props();
    await renderV2(<Landing {...p} />);
    await userEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    expect(p.onGoogle).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Apple/ })).not.toBeInTheDocument();
  });

  it("shows Apple when enabled and locks the CTAs while a social sign-in runs", async () => {
    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "true");
    const p = props();
    const { rerender } = await renderV2(<Landing {...p} />);
    await userEvent.click(screen.getByRole("button", { name: /Apple/ }));
    expect(p.onApple).toHaveBeenCalledOnce();
    rerender(<Landing {...p} appleLoading />);
    expect(screen.getByTestId("landing-v2-deck")).toBeDisabled();
  });

  it("routes the terms line and footer legal links through onNav", async () => {
    const p = props();
    await renderV2(<Landing {...p} />);
    const notice = screen.getByTestId("terms-agreement-notice");
    await userEvent.click(within(notice).getByRole("link", { name: "Terms" }));
    await userEvent.click(within(notice).getByRole("link", { name: "Privacy Policy" }));
    const legal = screen.getByRole("navigation", { name: "Legal" });
    for (const name of ["Privacy", "Terms", "Data Deletion"]) {
      await userEvent.click(within(legal).getByRole("button", { name }));
    }
    expect(p.onNav.mock.calls).toEqual([["terms"], ["privacy"], ["privacy"], ["terms"], ["datadeletion"]]);
  });

  it("keeps the zero-tolerance content rule in the footer", async () => {
    await renderV2(<Landing {...props()} />);
    expect(screen.getByText("Zero tolerance for objectionable content or abusive users.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Follow on X" })).toHaveAttribute("target", "_blank");
  });
});

describe("Landing flag off", () => {
  it("renders the classic landing by default", () => {
    render(<Landing {...props()} />);
    expect(screen.queryByTestId("landing-v2")).not.toBeInTheDocument();
    expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
  });
});
