import { describe, it, expect } from "vitest";

import {
  DEFAULT_TURN_LENGTH_HOURS,
  TURN_DURATION_MS,
  TURN_LENGTH_OPTIONS,
  isTurnLengthHours,
  turnDurationMsFor,
  turnLengthHoursOf,
  turnLengthLabel,
} from "../turnDuration";

const HOUR = 60 * 60 * 1000;

describe("turnDuration", () => {
  it("keeps the legacy 24h constant and default", () => {
    expect(TURN_DURATION_MS).toBe(24 * HOUR);
    expect(DEFAULT_TURN_LENGTH_HOURS).toBe(24);
    expect(TURN_LENGTH_OPTIONS).toEqual([24, 72, 168]);
  });

  it("accepts only the three allowed lengths", () => {
    expect(isTurnLengthHours(24)).toBe(true);
    expect(isTurnLengthHours(72)).toBe(true);
    expect(isTurnLengthHours(168)).toBe(true);
    for (const bad of [0, 48, 72.5, "72", null, undefined, {}]) {
      expect(isTurnLengthHours(bad)).toBe(false);
    }
  });

  it("reads a missing or invalid length as 24h", () => {
    expect(turnLengthHoursOf(undefined)).toBe(24);
    expect(turnLengthHoursOf(null)).toBe(24);
    expect(turnLengthHoursOf({})).toBe(24);
    expect(turnLengthHoursOf({ turnLengthHours: 999 })).toBe(24);
    expect(turnLengthHoursOf({ turnLengthHours: 168 })).toBe(168);
  });

  it("turns the game's length into milliseconds", () => {
    expect(turnDurationMsFor(undefined)).toBe(TURN_DURATION_MS);
    expect(turnDurationMsFor({ turnLengthHours: null })).toBe(TURN_DURATION_MS);
    expect(turnDurationMsFor({ turnLengthHours: 72 })).toBe(72 * HOUR);
    expect(turnDurationMsFor({ turnLengthHours: 168 })).toBe(168 * HOUR);
  });

  it("labels each length for chips and invites", () => {
    expect(turnLengthLabel(24)).toBe("24h turns");
    expect(turnLengthLabel(72)).toBe("3-day turns");
    expect(turnLengthLabel(168)).toBe("7-day turns");
  });
});
