#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Firebase / Google Cloud Billing Budget Alert Setup
#
# Creates a Pub/Sub topic and a Cloud Billing budget with alert thresholds
# that publish to that topic. The companion Cloud Function (onBillingAlert)
# listens on the topic and writes alerts to Firestore.
#
# Prerequisites:
#   1. gcloud CLI installed and authenticated: gcloud auth login
#   2. Billing account linked to the project
#   3. billing.budgets.create permission (roles/billing.admin or
#      roles/billing.costsManager on the billing account)
#
# Usage:
#   FIREBASE_PROJECT=your-project-id \
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX \
#   MONTHLY_BUDGET=25 \
#   bash scripts/setup-billing-alerts.sh
#
# Optional:
#   NOTIFICATION_EMAIL=ops@example.com   — also email this address
#   MONTHLY_BUDGET=25                    — budget in USD (default: 25)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

FIREBASE_PROJECT="${FIREBASE_PROJECT:?Set FIREBASE_PROJECT env var}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:?Set BILLING_ACCOUNT env var (format: XXXXXX-XXXXXX-XXXXXX)}"
MONTHLY_BUDGET="${MONTHLY_BUDGET:-25}"
TOPIC_NAME="firebase-billing-alerts"

echo "── Setting up billing alerts for project: ${FIREBASE_PROJECT}"
echo "   Billing account: ${BILLING_ACCOUNT}"
echo "   Monthly budget:  \$${MONTHLY_BUDGET} USD"
echo ""

# ── 1. Enable required APIs ──────────────────────────────────────────────────
echo "→ Enabling required APIs..."
gcloud services enable billingbudgets.googleapis.com \
  --project="${FIREBASE_PROJECT}" --quiet
gcloud services enable pubsub.googleapis.com \
  --project="${FIREBASE_PROJECT}" --quiet

# ── 2. Create Pub/Sub topic (idempotent) ─────────────────────────────────────
echo "→ Creating Pub/Sub topic: ${TOPIC_NAME}"
if gcloud pubsub topics describe "${TOPIC_NAME}" \
    --project="${FIREBASE_PROJECT}" &>/dev/null; then
  echo "  Topic already exists — skipping."
else
  gcloud pubsub topics create "${TOPIC_NAME}" \
    --project="${FIREBASE_PROJECT}"
  echo "  ✓ Topic created."
fi

TOPIC_FULL="projects/${FIREBASE_PROJECT}/topics/${TOPIC_NAME}"

# ── 3. Grant Cloud Billing permission to publish to the topic ────────────────
echo "→ Granting Billing service account publish access..."
gcloud pubsub topics add-iam-policy-binding "${TOPIC_NAME}" \
  --project="${FIREBASE_PROJECT}" \
  --member="serviceAccount:billing-export@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --quiet

# ── 4. Create the budget with thresholds ─────────────────────────────────────
echo "→ Creating billing budget (\$${MONTHLY_BUDGET}/month)..."

# Build threshold rules — alert at 50%, 80%, 100%, and 150%
# gcloud billing budgets create uses --threshold-rule flags
THRESHOLD_FLAGS=(
  --threshold-rule="percent=0.50,basis=CURRENT_SPEND"
  --threshold-rule="percent=0.80,basis=CURRENT_SPEND"
  --threshold-rule="percent=1.00,basis=CURRENT_SPEND"
  --threshold-rule="percent=1.50,basis=FORECASTED_SPEND"
)

NOTIFICATION_FLAGS=(
  --notifications-rule-pubsub-topic="${TOPIC_FULL}"
  --notifications-rule-monitoring-notification-channels=[]
)

# Optionally add email notification
if [[ -n "${NOTIFICATION_EMAIL:-}" ]]; then
  NOTIFICATION_FLAGS+=(
    --notifications-rule-monitoring-notification-channels="${NOTIFICATION_EMAIL}"
  )
  echo "   Email notifications: ${NOTIFICATION_EMAIL}"
fi

gcloud billing budgets create \
  --billing-account="${BILLING_ACCOUNT}" \
  --display-name="SkateHubba Monthly Budget" \
  --budget-amount="${MONTHLY_BUDGET}USD" \
  --filter-projects="projects/${FIREBASE_PROJECT}" \
  "${THRESHOLD_FLAGS[@]}" \
  "${NOTIFICATION_FLAGS[@]}" \
  --quiet

echo ""
echo "✓ Billing budget created with the following alert thresholds:"
echo "   • 50% of \$${MONTHLY_BUDGET}  (\$$(echo "${MONTHLY_BUDGET} * 0.5" | bc))  — actual spend"
echo "   • 80% of \$${MONTHLY_BUDGET}  (\$$(echo "${MONTHLY_BUDGET} * 0.8" | bc))  — actual spend"
echo "   • 100% of \$${MONTHLY_BUDGET} (\$${MONTHLY_BUDGET})       — actual spend"
echo "   • 150% of \$${MONTHLY_BUDGET} (\$$(echo "${MONTHLY_BUDGET} * 1.5" | bc))  — forecasted spend"
echo ""
echo "── Next steps:"
echo "   1. Deploy the Cloud Function:  firebase deploy --only functions"
echo "   2. Alerts will be logged and saved to Firestore 'billingAlerts' collection"
echo "   3. (Optional) Set up Firestore-triggered email/Slack alerts from that collection"
