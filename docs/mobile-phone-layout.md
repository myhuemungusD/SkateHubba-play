# Phone layout (Oct 2026)

SkateHubba is played on a phone, in a browser or in the Capacitor iOS/Android shell. This note covers the layout fixes from the Oct 8, 2026 mobile review and the one thing that still needs a real device.

After screenshots from the emulator pass (Playwright, the same phone sizes as the review):

- `docs/mobile-phone-layout/after/notifications-393.png` — the bell sheet on an iPhone 15
- `docs/mobile-phone-layout/after/land-miss-375.png` — Landed / Missed on an iPhone SE after a take
- `docs/mobile-phone-layout/after/landing-landscape.png` — sideways landing, header clear, sign-in above the cookie row
- `docs/mobile-phone-layout/after/signup-se.png` — date of birth clear of the cookie row
- `docs/mobile-phone-layout/after/dice-se.png` and `dice-landscape.png` — Roll Dice with the flag on

The Oct 8 review's before shots were not in the git tree, so they are not copied here. Headless Chromium cannot open a real keyboard or draw an iOS notch, so those two checks are called out below.

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

## Google app on iOS

Safari on the same phone already shows the lobby header in full. The Google app's in-app browser (user agent contains `GSA/`) draws a floating address bar on top of the web view instead of resizing it. `env(safe-area-inset-top)` does not include that bar, and `visualViewport.offsetTop` stays 0 because the bar is outside the web view. The header starts underneath it.

`src/lib/toolbarOverlay.ts` publishes `--overlay-top` only for that browser. In-flow pages (the lobby header included) pick it up as body padding. Fixed bars (landing nav, offline banner, toasts, the bell sheet) read the same variable. Safari, Chrome on iOS, the installed home-screen app, and the Capacitor shell get `0`, so they do not move. If the web view does report a real top offset, that number is used instead of the 64px fallback.

The lobby list already scrolls the document, not an inner box, so Safari can collapse its own toolbar. The Google bar does not collapse. The faint shapes under "20 finished" are the graffiti wallpaper showing through the translucent lobby background. Finished games are one line, not placeholder cards, and the tour does not dim the page.

## iOS safe area

`ios.contentInset` is `"never"`. On the native shell only, `initStatusBar()` sets the status bar to overlay the webview, so `env(safe-area-inset-*)` is the single inset and the scroll view does not add another one. Android still uses a solid status bar and does not overlay. The CSS classes (`.pt-safe`, `.pb-safe`) are unchanged, so Safari and the installed website render the way they did before.

The unsigned simulator job boots a notched iPhone and an iPhone SE and uploads screenshots of the landing, sign-in, and privacy screens.

`--overlay-top` is 0 inside the shell, so the Google-app inset does not stack on `contentInset`.

## Not changed

- Game rules, Firestore rules, and Cloud Functions.
- Map, Feed, and Verified Pro gating (the feature freeze was lifted 2026-10-10; they are live in production).
- Lazy-loading Firebase Auth, App Check, and reCAPTCHA (the landing page's main thread time). That touches first paint of sign-in and was left alone.
- Content-Security-Policy in `vercel.json`, aside from the Apple sign-in hosts added so Sign in with Apple can load.
- Decorative 8–10px type on admin, clips, and map screens, and the legal-copy / image-dimension nits from the review.
