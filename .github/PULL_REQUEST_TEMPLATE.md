<!--
PR TITLE MUST BE A CONVENTIONAL COMMIT — release-please builds the next
version and CHANGELOG from it. Examples:
  feat: add rematch flow between games
  fix: prevent double-tap on submit match
  docs: document emulator setup
Prefixes: feat, fix, perf, refactor, docs, test, chore, ci, build, style
Breaking change: append `!` (feat!: ...) or add a `BREAKING CHANGE:` footer.
-->

## What & why

<!-- One or two sentences. Link the issue, e.g. Closes #123. -->

## Blast radius

<!-- Per CLAUDE.md: what does this touch? A service-layer change hits every
caller; a firestore.rules / storage.rules change affects every user in
production. -->

- [ ] Smallest diff that solves the problem — no drive-by refactors

## Verification

- [ ] `npm run verify` passes locally (`tsc -b` + `lint` + `test:coverage` + `build` + `check:test-dup`)
- [ ] 100% coverage still holds on `src/services/**` and `src/hooks/**`

## Data-layer & dependency impact

- [ ] `firestore.rules` / `storage.rules` updated if collections or fields changed, and `npm run test:rules` covers it
- [ ] `.env.example` updated if new environment variables were introduced
- [ ] No new dependency — or the addition is justified below with its `npm audit` result and bundle-size impact

<!-- Auto-enforced by CI (not optional):
  - New code under functions/src/ is rejected except the approved stats file set.
  - Changes to .github/workflows/** are flagged for maintainer review.
  - `as any` and TODO/FIXME/HACK in src/ fail the PR gate.
-->
