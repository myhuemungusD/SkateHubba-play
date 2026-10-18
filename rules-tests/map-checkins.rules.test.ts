/** Map Phase 1: public browse flag, server-only spot fields, privateSpots, passport, check-in log, mapState. */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import * as fsx from "firebase/firestore";

const { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } =
  fsx;
import { setupRulesTestEnv } from "./_fixtures";

const SPOT = {
  createdBy: "owner",
  name: "Ledge",
  description: null,
  latitude: 33.7,
  longitude: -117.8,
  gnarRating: 3,
  bustRisk: 2,
  obstacles: ["ledge"],
  photoUrls: [],
  isVerified: false,
  isActive: true,
};

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-map", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const u of ["owner", "u2", "u3"]) await setDoc(doc(db, "users", u), { uid: u, username: u });
    await setDoc(doc(db, "spots", "s1"), SPOT);
    await setDoc(doc(db, "privateSpots", "crew1"), {
      ...SPOT,
      visibility: "crew",
      crewUids: ["friend"],
    });
    await setDoc(doc(db, "privateSpots", "solo1"), { ...SPOT, visibility: "private", crewUids: ["friend"] });
    await setDoc(doc(db, "users", "owner", "passport", "s1"), { scope: "public", spotName: "Ledge" });
    await setDoc(doc(db, "users", "owner", "passport", "p_crew1"), { scope: "private", spotName: "Secret" });
    await setDoc(doc(db, "users", "owner", "checkins", "c1"), { verdict: "ok" });
    await setDoc(doc(db, "mapState", "owner"), { strikes: 0 });
  });
});

const as = (uid: string) => getEnv().authenticatedContext(uid, { email_verified: true }).firestore();
const anon = () => getEnv().unauthenticatedContext().firestore();

async function setPublicBrowse(on: boolean) {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "config", "mapFlags"), { publicBrowse: on });
  });
}

describe("public browse", () => {
  it("signed-out reads are denied until config/mapFlags.publicBrowse is on", async () => {
    await assertFails(getDoc(doc(anon(), "spots", "s1")));
    await setPublicBrowse(false);
    await assertFails(getDoc(doc(anon(), "spots", "s1")));
    await setPublicBrowse(true);
    await assertSucceeds(getDoc(doc(anon(), "spots", "s1")));
    await assertSucceeds(getDocs(query(collection(anon(), "spots"), where("isActive", "==", true))));
    await assertSucceeds(getDoc(doc(anon(), "config", "mapFlags")));
  });

  it("signed-out visitors still never write and never see private spots", async () => {
    await setPublicBrowse(true);
    await assertFails(setDoc(doc(anon(), "spots", "s2"), SPOT));
    await assertFails(getDoc(doc(anon(), "privateSpots", "crew1")));
    await assertFails(setDoc(doc(as("owner"), "config", "mapFlags"), { publicBrowse: false }));
  });
});

describe("server-only spot fields", () => {
  it("a spot create cannot carry legendary or check-in fields", async () => {
    const db = as("owner");
    for (const extra of [
      { isLegendary: true },
      { checkinCount: 9 },
      { source: "osm" },
      { legendaryBadgeId: "legend_x" },
    ]) {
      const batch = writeBatch(db);
      batch.set(doc(db, "spots", `x${Object.keys(extra)[0]}`), { ...SPOT, ...extra });
      batch.set(doc(db, "users", "owner"), { lastSpotCreatedAt: serverTimestamp() }, { merge: true });
      await assertFails(batch.commit());
    }
  });

  it("an owner can edit the name but not the map fields", async () => {
    await assertSucceeds(updateDoc(doc(as("owner"), "spots", "s1"), { name: "New" }));
    await assertFails(updateDoc(doc(as("owner"), "spots", "s1"), { isLegendary: true }));
    await assertFails(updateDoc(doc(as("owner"), "spots", "s1"), { checkinCount: 100 }));
  });
});

