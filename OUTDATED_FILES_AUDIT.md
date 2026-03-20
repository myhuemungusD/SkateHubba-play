# Outdated Files & Patterns Audit

**Date:** 2026-03-19
**Auditor:** Senior Dev Scan
**Project:** SkateHubba-play v1.0.0

---

## Critical Findings

### 1. Firebase Messaging SW — Hardcoded SDK Version Mismatch

**File:** `public/firebase-messaging-sw.js:5-6`

```js
importScripts("https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js");
```

The service worker hardcodes Firebase JS SDK **v11.0.0**, but `package.json` specifies `^11.0.0` which resolves to **11.10.0**. The app and its service worker are running different Firebase SDK versions. This can cause silent messaging failures or token mismatches.

**Fix:** Keep the SW version in sync with the installed SDK version, or extract it into a build step.

---

### 2. `firebase-functions` — Major Version Behind

**File:** `functions/package.json:14`

```json
"firebase-functions": "^6.3.0"
```

Latest is **v7.2.2**. This is a major version behind with breaking changes. The v2 Firestore trigger API used in `functions/src/index.ts` may have changes in v7.

**Fix:** Review the [firebase-functions v7 changelog](https://github.com/firebase/firebase-functions) and upgrade.

---

## Major Outdated Dependencies (Root)

| Package | Current | Latest | Gap | Risk |
|---|---|---|---|---|
| `react` / `react-dom` | 18.3.1 | 19.2.4 | 1 major | High — new concurrent APIs, hooks changes |
| `firebase` | ^11.0.0 | 12.10.0 | 1 major | Medium — auth/firestore API breaking changes |
| `vite` | ^6.0.0 | 8.0.0 | 2 majors | Medium — upgrade with plugin-react |
| `@vitejs/plugin-react` | ^4.3.4 | 6.0.1 | 2 majors | Medium — tied to Vite version |
| `tailwindcss` | ^3.4.15 | 4.2.2 | 1 major | High — complete rewrite to CSS-first |
| `eslint` | ^9.0.0 | 10.0.3 | 1 major | Medium |
| `@vercel/analytics` | ^1.6.1 | 2.0.1 | 1 major | Low — small API surface |
| `jsdom` | ^28.1.0 | 29.0.0 | 1 major | Low — test-only |

*(Already documented in `DEPENDENCY_AUDIT.md` — included here for completeness.)*

---

## Outdated Configuration & Patterns

### 3. Functions `tsconfig.json` — CommonJS Module System

**File:** `functions/tsconfig.json:4`

```json
"module": "commonjs"
```

Firebase Functions v2+ supports ESM. Using CommonJS is legacy. The `compileOnSave: true` option on line 13 is also a relic from older IDE workflows (VS Code doesn't use it).

**Fix:** Consider migrating to ESM (`"module": "nodenext"`) when upgrading firebase-functions.

---

### 4. Functions `engines.node` — Node 20

**File:** `functions/package.json:10`

```json
"engines": { "node": "20" }
```

Node 20 reaches end-of-life in **April 2026** (one month away). The CI already runs on Node 22. Firebase Functions supports Node 22 as of late 2025.

**Fix:** Upgrade to `"node": "22"` in functions and ensure Cloud Functions runtime matches.

---

### 5. No `engines` Field or `.nvmrc` in Root

**File:** `package.json`

No `engines` field or `.nvmrc` file at the project root. CI uses Node 22, but nothing enforces this for local developers. Can cause "works on my machine" issues.

**Fix:** Add `"engines": { "node": ">=22" }` to root `package.json` and/or add an `.nvmrc` with `22`.

---

### 6. `manifest.json` — Legacy `gcm_sender_id`

**File:** `public/manifest.json:10`

```json
"gcm_sender_id": "103953800507"
```

The `gcm_sender_id` field is a legacy artifact from the Google Cloud Messaging era. FCM (Firebase Cloud Messaging) does not require this field. While it doesn't break anything, it's dead config.

**Fix:** Remove the `gcm_sender_id` field.

---

### 7. `sitemap.xml` — Stale / Minimal

**File:** `public/sitemap.xml`

Only contains a single URL with no `<lastmod>` date. If the app has grown to include privacy/terms pages, those should be in the sitemap. The `<changefreq>` element is officially ignored by Google as of 2023.

**Fix:** Add `<lastmod>` dates, add `/privacy` and `/terms` URLs, remove `<changefreq>`.

---

### 8. CSP Uses `unsafe-inline` for Scripts and Styles

**File:** `vercel.json:37` (Content-Security-Policy header)

```
script-src 'self' 'unsafe-inline' ...
style-src 'self' 'unsafe-inline' ...
```

`unsafe-inline` weakens the CSP significantly. The app already loads styles via CSS files (Tailwind) and scripts via modules. Inline styles come from Google Fonts and potentially Tailwind's runtime, which could be addressed with hashes or nonces.

**Fix:** Audit which inline scripts/styles are needed, replace `unsafe-inline` with specific hashes or nonces where possible. This is a medium-effort hardening task.

---

### 9. `postcss.config.js` — Will Need Rewrite for Tailwind v4

**File:** `postcss.config.js`

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

Tailwind CSS v4 eliminates the PostCSS plugin approach entirely. When upgrading to Tailwind v4, this file and `tailwind.config.js` will be replaced by CSS-native configuration. Not broken today, but will be the first files to touch during a Tailwind upgrade.

---

### 10. `.lighthouserc.json` — Not Wired into CI

**File:** `.lighthouserc.json`

The Lighthouse CI config exists but is not referenced in `.github/workflows/main.yml`. It's effectively dead config unless run manually.

**Fix:** Either add a Lighthouse CI step to the workflow, or remove the file to reduce confusion.

---

### 11. `PRODUCTION_AUDIT.md` and `PRODUCTION_GAP_ANALYSIS.md` — Potentially Stale

**Files:** `PRODUCTION_AUDIT.md` (18KB), `PRODUCTION_GAP_ANALYSIS.md` (8KB)

These are large audit documents from the initial setup. If they haven't been updated since initial creation, their recommendations may be stale or already addressed.

**Fix:** Review and update or archive. Consider moving actionable items to issues.

---

## Summary of Recommended Actions

### Do Now (low effort, no risk)
- [ ] Sync `firebase-messaging-sw.js` SDK version with installed Firebase version
- [ ] Remove `gcm_sender_id` from `manifest.json`
- [ ] Add `.nvmrc` with `22`
- [ ] Remove `compileOnSave` from `functions/tsconfig.json`

### Do Soon (medium effort)
- [ ] Upgrade `functions/package.json` to Node 22 engine
- [ ] Upgrade `firebase-functions` to v7
- [ ] Upgrade `@vercel/analytics` to v2
- [ ] Wire Lighthouse CI into workflow or remove `.lighthouserc.json`
- [ ] Update `sitemap.xml` with proper `lastmod` and additional pages

### Plan For (high effort, schedule as sprints)
- [ ] Firebase SDK v11 → v12 migration
- [ ] Vite v6 → v8 + plugin-react v4 → v6
- [ ] Tailwind CSS v3 → v4 (config rewrite)
- [ ] React 18 → 19 (largest effort — new concurrent model)
- [ ] Harden CSP by removing `unsafe-inline`
