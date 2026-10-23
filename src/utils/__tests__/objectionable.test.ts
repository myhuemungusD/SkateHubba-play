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

describe("self-harm phrases and leetspeak (#886 review S4)", () => {
  it("blocks 'kill yourself' and its common spellings", () => {
    for (const t of [
      "kill yourself",
      "go kill yourself",
      "KILL URSELF",
      "kill ur self",
      "kill your self",
      "kill yourselves",
      "neck yourself",
      "hang yourself",
      "k1ll urs3lf",
      "killurself",
      "just neckyourself lol",
    ]) {
      expect(containsObjectionableText(t), t).toBe(true);
    }
  });
  it("doesn't block skate talk that sits near those words", () => {
    for (const t of [
      "skill yourself up",
      "you killed it",
      "kill it out there",
      "treat yourself to a new deck",
      "neck and neck",
      "hang ten",
      "kill the ledge",
      "360 flip",
      "540 mctwist",
      "900 at the vert ramp",
      "8 stair",
      "you can do it yourself",
    ]) {
      expect(containsObjectionableText(t), t).toBe(false);
    }
  });
  it("folds 6, 8 and 9 look-alikes", () => {
    expect(containsObjectionableText("n1663r")).toBe(true);
    expect(containsObjectionableText("n1993r")).toBe(true);
    expect(containsObjectionableText("8eaner")).toBe(true);
    expect(isObjectionableUsername("x_n1663r_x")).toBe(true);
  });
  it("blocks run-together self-harm taunts in usernames", () => {
    expect(isObjectionableUsername("neck_yourself")).toBe(true);
    expect(isObjectionableUsername("kill_urself99")).toBe(true);
  });
});

describe("trailing '!' is punctuation, not an 'i' (#886 review should-fix A)", () => {
  it("blocks taunts and slurs that end in '!'", () => {
    for (const t of ["kill yourself!", "kys!", "fag!", "retard!!", "you n1gger!", "go kill urself!!!"]) {
      expect(containsObjectionableText(t), t).toBe(true);
    }
  });
  it("still folds '!' to 'i' when a letter follows", () => {
    expect(containsObjectionableText("n!gger")).toBe(true);
    expect(isObjectionableUsername("x_n!gger!")).toBe(true);
  });
  it("lets exclamations through", () => {
    for (const t of ["sick!", "stomped it!", "kill it!", "landed!!", "!!!"]) {
      expect(containsObjectionableText(t), t).toBe(false);
    }
  });
});

describe("trick catalog never trips the filter", () => {
  it("passes every string exported from src/constants", async () => {
    const modules = import.meta.glob("../../constants/*.ts", { eager: true });
    const strings = new Set<string>();
    const seen = new WeakSet<object>();
    const walk = (v: unknown): void => {
      if (typeof v === "string") {
        strings.add(v);
      } else if (v && typeof v === "object") {
        if (seen.has(v)) return;
        seen.add(v);
        const children = v instanceof Map || v instanceof Set ? [...v.values()] : Object.values(v);
        for (const child of children) walk(child);
      }
    };
    for (const mod of Object.values(modules)) walk(mod);
    // Plus every quoted literal in the source, including unexported lists.
    const sources = import.meta.glob("../../constants/*.ts", { eager: true, query: "?raw", import: "default" });
    for (const src of Object.values(sources) as string[]) {
      for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([^`$]*)`/g)) {
        strings.add(m[1] ?? m[2] ?? m[3]);
      }
    }
    expect(strings.size).toBeGreaterThan(450);
    const hits = [...strings].filter((s) => containsObjectionableText(s));
    expect(hits).toEqual([]);
  });
});
