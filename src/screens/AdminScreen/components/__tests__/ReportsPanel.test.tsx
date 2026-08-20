import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockFetchReports = vi.fn();
const mockResolveReport = vi.fn();
const mockBanUser = vi.fn();

vi.mock("../../../../services/admin", () => ({
  fetchReports: (...args: unknown[]) => mockFetchReports(...args),
  resolveReport: (...args: unknown[]) => mockResolveReport(...args),
}));

vi.mock("../../../../services/admin.bans", () => ({
  banUser: (...args: unknown[]) => mockBanUser(...args),
}));

vi.mock("../../../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { ReportsPanel } from "../ReportsPanel";
import { ADMIN_UID, renderWithToasts } from "./adminPanels.test-helpers";

function renderPanel() {
  return renderWithToasts(<ReportsPanel adminUid={ADMIN_UID} />);
}

const report = {
  id: "r1",
  reporterUid: "u2",
  reportedUid: "u1",
  reportedUsername: "nyjah",
  gameId: "g1",
  reason: "cheating",
  description: "He landed on his knee and still claimed it.",
  clipId: "g1_3_set",
  status: "pending",
  createdAt: new Date(Date.now() - 2 * 3_600_000),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchReports.mockResolvedValue([report]);
  mockResolveReport.mockResolvedValue(undefined);
  mockBanUser.mockResolvedValue(undefined);
});

