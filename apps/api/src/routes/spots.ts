import { Router } from 'express';
import { eq, and, between, desc } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
import { db } from '../db/index';
import { spots, spotComments } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import type { Spot, SpotComment, SpotGeoJSON, CreateSpotRequest, ObstacleType } from '@shared/types';

const router = Router();

const postLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

const getLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

const VALID_OBSTACLES: ObstacleType[] = [
  'ledge', 'rail', 'stairs', 'gap', 'bank', 'bowl',
  'manual_pad', 'quarter_pipe', 'euro_gap', 'slappy_curb',
  'hip', 'hubba', 'flatground', 'other',
];

function isValidRating(v: unknown): v is 1 | 2 | 3 | 4 | 5 {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
}

/** Validate a photo URL: must be a valid https URL */
function isValidPhotoUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function rowToSpot(row: typeof spots.$inferSelect): Spot {
  return {
    id: row.id,
    createdBy: row.createdBy,
    name: row.name,
    description: row.description,
    latitude: row.latitude,
    longitude: row.longitude,
    gnarRating: row.gnarRating as Spot['gnarRating'],
    bustRisk: row.bustRisk as Spot['bustRisk'],
    obstacles: (row.obstacles ?? []) as ObstacleType[],
    photoUrls: row.photoUrls ?? [],
    isVerified: row.isVerified,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function spotToGeoJSON(spot: Spot): SpotGeoJSON {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [spot.longitude, spot.latitude],
    },
    properties: spot,
  };
}

// GET /api/spots/bounds — fetch spots within map viewport
router.get('/bounds', getLimiter, async (req, res) => {
  try {
    const north = parseFloat(req.query.north as string);
    const south = parseFloat(req.query.south as string);
    const east = parseFloat(req.query.east as string);
    const west = parseFloat(req.query.west as string);

    if ([north, south, east, west].some((v) => Number.isNaN(v) || !Number.isFinite(v))) {
      res.status(400).json({ error: 'north, south, east, west query params required as finite numbers' });
      return;
    }

    if (north < -90 || north > 90 || south < -90 || south > 90) {
      res.status(400).json({ error: 'latitude values must be between -90 and 90' });
      return;
    }

    if (east < -180 || east > 180 || west < -180 || west > 180) {
      res.status(400).json({ error: 'longitude values must be between -180 and 180' });
      return;
    }

    if (north < south) {
      res.status(400).json({ error: 'north must be greater than or equal to south' });
      return;
    }

    const rows = await db
      .select()
      .from(spots)
      .where(
        and(
          between(spots.latitude, south, north),
          between(spots.longitude, west, east),
          eq(spots.isActive, true),
        ),
      )
      .limit(500);

    const features = rows.map(rowToSpot).map(spotToGeoJSON);
    res.json({
      type: 'FeatureCollection',
      features,
    });
  } catch (err) {
    console.warn('GET /api/spots/bounds failed:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Failed to fetch spots' });
  }
});

// GET /api/spots/:id — fetch single spot
router.get('/:id', getLimiter, async (req, res) => {
  try {
    if (!isValidUUID(req.params.id)) {
      res.status(400).json({ error: 'Invalid spot ID format' });
      return;
    }

    const rows = await db
      .select()
      .from(spots)
      .where(eq(spots.id, req.params.id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: 'Spot not found' });
      return;
    }

    res.json(rowToSpot(rows[0]));
  } catch (err) {
    console.warn('GET /api/spots/:id failed:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Failed to fetch spot' });
  }
});

