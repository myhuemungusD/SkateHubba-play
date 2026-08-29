# DSA Compliance Tracker — Deadline MISSED (2026-02-17)

> 🚨 **ESCALATED 2026-08-26. The deadline passed roughly six months ago and every
> account-level row below is still 🔴.** The original heading read "Feb 17" with no
> year, which made a passed hard deadline read as a future one.
>
> This is a live distribution risk, not a documentation problem: unverified trader
> status means EU delisting on both storefronts, and items 1–2 are external
> processes (D&B issuance, Apple org conversion) with 30-day and 2–4 week lead
> times that cannot be compressed.
>
> **The code half is equally unmet.** Reporting and bans exist
> (`src/services/reports.ts`, `admin.bans.ts`, `firestore.rules:2518`), but a
> repo-wide grep for `appeal` and `transparency` across `src/` returns nothing:
> no Art. 16 illegal-content notice path, no Art. 17 statement of reasons, no
> Art. 20 appeal mechanism. Tracked as **P0-4** and **P1-5** in
> [`docs/GAPS.md`](./GAPS.md), which is the register of record for the code side;
> this file tracks the account/trader side. Neither is done.

Status board for EU Digital Services Act (DSA) obligations that gate SkateHubba's
continued distribution on the Apple App Store and Google Play in the EU. Under the
DSA, app marketplaces must verify and display **trader status** for developers
distributing to EU users; an unverified account gets its apps **removed from all
EU storefronts** after the deadline. This file is the single source of truth for
where each item stands — update the Status column as items move.

**Hard deadline: 17 February 2026 — PASSED, unmet.** (store-side enforcement — submissions/updates after
this date without verified trader status are blocked, and existing listings are
delisted in the EU).

**Why this cannot wait:** three of the five items below are external processes with
lead times we do not control (D&B, Apple support). They are strictly sequential
(legal entity → D-U-N-S → Apple org conversion → trader declaration). Worst-case
combined lead time is ~10 weeks before we even reach the in-store declaration step.

---

## Dependency chain

```
Legal entity paperwork
        │
        ▼
  D-U-N-S number ──────────────┐
        │                      │
        ▼                      ▼
Apple Developer Program    Google Play trader
Individual → Organization  declaration
conversion                     │
        │                      │
        ▼                      │
App Store Connect trader  ─────┘
declaration (verified
email + phone + address)
```

## Tracker

| # | Item | Status | Lead time | Blocked by | Owner |
|---|------|--------|-----------|-----------|-------|
| 1 | **D-U-N-S number** — request/verify via Dun & Bradstreet (Apple's free D-U-N-S lookup/request tool). Legal entity name and address must match registration documents exactly. | 🔴 Not started — **START NOW** | Lookup ≈ 5 business days; new number issuance **up to 30 days** | Legal entity details finalized | Jason |
| 2 | **Apple Developer Program: Individual → Organization conversion** — requires the D-U-N-S number, legal entity status (not sole proprietor in most jurisdictions), a public-facing website with a domain-matched email, and a phone verification call from Apple. Apps remain live during migration but App Store Connect access is restricted mid-conversion — do not schedule a release window across it. | 🔴 Not started — **START NOW** (open the support case; Apple will hold it pending the D-U-N-S) | **2–4 weeks** after D-U-N-S resolves | #1 | Jason |
| 3 | **Trader status declaration** — App Store Connect (Business → Digital Services Act) and Google Play Console (Developer page → trader declaration): registered address, phone, and email, each verified by one-time code and **displayed publicly on every EU product page**. | 🔴 Not started | Days, once #2/#4 are done | #2 (Apple side), #4 | Jason |
| 4 | **Email provider trust configuration** — the trader contact mailbox must reliably receive Apple/Google verification codes and DSA-related notices: SPF, DKIM, and DMARC on the sending/receiving domain, no catch-all spam filtering of `apple.com` / `google.com` senders. Use a role address (e.g. `legal@` / `support@` on the app's domain), not a personal Gmail — the address becomes public on the store listing. | 🔴 Not started — **START NOW** (DNS changes + propagation are cheap to do early, painful to debug under deadline) | 1–3 days | Domain/DNS access | Jason |
| 5 | **Data access documentation** — written record of what user data the app collects, where it lives, and who/what can access it, to answer DSA transparency and authority-request obligations. Largely assembled already: `docs/STORE_PRIVACY_ANSWERS.md`, `docs/DATABASE.md`, and the account-deletion cascade (`api/` deletion endpoint + `src/services/*.cascade.ts`). Consolidate into one DSA-facing summary with a named point of contact. | 🟡 Source material exists; DSA-facing summary not written | ~1 week, internal | — | Jason |

## Start-now actions (this week)

1. Confirm the legal entity name/address exactly as registered — every downstream
   verification matches against it character-for-character.
2. Submit the D-U-N-S lookup/request through Apple's tool (item 1).
3. Open the Apple support case for the Individual → Organization conversion so it
   is queued behind the D-U-N-S (item 2).
4. Stand up the trader contact mailbox on the app domain and land SPF/DKIM/DMARC
   (item 4).

## Verification (definition of done)

- [ ] D-U-N-S number issued and visible in Apple's lookup.
- [ ] Apple Developer account shows entity type **Organization**.
- [ ] App Store Connect DSA section shows **trader status: verified**; EU product
      page displays the trader contact details.
- [ ] Google Play Console trader declaration **verified**.
- [ ] Test EU-storefront listing (VPN or EU tester) shows the app with trader info.
- [ ] DSA data-access summary merged into `docs/` and referenced from
      `docs/CHARTER.md`.
