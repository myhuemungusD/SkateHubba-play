# Deploy Cloud Functions

Merging to `main` does not deploy Cloud Functions. Firestore rules and indexes still go out on their own (`firebase-rules-deploy.yml`). Functions wait until someone runs the manual workflow.

## Run it

1. Open the repo on GitHub → **Actions** → **Deploy Firebase Functions** → **Run workflow**.
2. `functions`: leave empty to deploy every export, or type a comma-separated list such as `diceAction,diceSweep`.
3. `confirm`: type `deploy`. Anything else fails the job before it installs or uploads.
4. Leave the branch set to `main`. A run from any other branch fails. This uploads production code, not a feature branch.
5. Start the run. The job uses the `production` environment, same as the rules deploy. If that environment asks for a review, approve it.

The job installs `functions/`, builds, and runs the unit tests. A failing test stops the deploy. Two runs cannot overlap.

The upload command is:

```text
firebase deploy --only functions[:names] --project $FIREBASE_PROJECT_ID --non-interactive --force
```

`--force` is there so the CLI can answer the Artifact Registry cleanup prompt without a person at the keyboard. The default it accepts keeps container images for 1 day. `onGameCompleted` also retries on failure, and a non-interactive deploy refuses that unless `--force` is set.

A full deploy (empty `functions` box) deletes any Cloud Function that is no longer exported from `functions/src`. A named list updates only those names.

Auth is the same pair the rules workflow uses: `FIREBASE_WIF_PROVIDER` and `FIREBASE_WIF_SERVICE_ACCOUNT` (Workload Identity Federation), with `FIREBASE_TOKEN` as the fallback if WIF fails. The project id is `FIREBASE_PROJECT_ID`, then the default in `.firebaserc`.

## One-time IAM setup

The rules deploy service account can publish rules. It may not be allowed to deploy functions. These grants are on that same account (the email in the `FIREBASE_WIF_SERVICE_ACCOUNT` secret). They do not change rules deploys.

Project: `sk8hub-d7806`. These functions are 2nd gen, in `us-central1`. They run as `sk8hub-d7806@appspot.gserviceaccount.com` (`setGlobalOptions` in `functions/src/index.ts`). The default compute service account was deleted, so a deploy that leaves `serviceAccount` unset fails with "Service account ... was not found".

```bash
PROJECT_ID=sk8hub-d7806
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
DEPLOYER="PASTE_THE_FIREBASE_WIF_SERVICE_ACCOUNT_EMAIL"

# Deploy, update, and delete functions. This role already includes the
# Cloud Run and Eventarc permissions Firestore triggers need.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER}" \
  --role="roles/cloudfunctions.admin"

# Act as the account the function runs as.
gcloud iam service-accounts add-iam-policy-binding \
  "sk8hub-d7806@appspot.gserviceaccount.com" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER}" \
  --role="roles/iam.serviceAccountUser"

# Act as the Cloud Build account. If the build log names a different
# account, grant serviceAccountUser on that one too.
gcloud iam service-accounts add-iam-policy-binding \
  "${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER}" \
  --role="roles/iam.serviceAccountUser"

# Push images and set the container cleanup policy.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER}" \
  --role="roles/artifactregistry.repoAdmin"

# Start the Cloud Build that packages the function.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER}" \
  --role="roles/cloudbuild.builds.editor"

# diceSweep is scheduled. Cloud Functions Admin does not include Scheduler.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER}" \
  --role="roles/cloudscheduler.admin"
```

If the build log says the Cloud Build service account itself lacks permission, grant that account `roles/cloudbuild.builds.builder` on the project. A laptop deploy that already works usually means this is already in place.

If the first run says an API is disabled, enable it and rerun:

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  eventarc.googleapis.com \
  cloudscheduler.googleapis.com \
  pubsub.googleapis.com \
  --project="$PROJECT_ID"
```

## Parameter file

`firebase deploy --non-interactive` will not prompt for `defineBoolean` / `defineString` values, and it will not fall back to the defaults in code. The job reads a GitHub secret named `FUNCTIONS_DOTENV` and writes it to `functions/.env.<projectId>` before the upload. Put that secret in the same place as `FIREBASE_PROJECT_ID` (the `production` environment, or the repo Actions secrets).

The value is the file contents, one `KEY=value` per line, no `export`:

```text
XP_ENABLED=false
XP_TESTER_UIDS=
DICE_ENABLED=false
DICE_TESTER_UIDS=
MODERATION_ENABLED=false
SENTRY_DSN=
```

`XP_ENABLED`, `DICE_ENABLED`, and `MODERATION_ENABLED` must be `true` or `false`. The other three may be empty.

Copy the live values before the first run. A wrong file overwrites production on the next deploy (it can turn dice or moderation off).

```bash
gcloud functions describe onGameCompleted \
  --gen2 --region=us-central1 --project=sk8hub-d7806 \
  --format='yaml(serviceConfig.environmentVariables)'
```

If that function is not deployed yet, the block above is the safe starting point: every switch off.

The workflow does not print the file.

## Laptop deploy

The same upload still works from a machine that is already logged in:

```bash
firebase use sk8hub-d7806
firebase deploy --only functions
```

A single function:

```bash
firebase deploy --only functions:onGameCompleted
```
