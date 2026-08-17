import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const mockFetchReports = vi.fn();

vi.mock("../../services/admin", () => ({
  fetchReports: (...args: unknown[]) => mockFetchReports(...args),
  resolveReport: vi.fn(),
  grantVerifiedPro: vi.fn(),
  revokeVerifiedPro: vi.fn(),
  awardAchievement: vi.fn(),
  revokeAchievement: vi.fn(),
  awardLockerItem: vi.fn(),
  removeLockerItem: vi.fn(),
}));

vi.mock("../../services/users", () => ({
  getUidByUsername: vi.fn(),
  getUserProfile: vi.fn(),
}));

vi.mock("../../services/achievements", () => ({ fetchAchievements: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/locker", () => ({ fetchLockerItems: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { AdminScreen } from "../AdminScreen";
import { NotificationProvider } from "../../context/NotificationContext";

function Wrapper({ children }: { children: ReactNode }) {
  return <NotificationProvider uid="admin1">{children}</NotificationProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchReports.mockResolvedValue([]);
});

describe("AdminScreen", () => {
  it("opens on the Verify Pro tab", () => {
    render(<AdminScreen adminUid="admin1" onBack={vi.fn()} />, { wrapper: Wrapper });

    expect(screen.getByRole("region", { name: "Verify Pro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "VERIFY PRO" })).toHaveAttribute("aria-pressed", "true");
    // No queue read until the operator asks for it.
    expect(mockFetchReports).not.toHaveBeenCalled();
  });

  it("switches between the three sections", async () => {
    const user = userEvent.setup();
    render(<AdminScreen adminUid="admin1" onBack={vi.fn()} />, { wrapper: Wrapper });

    await user.click(screen.getByRole("button", { name: "AWARDS" }));
    expect(screen.getByRole("region", { name: "Awards" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Verify Pro" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "REPORTS" }));
    expect(screen.getByRole("region", { name: "Reports" })).toBeInTheDocument();
    await waitFor(() => expect(mockFetchReports).toHaveBeenCalledWith("pending"));
    expect(await screen.findByTestId("reports-empty")).toBeInTheDocument();
  });

  it("calls onBack from the header control", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<AdminScreen adminUid="admin1" onBack={onBack} />, { wrapper: Wrapper });

    await user.click(screen.getByRole("button", { name: "Back to lobby" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
