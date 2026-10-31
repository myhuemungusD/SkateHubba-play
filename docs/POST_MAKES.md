# Post your makes (planned)

Status: not built. `VITE_FEATURE_POST_MAKES_ENABLED` is reserved for this flow
and nothing reads it yet. The spec below used to live as a comment in
`src/screens/GameOverScreen.tsx`. Source: PR
[#715](https://github.com/myhuemungusD/SkateHubba-play/pull/715), section
"GameOver post flow".

When the flag is `"true"`, the game-over screen will:

- Show a "Post your makes" section above the share and rematch buttons.
- List the current user's landed tricks from `turnHistory` (turns where they
  were the matcher and `landed` is true).
- Check that both players have `trainingConsentOptedIn` set to true.
- Offer one-tap publish with the checkboxes pre-checked.
- Submit to the `clips` collection. This needs the video copied from game
  storage to `userClips/` storage first.

When it ships, add an `isPostMakesEnabled()` reader to `src/lib/featureFlags.ts`
and render the section from `GameOverScreen.tsx`.
