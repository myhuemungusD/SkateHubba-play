#!/bin/sh
# Xcode Cloud runs this right after it clones the repo, before it builds
# ios/App/App.xcodeproj (scheme "App"). It does what .github/workflows/
# ios-release.yml does before fastlane: install Node, build the web app with
# the TestFlight env, write GoogleService-Info.plist, and cap sync.
# Setup and the variable list: docs/XCODE_CLOUD.md. Secrets are never printed.
set -eu

if [ "${CI_XCODE_CLOUD:-}" != "TRUE" ]; then
  echo "ci_post_clone.sh: not running in Xcode Cloud, nothing to do."
  exit 0
fi

REPO="${CI_PRIMARY_REPOSITORY_PATH:?CI_PRIMARY_REPOSITORY_PATH is not set}"
cd "$REPO"

# 1. Fail fast with the full list of missing variables.
missing=""
for name in VITE_APP_URL VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN \
  VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_STORAGE_BUCKET \
  VITE_FIREBASE_MESSAGING_SENDER_ID VITE_FIREBASE_APP_ID \
  VITE_MAPBOX_TOKEN; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || missing="$missing $name"
done
if [ ! -f ios/App/App/GoogleService-Info.plist ] && [ -z "${GOOGLE_SERVICE_INFO_PLIST_BASE64:-}" ]; then
  missing="$missing GOOGLE_SERVICE_INFO_PLIST_BASE64"
fi
if [ -n "$missing" ]; then
  echo "error: add these in the Xcode Cloud workflow's Environment section:$missing" >&2
  exit 1
fi
[ -n "${VITE_FIREBASE_VAPID_KEY:-}" ] || echo "warning: VITE_FIREBASE_VAPID_KEY is not set; web push stays off."

# 2. Node from Homebrew, major version from .nvmrc (22).
NODE_MAJOR="$(tr -dc '0-9.' < .nvmrc | cut -d. -f1)"
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1
brew install "node@${NODE_MAJOR}"
export PATH="$(brew --prefix "node@${NODE_MAJOR}")/bin:$PATH"
echo "node $(node --version), npm $(npm --version)"

npm ci --no-audit --no-fund

# 3. Web build with the same production env and flags as ios-release.yml.
# Public App Store flags (2026-10-20): every finished feature is on for
# everyone. Still off: pro blessing UI, Skate Runner, What's That Trick, buying Hubba
# Bucks, SMS two-step, admin. Jason and Mike still get every flag
# through the config/featureTesters override at runtime.
export VITE_FEATURE_APPLE_SIGNIN_ENABLED=true
export VITE_FEATURE_EXTRAS_ENABLED=true
export VITE_FEATURE_MAP_CHECKINS=true
export VITE_FEATURE_SPOT_PRESENCE=true
export VITE_FEATURE_TIPS=true
# Pro blessing UI off on iPhone for launch (Jason, 2026-10-21); see docs/FEATURE_FLAGS.md.
export VITE_FEATURE_PRO_BLESSING=false
export VITE_FEATURE_PRO_PROFILES=true
export VITE_FEATURE_PRO_SHOWCASE=true
export VITE_FEATURE_PRO_CALLS=true
export VITE_FEATURE_PRO_COMMUNITY=true
export VITE_FEATURE_DICE_ENABLED=false
# XP, levels and the achievements ribbon off on iPhone for 1.2.0 (Jason, 2026-10-23); see docs/FEATURE_FLAGS.md.
export VITE_FEATURE_XP_ENABLED=false
export VITE_FEATURE_REFEREE_ENABLED=true
export VITE_FEATURE_TURN_LENGTH=true
export VITE_FEATURE_TRICK_PICKER_ENABLED=true
export VITE_FEATURE_CLIP_EDITOR=true
export VITE_FEATURE_PRO_CAMERA=true
export VITE_FEATURE_CLIP_MODERATION_ENABLED=true
export VITE_FEATURE_FEED_MODES_ENABLED=true
export VITE_FEATURE_POST_MAKES_ENABLED=true
export VITE_FEATURE_PROFILE_BANNER=true
export VITE_FEATURE_PROFILE_CUSTOM=true
export VITE_FEATURE_SPOT_CHATS_ENABLED=true
# Closet and Closet Studio off until App Check is verified on TestFlight (see ios-release.yml).
export VITE_FEATURE_CLOSET_ENABLED=false
export VITE_FEATURE_CLOSET_DROPS_ENABLED=false
export VITE_FEATURE_CLOSET_TRADING_ENABLED=false
export VITE_FEATURE_CLOSET_STUDIO=false
export VITE_FEATURE_SHOE_360=true
export VITE_FEATURE_HUBBA_ICONS=true
export VITE_FEATURE_RUNNER_ENABLED=false
export VITE_FEATURE_CLOSET_BUCKS_PURCHASE_ENABLED=false
export VITE_FEATURE_SMS_2FA_ENABLED=false
# "Find me a challenger" on Home stays off (button hidden) until matchmaking ships.
export VITE_FEATURE_RANDOM_CHALLENGER=false
export VITE_FEATURE_WTT_ENABLED="${VITE_FEATURE_WTT_ENABLED:-false}"
# App Check always on (App Attest is free), like ios-release.yml.
export VITE_APPCHECK_ENABLED=true
export REQUIRE_SW_CONFIG=1
npm run build

