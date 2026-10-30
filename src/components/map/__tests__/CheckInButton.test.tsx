import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";

const auth = vi.hoisted(() => ({ value: { user: { uid: "u1" } as { uid: string } | null } }));
const svc = vi.hoisted(() => ({ checkIn: vi.fn() }));
vi.mock("../../../context/AuthContext", () => ({ useAuthContext: () => auth.value }));
vi.mock("../../../services/mapCheckins", async (orig) => {
  const real = await orig<typeof import("../../../services/mapCheckins")>();
  return { ...real, checkInAtSpot: svc.checkIn };
});

const presence = vi.hoisted(() => ({ remember: vi.fn(() => true) }));
vi.mock("../../../services/spotPresence", () => ({ rememberIfPassed: presence.remember }));

import { CheckInButton } from "../CheckInButton";
import { LocationError } from "../../../services/mapCheckins";

function renderIt() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<CheckInButton spot={{ id: "s1" }} />} />
        <Route path="/auth" element={<div>auth page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  svc.checkIn.mockReset();
  auth.value = { user: { uid: "u1" } };
});

describe("CheckInButton", () => {
  it("sends signed-out visitors to sign in", async () => {
    auth.value = { user: null };
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: "Sign in to check in" }));
    expect(screen.getByText("auth page")).toBeInTheDocument();
  });

  it("checks in and shows the result", async () => {
    svc.checkIn.mockResolvedValueOnce({
      queued: false,
      result: { code: "ok", xp: 50, newSpot: true, pioneer: false, badgeId: null, rewardsPaused: false },
    });
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: "Check in" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Checked in! +50 XP."));
    expect(svc.checkIn).toHaveBeenCalledWith({ id: "s1" });
  });

  it("shows location errors as-is and other errors generically", async () => {
    svc.checkIn.mockRejectedValueOnce(new LocationError("Allow location"));
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: "Check in" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Allow location"));
    svc.checkIn.mockRejectedValueOnce(new Error("x"));
    await userEvent.click(screen.getByRole("button", { name: "Check in" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Check-in failed. Try again."));
  });

  it("remembers a passed check-in for spot presence only when that feature is on", async () => {
    const outcome = {
      queued: false,
      result: { code: "ok", xp: 10, newSpot: false, pioneer: false, badgeId: null, rewardsPaused: false },
    };
    svc.checkIn.mockResolvedValue(outcome);
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: "Check in" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Checked in! +10 XP."));
    expect(presence.remember).not.toHaveBeenCalled();

    vi.stubEnv("VITE_FEATURE_SPOT_PRESENCE", "true");
    await userEvent.click(screen.getByRole("button", { name: "Check in" }));
    await waitFor(() => expect(presence.remember).toHaveBeenCalledWith({ id: "s1" }, outcome));
  });
});
