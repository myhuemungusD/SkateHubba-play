import { describe, it, expect } from "vitest";
import { ADULT_AGE, MIN_AGE, getAge, isMinorDob, parseDob } from "../age";

const TODAY = new Date(2026, 3, 20); // 2026-04-20 (matches project date)

describe("getAge", () => {
  it("returns full years when birthday already happened this year", () => {
    expect(getAge(new Date(2000, 0, 15), TODAY)).toBe(26);
  });

  it("does not count the upcoming birthday later this year", () => {
    expect(getAge(new Date(2000, 5, 1), TODAY)).toBe(25);
  });

  it("counts the birthday exactly when month and day match", () => {
    expect(getAge(new Date(2000, 3, 20), TODAY)).toBe(26);
  });

  it("does not count birthday when the day has not yet arrived this month", () => {
    expect(getAge(new Date(2000, 3, 21), TODAY)).toBe(25);
  });

  it("defaults `today` to now when omitted", () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 30);
    expect(getAge(dob)).toBe(30);
  });
});

describe("parseDob", () => {
  it("rejects empty strings with 'full date of birth' message", () => {
    expect(parseDob("", "", "", TODAY)).toEqual({ kind: "invalid", message: "Please enter your full date of birth" });
  });

  it("rejects non-numeric inputs", () => {
    const result = parseDob("ab", "cd", "ef", TODAY);
    expect(result.kind).toBe("invalid");
  });

  it("rejects month outside 1-12", () => {
    expect(parseDob("13", "15", "2000", TODAY)).toEqual({ kind: "invalid", message: "Please enter a valid date" });
  });

  it("rejects day outside 1-31", () => {
    expect(parseDob("01", "32", "2000", TODAY)).toEqual({ kind: "invalid", message: "Please enter a valid date" });
  });

  it("rejects year before 1900", () => {
    expect(parseDob("01", "15", "1899", TODAY)).toEqual({ kind: "invalid", message: "Please enter a valid date" });
  });

  it("rejects year in the future", () => {
    expect(parseDob("01", "15", "2099", TODAY)).toEqual({ kind: "invalid", message: "Please enter a valid date" });
  });

  it("rejects calendar rollovers like Feb 30", () => {
    expect(parseDob("02", "30", "2000", TODAY)).toEqual({ kind: "invalid", message: "Please enter a valid date" });
  });

  it("blocks users under the minimum age", () => {
    const result = parseDob("01", "01", "2020", TODAY);
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") expect(result.age).toBeLessThan(MIN_AGE);
  });

  it("requires parental consent for users between 13 and 17 inclusive", () => {
    // Born 2011-01-01 → 15 on 2026-04-20
    const result = parseDob("01", "01", "2011", TODAY);
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.age).toBe(15);
      expect(result.needsParentalConsent).toBe(true);
      expect(result.dobString).toBe("2011-01-01");
    }
  });

  it("does not require parental consent for adults", () => {
    const result = parseDob("01", "15", "2000", TODAY);
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.age).toBeGreaterThanOrEqual(ADULT_AGE);
      expect(result.needsParentalConsent).toBe(false);
      expect(result.dobString).toBe("2000-01-15");
    }
  });

  it("zero-pads single-digit months and days in dobString", () => {
    const result = parseDob("3", "7", "1995", TODAY);
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") expect(result.dobString).toBe("1995-03-07");
  });

  it("defaults `today` to now when omitted", () => {
    const year = String(new Date().getFullYear() - 25);
    const result = parseDob("06", "01", year);
    expect(result.kind).toBe("valid");
  });
});

describe("isMinorDob", () => {
  it("returns false when inputs are incomplete", () => {
    expect(isMinorDob("", "", "", TODAY)).toBe(false);
  });

  it("returns false when month/day rolls over (e.g. Feb 30)", () => {
    expect(isMinorDob("02", "30", "2011", TODAY)).toBe(false);
  });

  it("returns true for a 13-17 year old", () => {
    expect(isMinorDob("01", "01", "2011", TODAY)).toBe(true);
  });

  it("returns false for users under 13", () => {
    expect(isMinorDob("01", "01", "2020", TODAY)).toBe(false);
  });

  it("returns false for adults", () => {
    expect(isMinorDob("01", "01", "2000", TODAY)).toBe(false);
  });
});
