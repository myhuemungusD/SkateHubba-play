#!/usr/bin/env bash
# Prints the SkateHubba dev-team roster on every Claude Code session start.
# Lightweight: no git, no npm, no network — just static output. Must exit fast.

set -eu

cat <<'EOF'
SkateHubba dev team online — 5 specialists + 1 reviewer (all model: opus, no exceptions)
  firebase-engineer     services/, firebase.ts, transactions, listeners
  rules-guardian        firestore.rules, storage.rules, rules-tests/
  frontend-engineer     screens/, components/, hooks/, context/, Tailwind, routes
  qa-engineer           *.test.ts(x), e2e/, coverage, check:test-dup
  release-engineer      .github/workflows/, vercel.json, build, Capacitor
  tech-lead-reviewer    read-only — enforces CLAUDE.md, audits diffs

Slash commands:
  /team <spec>          fan a feature to the team (reviewer → parallel impl → reviewer → ship)
  /ship                 run the verify gate (tsc, lint, coverage, build, test-dup)

Current priorities: see docs/STATUS_REPORT.md for the live board.

Guardrails: CLAUDE.md is the source of truth. No `as any`, no TODO/FIXME, no Cloud
Functions, no Firebase imports outside src/services/**, all game writes via runTransaction.
EOF
