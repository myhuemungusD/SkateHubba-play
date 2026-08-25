# Security Scan Record — 2026-07-30

Closes the two verification gaps left open by `docs/PENTEST_2026-05-22.md`, where both
`npm audit` and `npm run test:rules` were **BLOCKED** (network 403s) and the pentest
therefore declined to assert the deployment watertight. Both scans have now been executed
against `main` @ `caaad110` (post binding-dispute feature, #474).

## 1. Firestore rules — dynamic emulator validation

```
npm run test:rules
Test Files  41 passed (41)
Tests       672 passed (672)
```

**Verdict: PASS — gap closed.** Every rules suite passes against the emulator, including
the red-team suites added since the pentest: turn-seize/forgery denials (#472), username
impersonation binding (#473), and the binding-dispute freeze/gap-closure/stat-immutability
suites (#474). The pentest's static rules review found one CRITICAL (unruled
`notifications` collection), which was fixed at the time; the dynamic validation it could
not run now confirms enforcement end-to-end.

## 2. Dependency audit

```
npm audit --audit-level=moderate   → exit 1 (23 advisories: 22 high, 1 moderate)
npm audit --omit=dev               → 7 high (all one chain, see below)
```

**Verdict: EXECUTED, NOT CLEAN — accepted with rationale, tracked below.** The pentest gap
was that the audit could not run at all; it now runs and its findings decompose as:

| Chain                                                                                                  | Ships to users?       | Advisories          | Available "fix"                                                                           | Disposition                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-router` / `react-router-dom` 7.18.1                                                             | **Yes** (prod bundle) | 7 high              | npm proposes a **downgrade** to 7.11.0 (breaking; no forward-fixed release published yet) | **Accepted, monitored.** Downgrading a routing library below the version in production to satisfy an advisory is higher-risk than the advisory. Take the forward fix via Dependabot the release it exists (`chore(deps)` group PR #470 lane). |
| `firebase-tools` transitives (archiver, glob, minimatch, superstatic, brace-expansion, exegesis, tar…) | No — dev/CLI only     | 14 high, 1 moderate | npm proposes downgrade to `firebase-tools@3.18.2` (destructive)                           | **Accepted.** Never in the shipped bundle; per CI policy (`main.yml` audit-nightly comments) known-unfixable tool-chain advisories are drift, handled by Dependabot.                                                                          |
| `eslint` transitives                                                                                   | No — dev only         | (counted above)     | `eslint@10` major                                                                         | **Accepted.** Dev-deps group PR #453 lane.                                                                                                                                                                                                    |

CI context: the repo's audit gate is deliberately scoped (see `.github/workflows/main.yml`,
"Dependency audit, scoped to what this change can control") — it **blocks** any change that
touches the dependency manifests and is **report-only** for drift, with the nightly
`audit-nightly` job as the alert channel and Dependabot as the fix channel. This record does
not change that policy; it documents the current drift set and its rationale so the
pentest's open item can be marked resolved-with-known-drift rather than unverified.

## Standing follow-ups

- Merge the forward `react-router` fix the moment a fixed release ships (watch Dependabot
  production-dependencies group PRs).
- Re-run both scans (and update this record) at the next release cut.
