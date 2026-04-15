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
#   GITHUB_REPO=myhuemungusD/skatehubba-play bash scripts/apply-branch-protection.sh
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
# as the check run.
REQUIRED_CHECKS=(
  "build-and-test"
  "enforce-pr-policy"
  "verify-no-cloud-functions"
  "validate-firebase-rules"
)

echo "→ Applying branch protection to ${REPO}@${BRANCH}"

# Build the JSON payload on the fly so the required-status-checks array can
# be populated from the shell list above.
CHECK_CONTEXTS_JSON=$(printf '%s\n' "${REQUIRED_CHECKS[@]}" | \
  python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')

PAYLOAD=$(cat <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": ${CHECK_CONTEXTS_JSON}
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
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
