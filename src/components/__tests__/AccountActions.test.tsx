import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountActions } from "../AccountActions";
import { deferred } from "../../__tests__/harness/deferred";

/**
 * GDPR/CCPA account controls. Rehomed from the Lobby suite when the footer
 * moved into Settings: the data-export state machine (in-flight lock, error
 * surfacing, non-Error fallback) and the delete modal's integration with the
 * row that opens it. DeleteAccountModal.test.tsx owns the modal's own
 * internals (backdrop/inner-click propagation, non-Error fallback, deleting
 * state); nothing here re-asserts those.
 */

const downloadBtn = () => screen.getByRole("button", { name: /download my data/i });
const deleteRow = () => screen.getByRole("button", { name: /^Delete account/ });

async function openDeleteModal(): Promise<HTMLElement> {
  await userEvent.click(deleteRow());
  expect(screen.getByText("Delete Account?")).toBeInTheDocument();
  return screen.getByRole("dialog");
}

describe("AccountActions", () => {
  const onDeleteAccount = vi.fn<() => Promise<void>>();

  beforeEach(() => {
    vi.clearAllMocks();
    onDeleteAccount.mockResolvedValue(undefined);
  });

  describe("data export", () => {
    it("hides the Download my data row when no handler is provided", () => {
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      expect(screen.queryByRole("button", { name: /download my data/i })).not.toBeInTheDocument();
    });

    it("invokes onDownloadData when the row is clicked", async () => {
      const onDownloadData = vi.fn().mockResolvedValue(undefined);
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());

      await waitFor(() => expect(onDownloadData).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("stays quiet when the saved file is complete", async () => {
      const onDownloadData = vi.fn().mockResolvedValue({ missingSections: [], truncatedSections: [] });
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());

      await waitFor(() => expect(onDownloadData).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("says what the file leaves out and where to ask for it, even when it is complete", async () => {
      const onDownloadData = vi.fn().mockResolvedValue({ missingSections: [], truncatedSections: [] });
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());

      const note = await screen.findByRole("status");
      expect(note).toHaveTextContent(/^This file doesn't include daily closet limits, .+ and your pro reviews\./);
      expect(note).toHaveTextContent("To get a copy of those, email privacy@skatehubba.com.");
      expect(downloadBtn()).not.toContainElement(note);
      expect(document.getElementById(downloadBtn().getAttribute("aria-describedby") as string)).toContainElement(note);
    });

    it("shows no not-included note when the export fails", async () => {
      const onDownloadData = vi.fn().mockRejectedValueOnce(new Error("network down"));
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());

      await screen.findByRole("alert");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("warns in plain words when the saved file is missing sections", async () => {
      const onDownloadData = vi
        .fn()
        .mockResolvedValue({ missingSections: ["clips", "notifications"], truncatedSections: [] });
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "Your data file is ready, but some of it is missing. We couldn't load all of your clips and " +
          "notifications this time, so that part of the file may be empty or incomplete. Try again in a few " +
          "minutes. If you need a complete copy, email privacy@skatehubba.com.",
      );
    });

    it("says when a list was too long to fit in full", async () => {
      const onDownloadData = vi.fn().mockResolvedValue({ missingSections: [], truncatedSections: ["notifications"] });
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Your data file is ready, but some of it is missing. You have more than 5,000 items in your " +
          "notifications, so the file holds the first 5,000. If you need a complete copy, email privacy@skatehubba.com.",
      );
    });

    it("keeps messages outside the button so screen readers announce them", async () => {
      const onDownloadData = vi.fn().mockResolvedValue({ missingSections: ["games"], truncatedSections: [] });
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());

      const warning = await screen.findByRole("alert");
      expect(downloadBtn()).not.toContainElement(warning);
      // Tied to the button so it is read as the button's description.
      const describedBy = downloadBtn().getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy as string)).toContainElement(warning);
      expect(downloadBtn()).toHaveAccessibleName(/^Download my data/);
      expect(downloadBtn()).not.toHaveAccessibleName(/missing/);
    });

    it("clears an old missing-sections warning when the next export is complete", async () => {
      const onDownloadData = vi
        .fn()
        .mockResolvedValueOnce({ missingSections: ["games"], truncatedSections: [] })
        .mockResolvedValueOnce({ missingSections: [], truncatedSections: [] });
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());
      await screen.findByRole("alert");
      await userEvent.click(downloadBtn());

      await waitFor(() => expect(onDownloadData).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    it("surfaces the export error message", async () => {
      const onDownloadData = vi.fn().mockRejectedValueOnce(new Error("network down"));
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("network down"));
      expect(downloadBtn()).not.toBeDisabled();
    });

    it("falls back to a generic message when the export error is not an Error", async () => {
      const onDownloadData = vi.fn().mockRejectedValueOnce("boom");
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Export failed — try again"));
    });

    it("clears a previous error when a retry starts", async () => {
      const onDownloadData = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(undefined);
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());
      await screen.findByRole("alert");

      await userEvent.click(downloadBtn());

      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      expect(onDownloadData).toHaveBeenCalledTimes(2);
    });

    it("disables the row while an export is in flight so a second tap cannot re-enter", async () => {
      const pending = deferred<void>();
      const onDownloadData = vi.fn().mockReturnValue(pending.promise);
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());
      await waitFor(() => expect(downloadBtn()).toBeDisabled());
      expect(downloadBtn()).toHaveTextContent("Preparing your data…");

      // The `downloading` early-return inside handleDownload is unreachable
      // through the UI: React drops clicks on a disabled button. What this
      // pins is the disabled state itself — the user-facing re-entrancy lock.
      await userEvent.click(downloadBtn());

      pending.resolve();
      await waitFor(() => expect(downloadBtn()).not.toBeDisabled());
      expect(downloadBtn()).toHaveTextContent("Exports your profile");
      expect(onDownloadData).toHaveBeenCalledTimes(1);
    });
  });

  describe("account deletion", () => {
    it("hides the Delete account row (and modal) when no handler is provided", () => {
      const { container } = render(<AccountActions onDownloadData={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /^Delete account/ })).not.toBeInTheDocument();
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it("renders nothing at all when both handlers are omitted", () => {
      const { container } = render(<AccountActions />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(container.firstElementChild).toBeEmptyDOMElement();
    });

    it("Delete account trigger has type='button'", () => {
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      expect(deleteRow()).toHaveAttribute("type", "button");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("opens the delete modal from the row", async () => {
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      await openDeleteModal();
      expect(screen.getByText("Delete Forever")).toBeInTheDocument();
    });

    // The modal's own suite asserts onClose is CALLED; these two prove this
    // component's wiring actually unmounts it.
    it("overlay click closes the modal", async () => {
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      const dialog = await openDeleteModal();

      await userEvent.click(dialog);

      await waitFor(() => expect(screen.queryByText("Delete Account?")).not.toBeInTheDocument());
    });

    it("Escape key closes the modal", async () => {
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      await openDeleteModal();

      // Focus is trapped inside the dialog (Cancel autofocuses), so the key
      // bubbles to the dialog's onKeyDown.
      await userEvent.keyboard("{Escape}");

      await waitFor(() => expect(screen.queryByText("Delete Account?")).not.toBeInTheDocument());
    });

    it("does not close while deletion is in flight", async () => {
      onDeleteAccount.mockImplementation(() => new Promise(() => {}));
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      const dialog = await openDeleteModal();
      await userEvent.click(screen.getByText("Delete Forever"));
      await waitFor(() => expect(screen.getByText("Deleting...")).toBeInTheDocument());

      await userEvent.click(dialog);
      expect(screen.getByText("Delete Account?")).toBeInTheDocument();

      await userEvent.keyboard("{Escape}");
      expect(screen.getByText("Delete Account?")).toBeInTheDocument();
    });

    it("delete error shows in the modal and can be dismissed", async () => {
      onDeleteAccount.mockRejectedValueOnce(new Error("Delete failed"));
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      await openDeleteModal();
      await userEvent.click(screen.getByText("Delete Forever"));

      await waitFor(() => expect(screen.getByText("Delete failed")).toBeInTheDocument());

      await userEvent.click(screen.getByText("×"));
      expect(screen.queryByText("Delete failed")).not.toBeInTheDocument();
    });
  });
  describe("sign out", () => {
    it("hides the Sign out row when no handler is provided", () => {
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      expect(screen.queryByRole("button", { name: /^Sign out/ })).not.toBeInTheDocument();
    });

    it("asks first, and Cancel keeps the user signed in", async () => {
      const onSignOut = vi.fn();
      render(<AccountActions onSignOut={onSignOut} />);
      await userEvent.click(screen.getByRole("button", { name: /^Sign out/ }));
      expect(screen.getByRole("alertdialog", { name: "Sign out?" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(onSignOut).not.toHaveBeenCalled();
    });

    it("signs out once the user confirms", async () => {
      const onSignOut = vi.fn();
      render(<AccountActions onSignOut={onSignOut} />);
      await userEvent.click(screen.getByRole("button", { name: /^Sign out/ }));
      const dialog = screen.getByRole("alertdialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
      expect(onSignOut).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });
});
