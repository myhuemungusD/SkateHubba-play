import { afterEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ProfileAbout } from "../ProfileAbout";
import { DEFAULT_PROFILE_CUSTOM, type ProfileCustom } from "../../../../../services/profileCustom";

const withLinks = (links: ProfileCustom["links"]): ProfileCustom => ({ ...DEFAULT_PROFILE_CUSTOM, links });

describe("ProfileAbout link tooltips", () => {
  it("shows the bare host (no www.) as each link's tooltip", () => {
    render(<ProfileAbout custom={withLinks([{ label: "My IG", url: "https://www.instagram.com/sk8" }])} />);
    const link = screen.getByRole("link", { name: "My IG" });
    expect(link).toHaveAttribute("title", "instagram.com");
    expect(link).toHaveAttribute("href", "https://www.instagram.com/sk8");
  });

  it("falls back to the raw value when a link is not a parseable URL, instead of crashing the profile", () => {
    // Saved docs are sanitized, but the prop type allows any string; an old or
    // foreign doc must still render.
    render(<ProfileAbout custom={withLinks([{ label: "Broken", url: "not a url" }])} />);
    expect(screen.getByRole("link", { name: "Broken" })).toHaveAttribute("title", "not a url");
  });
});

describe("ProfileAbout theme song", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops back to the play state when the browser refuses playback", async () => {
    let refuse: (e: Error) => void = () => {};
    class RefusingAudio {
      loop = false;
      volume = 1;
      pause = vi.fn();
      play = () =>
        new Promise<void>((_ok, no) => {
          refuse = no;
        });
    }
    vi.stubGlobal("Audio", RefusingAudio);
    render(<ProfileAbout custom={{ ...DEFAULT_PROFILE_CUSTOM, themeSongId: "lofi-75" }} />);
    fireEvent.click(screen.getByRole("button", { name: /^Play theme song/ }));
    expect(screen.getByRole("button", { name: /^Pause theme song/ })).toHaveAttribute("aria-pressed", "true");
    await act(async () => refuse(new Error("NotAllowedError")));
    expect(screen.getByRole("button", { name: /^Play theme song/ })).toHaveAttribute("aria-pressed", "false");
  });
});
