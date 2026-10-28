import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataDeletion } from "../DataDeletion";

describe("DataDeletion", () => {
  it("renders heading and brand logo", () => {
    render(<DataDeletion onBack={vi.fn()} />);
    expect(screen.getByText("Data Deletion")).toBeInTheDocument();
    expect(document.querySelector('img[src="/logonew.webp"]')).toBeInTheDocument();
  });

  it("points export and deletion at Settings", () => {
    render(<DataDeletion onBack={vi.fn()} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain('under "Your data & sign out", tap "Download my data"');
    expect(text).toContain("comments and spot chat");
    expect(text).toContain("the spots you added, including ones no longer on the map");
    expect(text).toContain("If any part can't be read, or is too long to fit in full, the file says which.");
    // Not "everything": the file names what it leaves out, and how to get it.
    expect(text).toContain("a machine-readable copy of your account data");
    expect(text).not.toContain("everything we store");
    expect(text).toContain("aren't in the file yet; the file lists them");
    expect(text).toContain('under "Your data & sign out", tap "Delete account"');
    expect(text).not.toContain("under Account");
    expect(text.toLowerCase()).not.toContain("lobby");
  });

  it("does not claim the export holds everything", () => {
    render(<DataDeletion onBack={vi.fn()} />);
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).not.toContain("everything we store");
    expect(text).toContain("The file does not yet include everything we hold.");
    expect(text).toContain("To get a copy of those, email privacy@skatehubba.com.");
    // Comments, spot chat and check-ins are in the file now (registry reads), so nothing says they're left out.
    expect(text).not.toContain("are left out");
  });

  it("shows the same after-deletion facts as the Privacy Policy", () => {
    render(<DataDeletion onBack={vi.fn()} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Kept with your name removed");
    expect(text).toContain("daily database backups expire within 7 days");
    expect(text).toContain("We tell PostHog to delete your analytics profile and its events");
    expect(text).toContain("If that request fails, we're alerted and send it again");
    expect(text).toContain("Pro blessing records you gave or received, including the usernames on them");
    expect(text).not.toContain("Events already sent to PostHog");
    expect(text).not.toContain("within 90 days of the game ending");
    expect(text).not.toContain("All game records");
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    render(<DataDeletion onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
