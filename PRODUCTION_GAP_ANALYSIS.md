# Production Gap Analysis — SkateHubba-Play

**Date:** 2026-03-15
**Stack:** React 18 + TypeScript + Firebase (Auth / Firestore / Storage) + Vercel

---

## Executive Summary

SkateHubba-Play is a well-architected, lean MVP (4 production dependencies) that is **deployable today** but **not yet fully production-hardened**. Strong points: tight Firestore security rules, comprehensive service-layer tests, type-safe codebase. Critical gaps: no error tracking, no rate limiting / anti-abuse, no GDPR/data-retention strategy, and no automated deployment pipeline.

---

## Gap Analysis by Category

### 1. Monitoring & Observability — ❌ CRITICAL GAP

| What's There | What's Missing |
|---|---|
| Vercel Analytics (page views, Core Web Vitals) | Error tracking (Sentry / LogRocket) |
| `console.error/warn` in key paths | Structured logging (JSON, log levels) |
| Firebase Console basic usage metrics | Custom game-event analytics (trick submit, forfeit, match complete) |
| ErrorBoundary with stack trace | APM / response-time monitoring |
| | Uptime / health-check monitoring |
| | Firestore read/write rate dashboards |

**Recommended actions:**
- Integrate Sentry (free tier sufficient for MVP) for automatic exception capture
- Add custom Vercel Analytics `track()` calls at key game events
- Configure Firebase Alerts (quota, auth anomalies)

---

### 2. Rate Limiting & Anti-Abuse — ❌ CRITICAL GAP

| What's There | What's Missing |
|---|---|
| Firestore rules reject invalid data | Per-user rate limiting on write paths |
| Username uniqueness via atomic transaction | CAPTCHA / Bot detection on sign-up / password reset |
| Email regex validation | Firebase App Check (DeviceCheck / reCAPTCHA Enterprise) |
| | Brute-force protection on sign-in |
| | Spam game creation prevention |

**Recommended actions:**
- Enable **Firebase App Check** (free, reCAPTCHA v3 for web) — blocks non-app traffic
- Add Firestore Rules throttle logic (`request.time > resource.data.lastWrite + duration.value(60, 's')`) on game creation

---

### 3. Security — ⚠️ PARTIAL

| What's There | What's Missing |
|---|---|
| Tight Firestore rules (ownership, score monotonicity, self-challenge prevention) | CSP / X-Frame-Options / HSTS headers in `vercel.json` |
| Storage rules: type + size enforcement (`video/webm`, 1KB–50MB) | Email verification **not enforced** before game play |
| Firebase URL domain allowlist | 2FA / phone sign-in |
| React JSX XSS prevention | Audit log of sensitive operations |
| Password strength indicator | Session timeout / inactivity logout |

**Recommended actions (priority order):**
1. Add security headers to `vercel.json`:
   ```json
   { "key": "Content-Security-Policy", "value": "default-src 'self' *.googleapis.com *.firebaseapp.com *.firebasestorage.app; ..." }
   { "key": "X-Frame-Options", "value": "DENY" }
   { "key": "X-Content-Type-Options", "value": "nosniff" }
   { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" }
   ```
2. Enforce email verification before `createGame()` is allowed
3. Enable Firebase App Check (blocks unauthenticated Firestore access from non-app clients)

---

### 4. CI/CD & Deployment — ⚠️ PARTIAL

| What's There | What's Missing |
|---|---|
| GitHub Actions: typecheck → test → build on push + PR | Automated deployment to Vercel on merge to `main` |
| `package-lock.json` (deterministic installs) | Automated `firebase deploy --only firestore:rules,storage` |
| Vercel SPA routing configured | Staging environment (Vercel Preview + Firebase Emulator) |
| | Branch protection rules on `main` |
| | Code coverage reporting (Codecov / Coveralls) |
| | Rollback procedure documented |
| | Lighthouse CI in pipeline |

**Recommended actions:**
1. Add Vercel GitHub integration for automatic preview + production deploys
2. Add `firebase deploy` step in CI after successful build (using `FIREBASE_TOKEN` secret)
3. Add `--coverage` to vitest run and upload to Codecov
4. Enforce branch protection: require CI green + 1 review before merge to `main`

---

### 5. Data Privacy & Compliance — ❌ CRITICAL GAP

| What's There | What's Missing |
|---|---|
| Firebase Auth (email stored by Google) | GDPR account + data deletion endpoint |
| Firestore user profiles | User data export (GDPR Article 20 right to portability) |
| | Video retention policy (currently stored indefinitely) |
| | Privacy Policy page / link |
| | Cookie consent (Vercel Analytics uses cookies) |
| | Terms of Service |

**Recommended actions:**
1. Implement "Delete My Account" flow: delete Firestore profile, username reservation, game docs, Storage videos, then Firebase Auth user
2. Set Firebase Storage lifecycle rules to auto-delete videos after N days
3. Add Privacy Policy and ToS pages (required for App Store / Play Store if mobile is planned)
4. Add cookie consent banner if serving EU users

---

### 6. Testing — ⚠️ PARTIAL

| What's There | What's Missing |
|---|---|
| Unit tests: auth, users, games, storage, useAuth hook | E2E tests (Playwright / Cypress) for critical flows |
| Integration smoke test (`smoke-e2e.test.tsx`) | Accessibility testing (axe-core / Lighthouse) |
| Firebase mocks in test suite | Performance testing (video upload latency) |
| Vitest + React Testing Library | Visual regression tests |
| | Test coverage enforcement (threshold) |

