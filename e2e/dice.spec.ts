/**
 * Roll Dice, both seats, every game, on a 390×844 phone.
 *
 * Needs the functions emulator (the dice callable rolls every die), which the
 * default e2e run does not start, so the suite skips unless E2E_DICE=true.
 * Run it with emulators for auth, firestore, storage AND functions, the
 * functions env DICE_ENABLED=true, and the app built with
 * VITE_FEATURE_DICE_ENABLED=true. Set DICE_SHOTS=<dir> to save screenshots.
 * `npm run test:e2e:dice` does all of that, and CI runs it as the e2e-dice job.
 *
 * Deterministic on purpose: the bot waits out the server's cooldowns (one new
 * challenge per 10s per skater, 0.7s between one skater's rolls) instead of
 * retrying into them, and any rejected dice call fails the test.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { clearAll, createProfile, createUser, verifyAuthUser } from "./helpers/emulator";
import { signInViaUI } from "./helpers/auth-flow";
import { dismissBottomOverlays } from "./helpers/lobby-nav";

const ENABLED = process.env.E2E_DICE === "true";
const SHOTS = process.env.DICE_SHOTS ?? "";
const PHONE = { width: 390, height: 844 };

const A = { email: "dice-a@test.com", password: "password123", username: "kickflipkid" };
const B = { email: "dice-b@test.com", password: "password123", username: "nollienina" };

/** Server cooldowns (functions/src/dice/engine.ts) plus a little slack. */
const CREATE_WAIT_MS = 10_000 + 400;
const ROLL_WAIT_MS = 700 + 150;

const FS_DOCS = "http://localhost:8080/v1/projects/demo-skatehubba/databases/skatehubba/documents";
const uids: Record<string, string> = {};
/** Every diceAction call the server turned down, per test. */
let rejected: string[] = [];
const lastCreate = new Map<string, number>();
const lastRoll = new WeakMap<Page, number>();

async function pause(ms: number): Promise<void> {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/** Wait out this skater's create cooldown before the next challenge. */
async function createCooldown(who: string): Promise<void> {
  await pause((lastCreate.get(who) ?? 0) + CREATE_WAIT_MS - Date.now());
  lastCreate.set(who, Date.now());
}

/** Wait out this seat's roll cooldown. Banking doesn't throw dice, so it never waits. */
async function rollCooldown(page: Page): Promise<void> {
  await pause((lastRoll.get(page) ?? 0) + ROLL_WAIT_MS - Date.now());
  lastRoll.set(page, Date.now());
}

interface NoticeRow {
  recipientUid: string;
  type: string;
  body: string;
  gameId: string;
}

/** The in-app notification docs the callable wrote for one match. */
async function noticesFor(gameId: string): Promise<NoticeRow[]> {
  const res = await fetch(`${FS_DOCS}/notifications?pageSize=300`, { headers: { Authorization: "Bearer owner" } });
  if (!res.ok) throw new Error(`notifications read failed: ${res.status}`);
  const body = (await res.json()) as { documents?: { fields: Record<string, { stringValue?: string }> }[] };
  return (body.documents ?? [])
    .map((d) => ({
      recipientUid: d.fields.recipientUid?.stringValue ?? "",
      type: d.fields.type?.stringValue ?? "",
      body: d.fields.body?.stringValue ?? "",
      gameId: d.fields.gameId?.stringValue ?? "",
    }))
    .filter((n) => n.gameId === gameId);
}

async function expectNotice(gameId: string, to: typeof A, type: string, body: string | RegExp): Promise<void> {
  await expect
    .poll(async () => (await noticesFor(gameId)).filter((n) => n.recipientUid === uids[to.username] && n.type === type))
    .toContainEqual(expect.objectContaining({ body: typeof body === "string" ? body : expect.stringMatching(body) }));
}

/** Back-date a dice match's turn clock (only that field). */
async function expireDiceTurn(gameId: string): Promise<void> {
  const url = `${FS_DOCS}/diceGames/${gameId}?updateMask.fieldPaths=turnDeadline`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ fields: { turnDeadline: { integerValue: String(Date.now() - 1000) } } }),
  });
  if (!res.ok) throw new Error(`expireDiceTurn failed: ${res.status}`);
}

