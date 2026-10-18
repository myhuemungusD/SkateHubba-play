import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
});
