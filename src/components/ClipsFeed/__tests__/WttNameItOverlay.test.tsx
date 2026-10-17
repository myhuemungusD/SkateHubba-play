import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WttNameItOverlay } from "../WttNameItOverlay";
import type { WttItem } from "../../../services/wtt.types";

vi.mock("../../NameItCard", () => ({
  NameItCard: ({ item, onAnswer, onSkip }: { item: WttItem; onAnswer: (c: string) => void; onSkip: () => void }) => (
    <div>
      <span>card:{item.clipId}</span>
      <button onClick={() => onAnswer("kickflip")}>__answer__</button>
      <button onClick={onSkip}>__skip__</button>
    </div>
  ),
}));

const item = { clipId: "clip9" } as WttItem;
const base = { dailyCount: 0, dailyLimit: 20, loading: false };

describe("WttNameItOverlay", () => {
  it("shows the done screen at the daily limit and goes back to Scroll", () => {
    const onBack = vi.fn();
    render(
      <WttNameItOverlay
        {...base}
        dailyCount={20}
        currentItem={item}
        onAnswer={vi.fn()}
        onSkipCurrent={vi.fn()}
        onBackToScroll={onBack}
      />,
    );
    expect(screen.getByText(/daily 20 done/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to scroll/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it("renders nothing when the queue is empty", () => {
    const { container } = render(
      <WttNameItOverlay
        {...base}
        currentItem={null}
        onAnswer={vi.fn()}
        onSkipCurrent={vi.fn()}
        onBackToScroll={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lazy-loads the quiz card and wires answer and skip", async () => {
    const onAnswer = vi.fn();
    const onSkip = vi.fn();
    render(
      <WttNameItOverlay
        {...base}
        currentItem={item}
        onAnswer={onAnswer}
        onSkipCurrent={onSkip}
        onBackToScroll={vi.fn()}
      />,
    );
    expect(await screen.findByText("card:clip9")).toBeInTheDocument();
    fireEvent.click(screen.getByText("__answer__"));
    fireEvent.click(screen.getByText("__skip__"));
    expect(onAnswer).toHaveBeenCalledWith("kickflip");
    expect(onSkip).toHaveBeenCalled();
  });
});
