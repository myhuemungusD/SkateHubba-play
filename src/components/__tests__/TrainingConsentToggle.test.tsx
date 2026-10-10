import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrainingConsentToggle } from "../TrainingConsentToggle";

const { getTrainingConsent, setTrainingConsent, isAdultForTraining } = vi.hoisted(() => ({
  getTrainingConsent: vi.fn(),
  setTrainingConsent: vi.fn(),
  isAdultForTraining: vi.fn((_dob: string | null) => true),
}));

vi.mock("../../services/trainingConsent", () => ({
  getTrainingConsent: (...args: unknown[]) => getTrainingConsent(...args),
  setTrainingConsent: (...args: unknown[]) => setTrainingConsent(...args),
  isAdultForTraining: (dob: string | null) => isAdultForTraining(dob),
  TrainingConsentDeniedError: class TrainingConsentDeniedError extends Error {},
}));

import { TrainingConsentDeniedError } from "../../services/trainingConsent";

const adult = {
  optedIn: false,
  policyVersion: null as string | null,
  updatedAtMs: null as number | null,
  revokedAtMs: null as number | null,
  promptSeenAtMs: null as number | null,
  dob: "1990-01-01",
};

beforeEach(() => {
  vi.clearAllMocks();
  isAdultForTraining.mockReturnValue(true);
  getTrainingConsent.mockResolvedValue(adult);
  setTrainingConsent.mockResolvedValue(undefined);
});

describe("TrainingConsentToggle", () => {
  it("loads off for an adult and saves a turn-on", async () => {
    render(<TrainingConsentToggle uid="u1" />);
    const toggle = await screen.findByRole("switch", { name: "Help train SkateHubba's trick AI" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(setTrainingConsent).toHaveBeenCalledWith("u1", true));
  });

  it("locks the control for players under 18", async () => {
    isAdultForTraining.mockReturnValue(false);
    render(<TrainingConsentToggle uid="u1" />);
    expect(await screen.findByText("Players under 18 can't opt in.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Help train SkateHubba's trick AI" })).toBeDisabled();
  });

  it("shows a load error and restores the switch when a save fails", async () => {
    getTrainingConsent.mockRejectedValueOnce(new Error("offline"));
    const { unmount } = render(<TrainingConsentToggle uid="u1" />);
    expect(await screen.findByText("Couldn't load this setting.")).toBeInTheDocument();
    unmount();

    let resolveLoad: (value: typeof adult) => void = () => {};
    getTrainingConsent.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const pending = render(<TrainingConsentToggle uid="u2" />);
    pending.unmount();
    await act(async () => {
      resolveLoad(adult);
    });

    getTrainingConsent.mockResolvedValue(adult);
    setTrainingConsent.mockRejectedValueOnce(
      new TrainingConsentDeniedError("Players under 18 can't opt in to trick training."),
    );
    render(<TrainingConsentToggle uid="u3" />);
    const toggle = await screen.findByRole("switch", { name: "Help train SkateHubba's trick AI" });
    await userEvent.click(toggle);
    expect(await screen.findByText("Players under 18 can't opt in to trick training.")).toBeInTheDocument();
    expect(toggle).not.toBeChecked();

    setTrainingConsent.mockRejectedValueOnce(new Error("permission-denied"));
    await userEvent.click(toggle);
    expect(await screen.findByText("Couldn't save that. Try again.")).toBeInTheDocument();
  });
});
