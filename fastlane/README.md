# Fastlane

SkateHubba's release automation for iOS + Android. Encapsulates the manual
steps that would otherwise need to happen on a dev laptop every shipping
day: code signing, App Store Connect uploads, TestFlight → App Store
promotion, Google Play internal → beta → production track walks.

## One-time setup

### Host prerequisites

- macOS with Xcode + command-line tools (iOS lanes only)
- Ruby 3.2+ (`rbenv`, `asdf`, or system ruby ≥ 2.7)
- `bundle install` once per checkout

### Secrets

Fastlane reads every credential from environment variables. In CI these
come from GitHub Actions secrets; locally export them in your shell or use
`.env` with `direnv` (never commit the file).

| Variable                              | Purpose                                           | Where to get it                                             |
| ------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `APPLE_ID`                            | Apple Developer account email                     | Your account                                                |
| `APPLE_TEAM_ID`                       | 10-char Apple team identifier                     | Apple Developer → Membership                                |
| `APP_STORE_CONNECT_API_KEY_ID`        | App Store Connect API key id                      | App Store Connect → Users & Access → Integrations           |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | Issuer UUID                                       | Same page                                                   |
| `APP_STORE_CONNECT_API_KEY_CONTENT`   | Contents of the `.p8` file (paste as-is)          | Same page — **download once, save immediately**             |
| `APP_STORE_CONNECT_API_KEY_PATH`      | Absolute path to the .p8 file on CI runners       | CI step writes `APP_STORE_CONNECT_API_KEY_CONTENT` to disk  |
| `MATCH_PASSWORD`                      | Symmetric passphrase for signing-cert encryption  | You choose — keep in a password manager                     |
| `MATCH_GIT_URL`                       | Private Git repo for encrypted certs              | Create empty private GitHub repo; use its SSH URL           |
| `MATCH_READONLY`                      | `false` on your laptop, unset in CI               | Override for cert rotation days                             |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`    | Google Play Console service-account JSON (pasted) | Play Console → API access → create svc acct → download JSON |

## Lanes

```sh
# iOS
bundle exec fastlane ios certificates  # rotate / fetch signing certs
bundle exec fastlane ios beta          # build + upload to TestFlight
bundle exec fastlane ios release       # submit latest TestFlight for review

# Android
bundle exec fastlane android internal  # build + upload to internal testing
bundle exec fastlane android beta      # promote internal → closed (beta)
bundle exec fastlane android release   # promote beta → production (10% rollout)
```

## Release flow (end-to-end)

1. Work lands on `main` via PR. `release-please` opens a release PR with the
   version bump + CHANGELOG update.
2. Merge the release PR. `release-please` tags `v1.x.y` and creates a GitHub
   Release.
3. Release workflow uploads a web build artifact + notifies Sentry.
4. Manually (or via a `workflow_dispatch` job) run:
   - `bundle exec fastlane ios beta` → TestFlight
   - `bundle exec fastlane android internal` → Internal Testing
5. After smoke testing the build on real devices:
   - `bundle exec fastlane android beta`
   - (iOS) Use App Store Connect to add the new build to a submission.
6. After a day on closed testing:
   - `bundle exec fastlane ios release` → Apple review
   - `bundle exec fastlane android release` → 10% staged rollout

## Why not automate the full pipeline today?

Two reasons this PR stages the config without wiring a `workflow_dispatch`
job that actually invokes the lanes:

1. **macOS runners cost money.** GitHub-hosted `macos-latest` minutes bill
   10x `ubuntu-latest`. We only want those minutes spent on deliberate
   releases, not every `main` push.
2. **iOS project not yet generated.** The `ios/` Xcode project is created
   by `npx cap add ios` on a macOS host. Until that first sync is committed
   (along with app icons, launch screen, push-notification capability),
   running an iOS lane would fail on a missing workspace anyway.

The intended follow-up: once `ios/` lands in the repo, add
`.github/workflows/fastlane-ios.yml` and `fastlane-android.yml` that
invoke the lanes on `workflow_dispatch` with the release tag as input.
