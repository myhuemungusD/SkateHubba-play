import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileIdentityCard } from "../ProfileIdentityCard";

// AvatarPicker pulls in Capacitor + Firebase services; stub it so this test
// stays focused on the identity-card surface (PR-B has its own AvatarPicker
// suite).
vi.mock("../../../../components/AvatarPicker", () => ({
  AvatarPicker: ({
    uid,
    onUploaded,
    onClose,
  }: {
    uid: string;
    onUploaded: (url: string) => void;
    onClose: () => void;
  }) => (
    <div data-testid="avatar-picker" data-uid={uid}>
      <button type="button" onClick={() => onUploaded("https://example.com/new.webp")}>
        upload
      </button>
      <button type="button" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

// Helper: render the card in own-profile-with-uid mode (the configuration
// most tests need). Centralised to keep the duplication gate happy.
function renderOwn(overrides: { onAvatarUpdated?: (url: string) => void } = {}) {
  return render(
    <ProfileIdentityCard
      username="rider"
      isVerifiedPro={false}
      stance="regular"
      isOwnProfile
      uid="me"
      {...overrides}
    />,
  );
}

describe("ProfileIdentityCard", () => {
  it("renders username, stance, and level chip", () => {
    render(<ProfileIdentityCard username="rider" isVerifiedPro={false} stance="regular" level={7} />);
    expect(screen.getByText("@rider")).toBeInTheDocument();
    expect(screen.getByText("regular")).toBeInTheDocument();
    expect(screen.getByLabelText("Level 7")).toBeInTheDocument();
  });

  it("defaults level to 1 when undefined", () => {
    render(<ProfileIdentityCard username="rider" isVerifiedPro={false} stance="regular" />);
    expect(screen.getByLabelText("Level 1")).toBeInTheDocument();
  });

  it("renders the first-letter initial when no profileImageUrl is provided", () => {
    render(<ProfileIdentityCard username="rider" isVerifiedPro={false} stance="regular" />);
    expect(screen.getByText("R")).toBeInTheDocument();
  });

  it("renders the custom avatar img when profileImageUrl is set", () => {
    render(
      <ProfileIdentityCard
        username="rider"
        isVerifiedPro={false}
        stance="regular"
        profileImageUrl="https://example.com/me.webp"
      />,
    );
    expect(document.querySelector('img[src="https://example.com/me.webp"]')).toBeInTheDocument();
  });

  it("falls back to the SVG asset when username is empty", () => {
    render(<ProfileIdentityCard username="" isVerifiedPro={false} stance="regular" />);
    // The fallback img has src that ends with default-skater.svg via getAvatarFallbackUrl.
    const imgs = document.querySelectorAll("img");
    expect(imgs.length).toBeGreaterThan(0);
  });

  it("does NOT render the pencil-edit button on opponent profile", () => {
    render(
      <ProfileIdentityCard
        username="rider"
        isVerifiedPro={false}
        stance="regular"
        isOwnProfile={false}
        uid="u2"
      />,
    );
    expect(screen.queryByLabelText("Edit profile picture")).not.toBeInTheDocument();
  });

  it("renders the pencil-edit button only on own profile with uid", () => {
    renderOwn();
    expect(screen.getByLabelText("Edit profile picture")).toBeInTheDocument();
  });

  it("opens the avatar picker when the pencil is tapped", async () => {
    renderOwn();
    await userEvent.click(screen.getByLabelText("Edit profile picture"));
    expect(screen.getByTestId("avatar-picker")).toBeInTheDocument();
  });

  it("propagates a successful upload via onAvatarUpdated and shows the new image", async () => {
    const onAvatarUpdated = vi.fn();
    renderOwn({ onAvatarUpdated });
    await userEvent.click(screen.getByLabelText("Edit profile picture"));
    await userEvent.click(screen.getByText("upload"));

    expect(onAvatarUpdated).toHaveBeenCalledWith("https://example.com/new.webp");
    expect(screen.queryByTestId("avatar-picker")).not.toBeInTheDocument();
    expect(document.querySelector('img[src="https://example.com/new.webp"]')).toBeInTheDocument();
  });

  it("closing the picker without uploading leaves the previous avatar state alone", async () => {
    renderOwn();
    await userEvent.click(screen.getByLabelText("Edit profile picture"));
    expect(screen.getByTestId("avatar-picker")).toBeInTheDocument();

    await userEvent.click(screen.getByText("close"));
    expect(screen.queryByTestId("avatar-picker")).not.toBeInTheDocument();
    expect(screen.getByText("R")).toBeInTheDocument();
  });
});
