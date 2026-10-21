#!/usr/bin/env node
/**
 * npm run review:screenshots — capture App Store + Google Play screenshots
 * of the key screens, signed in as the review account.
 *
 *   REVIEW_EMAIL=... REVIEW_PASSWORD=... npm run review:screenshots
 *   options: --base-url URL (default REVIEW_BASE_URL or https://skatehubba.com)
 *            --out DIR (default store-screenshots/, gitignored)
 *            --only ios-6.9,play-phone
 * Run `npm run review:seed` first so the screens have content. For the store
 * set, build with the iPhone launch flags and seed the emulators
 * (docs/STORE_REVIEW_KIT.md).
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_OPPONENTS, FORBIDDEN_PATHS, SCREENS, SIZES, pixelSize, reviewEnv, shotPath } from "./plan.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const STORAGE_EMULATOR = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199"}`;

export function isLocalUrl(url) {
  return ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
}

/** True when a URL is a screen the iPhone launch build hides (Roll Dice, Skate Runner). */
export function isForbiddenUrl(url) {
  const path = new URL(url, "http://x").pathname;
  return FORBIDDEN_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export function parseArgs(argv, env) {
  const val = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const only = val("--only")
    ?.split(",")
    .map((s) => s.trim());
  const sizes = only ? SIZES.filter((s) => only.includes(s.id)) : SIZES;
  if (only && sizes.length !== only.length)
    throw new Error(`unknown size in --only; choose from ${SIZES.map((s) => s.id).join(", ")}`);
  return {
    baseUrl: (val("--base-url") || reviewEnv(env).appUrl).replace(/\/$/, ""),
    out: resolve(val("--out") || resolve(ROOT, "store-screenshots")),
    sizes,
  };
}

async function signIn(page, baseUrl, email, password) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("sh_analytics_consent", "declined");
    } catch {
      /* storage blocked */
    }
  });
  await page.goto(`${baseUrl}/`);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: "Show password" }).waitFor({ timeout: 15_000 });
  await page.getByPlaceholder("you@email.com").fill(email);
  await page.getByPlaceholder("••••••••").first().fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/lobby/, { timeout: 30_000 });
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const cfg = reviewEnv(env);
  if (cfg.missing.length) {
    console.error(`[review:screenshots] set ${cfg.missing.join(" and ")} first.`);
    return 1;
  }
  const opts = parseArgs(argv, env);
  const { chromium } = await import("@playwright/test");
  // Google Chrome plays the H.264 demo clip; Playwright's bundled Chromium can't.
  const browser = await chromium.launch({
    channel: env.REVIEW_BROWSER_CHANNEL || undefined,
    args: [
      "--use-gl=swiftshader",
      "--enable-unsafe-swiftshader",
      // Lets a localhost build reach the local emulators (Chromium Local Network Access).
      "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests",
    ],
  });
  let count = 0;
  try {
    for (const size of opts.sizes) {
      const ctx = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.scale,
        isMobile: size.mobile,
        hasTouch: true,
      });
      const page = await ctx.newPage();
      await signIn(page, opts.baseUrl, cfg.email, cfg.password);
      if (isLocalUrl(opts.baseUrl)) {
        // An emulator seed uses production-style Storage URLs; serve them from the Storage emulator.
        await page.route("https://firebasestorage.googleapis.com/**", async (route) => {
          const url = route.request().url().replace("https://firebasestorage.googleapis.com", STORAGE_EMULATOR);
          await route.fulfill({ response: await route.fetch({ url }) });
        });
      }
      for (const screen of SCREENS) {
        await page.goto(`${opts.baseUrl}${screen.path}`);
        await page.waitForLoadState("networkidle").catch(() => {});
        if (screen.open === "game") {
          // The game screen has no URL of its own; open the "your turn to match" card.
          await page
            .getByText(new RegExp(`vs @${DEMO_OPPONENTS[0].username}`, "i"))
            .first()
            .click();
          await page.waitForURL(/\/game/, { timeout: 15_000 });
        }
        if (screen.scrollTo) {
          await page.locator(screen.scrollTo).first().scrollIntoViewIfNeeded({ timeout: 15_000 });
          await page
            .locator(screen.scrollTo)
            .first()
            .evaluate((el) => el.scrollIntoView({ block: "start" }));
        }
        if (screen.seek) {
          // The clip opens on a white frame; show a frame with the skater in it.
          await page.evaluate(async (t) => {
            const v = document.querySelector("video");
            if (!v) return;
            v.pause();
            v.currentTime = t;
            await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
          }, screen.seek);
        }
        await page.waitForTimeout(2500);
        if (isForbiddenUrl(page.url()))
          throw new Error(`${screen.id} landed on ${page.url()}, which the iPhone build hides`);
        const file = shotPath(opts.out, size, screen);
        mkdirSync(dirname(file), { recursive: true });
        await page.screenshot({ path: file });
        count++;
      }
      const { w, h } = pixelSize(size);
      console.log(`[review:screenshots] ${size.store} ${size.label} (${w}×${h}) ✓`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`[review:screenshots] ${count} screenshots in ${opts.out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error(`[review:screenshots] ${e?.message ?? e}`);
      process.exit(1);
    },
  );
}
