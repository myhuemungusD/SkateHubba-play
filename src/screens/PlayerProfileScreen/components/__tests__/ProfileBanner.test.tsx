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
  it("renders nothing for a stranger's profile with no banner", () => {
    const { container } = render(<ProfileBanner uid="u1" isOwnProfile={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a stranger's banner without the change icon", () => {
    render(<ProfileBanner uid="u1" bannerImageUrl="https://x/b.webp" isOwnProfile={false} />);
    expect(screen.getByTestId("profile-banner").querySelector("img")).toHaveAttribute("src", "https://x/b.webp");
    expect(screen.queryByRole("button", { name: "Change background picture" })).not.toBeInTheDocument();
  });

  it("owner uploads a new banner and sees it right away", async () => {
    mockUpload.mockResolvedValueOnce("https://x/new.webp");
    render(<ProfileBanner uid="u1" isOwnProfile />);
    fireEvent.click(screen.getByRole("button", { name: "Change background picture" }));
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
    mockUpload.mockRejectedValueOnce(new BannerError("unauthenticated"));
    pick();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save"));
    mockUpload.mockRejectedValueOnce(new Error("net"));
    pick();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save"));
  });
});
