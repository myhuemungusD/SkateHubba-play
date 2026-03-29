import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportModal } from "../ReportModal";

const mockSubmitReport = vi.fn();

vi.mock("../../services/reports", () => ({
  submitReport: (...args: unknown[]) => mockSubmitReport(...args),
  REPORT_REASON_LABELS: {
    inappropriate_video: "Inappropriate video content",
    abusive_behavior: "Abusive or threatening behavior",
    cheating: "Cheating or exploiting",
    spam: "Spam or bot activity",
    other: "Other",
  },
}));

const baseProps = {
  reporterUid: "u1",
  reportedUid: "u2",
  reportedUsername: "bob",
  gameId: "g1",
  onClose: vi.fn(),
  onSubmitted: vi.fn(),
};

describe("ReportModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitReport.mockResolvedValue("r1");
  });

  it("renders modal with dialog role", () => {
    render(<ReportModal {...baseProps} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Report @bob")).toBeInTheDocument();
  });

  it("disables submit button when no reason is selected", () => {
    render(<ReportModal {...baseProps} />);
    expect(screen.getByText("Submit Report")).toBeDisabled();
  });

  it("submits report with reason and description", async () => {
    render(<ReportModal {...baseProps} />);
    await userEvent.selectOptions(screen.getByLabelText("REASON"), "cheating");
    await userEvent.type(screen.getByLabelText("DETAILS (OPTIONAL)"), "They faked the landing");
    await userEvent.click(screen.getByText("Submit Report"));

    await waitFor(() => {
      expect(mockSubmitReport).toHaveBeenCalledWith({
        reporterUid: "u1",
        reportedUid: "u2",
        reportedUsername: "bob",
        gameId: "g1",
        reason: "cheating",
        description: "They faked the landing",
      });
    });
    expect(baseProps.onSubmitted).toHaveBeenCalled();
  });

  it("shows error on submit failure", async () => {
    mockSubmitReport.mockRejectedValue(new Error("Server error"));
    render(<ReportModal {...baseProps} />);
    await userEvent.selectOptions(screen.getByLabelText("REASON"), "spam");
    await userEvent.click(screen.getByText("Submit Report"));

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });
  });

  it("calls onClose on Cancel click", async () => {
    render(<ReportModal {...baseProps} />);
    await userEvent.click(screen.getByText("Cancel"));
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    render(<ReportModal {...baseProps} />);
    const dialog = screen.getByRole("dialog");
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it("calls onClose on overlay click", async () => {
    render(<ReportModal {...baseProps} />);
    await userEvent.click(screen.getByRole("dialog"));
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it("shows character count for description", () => {
    render(<ReportModal {...baseProps} />);
    expect(screen.getByText("0/500")).toBeInTheDocument();
  });

  it("shows Sending... while submitting", async () => {
    mockSubmitReport.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ReportModal {...baseProps} />);
    await userEvent.selectOptions(screen.getByLabelText("REASON"), "other");
    await userEvent.click(screen.getByText("Submit Report"));
    expect(screen.getByText("Sending...")).toBeInTheDocument();
  });
});
