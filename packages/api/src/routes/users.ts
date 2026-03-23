import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import * as users from "../services/users.js";

const router = Router();

const createProfileSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-z0-9_]+$/),
  stance: z.string().min(1),
  dob: z.string().optional(),
  parentalConsent: z.boolean().optional(),
});

router.post("/", requireAuth, async (req, res) => {
  const parsed = createProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const profile = await users.createProfile(
      req.auth!.uid,
      parsed.data.username,
      parsed.data.stance,
      req.auth!.email_verified,
      parsed.data.dob,
      parsed.data.parentalConsent,
    );
    res.status(201).json(profile);
  } catch (err: unknown) {
    // Unique constraint violation → username taken
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505") {
      res.status(409).json({ error: "Username already taken" });
      return;
    }
    throw err;
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const profile = await users.getProfile(req.auth!.uid);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(profile);
});

router.get("/leaderboard", async (_req, res) => {
  const leaders = await users.getLeaderboard();
  res.json(leaders);
});

router.get("/lookup/:username", requireAuth, async (req, res) => {
  const uid = await users.getUidByUsername(req.params.username);
  if (!uid) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ uid });
});

router.delete("/me", requireAuth, async (req, res) => {
  const profile = await users.getProfile(req.auth!.uid);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  await users.deleteUserData(req.auth!.uid, profile.username);
  res.status(204).end();
});

export default router;
