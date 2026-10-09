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

| Variable                              | Purpose                                                 | Where to get it                                             |
| ------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| `APPLE_ID`                            | Apple Developer account email                           | Your account                                                |
| `APPLE_TEAM_ID`                       | 10-char Apple team identifier                           | Apple Developer → Membership                                |
| `APP_STORE_CONNECT_API_KEY_ID`        | App Store Connect API key id                            | App Store Connect → Users & Access → Integrations           |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | Issuer UUID                                             | Same page                                                   |
| `APP_STORE_CONNECT_API_KEY`           | Contents of the `.p8` file (paste as-is, or base64)     | Same page — **download once, save immediately**             |
| `MATCH_PASSWORD`                      | Symmetric passphrase for signing-cert encryption        | You choose — keep in a password manager                     |
| `MATCH_GIT_URL`                       | Private Git repo for encrypted certs                    | Create empty private GitHub repo; use its HTTPS URL         |
| `MATCH_GIT_BASIC_AUTHORIZATION`       | Base64 of `username:token` that can read the match repo | GitHub personal access token                                |
| `GOOGLE_SERVICE_INFO_PLIST_BASE64`    | Base64 of `GoogleService-Info.plist`                    | Firebase Console → Project settings → iOS app               |
| `MATCH_READONLY`                      | `false` on your laptop, unset in CI                     | Override for cert rotation days                             |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`    | Google Play Console service-account JSON (pasted)       | Play Console → API access → create svc acct → download JSON |

## Lanes

```sh
# iOS
bundle exec fastlane ios certificates  # rotate / fetch signing certs
bundle exec fastlane ios beta          # build + upload to TestFlight
bundle exec fastlane ios release       # submit latest TestFlight for review

# Android
bundle exec fastlane android internal          # build + upload to internal testing
bundle exec fastlane android publish_internal  # upload a pre-built AAB to internal testing (what CI calls)
bundle exec fastlane android beta              # promote internal → closed (beta)
bundle exec fastlane android release           # promote beta → production (10% rollout)
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

## CI wiring

- **Android** — `.github/workflows/android-aab.yml` builds the release AAB
  and, when its `publish_internal` dispatch input is set, runs
  `bundle exec fastlane android publish_internal` to upload it to the Play
  internal track.
- **iOS simulator** — `.github/workflows/ios-build.yml` is the unsigned
  simulator build. It also boots a notched iPhone and an iPhone SE and
  uploads screenshots. It does not sign.
- **iOS TestFlight** — `.github/workflows/ios-release.yml` is
  `workflow_dispatch` only. It reads the secrets in
  [`docs/IOS_RELEASE.md`](../docs/IOS_RELEASE.md) and stops with a list of
  missing names before it signs or uploads. `bundle exec fastlane ios release`
  (submit for review) stays a manual Mac step.

The `ios/` Xcode project is committed (`ios/App/App.xcodeproj/`), so the
iOS lanes run against the real project — see `ios/README.md` for the
per-Mac signing setup they assume.
