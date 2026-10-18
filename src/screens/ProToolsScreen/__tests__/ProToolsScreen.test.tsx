import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIsAdmin = vi.fn();
vi.mock("../../../hooks/useIsAdmin", () => ({
  useIsAdmin: (uid: string) => mockIsAdmin(uid),
}));
vi.mock("../../NotFound", () => ({ NotFound: () => <p>not-found</p> }));
vi.mock("../../../services/proCalls", () => ({
  fetchProQueue: async () => [],
  fetchGoldCandidates: async () => [],
  submitProCall: vi.fn(),
  submitGoldClip: vi.fn(),
}));

import { ProToolsRoute, ProToolsScreen } from "..";
import { resolveProToolsAccess } from "../access";
import { PRO_TOOLS } from "../../../components/pro/proTools";

/** Labels of every admin-only power. None may appear on the pro screen. */
const ADMIN_ONLY = [/ban/i, /reports?\b/i, /moderat/i, /verify pro/i, /award/i, /locker/i, /roadmap/i];

describe("resolveProToolsAccess", () => {
  it("opens for a verified pro only when the flag is on", () => {
    expect(resolveProToolsAccess({ flagOn: true, isVerifiedPro: true, isAdmin: false })).toBe("pro");
    expect(resolveProToolsAccess({ flagOn: false, isVerifiedPro: true, isAdmin: false })).toBeNull();
  });
  it("gives admins review mode and everyone else nothing", () => {
    expect(resolveProToolsAccess({ flagOn: false, isVerifiedPro: false, isAdmin: true })).toBe("review");
    expect(resolveProToolsAccess({ flagOn: true, isVerifiedPro: false, isAdmin: true })).toBe("review");
    expect(resolveProToolsAccess({ flagOn: true, isVerifiedPro: false, isAdmin: false })).toBeNull();
  });
});

describe("ProToolsScreen", () => {
  it("renders every pro tool as a coming-soon placeholder with no actionable controls", async () => {
    const onBack = vi.fn();
    render(<ProToolsScreen reviewMode={false} onBack={onBack} />);
    for (const t of PRO_TOOLS) {
      expect(
        screen.getByRole("region", { name: `${t.title} (${t.status ? t.status.toLowerCase() : "coming soon"})` }),
      ).toBeInTheDocument();
    }
    expect(screen.queryByRole("note")).toBeNull();
    // The only button is Back: placeholders write nothing.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: /BACK/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it("leads with Bless a pro, the headline pro power", () => {
    render(<ProToolsScreen reviewMode={false} onBack={() => {}} />);
    const hero = screen.getByTestId("blessing-hero");
    expect(hero).toHaveTextContent("Bless a pro");
    expect(hero).toHaveTextContent(/never earns or wins|Nobody earns or wins pro/);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.indexOf("Bless a pro")).toBe(1);
  });

  it("exposes no admin-only feature to pros", () => {
    render(<ProToolsScreen reviewMode={false} onBack={() => {}} />);
    const text = screen.getByTestId("pro-tools-screen").textContent ?? "";
    for (const re of ADMIN_ONLY) expect(text).not.toMatch(re);
  });

  it("does not import the admin console or admin services", () => {
    const dir = resolve(__dirname, "..");
    for (const f of ["index.tsx", "access.ts", "../../components/pro/proTools.tsx"]) {
      const src = readFileSync(resolve(dir, f), "utf8");
      expect(src).not.toMatch(/AdminScreen|services\/admin|VerifyProPanel|ReportsPanel|AwardsPanel|ClipReviewPanel/);
    }
  });
});

describe("ProToolsRoute", () => {
  beforeEach(() => mockIsAdmin.mockReturnValue({ isAdmin: false, loading: false }));
  afterEach(() => vi.unstubAllEnvs());

  it("lets a verified pro in with the flag on, without consulting the admin claim", () => {
    vi.stubEnv("VITE_FEATURE_PRO_PROFILES", "true");
    render(<ProToolsRoute uid="p1" isVerifiedPro onBack={() => {}} />);
    expect(screen.getByTestId("pro-tools-screen")).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
    expect(mockIsAdmin).toHaveBeenCalledWith("");
  });

  it("hides from a verified pro while the flag is off", () => {
    render(<ProToolsRoute uid="p1" isVerifiedPro onBack={() => {}} />);
    expect(screen.getByText("not-found")).toBeInTheDocument();
  });

  it("shows admins review mode while the flag is off", () => {
    mockIsAdmin.mockReturnValue({ isAdmin: true, loading: false });
    render(<ProToolsRoute uid="a1" isVerifiedPro={false} onBack={() => {}} />);
    expect(screen.getByRole("note")).toHaveTextContent("Review mode");
  });

  it("waits on the claim, and turns away signed-out and regular users", () => {
    mockIsAdmin.mockReturnValue({ isAdmin: false, loading: true });
    const { unmount } = render(<ProToolsRoute uid="u1" isVerifiedPro={false} onBack={() => {}} />);
    expect(screen.queryByTestId("pro-tools-screen")).toBeNull();
    expect(screen.queryByText("not-found")).toBeNull();
    unmount();
    mockIsAdmin.mockReturnValue({ isAdmin: false, loading: false });
    render(<ProToolsRoute uid={null} isVerifiedPro onBack={() => {}} />);
    expect(screen.getByText("not-found")).toBeInTheDocument();
  });
});

describe("ProToolsScreen live pro calls", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("swaps the review queue and gold cards for live tools for a real pro", () => {
    vi.stubEnv("VITE_FEATURE_PRO_CALLS", "true");
    render(<ProToolsScreen uid="p" reviewMode={false} onBack={() => {}} />);
    expect(screen.getByRole("region", { name: "Pro review queue" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Gold clip authoring" })).toBeInTheDocument();
  });
  it("keeps placeholders in admin review mode", () => {
    vi.stubEnv("VITE_FEATURE_PRO_CALLS", "true");
    render(<ProToolsScreen uid="a" reviewMode onBack={() => {}} />);
    expect(screen.getByRole("region", { name: "Pro review queue (coming soon)" })).toBeInTheDocument();
  });
});
