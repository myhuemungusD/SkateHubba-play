import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.hoisted(() => ({ on: true }));
const online = vi.hoisted(() => ({ getHideOnline: vi.fn(() => false), setHideOnline: vi.fn(async () => undefined) }));
const presence = vi.hoisted(() => ({ getAutoRejoin: vi.fn(() => true), setAutoRejoin: vi.fn() }));
vi.mock("../../../lib/featureFlags", () => ({ isSpotPresenceEnabled: () => flag.on }));
vi.mock("../../../services/onlineStatus", () => online);
vi.mock("../../../services/spotPresence", () => presence);

import { PresenceSettings } from "../PresenceSettings";

beforeEach(() => {
  vi.clearAllMocks();
  flag.on = true;
});

describe("PresenceSettings", () => {
  it("toggles hide-online and auto re-check-in", async () => {
    render(<PresenceSettings uid="me" />);
    online.setHideOnline.mockRejectedValueOnce(new Error("x"));
    await userEvent.click(screen.getByRole("switch", { name: "Hide my online status" }));
    expect(online.setHideOnline).toHaveBeenCalledWith("me", true);
    await userEvent.click(screen.getByRole("switch", { name: "Auto check back in" }));
    expect(presence.setAutoRejoin).toHaveBeenCalledWith(false);
  });
  it("hides when the switch is off", () => {
    flag.on = false;
    const { container } = render(<PresenceSettings uid="me" />);
    expect(container).toBeEmptyDOMElement();
  });
});
