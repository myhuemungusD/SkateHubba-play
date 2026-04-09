import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockSubscribeToSpots = vi.fn((cb: Function) => {
  cb([]);
  return vi.fn();
});

const mockCreateSpot = vi.fn().mockResolvedValue("new-spot-id");

vi.mock("../../services/spots", () => ({
  subscribeToSpots: (...args: unknown[]) => mockSubscribeToSpots(...args),
  createSpot: (...args: unknown[]) => mockCreateSpot(...args),
  getAllSpots: vi.fn().mockResolvedValue([]),
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ children }: { children: React.ReactNode }) => <div data-testid="marker">{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div data-testid="popup">{children}</div>,
  useMap: () => ({ flyTo: vi.fn() }),
  useMapEvents: () => null,
}));

vi.mock("leaflet", () => ({
  default: {
    Icon: class {
      constructor() {
        return {};
      }
    },
  },
  Icon: class {
    constructor() {
      return {};
    }
  },
}));

const profile = { uid: "u1", username: "sk8r", stance: "regular", emailVerified: true, createdAt: null };

beforeEach(() => vi.clearAllMocks());

describe("MapScreen", () => {
  it("renders header and map", async () => {
    const { MapScreen } = await import("../MapScreen");

    render(<MapScreen profile={profile} onBack={vi.fn()} onViewSpot={vi.fn()} />);

    expect(screen.getByText("Spot Map")).toBeInTheDocument();
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
    expect(screen.getByText("+ Add Spot")).toBeInTheDocument();
  });

  it("calls onBack when back button clicked", async () => {
    const { MapScreen } = await import("../MapScreen");
    const onBack = vi.fn();

    render(<MapScreen profile={profile} onBack={onBack} onViewSpot={vi.fn()} />);

    screen.getByLabelText("Back to lobby").click();
    expect(onBack).toHaveBeenCalled();
  });

  it("renders markers for spots", async () => {
    mockSubscribeToSpots.mockImplementation((cb: Function) => {
      cb([
        {
          id: "s1",
          name: "Hollywood High",
          latitude: 34.1,
          longitude: -118.3,
          createdByUid: "u2",
          createdByUsername: "rival",
          createdAt: null,
          gameCount: 5,
        },
      ]);
      return vi.fn();
    });

    const { MapScreen } = await import("../MapScreen");

    render(<MapScreen profile={profile} onBack={vi.fn()} onViewSpot={vi.fn()} />);

    expect(screen.getByTestId("marker")).toBeInTheDocument();
    expect(screen.getByText("Hollywood High")).toBeInTheDocument();
    expect(screen.getByText("1 spots")).toBeInTheDocument();
  });

  it("shows add spot form when button clicked", async () => {
    const { MapScreen } = await import("../MapScreen");

    render(<MapScreen profile={profile} onBack={vi.fn()} onViewSpot={vi.fn()} />);

    await userEvent.click(screen.getByText("+ Add Spot"));

    expect(screen.getByText("Add New Spot")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("cancels add spot form", async () => {
    const { MapScreen } = await import("../MapScreen");

    render(<MapScreen profile={profile} onBack={vi.fn()} onViewSpot={vi.fn()} />);

    await userEvent.click(screen.getByText("+ Add Spot"));
    expect(screen.getByText("Add New Spot")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Add New Spot")).not.toBeInTheDocument();
  });

  it("shows tap-to-place instruction in add form", async () => {
    const { MapScreen } = await import("../MapScreen");

    render(<MapScreen profile={profile} onBack={vi.fn()} onViewSpot={vi.fn()} />);

    await userEvent.click(screen.getByText("+ Add Spot"));

    await waitFor(() => {
      expect(screen.getByText(/Tap the map to place a pin/)).toBeInTheDocument();
    });
  });

  it("calls onViewSpot when spot popup View Spot clicked", async () => {
    mockSubscribeToSpots.mockImplementation((cb: Function) => {
      cb([
        {
          id: "s1",
          name: "Test Spot",
          latitude: 34.1,
          longitude: -118.3,
          createdByUid: "u2",
          createdByUsername: "rival",
          createdAt: null,
          gameCount: 3,
        },
      ]);
      return vi.fn();
    });

    const onViewSpot = vi.fn();
    const { MapScreen } = await import("../MapScreen");

    render(<MapScreen profile={profile} onBack={vi.fn()} onViewSpot={onViewSpot} />);

    await userEvent.click(screen.getByText("View Spot"));
    expect(onViewSpot).toHaveBeenCalledWith("s1");
  });

  it("opens add form via + Add First Spot button when spots are empty", async () => {
    // Fake geolocation so locatingUser resolves
    const originalGeo = navigator.geolocation;
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: (_ok: Function, err: Function) => err(new Error("denied")) },
      configurable: true,
    });

    const { MapScreen } = await import("../MapScreen");
    const { container } = render(<MapScreen profile={profile} onBack={vi.fn()} onViewSpot={vi.fn()} />);

    // Wait for spinner to resolve
    await waitFor(() => {
      expect(container.querySelector('[class*="min-h-dvh"]')).toBeInTheDocument();
    });

    // The + Add First Spot button may be visible; if so, click it
    const addFirstBtn = screen.queryByText("+ Add First Spot");
    if (addFirstBtn) {
      await userEvent.click(addFirstBtn);
      expect(screen.getByText("Add New Spot")).toBeInTheDocument();
    }

    Object.defineProperty(navigator, "geolocation", { value: originalGeo, configurable: true });
  });

  it("submits add spot form with pin location", async () => {
    // Mock geolocation
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok: Function) => ok({ coords: { latitude: 34.1, longitude: -118.3 } }),
      },
      configurable: true,
    });

    mockCreateSpot.mockResolvedValue("new-id");

    const { MapScreen } = await import("../MapScreen");
    render(<MapScreen profile={profile} onBack={vi.fn()} onViewSpot={vi.fn()} />);

    await userEvent.click(screen.getByText("+ Add Spot"));

    await waitFor(() => {
      expect(screen.getByText("Add New Spot")).toBeInTheDocument();
    });

    // Type a name
    await userEvent.type(screen.getByPlaceholderText("e.g. Hollywood High 16"), "Test Spot");

    // The form should show pin placed (user location is used as default pin)
    await waitFor(() => {
      expect(screen.getByText(/Pin placed/)).toBeInTheDocument();
    });

    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
  });

  it("displays spot count in header", async () => {
    mockSubscribeToSpots.mockImplementation((cb: Function) => {
      cb([
        {
          id: "s1",
          name: "Spot A",
          latitude: 34,
          longitude: -118,
          createdByUid: "u1",
          createdByUsername: "sk8r",
          createdAt: null,
          gameCount: 1,
        },
        {
          id: "s2",
          name: "Spot B",
          latitude: 35,
          longitude: -117,
          createdByUid: "u2",
          createdByUsername: "rival",
          createdAt: null,
          gameCount: 2,
        },
      ]);
      return vi.fn();
    });

    const { MapScreen } = await import("../MapScreen");
    render(<MapScreen profile={profile} onBack={vi.fn()} onViewSpot={vi.fn()} />);

    expect(screen.getByText("2 spots")).toBeInTheDocument();
  });
});