interface Seat {
  ctx: BrowserContext;
  page: Page;
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function seed(): Promise<void> {
  for (const p of [A, B]) {
    const user = await createUser(p.email, p.password);
    await verifyAuthUser(p.email, user.idToken);
    await createProfile(user.uid, p.username, p.email, true, false);
    uids[p.username] = user.uid;
  }
}

async function open(browser: Browser, who: typeof A, quick: boolean): Promise<Seat> {
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.addInitScript((q) => {
    localStorage.setItem("skate_dice_quick_rolls", q ? "1" : "0");
    localStorage.setItem("skate_sound_enabled", "false");
  }, quick);
  // Record any rejected dice call, with the request that caused it; afterEach fails on them.
  page.on("response", async (res) => {
    if (!res.url().includes("diceAction") || res.ok()) return;
    const line = `${who.username} ${res.status()} ${res.request().postData() ?? ""} -> ${await res.text().catch(() => "")}`;
    console.log(`[dice] ${line}`);
    // Two open tables racing to close the same expired turn: one wins, the other hears game_over.
    if (!(line.includes('"claimTimeout"') && line.includes("game_over"))) rejected.push(line);
  });
  await signInViaUI(page, who.email, who.password);
  await page.waitForTimeout(1500);
  await dismissBottomOverlays(page);
  return { ctx, page };
}

async function challenge(page: Page, mode: string, opponent: string, long = false): Promise<string> {
  await page.goto("/dice/new");
  await page.getByRole("radio", { name: new RegExp(`^${mode}`) }).check({ force: true });
  if (long) await page.getByRole("radio", { name: /^Long/ }).check({ force: true });
  await createCooldown(opponent === B.username ? A.username : B.username);
  await page.getByRole("button", { name: `Challenge @${opponent}` }).click();
  await expect(page).toHaveURL(/\/dice\/(?!new$)[^/]+$/, { timeout: 15_000 });
  const id = page.url().split("/").pop() ?? "";
  await expect(page.getByTestId("dice-waiting")).toContainText("to accept");
  return id;
}

async function accept(page: Page, gameId: string): Promise<void> {
  await page.goto(`/dice/${gameId}`);
  await page.getByRole("button", { name: "Accept challenge" }).click();
  await expect(page.getByTestId("dice-meta")).toContainText(/Round|Hand/, { timeout: 15_000 });
}

function dock(page: Page) {
  return page.getByTestId("dice-actions");
}

/** Faces worth keeping in 10,000: 1s, 5s and any face showing three or more times. */
function keepers(faces: number[]): number[] {
  const count = new Map<number, number>();
  for (const f of faces) count.set(f, (count.get(f) ?? 0) + 1);
  const keep = faces.flatMap((f, i) => (f === 1 || f === 5 || (count.get(f) ?? 0) >= 3 ? [i] : []));
  return keep.length > 0 ? keep : faces.map((_, i) => i);
}

/** Takes one step if it's this seat's move. Returns true when it acted. */
async function step(page: Page, mode: string): Promise<boolean> {
  const actions = dock(page);
  if (mode === "10,000") {
    const toggles = page.getByTestId("dice-spot").getByRole("button", { name: /^Die showing/ });
    const n = await toggles.count();
    if (n > 0) {
      const faces: number[] = [];
      for (let i = 0; i < n; i++)
        faces.push(Number(await toggles.nth(i).locator("[data-face]").getAttribute("data-face")));
      for (const i of keepers(faces)) {
        if ((await toggles.nth(i).getAttribute("aria-pressed")) !== "true") await toggles.nth(i).click();
      }
      const bank = actions.getByRole("button", { name: /^Bank/ });
      const total = Number(((await bank.textContent()) ?? "").replace(/\D/g, ""));
      const left = n - keepers(faces).length;
      const roll = actions.getByRole("button", { name: /^(Roll|Hot dice)/ });
      if (left === 0 && (await roll.isEnabled())) {
        await rollCooldown(page);
        await roll.click();
      } else if (total >= 350 || left <= 2) await bank.click();
      else {
        await rollCooldown(page);
        await roll.click();
      }
      await page.waitForTimeout(400);
      return true;
    }
  }
  const roll = actions.getByRole("button", { name: /^(Roll|Hot dice)/ });
  if ((await roll.count()) === 0 || !(await roll.isEnabled())) return false;
  await rollCooldown(page);
  await roll.click();
  await page.waitForTimeout(400);
  return true;
}

async function playOut(a: Page, b: Page, mode: string, shotPrefix: string): Promise<void> {
  let turns = 0;
  let midShots = 0;
  for (let guard = 0; guard < 600; guard++) {
    if ((await a.getByTestId("dice-result").count()) > 0) break;
    let acted = false;
    for (const page of [a, b]) {
      if (await step(page, mode)) {
        acted = true;
        turns++;
        if (turns === 3 || turns === 8) {
          midShots++;
          await shot(page, `${shotPrefix}-mid-${midShots}-roller`);
          await shot(page === a ? b : a, `${shotPrefix}-mid-${midShots}-watcher`);
        }
      }
    }
    if (!acted) await a.waitForTimeout(300);
  }
  await expect(a.getByTestId("dice-result")).toBeVisible({ timeout: 15_000 });
  await expect(b.getByTestId("dice-result")).toBeVisible({ timeout: 15_000 });
}

test.describe("Roll Dice", () => {
  test.skip(!ENABLED, "Needs the functions emulator; set E2E_DICE=true");
  test.setTimeout(Number(process.env.DICE_TIMEOUT ?? 15 * 60_000));

  let a: Seat;
  let b: Seat;

  test.beforeEach(async ({ browser }) => {
    rejected = [];
    await clearAll();
    await seed();
    a = await open(browser, A, true);
    b = await open(browser, B, true);
  });

  test.afterEach(async () => {
    await a.ctx.close();
    await b.ctx.close();
    expect(rejected, "the server turned down a dice call").toEqual([]);
  });

  for (const [mode, slug] of [
    ["C-Lo", "clo"],
    ["4-5-6", "s456"],
    ["Craps", "craps"],
    ["10,000", "ten"],
  ] as const) {
    test(`${mode}: challenge, accept, play to the target, rematch`, async () => {
      await a.page.goto("/dice");
      await shot(a.page, `${slug}-01-hub-before`);
      await a.page.goto("/dice/new");
      await a.page.getByRole("radio", { name: new RegExp(`^${mode}`) }).check({ force: true });
      await shot(a.page, `${slug}-02-new`);
      const id = await challenge(a.page, mode, B.username);
      await shot(a.page, `${slug}-03-pending-challenger`);
      await expectNotice(
        id,
        B,
        "dice_challenge",
        `@${A.username} challenged you to ${mode}, race to ${mode === "10,000" ? "5,000" : "5"}.`,
      );
      await b.page.goto("/dice");
      await expect(b.page.getByTestId("dice-match-row").first()).toContainText("Challenged you");
      await shot(b.page, `${slug}-04-hub-incoming`);
      await accept(b.page, id);
      await expectNotice(id, A, "dice_turn", `@${B.username} accepted. Your roll.`);
      await a.page.goto(`/dice/${id}`);
      await expect(
        dock(a.page).getByRole("button", { name: /^Roll/ }).or(a.page.getByTestId("dice-waiting")),
      ).toBeVisible();

      await playOut(a.page, b.page, mode, slug);
      // Turn passes and the result reach both skaters' notifications (push rides on the same docs).
      await expectNotice(id, B, "dice_turn", /Your (roll|turn)\.$/);
      await expectNotice(id, A, "dice_result", /won /);
      await expectNotice(id, B, "dice_result", /won /);
      await expect(a.page.getByTestId("dice-result")).toContainText(/You (won|lost)/);
      await expect(a.page.getByTestId("dice-result")).toContainText("Rep");
      await shot(a.page, `${slug}-05-result-a`);
      await shot(b.page, `${slug}-06-result-b`);

      await a.page.getByRole("button", { name: "Rematch" }).click();
      await expect(a.page).not.toHaveURL(new RegExp(`/dice/${id}$`), { timeout: 15_000 });
      await expect(a.page.getByTestId("dice-meta")).toContainText(mode);
      await b.page.reload();
      await expect(b.page.getByRole("button", { name: "Open rematch" })).toBeVisible();
      await b.page.goto("/dice");
      await expect(b.page.getByTestId("dice-record")).not.toContainText("0–0");
      await shot(b.page, `${slug}-07-hub-after`);
    });
  }

  test("decline, call off, forfeit, timeout, nudge, info sheet, offline", async () => {
    // Decline
    const declined = await challenge(a.page, "C-Lo", B.username);
    await b.page.goto(`/dice/${declined}`);
    await shot(b.page, "flow-01-accept-or-decline");
    await dock(b.page).getByRole("button", { name: "Decline" }).click();
    await shot(b.page, "flow-02-decline-confirm");
    await b.page.getByRole("alertdialog").getByRole("button", { name: "Decline" }).click();
    await expect(b.page.getByTestId("dice-result")).toContainText("You passed");
    await expect(a.page.getByTestId("dice-result")).toContainText("Challenge declined");
    await shot(a.page, "flow-03-declined-challenger");

    // Call off
    const calledOff = await challenge(a.page, "Craps", B.username);
    await dock(a.page).getByRole("button", { name: "Call off challenge" }).click();
    await expect(a.page.getByTestId("dice-result")).toContainText("Challenge called off");
    await a.page.goto(`/dice/${calledOff}`);

    // Nudge, then forfeit
    const forfeit = await challenge(a.page, "C-Lo", B.username);
    await accept(b.page, forfeit);
    await a.page.goto(`/dice/${forfeit}`);
    await expect(
      dock(a.page).getByRole("button", { name: /^Roll/ }).or(a.page.getByTestId("dice-waiting")),
    ).toBeVisible();
    const waiter = (await dock(a.page).getByRole("button", { name: /^Roll/ }).count()) > 0 ? b.page : a.page;
    const roller = waiter === a.page ? b.page : a.page;
    await waiter.goto(`/dice/${forfeit}`);
    await dock(waiter)
      .getByRole("button", { name: /^Nudge/ })
      .click();
    await expect(dock(waiter).getByRole("button", { name: "Nudged" })).toBeDisabled();
    const [waiterSkater, rollerSkater] = waiter === a.page ? [A, B] : [B, A];
    await expectNotice(forfeit, rollerSkater, "dice_turn", `@${waiterSkater.username} is waiting on your roll.`);
    await shot(waiter, "flow-04-nudged");
    await roller.getByRole("button", { name: "Forfeit match" }).click();
    await shot(roller, "flow-05-forfeit-confirm");
    await roller.getByRole("alertdialog").getByRole("button", { name: "Forfeit" }).click();
    await expect(roller.getByTestId("dice-result")).toContainText("You lost");
    await expect(waiter.getByTestId("dice-result")).toContainText("left the match");
    await shot(waiter, "flow-06-won-by-forfeit");

    // Timeout: back-date the deadline, the open table claims it
    const late = await challenge(a.page, "4-5-6", B.username);
    await accept(b.page, late);
    await expireDiceTurn(late);
    await a.page.goto(`/dice/${late}`);
    await expect(a.page.getByTestId("dice-result")).toContainText(/ran out of time|turn ran out/, { timeout: 20_000 });
    await shot(a.page, "flow-07-timeout");

    // Info sheet and offline
    await a.page.goto("/dice");
    await a.page.getByRole("button", { name: "How to play and settings" }).click();
    await shot(a.page, "flow-08-how-to-play");
    await a.page.getByRole("tab", { name: "10,000" }).click();
    await shot(a.page, "flow-09-how-to-play-10000");
    await a.page.getByRole("button", { name: "Done" }).click();
    const live = await challenge(a.page, "10,000", B.username);
    await accept(b.page, live);
    await b.ctx.setOffline(true);
    await b.page.waitForTimeout(500);
    await expect(dock(b.page)).toContainText("offline");
    await shot(b.page, "flow-10-offline");
    await b.ctx.setOffline(false);
  });

  test("slow reveal lands the dice one by one", async ({ browser }) => {
    await a.ctx.close();
    a = await open(browser, A, false);
    const id = await challenge(a.page, "10,000", B.username);
    await accept(b.page, id);
    await a.page.goto(`/dice/${id}`);
    await expect(
      dock(a.page).getByRole("button", { name: /^Roll/ }).or(a.page.getByTestId("dice-waiting")),
    ).toBeVisible();
    let page = a.page;
    if ((await dock(a.page).getByRole("button", { name: /^Roll/ }).count()) === 0) {
      await b.ctx.close();
      b = await open(browser, B, false);
      page = b.page;
      await page.goto(`/dice/${id}`);
    }
    await shot(page, "slow-01-your-turn");
    await dock(page).getByRole("button", { name: /^Roll/ }).click();
    await page.waitForTimeout(150);
    await shot(page, "slow-02-landing");
    await page.waitForTimeout(1200);
    await shot(page, "slow-03-landed");
  });
});
