import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteAccountModal } from "../DeleteAccountModal";

describe("DeleteAccountModal", () => {
  const onClose = vi.fn();
  const onDeleteAccount = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    onDeleteAccount.mockResolvedValue(undefined);
  });

  it("renders modal with title and warning text", () => {
    render(<DeleteAccountModal onClose={onClose} onDeleteAccount={onDeleteAccount} />);
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
  });

  it("renders as a dialog", () => {
    render(<DeleteAccountModal onClose={onClose} onDeleteAccount={onDeleteAccount} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("calls onClose when Cancel is clicked", async () => {
    render(<DeleteAccountModal onClose={onClose} onDeleteAccount={onDeleteAccount} />);
    await userEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking the backdrop", async () => {
    render(<DeleteAccountModal onClose={onClose} onDeleteAccount={onDeleteAccount} />);
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the card", async () => {
    render(<DeleteAccountModal onClose={onClose} onDeleteAccount={onDeleteAccount} />);
    await userEvent.click(screen.getByText("Delete Account?"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onDeleteAccount and shows deleting state", async () => {
    let resolveDelete: () => void;
    onDeleteAccount.mockReturnValue(
      new Promise<void>((r) => {
        resolveDelete = r;
      }),
    );

    render(<DeleteAccountModal onClose={onClose} onDeleteAccount={onDeleteAccount} />);
    await userEvent.click(screen.getByText("Delete Forever"));

    expect(screen.getByText("Deleting...")).toBeInTheDocument();
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);

    // Buttons should be disabled during deletion
    expect(screen.getByText("Cancel")).toBeDisabled();
    expect(screen.getByText("Deleting...")).toBeDisabled();

    resolveDelete!();
  });

  it("shows error when deletion fails", async () => {
    onDeleteAccount.mockRejectedValue(new Error("Auth error"));

    render(<DeleteAccountModal onClose={onClose} onDeleteAccount={onDeleteAccount} />);
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Auth error")).toBeInTheDocument();
    });

    // Button should re-enable after failure
    expect(screen.getByText("Delete Forever")).not.toBeDisabled();
  });

  it("shows fallback error message for non-Error exceptions", async () => {
    onDeleteAccount.mockRejectedValue("some string");

    render(<DeleteAccountModal onClose={onClose} onDeleteAccount={onDeleteAccount} />);
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Deletion failed — try again")).toBeInTheDocument();
    });
  });

  it("does not call onClose when backdrop is clicked during deletion", async () => {
    onDeleteAccount.mockReturnValue(new Promise(() => {})); // never resolves

    render(<DeleteAccountModal onClose={onClose} onDeleteAccount={onDeleteAccount} />);
    await userEvent.click(screen.getByText("Delete Forever"));
    await userEvent.click(screen.getByRole("dialog"));

    expect(onClose).not.toHaveBeenCalled();
  });
});
