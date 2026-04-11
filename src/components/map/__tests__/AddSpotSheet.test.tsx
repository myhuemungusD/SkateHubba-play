import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockCreateSpot = vi.fn();
const mockUseAuthContext = vi.fn();

vi.mock("../../../services/spots", () => ({
  createSpot: (...args: unknown[]) => mockCreateSpot(...args),
}));

vi.mock("../../../context/AuthContext", () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

import { AddSpotSheet } from "../AddSpotSheet";
import type { Spot } from "../../../types/spot";

const FAKE_USER = { uid: "creator-uid", emailVerified: true };

const FIXTURE_SPOT: Spot = {
  id: "11111111-2222-3333-4444-555555555555",
  createdBy: "creator-uid",
  name: "Hubba",
  description: null,
  latitude: 34.0522,
  longitude: -118.2437,
  gnarRating: 3,
  bustRisk: 1,
  obstacles: [],
  photoUrls: [],
  isVerified: false,
  isActive: true,
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-10T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuthContext.mockReturnValue({ user: FAKE_USER });
});

describe("AddSpotSheet", () => {
  it("renders step 1 (pin location) by default", () => {
    render(<AddSpotSheet userLocation={{ lat: 34.0522, lng: -118.2437 }} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByText("Pin Location")).toBeInTheDocument();
    expect(screen.getByText("Latitude")).toBeInTheDocument();
    expect(screen.getByText("Longitude")).toBeInTheDocument();
  });

  it("walks step 1 → step 2 → step 3 and submits via createSpot", async () => {
    mockCreateSpot.mockResolvedValueOnce(FIXTURE_SPOT);
    const onSuccess = vi.fn();
    render(<AddSpotSheet userLocation={{ lat: 34.0522, lng: -118.2437 }} onClose={vi.fn()} onSuccess={onSuccess} />);

    // Step 1 → 2
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Spot Details")).toBeInTheDocument();

    // Fill name
    const nameInput = screen.getByPlaceholderText(/Hollywood High/i);
    await userEvent.type(nameInput, "Hubba");

    // Step 2 → 3
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Photos")).toBeInTheDocument();

    // Submit
    await userEvent.click(screen.getByRole("button", { name: /Submit Spot/i }));

    await waitFor(() => {
      expect(mockCreateSpot).toHaveBeenCalledTimes(1);
    });
    const [req, uid] = mockCreateSpot.mock.calls[0];
    expect(uid).toBe("creator-uid");
    expect(req.name).toBe("Hubba");
    expect(req.latitude).toBeCloseTo(34.0522);
    expect(req.longitude).toBeCloseTo(-118.2437);
    expect(onSuccess).toHaveBeenCalledWith(FIXTURE_SPOT);
  });

  it("surfaces a service error message in the form", async () => {
    mockCreateSpot.mockRejectedValueOnce(new Error("Please wait before adding another spot"));
    render(<AddSpotSheet userLocation={{ lat: 34.0522, lng: -118.2437 }} onClose={vi.fn()} onSuccess={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByPlaceholderText(/Hollywood High/i), "Hubba");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: /Submit Spot/i }));

    await waitFor(() => {
      expect(screen.getByText(/wait before adding another/i)).toBeInTheDocument();
    });
  });

  it("blocks submit when the user is signed out", async () => {
    mockUseAuthContext.mockReturnValue({ user: null });
    render(<AddSpotSheet userLocation={{ lat: 34.0522, lng: -118.2437 }} onClose={vi.fn()} onSuccess={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByPlaceholderText(/Hollywood High/i), "Hubba");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: /Submit Spot/i }));

    await waitFor(() => {
      expect(screen.getByText(/signed in/i)).toBeInTheDocument();
    });
    expect(mockCreateSpot).not.toHaveBeenCalled();
  });

  it("toggles obstacle chips on and off", async () => {
    render(<AddSpotSheet userLocation={null} onClose={vi.fn()} onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    const ledge = screen.getByRole("button", { name: "ledge" });
    await userEvent.click(ledge);
    expect(ledge.className).toContain("F97316");
    await userEvent.click(ledge);
    expect(ledge.className).not.toContain("F97316");
  });
});
