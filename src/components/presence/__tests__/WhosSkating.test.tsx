import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WhosSkating } from "../../../services/whosSkating";

const svc = vi.hoisted(() => ({
  subscribeWhosSkating: vi.fn(),
  agoLabel: vi.fn((then: number, now: number) => `${Math.round((now - then) / 3_600_000)}h ago`),
}));
const online = vi.hoisted(() => ({ subscribeOnline: vi.fn() }));
vi.mock("../../../services/whosSkating", () => svc);
vi.mock("../../../services/onlineStatus", () => online);
vi.mock("../../../lib/featureFlags", () => ({ isSpotPresenceEnabled: () => true }));

import { WhosSkatingButton } from "../../../screens/Lobby/components/WhosSkatingButton";
import { getActiveTipZone } from "../../../lib/tipSignals";

const NOW = Date.now();
const LIST: WhosSkating = {
  now: [{ uid: "a", username: "alex", spotId: "s1", spotName: "Cherry Park", lastAt: NOW, hereUntil: NOW + 60_000 }],
  recent: [
    { uid: "b", username: "bea", spotId: "s2", spotName: "Mill Ledges", lastAt: NOW - 2 * 3_600_000, hereUntil: 0 },
  ],
};

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}
let emit: (l: WhosSkating) => void = () => undefined;
const stop = vi.fn();

function renderHome() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<WhosSkatingButton uid="me" />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openSheet() {
  renderHome();
  expect(svc.subscribeWhosSkating).not.toHaveBeenCalled();
  await userEvent.click(screen.getByTestId("whos-skating-button"));
  return screen.findByTestId("whos-skating-sheet");
}

beforeEach(() => {
  vi.clearAllMocks();
  online.subscribeOnline.mockImplementation(() => vi.fn());
  svc.subscribeWhosSkating.mockImplementation((_uid: string, cb: typeof emit) => {
    emit = cb;
    return stop;
  });
});

describe("Who's skating", () => {
  it("loads only once opened, then lists now and recently with spot names", async () => {
    const sheet = await openSheet();
    expect(within(sheet).getByRole("heading", { name: "Who's skating" })).toBeInTheDocument();
    expect(within(sheet).getByText("Looking around…")).toBeInTheDocument();
    expect(svc.subscribeWhosSkating).toHaveBeenCalledWith("me", expect.any(Function));
    expect(getActiveTipZone()).toBe("whosskating");
    act(() => emit(LIST));
    const now = screen.getByTestId("whos-skating-now");
    expect(within(now).getByText("@alex")).toBeInTheDocument();
    expect(within(now).getByText("at Cherry Park")).toBeInTheDocument();
    const recent = screen.getByTestId("whos-skating-recent");
    expect(within(recent).getByText(/Mill Ledges · 2h ago/)).toBeInTheDocument();
  });

  it("opens a profile from a name", async () => {
    await openSheet();
    act(() => emit(LIST));
    await userEvent.click(screen.getByRole("button", { name: "Open @alex's profile" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/player/a");
    expect(stop).toHaveBeenCalled();
  });

  it("opens the spot page from a spot", async () => {
    await openSheet();
    act(() => emit(LIST));
    await userEvent.click(screen.getByRole("button", { name: "Open Mill Ledges" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/spots/s2");
  });

  it("shows empty states", async () => {
    await openSheet();
    act(() => emit({ now: [], recent: [] }));
    expect(screen.getByText("Nobody's checked in at a spot right now.")).toBeInTheDocument();
    expect(screen.getByText("Nobody's been out in the last day.")).toBeInTheDocument();
  });

  it("closes from the button, the backdrop and Escape, but not a tap inside", async () => {
    await openSheet();
    await userEvent.click(screen.getByText("Spot names only. Nobody sees your exact location."));
    expect(screen.getByTestId("whos-skating-sheet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close who's skating" }));
    expect(screen.queryByTestId("whos-skating-sheet")).toBeNull();
    expect(getActiveTipZone()).toBeNull();

    await userEvent.click(screen.getByTestId("whos-skating-button"));
    await userEvent.click(await screen.findByTestId("whos-skating-sheet"));
    expect(screen.queryByTestId("whos-skating-sheet")).toBeNull();

    await userEvent.click(screen.getByTestId("whos-skating-button"));
    await screen.findByTestId("whos-skating-sheet");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("whos-skating-sheet")).toBeNull();
  });
});
