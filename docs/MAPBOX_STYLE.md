# Custom Mapbox Studio Style

The `/map` page renders skate spots over a Mapbox GL basemap. The basemap style
is configurable at deploy time via the `VITE_MAPBOX_STYLE_URL` environment
variable. When unset (or set to an invalid value) the app falls back to Mapbox's
stock `mapbox://styles/mapbox/dark-v11`.

This doc covers how to author a branded SkateHubba style in Mapbox Studio and
wire it in. **No code change is required** — the env var plumbing already lives
in `src/lib/mapbox.ts`. Tracking issue: [#191](https://github.com/myhuemungusD/SkateHubba-play/issues/191).

## Environment Variable

| Variable                | Where to set                                      | Example                                         |
| ----------------------- | ------------------------------------------------- | ----------------------------------------------- |
| `VITE_MAPBOX_STYLE_URL` | Vercel → Project Settings → Environment Variables | `mapbox://styles/skatehubba/clxyz0123abcd456ef` |

The value must either:

- start with `mapbox://styles/` (a Mapbox Studio style URI), **or**
- be a valid `https://` URL pointing at a self-hosted style JSON.

Any other value is rejected at startup: a warning is logged to the browser
console, a `map_style_invalid` Sentry event is emitted with the offending value
attached, and the map falls back to `mapbox://styles/mapbox/dark-v11`. This means
a typo can't take the `/map` page down. See `docs/SENTRY_ALERTS.md` →
`map_style_invalid` for the alert runbook.

## Design Intent

The custom style should make skate spots the visual focus, not the basemap:

- **Dark base** — consistent with the app's dark UI; markers and overlays must pop.
- **Emphasized roads + plazas** — skaters navigate by streets, ledges, and open
  paved areas. Keep road and pedestrian-plaza geometry legible.
- **De-emphasized labels** — reduce place-label density/opacity so the
  Firestore-driven spot markers stand out instead of competing with city labels.

## Authoring Steps (Mapbox Studio)

You need a Mapbox account; the style is owned by that account.

1. Sign in at <https://studio.mapbox.com> with the SkateHubba Mapbox account.
2. **Styles → New style.** Start from the **Dark** template (closest to the
   intended dark base) rather than from scratch.
3. Name it `SkateHubba Dark` so it's identifiable in the style list.
4. Tune the layers to match the design intent above:
   - **Base / land / water:** keep the dark template palette; nudge toward the
     app's neutral dark tones if needed for contrast with markers.
   - **Roads:** increase line width/contrast on the road layers so streets read
     clearly at the default `/map` zoom (zoom 13, see `MAP_DEFAULTS` in
     `src/lib/mapbox.ts`). Keep them visible across the `minZoom: 5` →
     `maxZoom: 19` range.
   - **Plazas / pedestrian areas:** raise fill contrast on the
     landuse/pedestrian layers so open paved spaces are distinguishable.
   - **Labels:** lower opacity (or hide minor label layers) for place, POI, and
     transit labels so spot markers dominate. Keep enough labeling for
     orientation — do not remove all labels.
5. **Keep the Mapbox attribution / wordmark intact.** Mapbox ToS requires
   attribution — do not delete the attribution layer or hide the wordmark in
   Studio. At runtime `/map` (and the Landing map) render mapbox-gl's default
   attribution control on top of the style.
6. **Publish** the style (top-right **Publish** button in Studio).
7. Open **Share** (or the style's **…** menu) and copy the **Style URL**, which
   has the form `mapbox://styles/<owner>/<style-id>`.

## Wiring It Up

1. Vercel → Project Settings → Environment Variables → add `VITE_MAPBOX_STYLE_URL`
   with the copied `mapbox://styles/<owner>/<style-id>` value.
2. Scope it to **Production**, **Preview**, and **Development**.
3. Vercel does **not** redeploy on env-var changes. Trigger a manual redeploy
   (Deployments → "…" → Redeploy) for the value to take effect.
4. For local development, add the same line to your `.env` (see `.env.example`):
   ```
   VITE_MAPBOX_STYLE_URL=mapbox://styles/<owner>/<style-id>
   ```

## Verifying

- On a preview deployment, open `/map` and confirm the basemap renders with the
  custom style (dark base, emphasized roads, quieter labels) rather than stock
  `dark-v11`.
- Check the browser console — there should be **no**
  `[mapbox] Ignoring invalid VITE_MAPBOX_STYLE_URL` warning. If you see it,
  the env value isn't a valid `mapbox://styles/` URI or `https://` URL.
- The e2e wiring guard in `e2e/map.spec.ts` asserts the env-var →
  `src/lib/mapbox.ts` → `SpotMap` → `mapbox-gl` path at the network level
  (it runs with the var unset and expects `dark-v11`).

## Self-Hosted Style (advanced)

If you point `VITE_MAPBOX_STYLE_URL` at a self-hosted `https://` style JSON on a
non-Mapbox origin, you must also add that origin to the `connect-src` directive
in `vercel.json` — otherwise the Content-Security-Policy will block the style
fetch. The Mapbox-hosted `mapbox://styles/` path is already allowed by the CSP.
