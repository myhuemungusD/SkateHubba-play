import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockGetModes, mockSetQuality } = vi.hoisted(() => ({
  mockGetModes: vi.fn(),
  mockSetQuality: vi.fn(async () => true),
}));

vi.mock("../../services/nativeVideo", () => ({
  getNativeQualityModes: mockGetModes,
  setNativeQuality: mockSetQuality,
}));

import { CameraQualitySelector } from "../CameraQualitySelector";

describe("CameraQualitySelector", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when inactive or only one mode available", async () => {
    mockGetModes.mockResolvedValue({ modes: ["standard1080p60"], current: "standard1080p60" });
    const { container, rerender } = render(<CameraQualitySelector active={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CameraQualitySelector active />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("shows available quality modes and switches between them", async () => {
    mockGetModes.mockResolvedValue({
      modes: ["standard1080p60", "pro4k60", "slomo120"],
      current: "standard1080p60",
    });
    render(<CameraQualitySelector active />);
    const btn = await screen.findByLabelText(/Current quality: 1080p60/);
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    const mode4k = await screen.findByRole("menuitem", { name: /4K60/ });
    fireEvent.click(mode4k);
    expect(mockSetQuality).toHaveBeenCalledWith("pro4k60");
  });

  it("closes the menu when clicking outside", async () => {
    mockGetModes.mockResolvedValue({
      modes: ["standard1080p60", "slomo240"],
      current: "standard1080p60",
    });
    render(<CameraQualitySelector active />);
    const btn = await screen.findByLabelText(/Current quality/);
    fireEvent.click(btn);
    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();
    const backdrop = menu.previousElementSibling;
    expect(backdrop).toHaveClass("fixed", "inset-0");
    fireEvent.click(backdrop!);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
