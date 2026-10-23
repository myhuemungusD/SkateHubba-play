import { describe, it, expect } from "vitest";
import { containsObjectionableText, isObjectionableUsername } from "../objectionable";
import { usernameNote } from "../../screens/profileSetupHelpers";

describe("containsObjectionableText", () => {
  it("allows normal skate talk, including cursing", () => {
    for (const t of [
      "sick kickflip!",
      "that was f***ing gnarly",
      "damn, clean hardflip",
      "raccoon at the spot lol",
      "therapist said skate more",
    ]) {
      expect(containsObjectionableText(t)).toBe(false);
    }
  });
  it("blocks slurs, plurals and look-alike spellings", () => {
    expect(containsObjectionableText("you're a f4gg0t")).toBe(true);
    expect(containsObjectionableText("N1GG3RS")).toBe(true);
    expect(containsObjectionableText("just kys")).toBe(true);
  });
  it("folds every look-alike swap back to its letter", () => {
    // 1/7/3 -> i/t/e, @/! -> a/i, 4/1 -> a/i, 3/0 -> e/o, 5 and $ -> s
    for (const t of ["h17l3r", "n@z!", "n4z1", "p3d0", "ky5", "ky$"]) {
      expect(containsObjectionableText(t)).toBe(true);
    }
    // Digits outside the swap table stay digits, so plain numbers never match.
    expect(containsObjectionableText("kickflip 2 8 9 6")).toBe(false);
  });

  it("blocks letters split up to dodge the filter", () => {
    expect(containsObjectionableText("k y s")).toBe(true);
    expect(containsObjectionableText("a b c")).toBe(false);
  });
});

describe("isObjectionableUsername", () => {
  it("blocks slurs anywhere in the handle", () => {
    expect(isObjectionableUsername("xx_n1gger_xx")).toBe(true);
    expect(isObjectionableUsername("fag")).toBe(true);
    expect(isObjectionableUsername("hitler99")).toBe(true);
  });
  it("allows ordinary handles", () => {
    for (const u of ["bryanherman", "mike_white", "therapist", "raccoon_sk8", "spicy_tre"]) {
      expect(isObjectionableUsername(u)).toBe(false);
    }
  });
  it("shows the not-allowed note in profile setup", () => {
    expect(usernameNote("hitler_kid", true, "")).toMatch(/isn't allowed/);
  });
});
