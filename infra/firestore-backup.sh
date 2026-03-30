#!/usr/bin/env bash
# Sets up daily Firestore managed backups for the skatehubba database.
#
# Prerequisites:
#   - gcloud CLI authenticated with project owner permissions
#   - GCP_PROJECT_ID environment variable set
#
# Usage:
#   GCP_PROJECT_ID=my-project ./firestore-backup.sh

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
DATABASE_ID="skatehubba"
BUCKET_NAME="${PROJECT_ID}-firestore-backups"
REGION="us-central1"

echo "Setting up daily Firestore backups for ${DATABASE_ID}..."

# 1. Create GCS bucket for exports (idempotent)
gcloud storage buckets create "gs://${BUCKET_NAME}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --uniform-bucket-level-access \
  2>/dev/null || echo "Bucket ${BUCKET_NAME} already exists"

# 2. Grant Firestore service agent write access to the bucket
SA="service-$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')@gcp-sa-firestore.iam.gserviceaccount.com"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_NAME}" \
  --member="serviceAccount:${SA}" \
  --role="roles/storage.admin"

# 3. Create daily backup schedule (retained 7 days)
gcloud firestore backups schedules create \
  --project="${PROJECT_ID}" \
  --database="${DATABASE_ID}" \
  --recurrence=daily \
  --retention=7d

echo "Daily Firestore backup configured (7-day retention)."
