import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIsAdmin = vi.fn();
vi.mock("../../../../hooks/useIsAdmin", () => ({
  useIsAdmin: (uid: string) => mockIsAdmin(uid),
}));

import { ProShowcaseGate } from "../ProShowcaseGate";
import { ProFieldText } from "../../../../components/pro/ProFieldText";
import { getProProfileContent } from "../../../../constants/proProfiles";

describe("ProShowcaseGate", () => {
  beforeEach(() => {
    mockIsAdmin.mockReturnValue({ isAdmin: false, loading: false });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders nothing for a username without pro content", () => {
    vi.stubEnv("VITE_FEATURE_PRO_PROFILES", "true");
    render(<ProShowcaseGate username="someone" wins={0} losses={0} viewerUid="v" uid="u1" />);
    expect(screen.queryByTestId("pro-showcase")).toBeNull();
  });

  it("hides from non-admins while the flag is off", () => {
    render(<ProShowcaseGate username="mikewhite" wins={0} losses={0} viewerUid="v" uid="u1" />);
    expect(screen.queryByTestId("pro-showcase")).toBeNull();
    expect(mockIsAdmin).toHaveBeenCalledWith("v");
  });

  it("shows admins a review-mode showcase with tagged placeholders", () => {
    mockIsAdmin.mockReturnValue({ isAdmin: true, loading: false });
    render(<ProShowcaseGate username="BryanHerman" wins={0} losses={0} viewerUid="v" uid="u1" />);
    expect(screen.getByTestId("pro-showcase")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Review mode");
    expect(screen.getByText("No games yet. Be the first to play a pro.")).toBeInTheDocument();
    expect(screen.getAllByText("PLACEHOLDER").length).toBeGreaterThan(5);
    expect(screen.queryByRole("button", { name: /PLAY A PRO/ })).toBeNull();
  });

  it("shows everyone the showcase with the flag on and wires Play a pro", async () => {
    vi.stubEnv("VITE_FEATURE_PRO_PROFILES", "true");
    const onPlayPro = vi.fn();
    render(<ProShowcaseGate username="mikewhite" wins={3} losses={1} viewerUid="v" uid="u1" onPlayPro={onPlayPro} />);
    expect(mockIsAdmin).toHaveBeenCalledWith("");
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText("3W · 1L across 4 games")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /PLAY A PRO/ }));
    expect(onPlayPro).toHaveBeenCalledWith("u1", "mikewhite");
  });

  it("looks up content case-insensitively and rejects empty usernames", () => {
    expect(getProProfileContent("MikeWhite")?.displayName).toBe("Mike White");
    expect(getProProfileContent(undefined)).toBeNull();
  });
});

describe("ProFieldText", () => {
  it("renders confirmed copy without the placeholder tag", () => {
    render(<ProFieldText field={{ value: "Confirmed", placeholder: false }} />);
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.queryByText("PLACEHOLDER")).toBeNull();
  });
});