describe("privateSpots", () => {
  it("crew and owner read a crew spot; strangers cannot", async () => {
    await assertSucceeds(getDoc(doc(as("owner"), "privateSpots", "crew1")));
    await assertSucceeds(getDoc(doc(as("friend"), "privateSpots", "crew1")));
    await assertFails(getDoc(doc(as("stranger"), "privateSpots", "crew1")));
    await assertSucceeds(
      getDocs(
        query(
          collection(as("friend"), "privateSpots"),
          where("crewUids", "array-contains", "friend"),
          where("visibility", "==", "crew"),
          where("isActive", "==", true),
        ),
      ),
    );
  });

  it("a private spot is owner-only even for listed crew", async () => {
    await assertSucceeds(getDoc(doc(as("owner"), "privateSpots", "solo1")));
    await assertFails(getDoc(doc(as("friend"), "privateSpots", "solo1")));
  });

  it("create needs the cooldown anchor and a valid shape", async () => {
    const db = as("owner");
    const good = writeBatch(db);
    good.set(doc(db, "privateSpots", "n1"), { ...SPOT, visibility: "crew", crewUids: [] });
    good.set(doc(db, "users", "owner"), { lastSpotCreatedAt: serverTimestamp() }, { merge: true });
    await assertSucceeds(good.commit());

    await assertFails(setDoc(doc(db, "privateSpots", "n2"), { ...SPOT, visibility: "crew", crewUids: [] }));
    const u2 = as("u2");
    const bad = writeBatch(u2);
    bad.set(doc(u2, "privateSpots", "n3"), { ...SPOT, createdBy: "u2", visibility: "public", crewUids: [] });
    bad.set(doc(u2, "users", "u2"), { lastSpotCreatedAt: serverTimestamp() }, { merge: true });
    await assertFails(bad.commit());
    const u3 = as("u3");
    const legend = writeBatch(u3);
    legend.set(doc(u3, "privateSpots", "n4"), {
      ...SPOT,
      createdBy: "u3",
      visibility: "crew",
      crewUids: [],
      isLegendary: true,
    });
    legend.set(doc(u3, "users", "u3"), { lastSpotCreatedAt: serverTimestamp() }, { merge: true });
    await assertFails(legend.commit());
  });

  it("the owner can change crew and visibility but not move the spot", async () => {
    await assertSucceeds(
      updateDoc(doc(as("owner"), "privateSpots", "crew1"), { crewUids: ["a", "b"], visibility: "private" }),
    );
    await assertFails(updateDoc(doc(as("owner"), "privateSpots", "crew1"), { latitude: 1 }));
    await assertFails(updateDoc(doc(as("friend"), "privateSpots", "crew1"), { name: "mine" }));
    await assertFails(deleteDoc(doc(as("friend"), "privateSpots", "crew1")));
    await assertSucceeds(deleteDoc(doc(as("owner"), "privateSpots", "crew1")));
  });
});

describe("passport", () => {
  it("the owner reads everything; nobody writes", async () => {
    await assertSucceeds(getDocs(collection(as("owner"), "users", "owner", "passport")));
    await assertFails(setDoc(doc(as("owner"), "users", "owner", "passport", "s9"), { scope: "public" }));
    await assertSucceeds(deleteDoc(doc(as("owner"), "users", "owner", "passport", "s1")));
  });

  it("others see public stamps only after the owner opts in", async () => {
    const publicStamps = () =>
      getDocs(query(collection(as("viewer"), "users", "owner", "passport"), where("scope", "==", "public")));
    await assertFails(publicStamps());
    await assertSucceeds(setDoc(doc(as("owner"), "passportSettings", "owner"), { public: true }));
    await assertSucceeds(publicStamps());
    await assertFails(getDoc(doc(as("viewer"), "users", "owner", "passport", "p_crew1")));
    await assertFails(getDoc(doc(anon(), "users", "owner", "passport", "s1")));
  });

  it("passportSettings is owner-written with one boolean", async () => {
    await assertFails(setDoc(doc(as("viewer"), "passportSettings", "owner"), { public: true }));
    await assertFails(setDoc(doc(as("owner"), "passportSettings", "owner"), { public: "yes" }));
    await assertFails(setDoc(doc(as("owner"), "passportSettings", "owner"), { public: true, x: 1 }));
    await assertSucceeds(setDoc(doc(as("owner"), "passportSettings", "owner"), { public: false }));
    await assertSucceeds(deleteDoc(doc(as("owner"), "passportSettings", "owner")));
  });
});

