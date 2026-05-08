import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProfileIdentityCard } from "../ProfileIdentityCard";

/**
 * Focused tests for ProfileIdentityCard. The pencil tap target is the
 * load-bearing assertion (audit B-BLOCKER-2): Apple HIG / Material both
 * require ≥44px square. Tailwind class assertion is sufficient here —
 * jsdom doesn't compute actual layout, but `w-11 h-11` resolves to
 * 44×44 in the design tokens, and the class is what ships.
 */

vi.mock("../../../../services/avatars", () => ({
  getAvatarFallbackUrl: () => "/fallback.svg",
}));

describe("ProfileIdentityCard — pencil edit button", () => {
  it("renders with a 44×44 (w-11 h-11) tap area on own profile (audit B-BLOCKER-2)", () => {
    render(
      <ProfileIdentityCard username="testuser" isVerifiedPro={false} stance="regular" isOwnProfile uid="user-1" />,
    );
    const button = screen.getByRole("button", { name: "Edit profile picture" });
    expect(button.className).toContain("w-11");
    expect(button.className).toContain("h-11");
  });

  it("does not render the pencil button when not viewing own profile", () => {
    render(<ProfileIdentityCard username="otheruser" isVerifiedPro={false} stance="goofy" isOwnProfile={false} />);
    expect(screen.queryByRole("button", { name: "Edit profile picture" })).toBeNull();
  });
});
