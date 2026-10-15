import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { isValidLatLng, isValidPhotoUrl, parseCoord } from "../addSpotHelpers";
import { AddSpotDetailsStep } from "../AddSpotDetailsStep";
import { AddSpotPhotosStep } from "../AddSpotPhotosStep";

describe("addSpotHelpers", () => {
  it("accepts only parseable https photo URLs", () => {
    expect(isValidPhotoUrl("https://example.com/a.jpg")).toBe(true);
    expect(isValidPhotoUrl("http://example.com/a.jpg")).toBe(false);
    expect(isValidPhotoUrl("not a url")).toBe(false);
  });

  it("parses coordinates, keeping NaN for half-typed input", () => {
    expect(parseCoord("12.5")).toBe(12.5);
    expect(parseCoord("-")).toBeNaN();
  });

  it.each([
    [0, 0, true],
    [90, 180, true],
    [-90, -180, true],
    [91, 0, false],
    [0, -181, false],
    [Number.NaN, 0, false],
    [0, Number.POSITIVE_INFINITY, false],
  ])("isValidLatLng(%s, %s) is %s", (lat, lng, ok) => {
    expect(isValidLatLng(lat, lng)).toBe(ok);
  });
});

function detailsProps(overrides: Partial<Parameters<typeof AddSpotDetailsStep>[0]> = {}) {
  return {
    name: "",
    setName: vi.fn(),
    nameError: null,
    setNameError: vi.fn(),
    description: "",
    setDescription: vi.fn(),
    obstacles: [],
    toggleObstacle: vi.fn(),
    gnarRating: 3 as const,
    setGnarRating: vi.fn(),
    bustRisk: 1 as const,
    setBustRisk: vi.fn(),
    canProceedStep2: true,
    onNext: vi.fn(),
    ...overrides,
  };
}

describe("AddSpotDetailsStep", () => {
  it("validates the name as it is typed", () => {
    const props = detailsProps();
    render(<AddSpotDetailsStep {...props} />);
    const input = screen.getByPlaceholderText("e.g. Hollywood High 16");
    fireEvent.change(input, { target: { value: "Ledge" } });
    expect(props.setName).toHaveBeenLastCalledWith("Ledge");
    expect(props.setNameError).toHaveBeenLastCalledWith(null);
    fireEvent.change(input, { target: { value: "   " } });
    expect(props.setNameError).toHaveBeenLastCalledWith("Name is required");
  });

  it("shows the name error, highlights picked obstacles and advances", () => {
    const props = detailsProps({ nameError: "Name is required", obstacles: ["rail"] });
    render(<AddSpotDetailsStep {...props} />);
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("What makes this spot special?"), { target: { value: "wax" } });
    expect(props.setDescription).toHaveBeenCalledWith("wax");
    fireEvent.click(screen.getByRole("button", { name: "rail" }));
    expect(props.toggleObstacle).toHaveBeenCalledWith("rail");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });
});

function photosProps(overrides: Partial<Parameters<typeof AddSpotPhotosStep>[0]> = {}) {
  return {
    photoUrls: [],
    photoInput: "",
    setPhotoInput: vi.fn(),
    addPhotoUrl: vi.fn(),
    removePhoto: vi.fn(),
    photoError: null,
    submitting: false,
    onSubmit: vi.fn(),
    ...overrides,
  };
}

describe("AddSpotPhotosStep", () => {
  it("adds, removes and submits photos", () => {
    const props = photosProps({ photoUrls: ["https://example.com/a.jpg"], photoInput: "https://example.com/b.jpg" });
    render(<AddSpotPhotosStep {...props} />);
    fireEvent.change(screen.getByPlaceholderText("https://..."), { target: { value: "https://x" } });
    expect(props.setPhotoInput).toHaveBeenCalledWith("https://x");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(props.addPhotoUrl).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    expect(props.removePhoto).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Submit Spot" }));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("hides the input at five photos and shows the error and submitting state", () => {
    const urls = Array.from({ length: 5 }, (_, i) => `https://example.com/${i}.jpg`);
    render(<AddSpotPhotosStep {...photosProps({ photoUrls: urls, photoError: "bad url", submitting: true })} />);
    expect(screen.queryByPlaceholderText("https://...")).toBeNull();
    expect(screen.getByText("bad url")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
  });
});
