# Branch Protection Rules

This document defines the branch protection rules for the `main` branch. These rules **must** be configured in GitHub → Settings → Branches → Branch protection rules (or via repository rulesets).

## Background

In early 2026, unsupervised AI coding agents (Claude Code, GitHub Copilot) pushed changes directly to `main` that:

1. Rewrote working game logic without approval
2. Added Cloud Functions that were never requested
3. Modified CI workflows without review

The CI pipeline has since been pruned to `build-and-test` only. The rules below prevent this class of incident from recurring.

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

In addition to GitHub's branch protection settings, the following CI checks run on every PR to `main`:

| Check | Workflow | Purpose |
|---|---|---|
| `enforce-pr-policy` | `pr-gate.yml` | Confirms the change arrived via PR |
| `verify-no-cloud-functions` | `pr-gate.yml` | Rejects new Cloud Functions code in `functions/src/` |
| `verify-workflow-changes` | `pr-gate.yml` | Warns when `.github/workflows/` files are modified |
| `build-and-test` | `main.yml` | Lint, type check, tests, build |
| `lighthouse` | `main.yml` | Performance regression check |

---

## CODEOWNERS

The `.github/CODEOWNERS` file assigns `@myhuemungusD` as the default owner for all files. When "Require review from Code Owners" is enabled, every PR requires their approval.

---

## What AI Agents Must Do

1. **Always work on a feature branch** — never commit directly to `main`
2. **Open a pull request** — all changes must go through PR review
3. **Do not modify CI workflows** without explicit maintainer approval
4. **Do not add Cloud Functions** — the app is a serverless Firebase SPA by design
5. **Do not rewrite existing game logic** without a linked issue and approval

---

## Setup Checklist

Use this checklist when configuring branch protection on GitHub:

- [ ] Go to GitHub → Settings → Branches → Add branch protection rule
- [ ] Set branch name pattern to `main`
- [ ] Enable "Require a pull request before merging"
- [ ] Set required approving reviews to 1
- [ ] Enable "Dismiss stale pull request approvals when new commits are pushed"
- [ ] Enable "Require review from Code Owners"
- [ ] Enable "Require approval of the most recent reviewable push"
- [ ] Enable "Require status checks to pass before merging"
- [ ] Enable "Require branches to be up to date before merging"
- [ ] Add required status checks: `build-and-test`, `enforce-pr-policy`, `verify-no-cloud-functions`
- [ ] Enable "Require conversation resolution before merging"
- [ ] Enable "Do not allow bypassing the above settings"
- [ ] Enable "Restrict who can push to matching branches" (add `@myhuemungusD`)
- [ ] Disable "Allow force pushes"
- [ ] Disable "Allow deletions"
