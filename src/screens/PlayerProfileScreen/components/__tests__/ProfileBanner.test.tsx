import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockUpload } = vi.hoisted(() => ({ mockUpload: vi.fn() }));
vi.mock("../../../../services/banners", async (orig) => {
  const actual = await orig<typeof import("../../../../services/banners")>();
  return { BannerError: actual.BannerError, uploadBanner: (...a: unknown[]) => mockUpload(...a) };
});

import { BannerError } from "../../../../services/banners";
import { ProfileBanner } from "../ProfileBanner";

function pick(file: File | null = new File(["x"], "b.png", { type: "image/png" })) {
  fireEvent.change(screen.getByTestId("banner-file-input"), { target: { files: file ? [file] : [] } });
}

beforeEach(() => mockUpload.mockReset());

describe("ProfileBanner", () => {
  it("shows the short gradient cover with no button on a stranger's profile with no banner", () => {
    render(<ProfileBanner uid="u1" isOwnProfile={false} />);
    const banner = screen.getByTestId("profile-banner");
    expect(banner).toHaveClass("cover-empty", "h-[68px]");
    expect(banner).toHaveAttribute("data-empty", "true");
    expect(banner.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("gives the owner an Add cover button on the empty cover", () => {
    render(<ProfileBanner uid="u1" isOwnProfile />);
    expect(screen.getByTestId("profile-banner")).toHaveClass("cover-empty", "h-[68px]");
    expect(screen.getByRole("button", { name: "Add cover picture" })).toHaveTextContent("Add cover");
  });

  it("keeps the full height and no gradient once a cover exists", () => {
    render(<ProfileBanner uid="u1" bannerImageUrl="https://x/b.webp" isOwnProfile />);
    const banner = screen.getByTestId("profile-banner");
    expect(banner).toHaveClass("h-28");
    expect(banner).not.toHaveClass("cover-empty");
    expect(banner).not.toHaveAttribute("data-empty");
    expect(screen.getByRole("button", { name: "Change background picture" })).not.toHaveTextContent("Add cover");
  });

  it("shows a stranger's banner without the change icon", () => {
    render(<ProfileBanner uid="u1" bannerImageUrl="https://x/b.webp" isOwnProfile={false} />);
    expect(screen.getByTestId("profile-banner").querySelector("img")).toHaveAttribute("src", "https://x/b.webp");
    expect(screen.queryByRole("button", { name: "Change background picture" })).not.toBeInTheDocument();
  });

  it("frames the cover on the custom crop's focal point and zoom", () => {
    render(
      <ProfileBanner
        uid="u1"
        bannerImageUrl="https://x/b.webp"
        isOwnProfile={false}
        crop={{ x: 20, y: 70, zoom: 150 }}
      />,
    );
    const img = screen.getByTestId("profile-banner").querySelector("img")!;
    expect(img.style.objectPosition).toBe("20% 70%");
    expect(img.style.transform).toBe("scale(1.5)");
    expect(img.style.transformOrigin).toBe("20% 70%");
  });

  it("owner uploads a new banner and sees it right away", async () => {
    mockUpload.mockResolvedValueOnce("https://x/new.webp");
    render(<ProfileBanner uid="u1" isOwnProfile />);
    fireEvent.click(screen.getByRole("button", { name: "Add cover picture" }));
    pick(null);
    expect(mockUpload).not.toHaveBeenCalled();
    pick();
    await waitFor(() =>
      expect(screen.getByTestId("profile-banner").querySelector("img")).toHaveAttribute("src", "https://x/new.webp"),
    );
  });

  it("shows a plain message for typed and unknown failures", async () => {
    mockUpload.mockRejectedValueOnce(new BannerError("rejected"));
    render(<ProfileBanner uid="u1" isOwnProfile />);
    pick();
    expect(await screen.findByRole("alert")).toHaveTextContent("can't be used");
    // The empty strip grows back to full height so the message has room.
    expect(screen.getByTestId("profile-banner")).toHaveClass("h-28");
    mockUpload.mockRejectedValueOnce(new BannerError("unauthenticated"));
    pick();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save"));
    mockUpload.mockRejectedValueOnce(new Error("net"));
    pick();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save"));
  });
});
