import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UploadProgress } from "../UploadProgress";

describe("UploadProgress", () => {
  it("returns null when progress is null", () => {
    const { container } = render(<UploadProgress progress={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders progress bar with percentage", () => {
    render(<UploadProgress progress={{ percent: 50, bytesTransferred: 1048576, totalBytes: 2097152 }} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Uploading video...")).toBeInTheDocument();
  });

  it("shows MB transferred", () => {
    render(<UploadProgress progress={{ percent: 25, bytesTransferred: 524288, totalBytes: 2097152 }} />);
    expect(screen.getByText("0.5 / 2.0 MB")).toBeInTheDocument();
  });
});