describe("ReportsPanel", () => {
  it("loads the pending queue and renders the case detail as plain text", async () => {
    renderPanel();

    expect(await screen.findByTestId("report-r1")).toBeInTheDocument();
    expect(mockFetchReports).toHaveBeenCalledWith("pending");
    const row = within(screen.getByTestId("report-r1"));
    expect(row.getByText("@nyjah")).toBeInTheDocument();
    expect(row.getByText("Cheating or exploiting")).toBeInTheDocument();
    expect(row.getByText(/2h ago · game g1 · reporter u2/)).toBeInTheDocument();
    // v1 is triage-only — nothing in a row navigates away from the queue.
    expect(row.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the evidence a verdict is made on: the description and the flagged clip", async () => {
    renderPanel();

    const row = within(await screen.findByTestId("report-r1"));
    expect(row.getByTestId("report-description-r1")).toHaveTextContent("He landed on his knee and still claimed it.");
    expect(row.getByTestId("report-clip-r1")).toHaveTextContent("clip g1_3_set");
  });

  it("renders a description containing markup as inert text", async () => {
    // Reporter-authored, therefore untrusted. It must reach the operator as
    // characters, never as DOM — a regression here is stored XSS in the
    // moderation console.
    mockFetchReports.mockResolvedValue([{ ...report, description: '<img src=x onerror="alert(1)"> he cut the line' }]);
    renderPanel();

    const description = await screen.findByTestId("report-description-r1");
    expect(description).toHaveTextContent('<img src=x onerror="alert(1)"> he cut the line');
    expect(description.querySelector("img")).toBeNull();
    expect(description.innerHTML).not.toContain("<img");
  });

  it("preserves the reporter's line breaks rather than collapsing them", async () => {
    mockFetchReports.mockResolvedValue([{ ...report, description: "First he claimed it.\nThen he blamed the lag." }]);
    renderPanel();

    const description = await screen.findByTestId("report-description-r1");
    expect(description).toHaveClass("whitespace-pre-wrap");
    expect(description.textContent).toBe("First he claimed it.\nThen he blamed the lag.");
  });

  it("says so explicitly when the reporter left no description", async () => {
    // Silence must not read as "not loaded" — the operator has to know the
    // report genuinely carries no account of what happened.
    mockFetchReports.mockResolvedValue([{ ...report, description: "" }]);
    renderPanel();

    expect(await screen.findByText("No description provided")).toBeInTheDocument();
    expect(screen.queryByTestId("report-description-r1")).not.toBeInTheDocument();
  });

  it("omits the clip line for a game-level report", async () => {
    mockFetchReports.mockResolvedValue([{ ...report, clipId: null }]);
    renderPanel();

    await screen.findByTestId("report-r1");
    expect(screen.queryByTestId("report-clip-r1")).not.toBeInTheDocument();
  });

  const resolvedReport = {
    ...report,
    status: "resolved",
    resolvedBy: "admin7",
    resolvedAt: new Date(Date.now() - 3 * 60_000),
  };

  it("shows who resolved a report and when", async () => {
    mockFetchReports.mockResolvedValue([resolvedReport]);
    renderPanel();

    expect(await screen.findByTestId("report-resolution-r1")).toHaveTextContent("resolved by admin7 · 3m ago");
  });

  it("refetches with the selected status when the resolved tab is picked", async () => {
    renderPanel();
    await screen.findByTestId("report-r1");
    expect(mockFetchReports).toHaveBeenCalledWith("pending");

    mockFetchReports.mockResolvedValue([resolvedReport]);
    await userEvent.click(screen.getByRole("tab", { name: "RESOLVED" }));

    await waitFor(() => expect(mockFetchReports).toHaveBeenLastCalledWith("resolved"));
    expect(await screen.findByTestId("report-resolution-r1")).toHaveTextContent("resolved by admin7 · 3m ago");
    expect(screen.getByRole("tab", { name: "RESOLVED" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "PENDING" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("RESOLVED REPORTS")).toBeInTheDocument();
  });

  it("offers no verdict buttons on an already-closed report", async () => {
    // firestore.rules only allows the update while status == 'pending', so a
    // verdict button here would be a guaranteed permission-denied.
    mockFetchReports.mockResolvedValue([resolvedReport]);
    renderPanel();

    const row = within(await screen.findByTestId("report-r1"));
    expect(row.queryByRole("button", { name: "RESOLVE" })).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "DISMISS" })).not.toBeInTheDocument();
  });

  it("re-selecting the active tab does not refetch", async () => {
    renderPanel();
    await screen.findByTestId("report-r1");
    expect(mockFetchReports).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("tab", { name: "PENDING" }));
    expect(mockFetchReports).toHaveBeenCalledTimes(1);
  });

  it("shows a status-specific empty state on the resolved tab", async () => {
    renderPanel();
    await screen.findByTestId("report-r1");

    mockFetchReports.mockResolvedValue([]);
    await userEvent.click(screen.getByRole("tab", { name: "RESOLVED" }));

    expect(await screen.findByTestId("reports-empty")).toHaveTextContent("No resolved reports");
  });

  it("says unknown for a report resolved before the audit fields shipped", async () => {
    mockFetchReports.mockResolvedValue([{ ...report, status: "dismissed", resolvedBy: "", resolvedAt: null }]);
    renderPanel();

    expect(await screen.findByTestId("report-resolution-r1")).toHaveTextContent("dismissed by unknown · unknown");
  });

  it("omits the resolution line while a report is still pending", async () => {
    renderPanel();

    await screen.findByTestId("report-r1");
    expect(screen.queryByTestId("report-resolution-r1")).not.toBeInTheDocument();
  });

  it("falls back to the raw reason for a value this build doesn't know", async () => {
    mockFetchReports.mockResolvedValue([{ ...report, reason: "future_reason" }]);
    renderPanel();

    expect(await screen.findByText("future_reason")).toBeInTheDocument();
  });

  it("shows an empty state when nothing is pending", async () => {
    mockFetchReports.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByTestId("reports-empty")).toHaveTextContent("No pending reports");
  });

  it("surfaces a load failure with the service's message", async () => {
    mockFetchReports.mockRejectedValue(new Error("Missing or insufficient permissions."));
    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent("Missing or insufficient permissions.");
    expect(screen.queryByTestId("reports-empty")).not.toBeInTheDocument();
  });

  it("resolves a report with the admin uid and refetches the queue", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByTestId("report-r1");
    mockFetchReports.mockResolvedValue([]);

    await user.click(screen.getByRole("button", { name: "RESOLVE" }));

    await waitFor(() => expect(mockResolveReport).toHaveBeenCalledWith(ADMIN_UID, "r1", "resolved"));
    expect(await screen.findByText("Report resolved")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("reports-empty")).toBeInTheDocument());
    expect(mockFetchReports).toHaveBeenCalledTimes(2);
  });

  it("dismisses a report", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByTestId("report-r1");

    await user.click(screen.getByRole("button", { name: "DISMISS" }));

    await waitFor(() => expect(mockResolveReport).toHaveBeenCalledWith(ADMIN_UID, "r1", "dismissed"));
    expect(await screen.findByText("Report dismissed")).toBeInTheDocument();
  });

  it("toasts and leaves the row in place when the verdict fails", async () => {
    const user = userEvent.setup();
    mockResolveReport.mockRejectedValue(new Error("Missing or insufficient permissions."));
    renderPanel();
    await screen.findByTestId("report-r1");

    await user.click(screen.getByRole("button", { name: "RESOLVE" }));

    expect(await screen.findByText("Action failed")).toBeInTheDocument();
    expect(screen.getByTestId("report-r1")).toBeInTheDocument();
    expect(mockFetchReports).toHaveBeenCalledTimes(1);
  });

  it("refetches on demand from the refresh button", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByTestId("report-r1");

    await user.click(screen.getByRole("button", { name: "Refresh reports" }));

    await waitFor(() => expect(mockFetchReports).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("report-r1")).toBeInTheDocument();
  });
});

