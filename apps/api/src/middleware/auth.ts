import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';

// Initialize Firebase Admin once
if (!admin.apps.length) {
  // Assumption: using GOOGLE_APPLICATION_CREDENTIALS env var for service account
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

// Extend Express Request to include userId
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Auth middleware — verifies Firebase ID token from Authorization header.
 * Attaches req.userId on success.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = header.slice(7);
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.userId = decoded.uid;
    next();
  } catch (err) {
    console.warn('Auth token verification failed:', err instanceof Error ? err.message : 'unknown');
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
