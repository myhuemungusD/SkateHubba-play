#!/usr/bin/env node
/**
 * Economy simulation — Hubba Bucks mint vs. spend over 6 months.
 *
 * Purpose: Prove the closet economy remains balanced — no runaway inflation,
 * no impossible deflation. Models 10,000 users earning and spending Bucks over
 * 180 days under realistic engagement distribution.
 *
 * Run:  node scripts/simulate-economy.mjs
 */

// ── Constants (plan §9) ──────────────────────────────────────────────────────

const SIMULATION_DAYS = 180;
const TOTAL_USERS = 10_000;

const EARN_RATES = {
  gameComplete: 25, // Bucks per S.K.A.T.E. game completed
  dailyLoginStreak: [0, 5, 5, 10, 10, 15, 25], // Day 1-7
  achievementGrant: 50, // Average per achievement badge earned
};

const SHOP_PRICES = {
  common: 100,
  uncommon: 250,
  rare: 500,
  limited: 1000, // Open-edition limited items
  grail: 0, // Not shop-purchasable (drops/earn-only)
};

const DROP_PRICES = {
  // Draw entry is free (earned), claiming a won serial is free
  limitedDrop: 0, // No Bucks spent (stock-limited, serials)
  grailDrop: 0, // Draw-only, no purchase
};

// ── User Engagement Profiles ─────────────────────────────────────────────────

const ENGAGEMENT_PROFILES = [
  {
    name: "whale",
    proportion: 0.05, // 5% of users
    gamesPerWeek: 15,
    shopPurchasesPerMonth: 8,
    dropClaimsPerMonth: 2,
    loginStreakDays: 28, // Almost daily
  },
  {
    name: "regular",
    proportion: 0.20, // 20%
    gamesPerWeek: 7,
    shopPurchasesPerMonth: 3,
    dropClaimsPerMonth: 1,
    loginStreakDays: 14,
  },
  {
    name: "casual",
    proportion: 0.40, // 40%
    gamesPerWeek: 2,
    shopPurchasesPerMonth: 1,
    dropClaimsPerMonth: 0.5,
    loginStreakDays: 4,
  },
  {
    name: "lurker",
    proportion: 0.35, // 35%
    gamesPerWeek: 0.5,
    shopPurchasesPerMonth: 0.2,
    dropClaimsPerMonth: 0.1,
    loginStreakDays: 1,
  },
];

// ── Simulation Helpers ───────────────────────────────────────────────────────

function distributeUsers() {
  const cohorts = [];
  for (const profile of ENGAGEMENT_PROFILES) {
    const count = Math.round(TOTAL_USERS * profile.proportion);
    cohorts.push({ profile, count });
  }
  return cohorts;
}

function simulateUserEarnings(profile, days) {
  let earned = 0;

  // Games completed
  const totalGames = (profile.gamesPerWeek * days) / 7;
  earned += totalGames * EARN_RATES.gameComplete;

  // Login streaks (simplified: assume they hit streak milestones)
  const streakMonths = days / 30;
  const streakBonusPerMonth = 50; // Average bonus over 30 days
  earned += streakMonths * streakBonusPerMonth * (profile.loginStreakDays / 7);

  // Achievement grants (random, assume 1 per 20 games on average)
  const achievementGrants = Math.floor(totalGames / 20);
  earned += achievementGrants * EARN_RATES.achievementGrant;

  return Math.floor(earned);
}

function simulateUserSpending(profile, days) {
  let spent = 0;

  // Shop purchases
  const totalPurchases = (profile.shopPurchasesPerMonth * days) / 30;
  // Assume purchases distributed: 50% common, 30% uncommon, 15% rare, 5% limited
  const commonPurchases = totalPurchases * 0.5;
  const uncommonPurchases = totalPurchases * 0.3;
  const rarePurchases = totalPurchases * 0.15;
  const limitedPurchases = totalPurchases * 0.05;

  spent += commonPurchases * SHOP_PRICES.common;
  spent += uncommonPurchases * SHOP_PRICES.uncommon;
  spent += rarePurchases * SHOP_PRICES.rare;
  spent += limitedPurchases * SHOP_PRICES.limited;

  // Drop claims (serials are free to claim, but model opportunity cost)
  // In reality, drops are free, so this is 0
  const dropClaims = (profile.dropClaimsPerMonth * days) / 30;
  spent += dropClaims * DROP_PRICES.limitedDrop; // 0 Bucks

  return Math.floor(spent);
}

// ── Run Simulation ───────────────────────────────────────────────────────────