/* ── User-clip reports and enforcement ────────────────────────────── */

describe("ReportsPanel — user-clip reports", () => {
  const userClipReport = {
    ...report,
    id: "r2",
    gameId: null,
    reason: "non_skate_content",
    clipId: "userclip1",
    description: "Not skating.",
  };

  it("surfaces a report with no game as a feed clip rather than printing a null", async () => {
    mockFetchReports.mockResolvedValue([userClipReport]);
    renderPanel();

    const row = within(await screen.findByTestId("report-r2"));
    expect(row.getByText(/feed clip \(no game\)/i)).toBeInTheDocument();
    expect(row.queryByText(/game null/i)).not.toBeInTheDocument();
    expect(row.getByTestId("report-clip-r2")).toHaveTextContent("clip userclip1");
  });

  it("renders the non_skate_content reason via its label, not the raw enum value", async () => {
    mockFetchReports.mockResolvedValue([userClipReport]);
    renderPanel();

    const row = within(await screen.findByTestId("report-r2"));
    expect(row.getByText("Not skateboarding")).toBeInTheDocument();
    expect(row.queryByText("non_skate_content")).not.toBeInTheDocument();
  });
});

describe("ReportsPanel — ban", () => {
  it("requires a confirm step before banning", async () => {
    const user = userEvent.setup();
    renderPanel();
    const row = within(await screen.findByTestId("report-r1"));

    await user.click(row.getByRole("button", { name: /ban user/i }));

    // The trigger is replaced by the confirm row — nothing has been called yet.
    expect(row.getByText(/ban @nyjah\?/i)).toBeInTheDocument();
    expect(mockBanUser).not.toHaveBeenCalled();
  });

  it("cancelling the confirm leaves the user unbanned", async () => {
    const user = userEvent.setup();
    renderPanel();
    const row = within(await screen.findByTestId("report-r1"));

    await user.click(row.getByRole("button", { name: /ban user/i }));
    await user.click(row.getByRole("button", { name: /cancel/i }));

    expect(mockBanUser).not.toHaveBeenCalled();
    expect(row.getByRole("button", { name: /ban user/i })).toBeInTheDocument();
  });

  it("bans the reported uid on confirm and reports it", async () => {
    const user = userEvent.setup();
    renderPanel();
    const row = within(await screen.findByTestId("report-r1"));

    await user.click(row.getByRole("button", { name: /ban user/i }));
    await user.click(row.getByRole("button", { name: "BAN" }));

    await waitFor(() => expect(mockBanUser).toHaveBeenCalledWith("u1"));
    expect(await screen.findByText("User banned")).toBeInTheDocument();
    // Banning is enforcement, not a verdict — the ticket stays open.
    expect(mockResolveReport).not.toHaveBeenCalled();
  });

  it("surfaces a ban failure to the operator", async () => {
    const user = userEvent.setup();
    mockBanUser.mockRejectedValueOnce(new Error("no such user"));
    renderPanel();
    const row = within(await screen.findByTestId("report-r1"));

    await user.click(row.getByRole("button", { name: /ban user/i }));
    await user.click(row.getByRole("button", { name: "BAN" }));

    expect(await screen.findByText("Ban failed")).toBeInTheDocument();
  });

  it("offers no ban control on an already-closed report", async () => {
    mockFetchReports.mockResolvedValue([{ ...report, status: "resolved", resolvedBy: "admin1" }]);
    renderPanel();

    const row = within(await screen.findByTestId("report-r1"));
    expect(row.queryByRole("button", { name: /ban user/i })).not.toBeInTheDocument();
  });
});
