#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Firestore Backup Script
#
# Exports the named Firestore database ("skatehubba") to Google Cloud Storage.
# Run this manually or wire up as a Cloud Scheduler → Cloud Run job for daily
# automated backups.
#
# Prerequisites:
#   1. gcloud CLI installed and authenticated: gcloud auth login
#   2. A GCS bucket created: gsutil mb gs://<YOUR_BACKUP_BUCKET>
#   3. Firestore service account given Storage Admin on the bucket.
#
# Usage:
#   FIREBASE_PROJECT=your-project-id \
#   BACKUP_BUCKET=your-backup-bucket \
#   bash scripts/firestore-backup.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

FIREBASE_PROJECT="${FIREBASE_PROJECT:?Set FIREBASE_PROJECT env var}"
BACKUP_BUCKET="${BACKUP_BUCKET:?Set BACKUP_BUCKET env var}"
DATABASE="skatehubba"
TIMESTAMP=$(date -u +"%Y%m%d-%H%M%SZ")
OUTPUT_URI="gs://${BACKUP_BUCKET}/firestore/${DATABASE}/${TIMESTAMP}"

echo "→ Exporting Firestore database '${DATABASE}' to ${OUTPUT_URI}"

gcloud firestore export "${OUTPUT_URI}" \
  --project="${FIREBASE_PROJECT}" \
  --database="${DATABASE}"

echo "✓ Backup complete: ${OUTPUT_URI}"

# ── Retention: delete exports older than 30 days ─────────────────────────────
echo "→ Cleaning up exports older than 30 days..."
CUTOFF=$(date -u -d "30 days ago" +"%Y%m%d" 2>/dev/null || \
         date -u -v -30d +"%Y%m%d")   # macOS fallback

gsutil ls "gs://${BACKUP_BUCKET}/firestore/${DATABASE}/" | while read -r prefix; do
  folder_date=$(basename "${prefix}" | cut -c1-8)
  if [[ "${folder_date}" < "${CUTOFF}" ]]; then
    echo "  Deleting old backup: ${prefix}"
    gsutil -m rm -r "${prefix}"
  fi
done

echo "✓ Cleanup complete."
