# Branch Protection Rules

This document defines the branch protection rules for the `main` branch. These rules **must** be configured in GitHub → Settings → Branches → Branch protection rules (or via repository rulesets).

## Background

In early 2026, unsupervised AI coding agents (Claude Code, GitHub Copilot) pushed changes directly to `main` that:

1. Rewrote working game logic without approval
2. Added Cloud Functions that were never requested (the guard is now an allowlist, not a blanket ban — see below)
3. Modified CI workflows without review

The rules below prevent this class of incident from recurring. (`main.yml` today defines four jobs — `build-and-test`, `e2e`, `lighthouse`, and `audit-nightly` — see the table below.)

---

## Required Rules for `main`

This is the protection that is **live on `main`** (last synced 2026-10-07).
`scripts/apply-branch-protection.sh` applies exactly this payload, so the
script, this file and GitHub stay in sync. Re-run the script after editing
either one.

### 1. Require a pull request before merging

- ✅ Required, with **0 approving reviews**. The repo has a single maintainer
  and GitHub doesn't let you approve your own PR, so requiring approvals
  would make every maintainer PR unmergeable. The PR requirement plus the
  required checks below is what stops direct pushes from agents and bots.
- If a second maintainer joins: raise approvals to 1 and turn on
  "Require review from Code Owners" (`.github/CODEOWNERS` is already in place).

### 2. Require status checks to pass before merging

- **Require branches to be up to date before merging**: ✅ (strict)
- **Required status checks** (all from the GitHub Actions app, all run on
  every PR to `main`; the change-scoped ones skip their heavy steps and pass
  when nothing relevant changed):
  - `build-and-test` (`main.yml`)
  - `e2e` (`main.yml`)
  - `enforce-pr-policy` (`pr-gate.yml`)
  - `guard-as-any-casts` (`pr-gate.yml`)
  - `guard-todo-fixme-hack` (`pr-gate.yml`)
  - `verify-no-cloud-functions` (`pr-gate.yml`)
  - `verify-workflow-changes` (`pr-gate.yml`)
  - `Validate Firebase rules changes` (`pr-gate.yml`)
  - `Build and test Cloud Functions` (`pr-gate.yml`)

> ⚠️ **Use the display name, not the job id.** Jobs with a `name:` publish
> their check run under that name (`Validate Firebase rules changes`, not
> `validate-firebase-rules`). A required check registered under the job id
> never reports and leaves every PR stuck on "Expected — Waiting for status
> to be reported".
>
> Don't make a check required unless it runs on **every** PR. A workflow with
> `paths:` filters (or one that only runs on `push`) never reports on the PRs
> it skips, and those PRs can never merge.

### 3. Require conversation resolution before merging

- ✅ All review threads must be resolved

### 4. Require linear history

- ✅ Only squash merges are enabled in repo settings (merge commits and
  rebase merges are off), and the squash commit title is the PR title, so
  every commit on `main` is a Conventional Commit that release-please can read.

### 5. Admin bypass

- `enforce_admins` is **off**, so the repository owner keeps a break-glass
  path. Turn it on to hold admins to the same rules.

### 6. Block force pushes and deletions

- ✅ Force pushes blocked
- ✅ Branch deletion blocked

### 7. Not required (on purpose)

- **Signed commits**: off. Dependabot and agent commits are unsigned and
  would be blocked.

---

## Automated Guards (CI-Enforced)

In addition to GitHub's branch protection settings, the following CI checks run on every PR to `main` (plus the out-of-band `audit-nightly` job at the bottom of the table, which runs on a schedule rather than per PR):

| Check                             | Workflow                    | Purpose                                                                                                                               |
| --------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `enforce-pr-policy`               | `pr-gate.yml`               | Confirms the change arrived via PR                                                                                                    |
| `verify-no-cloud-functions`       | `pr-gate.yml`               | Enforces the `functions/src/` **allowlist** — the stats close-out files and `functions/src/dice/*.ts` pass, anything else is rejected |
| `verify-workflow-changes`         | `pr-gate.yml`               | Warns when `.github/workflows/` files are modified                                                                                    |
| `Validate Firebase rules changes` | `pr-gate.yml`               | Runs emulator rules tests when Firestore/Storage rules change (job id `validate-firebase-rules`)                                      |
| `guard-as-any-casts`              | `pr-gate.yml`               | Rejects `as any` in `src/`, `functions/src/` and `api/` production code                                                               |
| `guard-todo-fixme-hack`           | `pr-gate.yml`               | Rejects `TODO` / `FIXME` / `HACK` in `src/` and `api/`                                                                                |
| `check-test-duplication`          | `pr-gate.yml`               | Flags duplicated test blocks                                                                                                          |
| `check-file-length`               | `pr-gate.yml`               | Reports files over the LOC budgets (`continue-on-error: true` — non-blocking)                                                         |
| `Build and test Cloud Functions`  | `pr-gate.yml`               | Builds, tests and audits (high+) the approved Cloud Functions codebase when it changes                                                |
| `e2e`                             | `main.yml`                  | Playwright end-to-end suite against the Firebase emulators                                                                            |
| `build-and-test`                  | `main.yml`                  | Lint, type check, tests, build (blocking `npm audit` when this PR touches deps; report-only otherwise)                                |
| `lighthouse`                      | `main.yml`                  | Performance regression check                                                                                                          |
| Rules deploy                      | `firebase-rules-deploy.yml` | Pushes `firestore.rules` / `storage.rules` / indexes to production on merge to `main`                                                 |
| Infra setup                       | `firebase-infra-setup.yml`  | Manual workflow for daily Firestore backups + 90-day Storage lifecycle (`workflow_dispatch`)                                          |
| `audit-nightly`                   | `main.yml`                  | Nightly `npm audit` of main's root lockfile (moderate+) and `functions/` lockfile (high+)                                             |
| CodeQL                            | `codeql.yml`                | Static analysis (JS/TS, Actions, Python) on PRs, pushes to main and weekly. Not required yet                                          |

---

## CODEOWNERS

`.github/CODEOWNERS` assigns `@myhuemungusD` as the default owner for all files,
so they are auto-requested as reviewer on every PR. Code-owner review is not
enforced while there is a single maintainer (see §1).

---

## What AI Agents Must Do

1. **Always work on a feature branch** — never commit directly to `main`
2. **Open a pull request** — all changes must go through PR review
3. **Do not modify CI workflows** without explicit maintainer approval
4. **Do not add Cloud Functions outside the allowlist** — the app is a serverless
   Firebase SPA by design. `pr-gate.yml` permits the maintainer-approved stats
   close-out files under `functions/src/` (`index.ts`, `index.test.ts`,
   `applyGameStats.ts`, `applyGameStats.test.ts`, approved 2026-07) and Roll Dice
   under `functions/src/dice/*.ts` (approved 2026-10). Editing those is fine;
   adding any other file there hard-fails the gate
5. **Do not rewrite existing game logic** without a linked issue and approval

---

## Setup

Apply the whole ruleset in one command (needs admin on the repo):

```bash
GITHUB_REPO=myhuemungusD/SkateHubba-play bash scripts/apply-branch-protection.sh
```

The script replaces the protection on `main` with the payload above. Repo
settings that go with it (Settings → General → Pull Requests): squash merging
only, default commit message "Pull request title and commit details", "Always
suggest updating pull request branches", "Allow auto-merge" and
"Automatically delete head branches" all on.