# 4. GoogleService-Info.plist (gitignored) from the secret.
node .github/scripts/install-google-service-info.mjs

npx cap sync ios
# Fail unless the generated manifest pins the auth plugin to the Google trait
# (otherwise SwiftPM links the Facebook SDK, which declares tracking).
node scripts/check-ios-spm-traits.mjs

# 5. Add the plist to Copy Bundle Resources (same helper fastlane uses).
# The project uses Swift Package Manager (ios/App/CapApp-SPM), not
# CocoaPods, so there is no pod install; Xcode Cloud resolves packages.
gem install --user-install --no-document xcodeproj
GEM_USER_BIN="$(ruby -e 'print Gem.user_dir')/bin"
export PATH="$GEM_USER_BIN:$PATH"
ruby -I fastlane -e 'require "ci_helpers"; SkatehubbaCI.attach_google_service_plist!("ios/App/App.xcodeproj")'

# 6. Signing: the committed Release config signs manually with the fastlane
# match profile. Xcode Cloud only supports automatic (cloud-managed)
# signing, so switch Release to automatic on this throwaway clone only.
PBX=ios/App/App.xcodeproj/project.pbxproj
TEAM="${CI_TEAM_ID:?CI_TEAM_ID is not set}"
sed -i '' \
  -e 's/CODE_SIGN_STYLE = Manual;/CODE_SIGN_STYLE = Automatic;/' \
  -e 's/CODE_SIGN_IDENTITY = "Apple Distribution";/CODE_SIGN_IDENTITY = "Apple Development";/' \
  -e "s/DEVELOPMENT_TEAM = \"\";/DEVELOPMENT_TEAM = ${TEAM};/" \
  -e '/PROVISIONING_PROFILE_SPECIFIER = "match AppStore com.skatehubba.app";/d' \
  "$PBX"

# 7. Version: package.json, like fastlane. Build number: Xcode Cloud's
# CI_BUILD_NUMBER (set "Next Build Number" above 10 in App Store Connect).
VERSION="$(node -p 'require("./package.json").version')"
BUILD="${CI_BUILD_NUMBER:-11}"
sed -i '' -e "s/CURRENT_PROJECT_VERSION = [0-9]*;/CURRENT_PROJECT_VERSION = ${BUILD};/" \
  -e "s/MARKETING_VERSION = [0-9.]*;/MARKETING_VERSION = ${VERSION};/" "$PBX"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${BUILD}" ios/App/App/Info.plist
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${VERSION}" ios/App/App/Info.plist
echo "Prepared SkateHubba ${VERSION} (${BUILD}) for Xcode Cloud."
