# Deploy Cloud Functions

Merging to `main` does not deploy Cloud Functions. Firestore rules and indexes still go out on their own (`firebase-rules-deploy.yml`). Functions wait until someone deploys them by hand: `npm run deploy:functions` from a logged-in PC ([One command](#one-command-laptop), preferred) or the manual workflow below.

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
PRO_BLESSING_ENABLED=false
PRO_BLESSING_TESTER_UIDS=
PRO_BLESSING_LIMIT=2
PRO_BLESSING_WINDOW_DAYS=30
PRO_BLESSING_MIN_ACCOUNT_DAYS=30
CLOSET_ENABLED=false
CLOSET_DROPS_ENABLED=false
CLOSET_TRADING_ENABLED=false
CLOSET_BUCKS_PURCHASE_ENABLED=false
CLOSET_TESTER_UIDS=
MAP_CHECKINS_ENABLED=false
MAP_TESTER_UIDS=
SPOT_PRESENCE_ENABLED=false
SPOT_PRESENCE_TESTER_UIDS=
GAME_VIDEO_RETENTION_ENABLED=false
```

Every `*_ENABLED` key must be `true` or `false`, and the `PRO_BLESSING_*` numbers must be whole numbers. The tester lists and `SENTRY_DSN` may be empty. `scripts/deploy.mjs` lists every `defineString` / `defineBoolean` / `defineInt` in `functions/src` and refuses to deploy if one is missing, so this block can't silently drift from the code.

`CRON_SECRET` is not in this file. `pushDispatchSweep` reads it from Firebase Secret Manager (`firebase functions:secrets:set CRON_SECRET`), and the value must match the Vercel env exactly.

`GAME_VIDEO_RETENTION_ENABLED` can also come from a repository variable of the same name (default `false`), and the deploy log prints `switch GAME_VIDEO_RETENTION: ON/OFF`. While it is off, `gameVideoRetention` only logs what it would delete (`event: game_video_retention`, `dryRun: true`). Turn it on only after checking those counts, because it deletes user videos.

Copy the live values before the first run. A wrong file overwrites production on the next deploy (it can turn dice or moderation off).

```bash
gcloud functions describe onGameCompleted \
  --gen2 --region=us-central1 --project=sk8hub-d7806 \
  --format='yaml(serviceConfig.environmentVariables)'
```

If that function is not deployed yet, the block above is the safe starting point: every switch off.

The workflow does not print the file.

## One command (laptop)

```bash
npm run deploy:functions            # every function
npm run deploy:functions -- --only mapCheckin,diceAction
npm run deploy:rules                # Firestore rules + indexes + Storage rules
npm run deploy:all
npm run deploy:all -- --dry-run     # every check, prints the deploy command, uploads nothing
```

`scripts/deploy.mjs` refuses to run unless you are on `main`, the tree is clean, and you match `origin/main`. It runs the typecheck, the functions build and tests, and the rules tests when the rules changed since this machine's last rules deploy. Then it deploys to `sk8hub-d7806` (database `skatehubba`).

The parameter values live outside the repo in `~/.skatehubba/functions.sk8hub-d7806.env` (or the path in `SKATEHUBBA_FUNCTIONS_ENV`), in the format under "Parameter file" above. The script checks every `defineString` / `defineBoolean` / `defineInt` in `functions/src` has a valid value, copies the file to `functions/.env.sk8hub-d7806` for the upload, and always deletes that copy afterwards, even if the deploy fails or you press Ctrl-C. `npm run testers:sync -- --apply` keeps the tester lists in that file matched to `config/featureTesters`.

## Plain firebase deploy

The raw upload still works from a machine that is already logged in, but it skips the checks above and needs the parameter file in place by hand:

```bash
firebase use sk8hub-d7806
firebase deploy --only functions
```

A single function:

```bash
firebase deploy --only functions:onGameCompleted
```
