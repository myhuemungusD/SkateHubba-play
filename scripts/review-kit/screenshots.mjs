#!/usr/bin/env node
/**
 * npm run review:screenshots — capture App Store + Google Play screenshots
 * of the key screens, signed in as the review account.
 *
 *   REVIEW_EMAIL=... REVIEW_PASSWORD=... npm run review:screenshots
 *   options: --base-url URL (default REVIEW_BASE_URL or https://skatehubba.com)
 *            --out DIR (default store-screenshots/, gitignored)
 *            --only ios-6.9,play-phone
 * Run `npm run review:seed` first so the screens have content.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCREENS, SIZES, pixelSize, reviewEnv, shotPath } from "./plan.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
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
      for (const screen of SCREENS) {
        await page.goto(`${opts.baseUrl}${screen.path}`);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(1500);
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
