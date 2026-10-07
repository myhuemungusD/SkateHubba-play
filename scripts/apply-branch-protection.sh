#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Apply GitHub branch protection rules to `main`.
#
# Codifies the policy documented in .github/BRANCH_PROTECTION.md so a
# maintainer can reset or mirror the ruleset from the command line instead of
# clicking through the GitHub Settings UI.
#
# Prerequisites:
#   1. GitHub CLI installed and authenticated: `gh auth status`
#   2. The auth'd user must have admin rights on the repo
#   3. Environment variable `GITHUB_REPO` set as owner/name
#      (falls back to `gh repo view --json nameWithOwner` when unset)
#
# Usage:
#   GITHUB_REPO=myhuemungusD/SkateHubba-play bash scripts/apply-branch-protection.sh
#   bash scripts/apply-branch-protection.sh   # infers repo from current checkout
#
# Idempotent: re-running replays the same settings, which is how we keep the
# remote in sync when the `.github/BRANCH_PROTECTION.md` checklist changes.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO="${GITHUB_REPO:-}"
if [ -z "$REPO" ]; then
  REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
fi
if [ -z "$REPO" ]; then
  echo "::error::Could not determine repo. Set GITHUB_REPO=owner/name or run inside a gh-authenticated checkout." >&2
  exit 1
fi

BRANCH="${BRANCH:-main}"
# Required status checks — keep in sync with .github/BRANCH_PROTECTION.md.
# Job names must match the `name:` (or job id, when unnamed) GitHub exposes
# as the check run. Every entry must run on EVERY pull request to main, or
# PRs it skips can never merge.
REQUIRED_CHECKS=(
  "build-and-test"
  "e2e"
  "enforce-pr-policy"
  "guard-as-any-casts"
  "guard-todo-fixme-hack"
  "verify-no-cloud-functions"
  "verify-workflow-changes"
  "Validate Firebase rules changes"
  "Build and test Cloud Functions"
)
# GitHub Actions' app id. Pinning checks to it stops any other app (or a
# commit status posted with a stolen token) from satisfying a required check.
GITHUB_ACTIONS_APP_ID=15368

echo "→ Applying branch protection to ${REPO}@${BRANCH}"

# Build the JSON payload on the fly so the required-status-checks array can
# be populated from the shell list above. Uses jq (available on ubuntu-latest
# and any machine with gh CLI) instead of python3 for portability.
CHECKS_JSON=$(printf '%s\n' "${REQUIRED_CHECKS[@]}" | jq -R -s --argjson app "$GITHUB_ACTIONS_APP_ID" \
  'split("\n") | map(select(length > 0)) | map({context: ., app_id: $app})')

PAYLOAD=$(cat <<EOF
{
  "required_status_checks": {
    "strict": true,
    "checks": ${CHECKS_JSON}
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF
)

# PUT /repos/{owner}/{repo}/branches/{branch}/protection — replaces existing
# protection with the payload above. The `--method PUT` + stdin pattern keeps
# the call idempotent.
echo "$PAYLOAD" | gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/${REPO}/branches/${BRANCH}/protection" \
  --input -

echo "✓ Branch protection applied."
echo ""
echo "Required checks: ${REQUIRED_CHECKS[*]}"
echo "See .github/BRANCH_PROTECTION.md for the source of truth."
