import { describe, expect, it } from "vitest";
import { WEB_PUSH_ORIGIN, webPushLink, webpushOptions } from "./webpush.js";

describe("webPushLink", () => {
  it("opens a S.K.A.T.E. game at /?game=<id>, like the service worker", () => {
    expect(webPushLink({ gameId: "g1", type: "your_turn" })).toBe("https://skatehubba.com/?game=g1");
  });

  it("opens a Roll Dice game at /dice/<id>", () => {
    expect(webPushLink({ gameId: "d1", kind: "dice", type: "dice_your_roll" })).toBe("https://skatehubba.com/dice/d1");
  });

  it("falls back to the home page when there is no game", () => {
    expect(webPushLink({})).toBe("https://skatehubba.com/");
    expect(webPushLink({ gameId: "" })).toBe("https://skatehubba.com/");
  });

  it("encodes the game id", () => {
    expect(webPushLink({ gameId: "a b/c" })).toBe("https://skatehubba.com/?game=a%20b%2Fc");
  });

  it("is always an absolute https URL (FCM rejects anything else)", () => {
    expect(WEB_PUSH_ORIGIN.startsWith("https://")).toBe(true);
  });
});

describe("webpushOptions", () => {
  it("sets the link, icon, badge and per-game tag", () => {
    expect(webpushOptions({ gameId: "g1" })).toEqual({
      fcmOptions: { link: "https://skatehubba.com/?game=g1" },
      notification: { icon: "/icon-192.png", badge: "/icon-192.png", tag: "game_g1", renotify: true },
    });
  });

  it("uses the shared tag when there is no game", () => {
    expect(webpushOptions({}).notification.tag).toBe("skatehubba");
  });
});
