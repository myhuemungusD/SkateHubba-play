# Phone layout (Oct 2026)

SkateHubba is played on a phone, in a browser or in the Capacitor iOS/Android shell. This note covers the layout fixes from the Oct 8, 2026 mobile review and the one thing that still needs a real device.

Screenshots from the emulator pass live in `docs/mobile-phone-layout/`. Headless Chromium cannot open a real keyboard or draw an iOS notch, so those two checks are called out below.

## What changed for a skater

- **Notifications.** On a phone the bell sits in the middle of the lobby header, so a 320px menu anchored to the bell ran off the left edge. Below 933px (covers landscape phones) it is a full-width sheet under the header. Wider windows keep the 320px popover.
- **Landed / Missed, and the record button.** A 9:16 clip is capped at 55dvh. The control that sends the turn is a fixed bar at the bottom of the screen, above the home indicator. A sticky bar cannot pull a button up into view when it starts below the fold, so the bar is `position: fixed`. The same bar is used for referee and review actions, and for Roll / Leave on a dice table.
- **Cookie banner.** On a short screen it is one compact row (`max-h: 20dvh`). Landing and sign-up reserve that height, and the page's scroll padding keeps Sign in, Create account, and the date of birth above it.
- **Landscape landing.** The hero starts below the fixed header, and the spacing tightens when the screen is shorter than 500px, so "Free to play" is not under the bar.
- **Scroll.** Changing routes resets the window scroll and any screen marked `data-scroll-root`, so game over opens on the result instead of the rematch buttons.
- **Tap targets.** Flag, the bell, delete-notification, mute, Mark all read, Clear all, challenge rows, and the dice Back / Decline / Leave controls are at least 44×44.
- **Type that carries meaning.** Countdown on a game card, win/loss on the leaderboard, and the landing mock caption are 12px with enough contrast to read outside. Small badges on orange (PLAY, YOU, unread count) use black text.
- **Keyboard.** Focusing an input scrolls it into view. `visualViewport` publishes the overlap as `--keyboard-inset`, and the viewport meta asks Android Chrome to resize with `interactive-widget=resizes-content`.
- **Lobby tour.** While the tour card is open the lobby list can scroll the finished-games row clear of the card. The completion check was already correct: a saved version number without `completedAt` or `skippedAt` still shows the tour.
- **Auth paint.** The card entrance is transform-only, so `/auth` has something to paint on the first frame (Largest Contentful Paint).
- **Roll Dice.** Hub, picker, and table use the same safe-area padding, 44px controls, and bottom action bar. The dice feature stays behind `VITE_FEATURE_DICE_ENABLED`.

## Real-device check: iOS safe area

`ios.contentInset` is still `"always"`. `StatusBar.overlaysWebView` is `false`, and CSS also adds `env(safe-area-inset-*)` because `viewport-fit=cover` is set.

On some Capacitor / iOS combinations those insets stack and the header or bottom nav sits too far in. On others `env()` reports 0 and only the CSS fallback applies. Headless Chrome cannot show a notch, so the value was not changed. Confirm on a real iPhone 15 before switching `contentInset` to `"never"` (CSS would then own the inset). The comment in `capacitor.config.ts` points here.

## Not changed

- Game rules, Firestore rules, and Cloud Functions.
- Map, Feed, and Verified Pro stay behind the feature freeze.
- Lazy-loading Firebase Auth, App Check, and reCAPTCHA (the landing page's main thread time). That touches first paint of sign-in and was left alone.
- Content-Security-Policy in `vercel.json`. No blocked resource was identified from this UI pass.
- Decorative 8–10px type on admin, clips, and map screens, and the legal-copy / image-dimension nits from the review.