**Recommended actions:**
1. Add `--coverage --coverage.thresholds.lines=80` to CI test command
2. Add Playwright E2E for: sign-up → create game → submit trick → complete game flow
3. Add `axe-core` accessibility scan to CI

---

### 7. Performance — ⚠️ UNKNOWN BASELINE

| What's There | What's Missing |
|---|---|
| Vite code splitting (vendor / firebase / app chunks) | Lighthouse CI baseline and budgets |
| Tailwind CSS (purged in production) | CDN/cache headers on Firebase Storage video URLs |
| Vercel edge network | Service worker for offline / pre-caching |
| Firestore local persistence (offline reads) | Image/video lazy loading audit |
| | Bundle size monitoring over time |

**Recommended actions:**
1. Add `@lhci/cli` to CI: `lhci autorun --upload.target=temporary-public-storage`
2. Set `Cache-Control: public, max-age=86400` on Storage video objects via `storage.rules` metadata
3. Add `rel="preconnect"` for Firebase domains in `index.html`

---

### 8. Error Handling & Resilience — ⚠️ PARTIAL

| What's There | What's Missing |
|---|---|
| ErrorBoundary with fallback UI | Retry logic with exponential backoff on Firestore ops |
| `try/catch` in all async service functions | Graceful offline mode / reconnect UI |
| Google OAuth popup → redirect fallback | Toast notifications for non-critical failures |
| `console.warn` for recoverable errors | User-facing messages for all error codes |

**Recommended actions:**
1. Wrap game subscription reconnect logic with exponential backoff
2. Add a toast/notification system for transient errors (network offline, upload failed)
3. Show "You're offline" banner when Firestore reconnects

---

### 9. Backups & Disaster Recovery — ❌ CRITICAL GAP

| What's There | What's Missing |
|---|---|
| Firebase point-in-time recovery (not configured) | Scheduled Firestore exports to GCS |
| | Storage backup / replication |
| | Recovery time objective (RTO) documented |
| | Incident response runbook |

**Recommended actions:**
1. Enable **Cloud Firestore managed exports** (daily, to GCS bucket)
2. Document RTO/RPO targets and recovery procedure in `RUNBOOK.md`

---

### 10. Code Quality & Maintainability — ⚠️ WATCH

| What's There | What's Missing |
|---|---|
| TypeScript strict mode | `App.tsx` is 1,692 lines — needs decomposition |
| ESLint (via Vite default) | Lint step in CI (`npm run lint`) |
| Service layer separation | Component decomposition plan |
| Custom hooks for auth state | ADRs (Architecture Decision Records) |

**Recommended actions:**
1. Split `App.tsx` into route-based components (`GameLobby`, `TrickTurn`, `Scoreboard`, etc.)
2. Add `eslint` script + enforce in CI
3. Document key architecture decisions (why Firebase vs custom backend, etc.)

---

## Prioritized Action Plan

### P0 — Launch Blockers (do before public launch)
| # | Action | Effort |
|---|---|---|
| 1 | Add Sentry error tracking | 2h |
| 2 | Add security headers to `vercel.json` (CSP, HSTS, X-Frame) | 1h |
| 3 | Enable Firebase App Check | 2h |
| 4 | Add Privacy Policy + ToS pages | 4h |
| 5 | Implement "Delete My Account" flow | 4h |

### P1 — Production Hardening (first sprint post-launch)
| # | Action | Effort |
|---|---|---|
| 6 | Enforce email verification before game creation | 2h |
| 7 | Automate Vercel + Firebase deployment in CI | 3h |
| 8 | Enable Firestore scheduled exports (backups) | 1h |
| 9 | Add Lighthouse CI to pipeline | 2h |
| 10 | Video retention policy (Storage lifecycle rules) | 1h |

### P2 — Scale & Quality (ongoing)
| # | Action | Effort |
|---|---|---|
| 11 | Decompose App.tsx into smaller components | 8h |
| 12 | Add Playwright E2E test suite | 8h |
| 13 | Add test coverage enforcement (80% threshold) | 1h |
| 14 | Add cookie consent banner | 2h |
| 15 | Retry / exponential backoff for Firestore ops | 3h |

---

## Overall Production Readiness Score

| Category | Score |
|---|---|
| Tests | ⚠️ 6/10 — unit tests solid; E2E missing |
| CI/CD | ⚠️ 5/10 — CI runs; no auto-deploy or coverage |
| Security | ⚠️ 7/10 — Firestore rules strong; no App Check, no CSP |
| Monitoring | ❌ 2/10 — analytics only; no error tracking |
| Error Handling | ⚠️ 6/10 — Error Boundary + try-catch; no retry logic |
| Data Privacy | ❌ 2/10 — no deletion, no retention policy |
| Deployment | ⚠️ 6/10 — Vercel ready; no automation |
| Performance | ⚠️ 5/10 — code split; no baseline metrics |
| Backups | ❌ 1/10 — not configured |
| Documentation | ⚠️ 6/10 — good deployment guide; no runbook |
| **Overall** | **⚠️ 4.6/10** |

**Verdict:** Ready for a **soft launch / closed beta**. Reach **7/10** by completing P0 + P1 items (~28h effort). Not recommended for open public launch without error tracking and privacy compliance.
