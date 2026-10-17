import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserProfile } from "../../services/users";
import { TrainingConsentPrompt } from "../TrainingConsentPrompt";

const { getTrainingConsent, setTrainingConsent, markTrainingConsentPromptSeen, shouldPromptTrainingConsent } =
  vi.hoisted(() => ({
    getTrainingConsent: vi.fn(),
    setTrainingConsent: vi.fn(),
    markTrainingConsentPromptSeen: vi.fn(),
    shouldPromptTrainingConsent: vi.fn(),
  }));

vi.mock("../../services/trainingConsent", () => ({
  getTrainingConsent: (...args: unknown[]) => getTrainingConsent(...args),
  setTrainingConsent: (...args: unknown[]) => setTrainingConsent(...args),
  markTrainingConsentPromptSeen: (...args: unknown[]) => markTrainingConsentPromptSeen(...args),
  shouldPromptTrainingConsent: (...args: unknown[]) => shouldPromptTrainingConsent(...args),
  TrainingConsentDeniedError: class TrainingConsentDeniedError extends Error {},
}));

import { TrainingConsentDeniedError } from "../../services/trainingConsent";

const profile = { uid: "u1", username: "sk8r", gamesPlayed: 1 } as UserProfile;
const consent = {
  dob: "1990-01-01",
  optedIn: false,
  policyVersion: "2026-10-10" as string | null,
  updatedAtMs: null as number | null,
  revokedAtMs: null as number | null,
  promptSeenAtMs: null as number | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getTrainingConsent.mockResolvedValue(consent);
  shouldPromptTrainingConsent.mockReturnValue(true);
  setTrainingConsent.mockResolvedValue(undefined);
  markTrainingConsentPromptSeen.mockResolvedValue(undefined);
});

describe("TrainingConsentPrompt", () => {
  it("stays hidden when the skater should not be asked or the lookup fails", async () => {
    shouldPromptTrainingConsent.mockReturnValue(false);
    const { unmount } = render(<TrainingConsentPrompt profile={profile} />);
    expect(screen.queryByText("Help train SkateHubba's trick AI?")).not.toBeInTheDocument();
    unmount();

    getTrainingConsent.mockRejectedValueOnce(new Error("offline"));
    render(<TrainingConsentPrompt profile={{ ...profile, gamesPlayed: undefined, wins: 1, losses: 0 }} />);
    expect(screen.queryByText("Help train SkateHubba's trick AI?")).not.toBeInTheDocument();
  });

  it("opts in or dismisses, and explains a failed save", async () => {
    render(<TrainingConsentPrompt profile={profile} />);
    expect(await screen.findByText("Help train SkateHubba's trick AI?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(markTrainingConsentPromptSeen).toHaveBeenCalledWith("u1");
    cleanup();

    markTrainingConsentPromptSeen.mockRejectedValueOnce(new Error("nope"));
    render(<TrainingConsentPrompt profile={{ ...profile, uid: "u2" }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(await screen.findByText("Couldn't save that. You can decide later in Settings.")).toBeInTheDocument();
    cleanup();

    render(<TrainingConsentPrompt profile={{ ...profile, uid: "u3" }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Yes, I'll help" }));
    expect(setTrainingConsent).toHaveBeenCalledWith("u3", true);
    cleanup();

    setTrainingConsent.mockRejectedValueOnce(
      new TrainingConsentDeniedError("Players under 18 can't opt in to trick training."),
    );
    render(<TrainingConsentPrompt profile={{ ...profile, uid: "u4" }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Yes, I'll help" }));
    expect(await screen.findByText("Players under 18 can't opt in to trick training.")).toBeInTheDocument();
    cleanup();

    setTrainingConsent.mockRejectedValueOnce(new Error("offline"));
    render(<TrainingConsentPrompt profile={{ ...profile, uid: "u5" }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Yes, I'll help" }));
    expect(await screen.findByText("Couldn't save that. Try again in Settings.")).toBeInTheDocument();
  });
});