// POST /api/spots — create a new spot [auth required]
router.post('/', postLimiter, authMiddleware, async (req, res) => {
  try {
    const body = req.body as CreateSpotRequest;
    const errors: string[] = [];

    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      errors.push('name is required');
    } else if (body.name.length > 80) {
      errors.push('name must be 80 characters or less');
    }

    if (body.description !== undefined && body.description !== null) {
      if (typeof body.description !== 'string') {
        errors.push('description must be a string');
      } else if (body.description.length > 500) {
        errors.push('description must be 500 characters or less');
      }
    }

    if (typeof body.latitude !== 'number' || !Number.isFinite(body.latitude) ||
        body.latitude < -90 || body.latitude > 90) {
      errors.push('latitude must be a finite number between -90 and 90');
    }

    if (typeof body.longitude !== 'number' || !Number.isFinite(body.longitude) ||
        body.longitude < -180 || body.longitude > 180) {
      errors.push('longitude must be a finite number between -180 and 180');
    }

    if (!isValidRating(body.gnarRating)) {
      errors.push('gnarRating must be 1-5');
    }

    if (!isValidRating(body.bustRisk)) {
      errors.push('bustRisk must be 1-5');
    }

    if (!Array.isArray(body.obstacles)) {
      errors.push('obstacles must be an array');
    } else if (body.obstacles.some((o) => !VALID_OBSTACLES.includes(o))) {
      errors.push('obstacles contains invalid values');
    }

    if (!Array.isArray(body.photoUrls)) {
      errors.push('photoUrls must be an array');
    } else if (body.photoUrls.length > 5) {
      errors.push('photoUrls max 5');
    } else if (body.photoUrls.some((url) => !isValidPhotoUrl(url))) {
      errors.push('photoUrls must contain valid https URLs');
    }

    if (errors.length > 0) {
      res.status(400).json({ error: errors.join('; ') });
      return;
    }

    const [row] = await db
      .insert(spots)
      .values({
        createdBy: req.userId!,
        name: body.name.trim(),
        description: body.description?.trim() ?? null,
        latitude: body.latitude,
        longitude: body.longitude,
        gnarRating: body.gnarRating,
        bustRisk: body.bustRisk,
        obstacles: body.obstacles,
        photoUrls: body.photoUrls,
      })
      .returning();

    res.status(201).json(rowToSpot(row));
  } catch (err) {
    console.warn('POST /api/spots failed:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Failed to create spot' });
  }
});

// GET /api/spots/:id/comments — list comments for a spot
router.get('/:id/comments', getLimiter, async (req, res) => {
  try {
    if (!isValidUUID(req.params.id)) {
      res.status(400).json({ error: 'Invalid spot ID format' });
      return;
    }

    const rows = await db
      .select()
      .from(spotComments)
      .where(eq(spotComments.spotId, req.params.id))
      .orderBy(desc(spotComments.createdAt))
      .limit(50);

    const comments: SpotComment[] = rows.map((r) => ({
      id: r.id,
      spotId: r.spotId,
      userId: r.userId,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
    }));

    res.json(comments);
  } catch (err) {
    console.warn('GET /api/spots/:id/comments failed:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// POST /api/spots/:id/comments — add a comment [auth required]
router.post('/:id/comments', postLimiter, authMiddleware, async (req, res) => {
  try {
    if (!isValidUUID(req.params.id)) {
      res.status(400).json({ error: 'Invalid spot ID format' });
      return;
    }

    const { content } = req.body as { content: string };

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    if (content.length > 300) {
      res.status(400).json({ error: 'content must be 300 characters or less' });
      return;
    }

    // Verify the spot exists
    const spotRows = await db
      .select({ id: spots.id })
      .from(spots)
      .where(eq(spots.id, req.params.id))
      .limit(1);

    if (spotRows.length === 0) {
      res.status(404).json({ error: 'Spot not found' });
      return;
    }

    const [row] = await db
      .insert(spotComments)
      .values({
        spotId: req.params.id,
        userId: req.userId!,
        content: content.trim(),
      })
      .returning();

    const comment: SpotComment = {
      id: row.id,
      spotId: row.spotId,
      userId: row.userId,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    };

    res.status(201).json(comment);
  } catch (err) {
    console.warn('POST /api/spots/:id/comments failed:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

export default router;