function runSimulation() {
  console.log("=".repeat(80));
  console.log("Hubba Bucks Economy Simulation");
  console.log("=".repeat(80));
  console.log(`Total users: ${TOTAL_USERS.toLocaleString()}`);
  console.log(`Simulation period: ${SIMULATION_DAYS} days (6 months)`);
  console.log("");

  const cohorts = distributeUsers();
  let totalEarned = 0;
  let totalSpent = 0;

  console.log("User Cohorts:");
  console.log("-".repeat(80));
  for (const { profile, count } of cohorts) {
    const earned = simulateUserEarnings(profile, SIMULATION_DAYS);
    const spent = simulateUserSpending(profile, SIMULATION_DAYS);
    const balance = earned - spent;

    const cohortEarned = earned * count;
    const cohortSpent = spent * count;

    totalEarned += cohortEarned;
    totalSpent += cohortSpent;

    console.log(`${profile.name.padEnd(10)} (${(profile.proportion * 100).toFixed(0)}%)`);
    console.log(`  Count:         ${count.toLocaleString()} users`);
    console.log(`  Avg Earned:    ${earned.toLocaleString()} Bucks/user`);
    console.log(`  Avg Spent:     ${spent.toLocaleString()} Bucks/user`);
    console.log(`  Avg Balance:   ${balance.toLocaleString()} Bucks/user`);
    console.log(`  Cohort Earned: ${cohortEarned.toLocaleString()} Bucks`);
    console.log(`  Cohort Spent:  ${cohortSpent.toLocaleString()} Bucks`);
    console.log("");
  }

  console.log("=".repeat(80));
  console.log("Economy-Wide Totals:");
  console.log("-".repeat(80));
  console.log(`Total Earned (mint):  ${totalEarned.toLocaleString()} Bucks`);
  console.log(`Total Spent (burn):   ${totalSpent.toLocaleString()} Bucks`);
  console.log(`Net Circulating:      ${(totalEarned - totalSpent).toLocaleString()} Bucks`);
  console.log(
    `Spend Ratio:          ${((totalSpent / totalEarned) * 100).toFixed(1)}% (target: 60-80% healthy)`,
  );
  console.log("");

  // ── Analysis ────────────────────────────────────────────────────────────────

  console.log("=".repeat(80));
  console.log("Analysis:");
  console.log("-".repeat(80));

  const spendRatio = totalSpent / totalEarned;
  if (spendRatio < 0.5) {
    console.log("⚠️  LOW SPEND RATIO: Users hoard Bucks. Consider:");
    console.log("   - Lowering shop prices");
    console.log("   - Adding more desirable limited items");
    console.log("   - Introducing time-limited sales");
  } else if (spendRatio > 0.9) {
    console.log("⚠️  HIGH SPEND RATIO: Users may run out of Bucks. Consider:");
    console.log("   - Increasing earn rates");
    console.log("   - Lowering shop prices");
    console.log("   - Adding more free-to-earn items");
  } else {
    console.log("✅ HEALTHY ECONOMY: Balanced mint vs. burn.");
    console.log("   - Users earn enough to engage with the shop");
    console.log("   - Users have incentive to keep playing (Bucks have value)");
    console.log("   - No runaway inflation or deflation");
  }

  console.log("");
  console.log("Per-User Averages:");
  console.log(
    `  Earned:  ${Math.floor(totalEarned / TOTAL_USERS).toLocaleString()} Bucks/user over 6 months`,
  );
  console.log(
    `  Spent:   ${Math.floor(totalSpent / TOTAL_USERS).toLocaleString()} Bucks/user over 6 months`,
  );
  console.log(
    `  Balance: ${Math.floor((totalEarned - totalSpent) / TOTAL_USERS).toLocaleString()} Bucks/user`,
  );
  console.log("");

  // ── Conclusion ──────────────────────────────────────────────────────────────

  console.log("=".repeat(80));
  console.log("Conclusion:");
  console.log("-".repeat(80));
  console.log("This simulation models the closet economy under realistic engagement");
  console.log("distribution. The target spend ratio is 60-80%: users have enough Bucks");
  console.log("to engage with the shop, but not so many that Bucks become worthless.");
  console.log("");
  console.log("Next Steps:");
  console.log("  1. Run this script monthly after launch to track real metrics");
  console.log("  2. Adjust earn rates and shop prices based on actual user behavior");
  console.log("  3. Monitor extreme cohorts (whales running out, lurkers hoarding)");
  console.log("=".repeat(80));
}

// ── Entry Point ──────────────────────────────────────────────────────────────

runSimulation();
