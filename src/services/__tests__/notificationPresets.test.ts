import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_PRESETS,
  PRESET_HANDLE_FALLBACK,
  PRESET_TRICK_FALLBACK,
  catalogTrickDisplayNames,
  escapeRegex,
  isPresetMessage,
  presetCategoryLabels,
  presetChallengeHeadline,
  presetHandle,
  presetTrickName,
  presetTurnLengthLabels,
  templatePattern,
} from "../notificationPresets";
import { TRICKS, formatTrickDisplayName, TRICK_STANCES } from "../../constants/tricks";

describe("notification presets", () => {
  it("accepts every message the game services send", () => {
    const ok: Array<[string, string, string]> = [
      ["new_challenge", "New Challenge!", "@alice challenged you to S.K.A.T.E."],
      ["new_challenge", "New Challenge!", "@alice challenged you to S.K.A.T.E. — Flat Bar"],
      ["new_challenge", "New Challenge!", "@alice challenged you to S.K.A.T.E. — Custom Rules · 3-day turns"],
      ["new_challenge", "New Challenge!", "@alice challenged you to S.K.A.T.E. — 7-day turns"],
      ["judge_invite", "You've been asked to referee", "@alice vs @bob_2 — accept to rule on disputes"],
      ["nudge", "You got nudged!", "@alice is waiting for your move"],
      ["game_won", "You Won!", "vs @bob"],
      ["game_lost", "Game Over", "vs @bob"],
      ["your_turn", "Your Turn!", "Match @alice's Kickflip"],
      ["your_turn", "Your Turn!", "Match @alice's Switch Tre Flip"],
      ["your_turn", "Your Turn!", "Match @alice's trick"],
      ["your_turn", "Your Turn!", "Match @alice's Trick"],
      ["your_turn", "Your Turn to Set!", "@alice couldn't land their trick. Set a trick!"],
      ["your_turn", "Your Turn to Set!", "Set a trick for @bob"],
      ["your_turn", "Your Turn to Set!", "You landed @alice's Fakie Heelflip. Set a trick!"],
      ["your_turn", "Trick Landed!", "You landed! Set a trick for @alice"],
      ["your_turn", "Ruling Needed", "@bob called BS on @alice's set. Rule clean or sketchy?"],
      ["your_turn", "Ruling Needed", "@bob claims they landed @alice's trick. Rule landed or missed?"],
      ["your_turn", "Land Claimed", "@bob claims they landed your trick. Accept or dispute before the timer runs out."],
      ["your_turn", "Referee ruled: Clean", "The set stands. Match @alice's trick."],
      ["your_turn", "Referee ruled: Sketchy", "Set a new trick for @bob."],
      ["your_turn", "Referee ruled: Landed", "You landed! Set a trick for @alice"],
      ["your_turn", "Referee ruled: Missed", "Set a trick for @bob"],
      ["your_turn", "Call sent to the community", "@alice disputed your Ollie claim."],
    ];
    for (const [type, title, body] of ok) expect(isPresetMessage(type, title, body), body).toBe(true);
  });

  it("rejects free text, wrong types, bad handles and off-catalog tricks", () => {
    expect(isPresetMessage("your_turn", "Your Turn!", "Match @alice's visit evil.example")).toBe(false);
    expect(isPresetMessage("your_turn", "Your Turn!", "Match @alice's Kickflip https://x.y")).toBe(false);
    expect(isPresetMessage("your_turn", "Free text", "Set a trick for @bob")).toBe(false);
    expect(isPresetMessage("game_won", "Game Over", "vs @bob")).toBe(false);
    expect(isPresetMessage("game_won", "You Won!", "vs @Bob")).toBe(false);
    expect(isPresetMessage("game_won", "You Won!", "vs @bob click here")).toBe(false);
    expect(
      isPresetMessage("new_challenge", "New Challenge!", "@alice challenged you to S.K.A.T.E. — DM me on telegram"),
    ).toBe(false);
    expect(isPresetMessage("new_challenge", "New Challenge!", "@aliceXchallenged you to SXKXAXTXEX")).toBe(false);
  });

  it("covers every catalog display name in every stance", () => {
    const names = catalogTrickDisplayNames();
    expect(names).toHaveLength(TRICKS.length * TRICK_STANCES.length);
    for (const stance of TRICK_STANCES) {
      for (const trick of TRICKS) {
        const display = formatTrickDisplayName({ trickId: trick.id, stance, obstacle: null, trickNameCustom: null });
        expect(names).toContain(display);
        expect(isPresetMessage("your_turn", "Your Turn!", `Match @a's ${display}`)).toBe(true);
      }
    }
  });

  it("maps trick names to the catalog or the fallback", () => {
    expect(presetTrickName("Kickflip")).toBe("Kickflip");
    expect(presetTrickName("  switch tre flip ")).toBe("Switch Tre Flip");
    expect(presetTrickName("my secret trick, dm me")).toBe(PRESET_TRICK_FALLBACK);
    expect(presetTrickName(null)).toBe(PRESET_TRICK_FALLBACK);
    expect(presetTrickName(undefined)).toBe(PRESET_TRICK_FALLBACK);
  });

  it("keeps valid handles and replaces anything else", () => {
    expect(presetHandle("bob_2")).toBe("bob_2");
    expect(presetHandle("Bob")).toBe(PRESET_HANDLE_FALLBACK);
    expect(presetHandle("")).toBe(PRESET_HANDLE_FALLBACK);
    expect(presetHandle(undefined)).toBe(PRESET_HANDLE_FALLBACK);
  });

  it("builds challenge headlines from preset labels only", () => {
    expect(presetChallengeHeadline("any", null)).toBe("");
    expect(presetChallengeHeadline(null, "3-day turns")).toBe("3-day turns");
    expect(presetChallengeHeadline("flatbar", null)).toBe("Flat Bar");
    expect(presetChallengeHeadline("custom", "7-day turns")).toBe("Custom Rules · 7-day turns");
    expect(presetCategoryLabels()).not.toContain("Anything Goes");
    expect(presetTurnLengthLabels()).toEqual(["24h turns", "3-day turns", "7-day turns"]);
  });

  it("escapes regex metacharacters in literals", () => {
    expect(escapeRegex("S.K.A.T.E. (x)?")).toBe("S\\.K\\.A\\.T\\.E\\. \\(x\\)\\?");
    expect(new RegExp(`^${templatePattern("vs {user}")}$`).test("vs @a")).toBe(true);
    expect(NOTIFICATION_PRESETS.length).toBeGreaterThan(10);
  });
});
