import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NameItCard } from "../NameItCard";
import type { WttItem } from "../../services/wtt.types";

const item: WttItem = {
  clipId: "clip1",
  trickFamily: "kickflip",
  options: ["kickflip", "heelflip", "impossible", "made-up-trick"],
  status: "open",
  voteCount: 4,
  weightedTally: {},
  top: "kickflip",
  topPosterior: 0.8,
  createdAt: new Date(),
  aliases: { heelflip: "heely" },
};

afterEach(() => {
  vi.useRealTimers();
});

describe("NameItCard", () => {
  it("lists the four options by name, falling back to the id, with aliases", () => {
    render(<NameItCard item={item} onAnswer={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^kickflip$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /made-up-trick/ })).toBeInTheDocument();
    expect(screen.getByText("heely")).toBeInTheDocument();
  });

  it("shows the crowd answer after a vote, then resets", async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<NameItCard item={item} onAnswer={onAnswer} onSkip={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^kickflip$/i }));
    });
    expect(onAnswer).toHaveBeenCalledWith("kickflip");
    expect(screen.getByText(/80% of skaters said Kickflip/i)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/what's that trick/i)).toBeInTheDocument();
  });

  it("says the crowd is split when there is no clear top answer", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<NameItCard item={{ ...item, top: null, topPosterior: 0.3 }} onAnswer={onAnswer} onSkip={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /not sure/i }));
    });
    expect(onAnswer).toHaveBeenCalledWith("unsure");
    expect(screen.getByText(/crowd is split/i)).toBeInTheDocument();
  });

  it("ignores a second tap while a vote is in flight", async () => {
    let resolve!: () => void;
    const onAnswer = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<NameItCard item={item} onAnswer={onAnswer} onSkip={vi.fn()} />);
    const notLanded = screen.getByRole("button", { name: /not landed/i });
    fireEvent.click(notLanded);
    // Re-enable briefly by calling the handler again through a fresh click.
    fireEvent.click(notLanded);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("not_landed");
    await act(async () => resolve());
  });

  it("logs a failed vote and lets the skater try again", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onAnswer = vi.fn().mockRejectedValue(new Error("denied"));
    render(<NameItCard item={item} onAnswer={onAnswer} onSkip={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /heelflip/i }));
    });
    expect(spy).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /heelflip/i })).not.toBeDisabled();
    spy.mockRestore();
  });

  it("skips without voting", () => {
    const onSkip = vi.fn();
    const onAnswer = vi.fn();
    render(<NameItCard item={item} onAnswer={onAnswer} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    expect(onSkip).toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
