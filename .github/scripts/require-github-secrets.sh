#!/usr/bin/env bash
# Print the names of missing GitHub Actions secrets and exit 1.
# Pass secret names as arguments. Values are read from the environment
# and are never printed.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "::error::require-github-secrets.sh was called with no secret names."
  exit 1
fi

missing=()
for name in "$@"; do
  value="${!name:-}"
  if [[ -z "${value//[[:space:]]/}" ]]; then
    missing+=("$name")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "::error::Stopped before signing or upload. Add these GitHub Actions secrets, then run this workflow again."
  printf ' - %s\n' "${missing[@]}"
  echo "Where each one comes from: docs/IOS_RELEASE.md"
  exit 1
fi

echo "All required secrets are present."
