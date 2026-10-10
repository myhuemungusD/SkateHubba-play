import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockListMyReports = vi.fn();
const mockListMyStatements = vi.fn();
const mockGetMyBan = vi.fn();
const mockListMyAppeals = vi.fn();
const mockSubmitAppeal = vi.fn();

vi.mock("../../services/moderation", () => ({
  listMyReports: (...args: unknown[]) => mockListMyReports(...args),
  listMyStatements: (...args: unknown[]) => mockListMyStatements(...args),
  getMyBan: (...args: unknown[]) => mockGetMyBan(...args),
  listMyAppeals: (...args: unknown[]) => mockListMyAppeals(...args),
  submitAppeal: (...args: unknown[]) => mockSubmitAppeal(...args),
}));

import { SafetyReportsSection } from "../SafetyReportsSection";

function ready(): void {
  mockListMyReports.mockResolvedValue([]);
  mockListMyStatements.mockResolvedValue([]);
  mockGetMyBan.mockResolvedValue(null);
  mockListMyAppeals.mockResolvedValue([]);
  mockSubmitAppeal.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  ready();
});

describe("SafetyReportsSection", () => {
  it("shows the empty states", async () => {
    render(<SafetyReportsSection uid="u1" />);
    expect(screen.getByTestId("safety-reports-loading")).toBeInTheDocument();
    expect(await screen.findByText("You haven't filed a report.")).toBeInTheDocument();
    expect(screen.getByText("No action has been taken on your content.")).toBeInTheDocument();
  });

  it("lists a report with its status and reference", async () => {
    mockListMyReports.mockResolvedValue([
      { id: "r1", reason: "illegal_content", status: "pending", createdAt: null, contentRef: "c1" },
      { id: "r2", reason: "future_reason", status: "mystery", createdAt: null, contentRef: "account" },
      { id: "r3", reason: "spam", status: "resolved", createdAt: null, contentRef: "g1" },
      { id: "r4", reason: "other", status: "dismissed", createdAt: null, contentRef: "g2" },
    ]);
    render(<SafetyReportsSection uid="u1" />);
    const row = await screen.findByTestId("my-report-r1");
    expect(row).toHaveTextContent("Illegal content");
    expect(row).toHaveTextContent("Received — in review");
    expect(row).toHaveTextContent("Reference r1");
    expect(screen.getByTestId("my-report-r2")).toHaveTextContent("future_reason");
    expect(screen.getByTestId("my-report-r2")).toHaveTextContent("mystery");
    expect(screen.getByTestId("my-report-r3")).toHaveTextContent("Action taken");
    expect(screen.getByTestId("my-report-r4")).toHaveTextContent("No action taken");
  });

  it("shows a statement and files an appeal", async () => {
    const user = userEvent.setup();
    mockListMyStatements.mockResolvedValue([
      {
        id: "r1",
        reportId: "r1",
        reason: "spam",
        explanation: "The clip was removed.",
        contentRef: "c1",
        createdAt: null,
      },
    ]);
    render(<SafetyReportsSection uid="u1" />);
    expect(await screen.findByText("The clip was removed.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Appeal" }));
    expect(screen.getByRole("button", { name: "Submit appeal" })).toBeDisabled();
    await user.type(screen.getByLabelText("WHY SHOULD THIS BE REVIEWED?"), "Please look again.");
    await user.click(screen.getByRole("button", { name: "Submit appeal" }));
    await waitFor(() => expect(mockSubmitAppeal).toHaveBeenCalledWith("u1", "statement", "r1", "Please look again."));
  });

  it("shows an existing appeal instead of another button", async () => {
    mockListMyStatements.mockResolvedValue([
      {
        id: "r1",
        reportId: "r1",
        reason: "unknown_reason",
        explanation: "Restricted.",
        contentRef: "c1",
        createdAt: null,
      },
    ]);
    mockListMyAppeals.mockResolvedValue([
      { id: "statement_r1", targetKind: "statement", targetId: "r1", status: "pending", createdAt: null },
    ]);
    render(<SafetyReportsSection uid="u1" />);
    expect(await screen.findByText("Appeal received")).toBeInTheDocument();
    expect(screen.getByText("unknown_reason")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Appeal" })).not.toBeInTheDocument();
  });

  it("shows a ban reason and appeals the ban", async () => {
    const user = userEvent.setup();
    mockGetMyBan.mockResolvedValue({ reason: "Repeated spam" });
    render(<SafetyReportsSection uid="u1" />);
    expect(await screen.findByTestId("account-restriction")).toHaveTextContent("Repeated spam");
    await user.click(screen.getByRole("button", { name: "Appeal" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("WHY SHOULD THIS BE REVIEWED?")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Appeal" }));
    await user.type(screen.getByLabelText("WHY SHOULD THIS BE REVIEWED?"), "I fixed it.");
    await user.click(screen.getByRole("button", { name: "Submit appeal" }));
    await waitFor(() => expect(mockSubmitAppeal).toHaveBeenCalledWith("u1", "ban", "u1", "I fixed it."));
  });

  it("uses a fallback when a ban has no written reason", async () => {
    mockGetMyBan.mockResolvedValue({ reason: "  " });
    render(<SafetyReportsSection uid="u1" />);
    expect(await screen.findByTestId("account-restriction")).toHaveTextContent("A written reason was not included.");
  });

  it("labels upheld and rejected appeals", async () => {
    mockGetMyBan.mockResolvedValue({ reason: "Spam" });
    mockListMyAppeals.mockResolvedValue([
      { id: "ban_u1", targetKind: "ban", targetId: "u1", status: "upheld", createdAt: null },
    ]);
    const { unmount } = render(<SafetyReportsSection uid="u1" />);
    expect(await screen.findByText("Appeal upheld")).toBeInTheDocument();
    unmount();

    mockListMyAppeals.mockResolvedValue([
      { id: "ban_u1", targetKind: "ban", targetId: "u1", status: "rejected", createdAt: null },
    ]);
    render(<SafetyReportsSection uid="u1" />);
    expect(await screen.findByText("Appeal rejected")).toBeInTheDocument();
  });

  it("shows an unknown appeal status as stored", async () => {
    mockListMyStatements.mockResolvedValue([
      {
        id: "r9",
        reportId: "r9",
        reason: "spam",
        explanation: "Restricted.",
        contentRef: "c1",
        createdAt: null,
      },
    ]);
    mockListMyAppeals.mockResolvedValue([
      { id: "statement_r9", targetKind: "statement", targetId: "r9", status: "queued", createdAt: null },
    ]);
    render(<SafetyReportsSection uid="u1" />);
    expect(await screen.findByText("queued")).toBeInTheDocument();
  });

  it("shows a load failure", async () => {
    mockListMyReports.mockRejectedValue(new Error("offline"));
    render(<SafetyReportsSection uid="u1" />);
    expect(await screen.findByTestId("safety-reports-error")).toHaveTextContent("Couldn't load your reports.");
  });

  it("ignores a response that arrives after unmount", async () => {
    let resolveReports: (rows: unknown[]) => void = () => {};
    mockListMyReports.mockReturnValue(
      new Promise((resolve) => {
        resolveReports = resolve;
      }),
    );
    const { unmount } = render(<SafetyReportsSection uid="u1" />);
    unmount();
    resolveReports([]);
    await Promise.resolve();
    expect(screen.queryByTestId("safety-reports")).not.toBeInTheDocument();
  });

  it("shows the appeal error and a non-Error rejection", async () => {
    const user = userEvent.setup();
    mockListMyStatements.mockResolvedValue([
      {
        id: "r1",
        reportId: "r1",
        reason: "spam",
        explanation: "Removed.",
        contentRef: "c1",
        createdAt: null,
      },
    ]);
    mockSubmitAppeal.mockRejectedValueOnce(new Error("Already appealed."));
    render(<SafetyReportsSection uid="u1" />);
    await user.click(await screen.findByRole("button", { name: "Appeal" }));
    await user.type(screen.getByLabelText("WHY SHOULD THIS BE REVIEWED?"), "Again.");
    await user.click(screen.getByRole("button", { name: "Submit appeal" }));
    expect(await screen.findByText("Already appealed.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByText("Already appealed.")).not.toBeInTheDocument();

    mockSubmitAppeal.mockRejectedValueOnce("nope");
    await user.click(screen.getByRole("button", { name: "Submit appeal" }));
    expect(await screen.findByText("Failed to submit appeal")).toBeInTheDocument();
  });
});