describe("check-in log and mapState", () => {
  it("are owner-readable and deletable, never client-written", async () => {
    await assertSucceeds(getDoc(doc(as("owner"), "users", "owner", "checkins", "c1")));
    await assertFails(getDoc(doc(as("viewer"), "users", "owner", "checkins", "c1")));
    await assertFails(setDoc(doc(as("owner"), "users", "owner", "checkins", "c2"), { verdict: "ok" }));
    await assertSucceeds(deleteDoc(doc(as("owner"), "users", "owner", "checkins", "c1")));

    await assertSucceeds(getDoc(doc(as("owner"), "mapState", "owner")));
    await assertFails(getDoc(doc(as("viewer"), "mapState", "owner")));
    await assertFails(setDoc(doc(as("owner"), "mapState", "owner"), { strikes: 0, blockedUntil: 0 }));
    await assertSucceeds(deleteDoc(doc(as("owner"), "mapState", "owner")));
  });
});

describe("server-written check-in rewards", () => {
  it("players cannot write their own XP, level or daily XP counters", async () => {
    for (const patch of [{ xp: 9999 }, { level: 50 }, { xpDay: "2026-10-17" }, { xpToday: 0 }]) {
      await assertFails(updateDoc(doc(as("u2"), "users", "u2"), patch));
    }
  });

  it("a new profile cannot start with check-in XP", async () => {
    await assertFails(setDoc(doc(as("fresh"), "users", "fresh"), { uid: "fresh", username: "fresh", xp: 50 }));
    await assertFails(
      setDoc(doc(as("fresh"), "users", "fresh"), { uid: "fresh", username: "fresh", xpDay: "2026-10-17" }),
    );
    await assertFails(setDoc(doc(as("fresh"), "users", "fresh"), { uid: "fresh", username: "fresh", xpToday: 5 }));
  });

  it("players cannot award themselves a legendary badge, stamp, day marker or spot count", async () => {
    const reason = { earnedAt: serverTimestamp(), reason: "Checked in." };
    await assertFails(setDoc(doc(as("u2"), "users", "u2", "achievements", "legend_love_park"), reason));
    await assertFails(setDoc(doc(as("u2"), "users", "u2", "passport", "s1"), { scope: "public", count: 1 }));
    await assertFails(setDoc(doc(as("u2"), "users", "u2", "checkins", "day.s1.2026-10-17"), { createdAt: 1 }));
    await assertFails(setDoc(doc(as("u2"), "users", "u2", "xpMarkers", "spot_s1"), { kind: "spot" }));
    await assertFails(updateDoc(doc(as("owner"), "spots", "s1"), { checkinCount: 99 }));
    await assertFails(updateDoc(doc(as("owner"), "spots", "s1"), { lastCheckinAt: serverTimestamp() }));
  });

  it("nobody else can read where a player checked in from", async () => {
    await assertFails(getDocs(collection(as("viewer"), "users", "owner", "checkins")));
    await assertFails(getDoc(doc(as("viewer"), "mapState", "owner")));
    await assertFails(getDoc(doc(anon(), "mapState", "owner")));
    await assertFails(getDocs(collection(anon(), "users", "owner", "checkins")));
  });
});
