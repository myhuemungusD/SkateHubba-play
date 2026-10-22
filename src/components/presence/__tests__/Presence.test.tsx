import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ value: { user: { uid: "me" } as { uid: string } | null } }));
const flag = vi.hoisted(() => ({ on: true }));
const presence = vi.hoisted(() => ({
  subscribeSpotSkaters: vi.fn(),
  leaveSpot: vi.fn(async () => ({ code: "away", expiresAt: null })),
  readActiveSpot: vi.fn(),
  startSpotPresence: vi.fn(),
  setAutoRejoin: vi.fn(),
  getAutoRejoin: vi.fn(() => true),
}));
const online = vi.hoisted(() => ({
  subscribeOnline: vi.fn(),
  startOnlineHeartbeat: vi.fn(),
  getHideOnline: vi.fn(() => false),
}));
vi.mock("../../../context/AuthContext", () => ({ useAuthContext: () => auth.value }));
vi.mock("../../../lib/featureFlags", () => ({ isSpotPresenceEnabled: () => flag.on }));
vi.mock("../../../services/spotPresence", () => ({ ...presence, ACTIVE_SPOT_EVENT: "sh-presence-spot" }));
vi.mock("../../../services/onlineStatus", () => online);

import { PresenceDot } from "../PresenceDot";
import { PresenceRunner } from "../PresenceRunner";
import { WhosSkatingHere } from "../WhosSkatingHere";

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}
const SPOT = { id: "s1", name: "Plaza" };
function renderHere() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<WhosSkatingHere spot={SPOT} />} />
        <Route path="/challenge" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}
let emitHere: (list: { uid: string; username: string }[]) => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  flag.on = true;
  auth.value = { user: { uid: "me" } };
  presence.subscribeSpotSkaters.mockImplementation((_id: string, cb: typeof emitHere) => {
    emitHere = cb;
    return vi.fn();
  });
  online.subscribeOnline.mockImplementation(() => vi.fn());
});

describe("WhosSkatingHere", () => {
  it("shows nobody to challenge when the spot is empty", () => {
    renderHere();
    expect(screen.getByText("Looking around…")).toBeInTheDocument();
    act(() => emitHere([{ uid: "me", username: "jason" }]));
    expect(screen.getByTestId("whos-skating-here-empty")).toHaveTextContent("Nobody's here right now");
    expect(screen.getByText("You're here")).toBeInTheDocument();
  });
  it("lists only skaters here and challenges with spot presence", async () => {
    renderHere();
    act(() =>
      emitHere([
        { uid: "me", username: "jason" },
        { uid: "m", username: "mike" },
        { uid: "x", username: "" },
      ]),
    );
    expect(screen.queryByText("@jason")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Challenge @mike" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/challenge?spot=s1&here=1&to=mike");
  });
  it("needs you checked in to challenge, and lets you leave and toggle auto", async () => {
    renderHere();
    act(() => emitHere([{ uid: "m", username: "mike" }]));
    expect(screen.getByRole("button", { name: "Challenge @mike" })).toBeDisabled();
    expect(screen.getByText("Check in here to challenge them.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(presence.setAutoRejoin).toHaveBeenCalledWith(false);
    act(() => emitHere([{ uid: "me", username: "jason" }]));
    presence.leaveSpot.mockRejectedValueOnce(new Error("x"));
    await userEvent.click(screen.getByRole("button", { name: "Leave spot" }));
    expect(presence.leaveSpot).toHaveBeenCalledWith("s1");
  });
  it("tells a hidden skater they're hidden instead of 'not checked in'", () => {
    online.getHideOnline.mockReturnValue(true);
    renderHere();
    act(() => emitHere([{ uid: "m", username: "mike" }]));
    expect(screen.getByText("You're hidden")).toBeInTheDocument();
    online.getHideOnline.mockReturnValue(false);
  });
  it("renders nothing signed out", () => {
    auth.value = { user: null };
    const { container } = renderHere();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PresenceDot", () => {
  it("shows online, recent, and nothing for offline or when off", () => {
    let emit: (s: string) => void = () => {};
    online.subscribeOnline.mockImplementation((_uid: string, cb: typeof emit) => {
      emit = cb;
      return vi.fn();
    });
    const { rerender } = render(<PresenceDot uid="a" />);
    expect(screen.queryByRole("img")).toBeNull();
    act(() => emit("online"));
    expect(screen.getByRole("img", { name: "Online" })).toBeInTheDocument();
    act(() => emit("recent"));
    expect(screen.getByRole("img", { name: "Active recently" })).toBeInTheDocument();
    flag.on = false;
    rerender(<PresenceDot uid="b" className="x" />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("PresenceRunner", () => {
  it("beats online and follows today's spot, restarting on new check-ins", () => {
    const stopOnline = vi.fn();
    const stopSpot = vi.fn();
    online.startOnlineHeartbeat.mockReturnValue(stopOnline);
    presence.startSpotPresence.mockReturnValue(stopSpot);
    presence.readActiveSpot.mockReturnValueOnce(null).mockReturnValue({ id: "s1" });
    const { unmount } = render(<PresenceRunner uid="me" />);
    expect(online.startOnlineHeartbeat).toHaveBeenCalledWith("me");
    expect(presence.startSpotPresence).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new CustomEvent("sh-presence-spot"));
    });
    expect(presence.startSpotPresence).toHaveBeenCalledTimes(1);
    const onStatus = presence.startSpotPresence.mock.calls[0]?.[1] as () => void;
    onStatus();
    act(() => {
      window.dispatchEvent(new CustomEvent("sh-presence-spot"));
    });
    expect(stopSpot).toHaveBeenCalledTimes(1);
    unmount();
    expect(stopSpot).toHaveBeenCalledTimes(2);
    expect(stopOnline).toHaveBeenCalled();
  });
  it("does nothing when the switch is off", () => {
    flag.on = false;
    render(<PresenceRunner uid="me" />);
    expect(online.startOnlineHeartbeat).not.toHaveBeenCalled();
  });
});
