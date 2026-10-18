# Customizable profiles

Flag: `VITE_FEATURE_PROFILE_CUSTOM` (literal `"true"`, default off). Builds on the
profile banner (`VITE_FEATURE_PROFILE_BANNER`).

Benchmarks: Instagram (bio, links, pinned posts), Spotify (profile color, anthem),
Discord Nitro (theme colors + gradient, banner), Steam (showcases), MySpace
(section order, profile song) — kept to one palette icon and a three-tab editor.

## What a player can set

- **Look:** accent color, profile gradient (two colors + angle), banner crop (focal point + zoom).
- **Layout:** order of Pinned clips, Stats, Closet showcase, Crew, Spots; up to 3 pinned clips (own clips only); signature-pieces highlight on/off.
- **About:** bio (280), favorite tricks (5 × 40), links & socials (5, allowlisted hosts), sponsors/shops (5, URL optional but allowlisted), theme song from the clip-editor music library (never autoplays).
- Stance comes from the profile; badges stay the server-granted BadgesRow (earned only, never bought).
- Signature pieces: owned Mike White Signature items show with "Designed by Mike White", signature and collection.

## Data + security

`users/{uid}/profileCustom/main`. `firestore.rules` → `profileCustomValid`: owner-only
write, `docId == 'main'`, exact key set, hex colors, int ranges, full section
permutation, list/length caps, `https://` host allowlist (`LINK_HOSTS` in
`src/services/profileCustom.ts` — keep both in sync; a unit test checks), theme
song ids from `MUSIC_TRACKS`, `updatedAt == request.time`. Public `get`, no `list`.
Images: only the banner, which still goes through `services/banners.ts` (avatar NSFW filter).
Tests: `rules-tests/profile-custom.rules.test.ts`, `src/services/__tests__/profileCustom.test.ts`, `src/screens/__tests__/PlayerProfileScreen.custom.test.tsx`.

## Pro Clip Reel + Pro Spots

Flag: `VITE_FEATURE_PRO_SHOWCASE` (literal `"true"`, default off; tester override turns it on).
Replaces the COMING SOON cards on a verified pro's showcase. Read-only, no rules change:
- **Clip Reel:** the pro's own `pinnedClipIds` above (max 3), resolved via `fetchPinnedClips`.
- **Pro Spots:** spots the pro created (marked Recommended) plus every spot tagged on their clips,
  each linking to `/spots/:id` with the pro's clips from it. `src/services/proShowcase.ts`.
