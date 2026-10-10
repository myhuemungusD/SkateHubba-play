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
    expect(text).toContain('open Settings and tap "Download my data"');
    expect(text).toContain('open Settings and tap "Delete account"');
    expect(text.toLowerCase()).not.toContain("lobby");
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    render(<DataDeletion onBack={onBack} />);
    await userEvent.click(screen.getByText("← Back"));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
