/**
 * Apple App Site Association for universal links.
 *
 * Served at `/.well-known/apple-app-site-association` (see vercel.json). The
 * file must be HTTPS with no redirect, so the www → apex redirect excludes
 * `/.well-known`. Apple caches a missing or wrong file for a long time, so
 * this returns 404 until `APPLE_TEAM_ID` is a real 10-character Team ID.
 * Do not commit a placeholder Team ID.
 */

interface WellKnownRequest {
  method?: string;
}

interface WellKnownResponse {
  status: (code: number) => WellKnownResponse;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

const TEAM_ID = /^[A-Z0-9]{10}$/;

export default function handler(req: WellKnownRequest, res: WellKnownResponse): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).end();
    return;
  }
  const team = process.env.APPLE_TEAM_ID ?? "";
  if (!TEAM_ID.test(team)) {
    res.status(404).end();
    return;
  }
  const body = {
    applinks: {
      apps: [],
      details: [
        {
          appID: `${team}.com.skatehubba.app`,
          paths: ["*"],
        },
      ],
    },
  };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).end(JSON.stringify(body));
}
