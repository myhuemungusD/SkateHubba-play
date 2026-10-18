import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../AdminOpsPanel", () => ({ AdminOpsPanel: () => <div data-testid="ops" /> }));
vi.mock("../AdminInsightsPanel", () => ({ AdminInsightsPanel: () => <div data-testid="insights" /> }));
vi.mock("../AdminConsolePanel", () => ({ AdminConsolePanel: () => <div data-testid="console" /> }));
import { AdminRoadmapPanel } from "../AdminRoadmapPanel";

afterEach(() => vi.unstubAllEnvs());

describe("AdminRoadmapPanel", () => {
  it("shows every roadmap card with the console off", () => {
    render(<AdminRoadmapPanel />);
    expect(screen.queryByTestId("console")).toBeNull();
    expect(screen.getByRole("region", { name: "Bans list (coming soon)" })).toBeInTheDocument();
  });
  it("swaps built sections for the live console when the flag is on", () => {
    vi.stubEnv("VITE_FEATURE_ADMIN_CONSOLE", "true");
    render(<AdminRoadmapPanel />);
    expect(screen.getByTestId("console")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Bans list (coming soon)" })).toBeNull();
    expect(screen.getByRole("region", { name: "Audit log (coming soon)" })).toBeInTheDocument();
  });
  it("swaps disputes queue and audit log for the ops panel", () => {
    vi.stubEnv("VITE_FEATURE_ADMIN_OPS", "true");
    render(<AdminRoadmapPanel />);
    expect(screen.getByTestId("ops")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Audit log (coming soon)" })).toBeNull();
    expect(screen.getByRole("region", { name: "Bans list (coming soon)" })).toBeInTheDocument();
  });
  it("swaps analytics and announcements for the insights panel", () => {
    vi.stubEnv("VITE_FEATURE_ADMIN_INSIGHTS", "true");
    render(<AdminRoadmapPanel />);
    expect(screen.getByTestId("insights")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Analytics (coming soon)" })).toBeNull();
    expect(screen.getByText(/Coming next/)).toBeInTheDocument();
  });
  it("drops the coming-next line once everything is built", () => {
    vi.stubEnv("VITE_FEATURE_ADMIN_INSIGHTS", "true");
    vi.stubEnv("VITE_FEATURE_ADMIN_OPS", "true");
    vi.stubEnv("VITE_FEATURE_ADMIN_CONSOLE", "true");
    render(<AdminRoadmapPanel />);
    expect(screen.queryByText(/Coming next/)).toBeNull();
  });
});
