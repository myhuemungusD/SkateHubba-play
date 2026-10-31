import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Hesher's #934 S2: game clips pinned before Fix A can never show, but they
 * still filled the 3 pin slots in the editor. This runs the real service +
 * hook + sheet over a mocked Firestore: 2 game pins + 1 user pin open as 1/3,
 * a new pin can be added, and Save writes the cleaned list.
 */
const h = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn() }));

vi.mock("firebase/firestore", async () =>
  (await import("../../../../../services/__tests__/profileCustomFirestore.test-helpers")).fakeProfileCustomFirestore(h),
);
vi.mock("../../../../../firebase", () => ({
  requireAuth: () => ({ currentUser: { uid: "owner" } }),
  requireDb: () => ({}),
}));

import { useProfileCustom } from "../useProfileCustom";
import { ProfileCustomizeSheet } from "../ProfileCustomizeSheet";

const userClip = (trickName: string) => ({
  source: "user",
  playerUid: "owner",
  trickName,
  videoUrl: `${trickName}.mp4`,
});
const gameClip = { source: "game", playerUid: "owner", trickName: "Game make", videoUrl: "g.mp4" };
const docs: Record<string, object> = {
  "users/owner/profileCustom/main": { pinnedClipIds: ["game1", "mine", "game2"] },
  "clips/game1": gameClip,
  "clips/game2": gameClip,
  "clips/mine": userClip("Tre flip"),
};

/** Opens the editor once the profile has loaded, like the Customize button. */
function OwnProfile() {
  const pc = useProfileCustom("owner", true);
  if (pc.pinned.length === 0) return null;
  return <ProfileCustomizeSheet uid="owner" initial={pc.custom} onClose={() => {}} onSaved={() => {}} />;
}

describe("orphaned game-clip pins", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    h.getDoc.mockImplementation(async (path: string) => ({
      exists: () => path in docs,
      data: () => docs[path],
    }));
    h.getDocs.mockResolvedValue({
      docs: [
        { id: "mine", data: () => userClip("Tre flip") },
        { id: "fresh", data: () => userClip("Kickflip") },
      ],
    });
    h.setDoc.mockResolvedValue(undefined);
  });

  it("opens at 1/3, takes a new pin and saves only real pins", async () => {
    render(<OwnProfile />);
    fireEvent.click(await screen.findByRole("tab", { name: "LAYOUT" }));
    expect(screen.getByText("PINNED CLIPS · 1/3")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Tre flip" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Kickflip" }));
    expect(screen.getByText("PINNED CLIPS · 2/3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kickflip" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    await waitFor(() => expect(h.setDoc).toHaveBeenCalledTimes(1));
    expect(h.setDoc.mock.calls[0][0]).toBe("users/owner/profileCustom/main");
    expect(h.setDoc.mock.calls[0][1].pinnedClipIds).toEqual(["mine", "fresh"]);
  });
});
