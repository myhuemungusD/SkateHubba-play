import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountActions } from "../AccountActions";
import { deferred } from "../../__tests__/harness/deferred";

/**
 * GDPR/CCPA account controls. Rehomed from the Lobby suite when the footer
 * moved into Settings: the data-export state machine (in-flight lock, error
 * surfacing, non-Error fallback) and the delete modal's integration with the
 * row that opens it. DeleteAccountModal.test.tsx owns the modal's own
 * internals; here the modal is driven through this component's row.
 */

const downloadBtn = () => screen.getByRole("button", { name: /download a copy of my data/i });
const deleteRow = () => screen.getByRole("button", { name: /^Delete account/ });

async function openDeleteModal(): Promise<HTMLElement> {
  await userEvent.click(deleteRow());
  expect(screen.getByText("Delete Account?")).toBeInTheDocument();
  return screen.getByRole("dialog");
}

/** Fire a raw DOM event on the dialog backdrop, as the old Lobby suite did. */
async function dispatchOnDialog(dialog: HTMLElement, event: Event): Promise<void> {
  await act(async () => {
    dialog.dispatchEvent(event);
  });
}

const backdropClick = () => new MouseEvent("click", { bubbles: true });
const escapeKey = () => new KeyboardEvent("keydown", { key: "Escape", bubbles: true });

describe("AccountActions", () => {
  const onDeleteAccount = vi.fn<() => Promise<void>>();

  beforeEach(() => {
    vi.clearAllMocks();
    onDeleteAccount.mockResolvedValue(undefined);
  });

  describe("data export", () => {
    it("hides the Download my data row when no handler is provided", () => {
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      expect(screen.queryByRole("button", { name: /download a copy of my data/i })).not.toBeInTheDocument();
    });

    it("invokes onDownloadData when the row is clicked", async () => {
      const onDownloadData = vi.fn().mockResolvedValue(undefined);
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());

      await waitFor(() => expect(onDownloadData).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

    it("ignores re-clicks while an export is in flight", async () => {
      const pending = deferred<void>();
      const onDownloadData = vi.fn().mockReturnValue(pending.promise);
      render(<AccountActions onDownloadData={onDownloadData} />);

      await userEvent.click(downloadBtn());
      await waitFor(() => expect(downloadBtn()).toBeDisabled());
      expect(downloadBtn()).toHaveTextContent("Preparing your data…");

      // Disabled while loading, so the second click never reaches the handler.
      await userEvent.click(downloadBtn());

      pending.resolve();
      await waitFor(() => expect(downloadBtn()).not.toBeDisabled());
      expect(downloadBtn()).toHaveTextContent("Download my data");
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

    it("overlay click closes the modal", async () => {
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      const dialog = await openDeleteModal();

      await dispatchOnDialog(dialog, backdropClick());

      await waitFor(() => expect(screen.queryByText("Delete Account?")).not.toBeInTheDocument());
    });

    it("Escape key closes the modal", async () => {
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      const dialog = await openDeleteModal();

      await dispatchOnDialog(dialog, escapeKey());

      await waitFor(() => expect(screen.queryByText("Delete Account?")).not.toBeInTheDocument());
    });

    it("inner modal click stops propagation", async () => {
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      await openDeleteModal();

      await userEvent.click(screen.getByText("Delete Account?"));

      expect(screen.getByText("Delete Account?")).toBeInTheDocument();
    });

    it("does not close while deletion is in flight", async () => {
      onDeleteAccount.mockImplementation(() => new Promise(() => {}));
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      const dialog = await openDeleteModal();
      await userEvent.click(screen.getByText("Delete Forever"));
      await waitFor(() => expect(screen.getByText("Deleting...")).toBeInTheDocument());

      await dispatchOnDialog(dialog, backdropClick());
      expect(screen.getByText("Delete Account?")).toBeInTheDocument();

      await dispatchOnDialog(dialog, escapeKey());
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

    it("non-Error delete failure shows the fallback message", async () => {
      onDeleteAccount.mockRejectedValueOnce("string error");
      render(<AccountActions onDeleteAccount={onDeleteAccount} />);
      await openDeleteModal();
      await userEvent.click(screen.getByText("Delete Forever"));

      await waitFor(() => expect(screen.getByText("Deletion failed — try again")).toBeInTheDocument());
    });
  });
});
