import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportModal } from "../ReportModal";

const mockSubmitReport = vi.fn();

vi.mock("../../services/reports", () => ({
  submitReport: (...args: unknown[]) => mockSubmitReport(...args),
  ILLEGAL_CONTENT_MIN_EXPLANATION: 20,
  COMMENT_REPORT_REASONS: ["abusive_behavior", "spam", "illegal_content", "other"],
  REPORT_REASON_LABELS: {
    inappropriate_video: "Inappropriate video content",
    abusive_behavior: "Abusive or threatening behavior",
    cheating: "Cheating or exploiting",
    spam: "Spam or bot activity",
    non_skate_content: "Not skateboarding",
    illegal_content: "Illegal content",
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
    await userEvent.selectOptions(screen.getByLabelText("Reason"), "cheating");
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
    expect(baseProps.onSubmitted).not.toHaveBeenCalled();
    expect(screen.getByText("We received your report")).toBeInTheDocument();
    expect(screen.getByTestId("report-receipt-id")).toHaveTextContent("Reference r1");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(baseProps.onSubmitted).toHaveBeenCalled();
  });

  it("requires a 20-character explanation for illegal content", async () => {
    render(<ReportModal {...baseProps} />);
    await userEvent.selectOptions(screen.getByLabelText("Reason"), "illegal_content");
    expect(screen.getByLabelText("EXPLANATION (REQUIRED)")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("EXPLANATION (REQUIRED)"), "too short");
    expect(screen.getByText("Submit Report")).toBeDisabled();
  });

  it("submits an illegal-content report once the explanation is long enough", async () => {
    render(<ReportModal {...baseProps} />);
    await userEvent.selectOptions(screen.getByLabelText("Reason"), "illegal_content");
    await userEvent.type(screen.getByLabelText("EXPLANATION (REQUIRED)"), "This clip contains illegal content.");
    await userEvent.click(screen.getByText("Submit Report"));
    await waitFor(() =>
      expect(mockSubmitReport).toHaveBeenCalledWith(expect.objectContaining({ reason: "illegal_content" })),
    );
    expect(screen.getByText("We received your report")).toBeInTheDocument();
  });

  it("confirms the receipt on Escape", async () => {
    render(<ReportModal {...baseProps} />);
    await userEvent.selectOptions(screen.getByLabelText("Reason"), "spam");
    await userEvent.click(screen.getByText("Submit Report"));
    const dialog = await screen.findByRole("dialog");
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(baseProps.onSubmitted).toHaveBeenCalled();
  });

  it("confirms the receipt when the overlay is clicked", async () => {
    render(<ReportModal {...baseProps} />);
    await userEvent.selectOptions(screen.getByLabelText("Reason"), "spam");
    await userEvent.click(screen.getByText("Submit Report"));
    await screen.findByText("We received your report");
    await userEvent.click(screen.getByRole("dialog"));
    expect(baseProps.onSubmitted).toHaveBeenCalled();
  });

  it("shows error on submit failure", async () => {
    mockSubmitReport.mockRejectedValue(new Error("Server error"));
    render(<ReportModal {...baseProps} />);
    await userEvent.selectOptions(screen.getByLabelText("Reason"), "spam");
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
    await userEvent.selectOptions(screen.getByLabelText("Reason"), "other");
    await userEvent.click(screen.getByText("Submit Report"));
    expect(screen.getByText("Sending...")).toBeInTheDocument();
  });
});

describe("ReportModal — user-clip reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitReport.mockResolvedValue("r1");
  });

  it("offers the non-skate-content reason — the one a feed clip is usually reported for", async () => {
    const user = userEvent.setup();
    render(<ReportModal {...baseProps} />);

    await user.selectOptions(screen.getByRole("combobox"), "non_skate_content");

    expect(screen.getByRole("option", { name: "Not skateboarding" })).toBeInTheDocument();
    await user.click(screen.getByText("Submit Report"));
    await waitFor(() =>
      expect(mockSubmitReport).toHaveBeenCalledWith(expect.objectContaining({ reason: "non_skate_content" })),
    );
  });

  it("passes a reported comment through to the report", async () => {
    const user = userEvent.setup();
    render(<ReportModal {...baseProps} clipId="userclip1" comment={{ id: "cm1", text: "rude" }} />);

    await user.selectOptions(screen.getByRole("combobox"), "abusive_behavior");
    await user.click(screen.getByText("Submit Report"));

    await waitFor(() =>
      expect(mockSubmitReport).toHaveBeenCalledWith(
        expect.objectContaining({ clipId: "userclip1", comment: { id: "cm1", text: "rude" } }),
      ),
    );
  });

  it("quotes the comment and offers only comment reasons", () => {
    render(<ReportModal {...baseProps} clipId="userclip1" comment={{ id: "cm1", text: "rude" }} />);
    expect(screen.getByRole("heading", { name: "Report comment by @bob" })).toBeInTheDocument();
    expect(screen.getByTestId("report-comment-quote")).toHaveTextContent("rude");
    const options = screen.getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options).toEqual(["", "abusive_behavior", "spam", "illegal_content", "other"]);
  });

  it("titles a report on a comment with no stored handle without an empty @", () => {
    render(<ReportModal {...baseProps} reportedUsername="" spotId="s1" comment={{ id: "cm1", text: "rude" }} />);
    expect(screen.getByRole("heading", { name: "Report this comment" })).toBeInTheDocument();
  });

  it.each([
    [
      { spotId: "s1", message: { id: "m1", text: "rude msg" } },
      { spotId: "s1", message: { id: "m1", text: "rude msg" } },
    ],
    [{ profile: true }, { profile: true, gameId: null }],
  ])("passes a chat message or profile target through (%o)", async (props, expected) => {
    const user = userEvent.setup();
    render(<ReportModal {...baseProps} gameId={null} {...props} />);
    await user.selectOptions(screen.getByRole("combobox"), "spam");
    await user.click(screen.getByText("Submit Report"));
    await waitFor(() => expect(mockSubmitReport).toHaveBeenCalledWith(expect.objectContaining(expected)));
  });

  it("quotes a chat message under its own title, with or without a handle", () => {
    const { unmount } = render(<ReportModal {...baseProps} spotId="s1" message={{ id: "m1", text: "rude msg" }} />);
    expect(screen.getByRole("heading", { name: "Report message by @bob" })).toBeInTheDocument();
    expect(screen.getByTestId("report-comment-quote")).toHaveTextContent("rude msg");
    expect(screen.getAllByRole("option")).toHaveLength(5);
    unmount();
    render(<ReportModal {...baseProps} reportedUsername="" spotId="s1" message={{ id: "m1", text: "x" }} />);
    expect(screen.getByRole("heading", { name: "Report this message" })).toBeInTheDocument();
  });

  it("sends a null gameId when reporting a clip that belongs to no game", async () => {
    const user = userEvent.setup();
    const { gameId: _omitted, ...noGame } = baseProps;
    render(<ReportModal {...noGame} clipId="userclip1" />);

    await user.selectOptions(screen.getByRole("combobox"), "non_skate_content");
    await user.click(screen.getByText("Submit Report"));

    await waitFor(() =>
      expect(mockSubmitReport).toHaveBeenCalledWith(expect.objectContaining({ gameId: null, clipId: "userclip1" })),
    );
  });
});
