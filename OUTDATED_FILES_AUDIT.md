# Outdated Files & Patterns Audit

**Date:** 2026-03-24 (revised)
**Original audit:** 2026-03-19
**Project:** SkateHubba-play v1.0.0

---

## Resolved Since Last Audit

The following items from the 2026-03-19 audit have been addressed:

- [x] Firebase JS SDK upgraded to v12.11.0 (was v11.0.0)
- [x] Firebase Messaging SW version synced to 12.11.0
- [x] `firebase-functions` upgraded to v7.0.0 (was v6.3.0)
- [x] Functions `tsconfig.json` migrated to ESM (`"module": "nodenext"`), `compileOnSave` removed
- [x] Functions `engines.node` upgraded to Node 22 (was Node 20)
- [x] Root `package.json` has `"engines": { "node": ">=22" }` and `.nvmrc` with `22`
- [x] `gcm_sender_id` removed from `manifest.json`
- [x] React upgraded to v19.2.4 (was v18.3.1)
- [x] Vite upgraded to v8.0.2 (was v6.0.0)
- [x] `@vitejs/plugin-react` upgraded to v6.0.1 (was v4.3.4)
- [x] Tailwind CSS upgraded to v4.2.2 (was v3.4.15); `postcss.config.js` and `tailwind.config.js` removed
- [x] `@vercel/analytics` upgraded to v2.0.1 (was v1.6.1)
- [x] `jsdom` upgraded to v29.0.1 (was v28.1.0)
- [x] `sitemap.xml` updated with `/privacy` and `/terms` URLs and `<lastmod>` dates

---

## Remaining Items

### 1. Firebase Messaging SW — Hardcoded SDK Version

**File:** `public/firebase-messaging-sw.js:7-8`
**Status:** Version is currently 12.11.0, matching `package.json`. However, the version is still hardcoded in the `importScripts` URL. If `firebase` resolves to a newer patch (e.g. 12.11.1), the SW will drift again.

**Recommendation:** Accept as-is. The Vite build plugin already handles config injection; a version-sync plugin could be added later but the risk is low for patch versions.

---

### 2. CSP Uses `unsafe-inline` for Styles

**File:** `vercel.json` (Content-Security-Policy header)

`style-src 'self' 'unsafe-inline'` weakens CSP. The app uses Tailwind CSS files (not inline styles in most cases), but dynamic `style={}` props for progress bars and SVG transforms require `unsafe-inline`.

**Recommendation:** Low priority. Removing `unsafe-inline` would require nonce-based CSP which adds build complexity. Current risk is limited to style injection, not script injection.

---

### 3. `.lighthouserc.json` — Not Wired into CI

**File:** `.lighthouserc.json`

Config exists with performance/accessibility thresholds but is not referenced in `.github/workflows/main.yml`. Lighthouse runs in the `main.yml` workflow via Vercel preview URLs but does not use this config file.

**Recommendation:** Wire into CI or remove to reduce confusion.

---

### 4. `PRODUCTION_AUDIT.md` and `PRODUCTION_GAP_ANALYSIS.md` — Potentially Stale

**Files:** `PRODUCTION_AUDIT.md`, `PRODUCTION_GAP_ANALYSIS.md`

Large audit documents from initial setup. Many recommendations may already be addressed.

**Recommendation:** Review and archive or delete if no longer actionable.

---

## Summary of Remaining Actions

### Low Priority

- [ ] Wire Lighthouse CI config into workflow or remove `.lighthouserc.json`
- [ ] Review and archive stale `PRODUCTION_AUDIT.md` / `PRODUCTION_GAP_ANALYSIS.md`
- [ ] Harden CSP by replacing `unsafe-inline` for styles (requires nonce-based approach)
