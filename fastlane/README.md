# Fastlane

SkateHubba's release automation for iOS + Android. Encapsulates the manual
steps that would otherwise need to happen on a dev laptop every shipping
day: code signing, App Store Connect uploads, TestFlight → App Store
promotion, Google Play internal → beta → production track walks.

## One-time setup

### Host prerequisites

- GitHub Actions provides the Mac for TestFlight. A local iOS lane still needs macOS with Xcode
- Ruby 3.2+ (`rbenv`, `asdf`, or system ruby ≥ 2.7) when you run a lane yourself
- `bundle install` once per checkout

### Secrets

Fastlane reads every credential from environment variables. In CI these
come from GitHub Actions secrets; locally export them in your shell or use
`.env` with `direnv` (never commit the file).

| Variable                              | Purpose                                                                      | Where to get it                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ASC_KEY_ID`                          | App Store Connect API key id                                                 | App Store Connect → Users and Access → Integrations → Team Keys                |
| `ASC_ISSUER_ID`                       | Issuer UUID on that page                                                     | Same page                                                                       |
| `ASC_KEY_P8`                          | The `.p8` file, or its base64                                                | Same page — download once                                                      |
| `APPLE_TEAM_ID`                       | 10-character Team ID                                                         | Apple Developer → Membership                                                    |
| `MATCH_PASSWORD`                      | Passphrase that encrypts the cert repo                                       | You choose it. Store it in a password manager. It cannot be recovered.         |
| `MATCH_GIT_BASIC_AUTHORIZATION`       | Base64 of `myhuemungusD:token` that can write the cert repo                  | Fine-grained personal access token on `myhuemungusD/skatehubba-certs`          |
| `MATCH_GIT_URL`                       | Optional. Defaults to `https://github.com/myhuemungusD/skatehubba-certs.git` | Set only if the cert repo URL is different                                      |
| `GOOGLE_SERVICE_INFO_PLIST_BASE64`    | Raw `GoogleService-Info.plist` or its base64                                 | Firebase → Project settings → iOS app `com.skatehubba.app`                     |
| `MATCH_READONLY`                      | `false` only in the signing-bootstrap workflow                               | TestFlight runs set `true`                                                      |
| `IOS_MARKETING_VERSION`               | Optional store version. Blank uses `package.json`                            | The TestFlight workflow input                                                   |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`    | Google Play Console service-account JSON (pasted)                            | Play Console → API access → create svc acct → download JSON                    |

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
4. From the Actions tab, run **iOS TestFlight**. For Android, run the
   Android workflow or `bundle exec fastlane android internal`.
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
- **iOS signing bootstrap** — `.github/workflows/ios-signing-bootstrap.yml`
  is `workflow_dispatch` only. Run it once. It creates the distribution
  certificate with `MATCH_READONLY=false` and stores it in the private
  cert repo. It does not upload a build.
- **iOS TestFlight** — `.github/workflows/ios-release.yml` is
  `workflow_dispatch` only. It reads the secrets in
  [`docs/IOS_RELEASE.md`](../docs/IOS_RELEASE.md), stops with a list of
  missing names before it signs or uploads, installs the certs read-only,
  and uploads with `pilot` without waiting for processing.
- **App Store review** — after TestFlight processing finishes, submit that
  build from the App Store Connect website. `bundle exec fastlane ios release`
  does the same submit and is not wired to GitHub Actions.

The `ios/` Xcode project is committed (`ios/App/App.xcodeproj/`), so the
iOS lanes run against the real project. TestFlight signing happens on the
GitHub macOS runner. See [`docs/IOS_RELEASE.md`](../docs/IOS_RELEASE.md).
