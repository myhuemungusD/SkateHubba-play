import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIsAdmin = vi.fn();
vi.mock("../../../../hooks/useIsAdmin", () => ({
  useIsAdmin: (uid: string) => mockIsAdmin(uid),
}));

vi.mock("../../../../services/proProfile", () => ({
  saveProProfile: async (_uid: string, v: unknown) => v,
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
    render(<ProShowcaseGate stance="regular" username="someone" wins={0} losses={0} viewerUid="v" uid="u1" />);
    expect(screen.queryByTestId("pro-showcase")).toBeNull();
  });

  it("hides from non-admins while the flag is off", () => {
    render(<ProShowcaseGate stance="regular" username="mikewhite" wins={0} losses={0} viewerUid="v" uid="u1" />);
    expect(screen.queryByTestId("pro-showcase")).toBeNull();
    expect(mockIsAdmin).toHaveBeenCalledWith("v");
  });

  it("shows admins a review-mode showcase with tagged placeholders", () => {
    mockIsAdmin.mockReturnValue({ isAdmin: true, loading: false });
    render(<ProShowcaseGate stance="regular" username="BryanHerman" wins={0} losses={0} viewerUid="v" uid="u1" />);
    expect(screen.getByTestId("pro-showcase")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Review mode");
    expect(screen.getByText("No games yet. Be the first to play a pro.")).toBeInTheDocument();
    expect(screen.getAllByText("PLACEHOLDER").length).toBeGreaterThan(3);
    expect(screen.queryByRole("button", { name: /PLAY A PRO/ })).toBeNull();
  });

  it("shows everyone the showcase with the flag on and wires Play a pro", async () => {
    vi.stubEnv("VITE_FEATURE_PRO_PROFILES", "true");
    const onPlayPro = vi.fn();
    render(
      <ProShowcaseGate
        stance="regular"
        username="mikewhite"
        wins={3}
        losses={1}
        viewerUid="v"
        uid="u1"
        onPlayPro={onPlayPro}
      />,
    );
    expect(mockIsAdmin).toHaveBeenCalledWith("");
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText("3W · 1L across 4 games")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /PLAY A PRO/ }));
    expect(onPlayPro).toHaveBeenCalledWith("u1", "mikewhite");
  });

  it("shows the real stance from the user doc, never a placeholder", () => {
    vi.stubEnv("VITE_FEATURE_PRO_PROFILES", "true");
    const { unmount } = render(
      <ProShowcaseGate username="mikewhite" stance="goofy" wins={0} losses={0} viewerUid="v" uid="u1" />,
    );
    expect(screen.getByTestId("pro-stance")).toHaveTextContent("Goofy");
    unmount();
    render(<ProShowcaseGate username="bryanherman" stance="" wins={0} losses={0} viewerUid="v" uid="u1" />);
    expect(screen.getByTestId("pro-stance")).toHaveTextContent("Not set");
    expect(getProProfileContent("bryanherman")).not.toHaveProperty("stance");
  });

  it("offers Pro tools only when the owner callback is passed", async () => {
    vi.stubEnv("VITE_FEATURE_PRO_PROFILES", "true");
    const onOpenProTools = vi.fn();
    const { unmount } = render(
      <ProShowcaseGate username="mikewhite" stance="goofy" wins={0} losses={0} viewerUid="u1" uid="u1" />,
    );
    expect(screen.queryByTestId("open-pro-tools")).toBeNull();
    unmount();
    render(
      <ProShowcaseGate
        username="mikewhite"
        stance="goofy"
        wins={0}
        losses={0}
        viewerUid="u1"
        uid="u1"
        onOpenProTools={onOpenProTools}
      />,
    );
    await userEvent.click(screen.getByTestId("open-pro-tools"));
    expect(onOpenProTools).toHaveBeenCalled();
  });

  it("shows only real bios and tricks: Bryan's confirmed Hardflip, nothing for Mike", () => {
    vi.stubEnv("VITE_FEATURE_PRO_PROFILES", "true");
    const { unmount } = render(
      <ProShowcaseGate username="bryanherman" stance="regular" wins={0} losses={0} viewerUid="v" uid="u1" />,
    );
    expect(screen.getByRole("region", { name: "Signature tricks" })).toHaveTextContent("Hardflip");
    expect(screen.queryByRole("region", { name: "Bio" })).toBeNull();
    expect(screen.queryByTestId("pro-profile-prompt")).toBeNull();
    unmount();
    render(<ProShowcaseGate username="mikewhite" stance="goofy" wins={0} losses={0} viewerUid="v" uid="u2" />);
    expect(screen.queryByRole("region", { name: "Signature tricks" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Bio" })).toBeNull();
  });

  it("prefers the pro's own bio and picks over defaults", () => {
    vi.stubEnv("VITE_FEATURE_PRO_PROFILES", "true");
    render(
      <ProShowcaseGate
        username="bryanherman"
        stance="regular"
        bio="Skating LA."
        signatureTricks={["Tre Flip"]}
        wins={0}
        losses={0}
        viewerUid="v"
        uid="u1"
      />,
    );
    expect(screen.getByRole("region", { name: "Bio" })).toHaveTextContent("Skating LA.");
    expect(screen.getByRole("region", { name: "Signature tricks" })).not.toHaveTextContent("Hardflip");
  });

  it("prompts only the owning pro to add a bio and opens the editor", async () => {
    vi.stubEnv("VITE_FEATURE_PRO_PROFILES", "true");
    render(<ProShowcaseGate username="mikewhite" stance="goofy" canEdit wins={0} losses={0} viewerUid="u2" uid="u2" />);
    await userEvent.click(screen.getByTestId("pro-profile-prompt"));
    expect(screen.getByTestId("pro-profile-editor")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "CANCEL" }));
    expect(screen.getByText("Add your bio")).toBeInTheDocument();
  });

  it("saves the pro's bio in place and then offers Edit", async () => {
    vi.stubEnv("VITE_FEATURE_PRO_PROFILES", "true");
    render(
      <ProShowcaseGate username="bryanherman" stance="regular" canEdit wins={0} losses={0} viewerUid="u1" uid="u1" />,
    );
    await userEvent.click(screen.getByTestId("pro-profile-prompt"));
    await userEvent.type(screen.getByLabelText("BIO"), "Skating LA.");
    await userEvent.click(screen.getByRole("button", { name: "SAVE" }));
    expect(await screen.findByRole("region", { name: "Bio" })).toHaveTextContent("Skating LA.");
    expect(screen.getByRole("region", { name: "Signature tricks" })).toHaveTextContent("Hardflip");
    await userEvent.click(screen.getByTestId("edit-pro-profile"));
    expect(screen.getByTestId("pro-profile-editor")).toBeInTheDocument();
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
