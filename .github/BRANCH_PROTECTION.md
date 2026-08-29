# Branch Protection Rules

This document defines the branch protection rules for the `main` branch. These rules **must** be configured in GitHub → Settings → Branches → Branch protection rules (or via repository rulesets).

## Background

In early 2026, unsupervised AI coding agents (Claude Code, GitHub Copilot) pushed changes directly to `main` that:

1. Rewrote working game logic without approval
2. Added Cloud Functions that were never requested
3. Modified CI workflows without review

The rules below prevent this class of incident from recurring. (`main.yml` today defines four jobs — `build-and-test`, `e2e`, `lighthouse`, and `audit-nightly` — see the table below.)

---

## Required Rules for `main`

Configure these in **GitHub → Settings → Branches → Add rule** (pattern: `main`):

### 1. Require pull request before merging

- **Required approving reviews**: 1
- **Dismiss stale pull request approvals when new commits are pushed**: ✅
- **Require review from Code Owners**: ✅ (see `.github/CODEOWNERS`)
- **Require approval of the most recent reviewable push**: ✅

### 2. Require status checks to pass before merging

- **Require branches to be up to date before merging**: ✅
- **Required status checks**:
  - `build-and-test` (from `.github/workflows/main.yml`)
  - `enforce-pr-policy` (from `.github/workflows/pr-gate.yml`)
  - `verify-no-cloud-functions` (from `.github/workflows/pr-gate.yml`)
  - `Validate Firebase rules changes` (from `.github/workflows/pr-gate.yml`)

> ⚠️ **Use the display name, not the job id.** That job sets
> `name: Validate Firebase rules changes` (`pr-gate.yml:153`), so GitHub
> publishes the check run under that string. A required check registered as
> `validate-firebase-rules` never reports and leaves every PR stuck on
> "Expected — Waiting for status to be reported".
> `scripts/apply-branch-protection.sh` currently carries the job-id form and
> needs the same correction.

> **Automation:** `scripts/apply-branch-protection.sh` applies every rule
> below **except §5 (push restrictions)** via `gh api`. Run it whenever this
> checklist changes so the remote repo stays in sync with the documented
> policy.
>
> ⚠️ The script sends `"restrictions": null`, which _clears_ push
> restrictions. If §5 was set through the UI, running the script silently
> removes it — re-apply §5 in the UI afterwards, or fix the payload to
> `{"users": ["myhuemungusD"], "teams": [], "apps": []}`.

### 3. Require conversation resolution before merging

- ✅ All review comments must be resolved

### 4. Do not allow bypassing the above settings

- ✅ Even administrators must follow these rules

### 5. Restrict who can push to matching branches

- Only the repository owner (`@myhuemungusD`) may push directly
- AI agents and bot accounts must go through pull requests

### 6. Block force pushes

- ✅ Do not allow force pushes

### 7. Block deletions

- ✅ Do not allow branch deletion

---

## Automated Guards (CI-Enforced)

In addition to GitHub's branch protection settings, the following CI checks run on every PR to `main` (plus the out-of-band `audit-nightly` job at the bottom of the table, which runs on a schedule rather than per PR):

| Check                             | Workflow                    | Purpose                                                                                                |
| --------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `enforce-pr-policy`               | `pr-gate.yml`               | Confirms the change arrived via PR                                                                     |
| `verify-no-cloud-functions`       | `pr-gate.yml`               | Rejects any `functions/src/` file outside the approved stats close-out allowlist                       |
| `verify-workflow-changes`         | `pr-gate.yml`               | Warns when `.github/workflows/` files are modified                                                     |
| `Validate Firebase rules changes` | `pr-gate.yml`               | Runs emulator rules tests when Firestore/Storage rules change (job id `validate-firebase-rules`)       |
| `guard-as-any-casts`              | `pr-gate.yml`               | Rejects `as any` in `src/` and `functions/src/` production code                                        |
| `guard-todo-fixme-hack`           | `pr-gate.yml`               | Rejects `TODO` / `FIXME` / `HACK` in production code                                                   |
| `check-test-duplication`          | `pr-gate.yml`               | Flags duplicated test blocks                                                                           |
| `check-file-length`               | `pr-gate.yml`               | Reports files over the LOC budgets (`continue-on-error: true` — non-blocking)                          |
| `build-functions`                 | `pr-gate.yml`               | Builds and tests the approved Cloud Functions codebase when it changes                                 |
| `e2e`                             | `main.yml`                  | Playwright end-to-end suite against the Firebase emulators                                             |
| `build-and-test`                  | `main.yml`                  | Lint, type check, tests, build (blocking `npm audit` when this PR touches deps; report-only otherwise) |
| `lighthouse`                      | `main.yml`                  | Performance regression check                                                                           |
| Rules deploy                      | `firebase-rules-deploy.yml` | Pushes `firestore.rules` / `storage.rules` / indexes to production on merge to `main`                  |
| Infra setup                       | `firebase-infra-setup.yml`  | Manual workflow for daily Firestore backups + 90-day Storage lifecycle (`workflow_dispatch`)           |
| `audit-nightly`                   | `main.yml`                  | Nightly `npm audit` against main's lockfile — catches drift no PR can gate (schedule + dispatch)       |

---

## CODEOWNERS

The `.github/CODEOWNERS` file assigns `@myhuemungusD` as the default owner for all files. When "Require review from Code Owners" is enabled, every PR requires their approval.

---

## What AI Agents Must Do

1. **Always work on a feature branch** — never commit directly to `main`
2. **Open a pull request** — all changes must go through PR review
3. **Do not modify CI workflows** without explicit maintainer approval
4. **Do not add new Cloud Functions** — the app is a serverless Firebase SPA by design. One maintainer-approved codebase exists (the stats close-out function). `verify-no-cloud-functions` pins its exact file set — `functions/src/index.ts`, `index.test.ts`, `applyGameStats.ts`, `applyGameStats.test.ts` — and hard-fails any other file under `functions/src/`. See `docs/CHARTER.md` §4.14.
5. **Do not rewrite existing game logic** without a linked issue and approval

---

## Setup Checklist

You can apply the entire ruleset in one command:

```bash
GITHUB_REPO=myhuemungusD/skatehubba-play bash scripts/apply-branch-protection.sh
```

Or click through the UI:

- [ ] Go to GitHub → Settings → Branches → Add branch protection rule
- [ ] Set branch name pattern to `main`
- [ ] Enable "Require a pull request before merging"
- [ ] Set required approving reviews to 1
- [ ] Enable "Dismiss stale pull request approvals when new commits are pushed"
- [ ] Enable "Require review from Code Owners"
- [ ] Enable "Require approval of the most recent reviewable push"
- [ ] Enable "Require status checks to pass before merging"
- [ ] Enable "Require branches to be up to date before merging"
- [ ] Add required status checks: `build-and-test`, `enforce-pr-policy`, `verify-no-cloud-functions`, `Validate Firebase rules changes` (display name — see the warning above)
- [ ] Enable "Require conversation resolution before merging"
- [ ] Enable "Do not allow bypassing the above settings"
- [ ] Enable "Restrict who can push to matching branches" (add `@myhuemungusD`) — **UI only**, `apply-branch-protection.sh` does not set this
- [ ] Disable "Allow force pushes"
- [ ] Disable "Allow deletions"
