#!/usr/bin/env bash
# Applies video retention lifecycle rule to the Firebase Storage bucket.
# Deletes game videos older than 90 days.
#
# Prerequisites:
#   - gcloud CLI authenticated with project owner permissions
#   - GCP_PROJECT_ID environment variable set
#
# Usage:
#   GCP_PROJECT_ID=my-project ./storage-lifecycle.sh

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
BUCKET_NAME="${PROJECT_ID}.firebasestorage.app"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Applying storage lifecycle rule to gs://${BUCKET_NAME}..."

gcloud storage buckets update "gs://${BUCKET_NAME}" \
  --lifecycle-file="${SCRIPT_DIR}/storage-lifecycle.json"

echo "Storage lifecycle applied: game videos deleted after 90 days."
