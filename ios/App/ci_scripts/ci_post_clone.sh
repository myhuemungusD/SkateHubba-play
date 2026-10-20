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
# Public App Store flags match store screenshots (Map/Clips, passport,
# Who's skating, tips). Tester-only screens (Dice, Runner, WTT, Closet
# Studio, admin, XP…) stay off; Jason and Mike still get every flag
# through the config/featureTesters override at runtime.
export VITE_FEATURE_APPLE_SIGNIN_ENABLED=true
export VITE_FEATURE_DICE_ENABLED="${VITE_FEATURE_DICE_ENABLED:-false}"
export VITE_FEATURE_CLIP_EDITOR="${VITE_FEATURE_CLIP_EDITOR:-false}"
export VITE_FEATURE_PRO_CAMERA="${VITE_FEATURE_PRO_CAMERA:-false}"
export VITE_FEATURE_WTT_ENABLED="${VITE_FEATURE_WTT_ENABLED:-false}"
export VITE_FEATURE_FEED_MODES_ENABLED="${VITE_FEATURE_WTT_ENABLED}"
export VITE_FEATURE_PROFILE_BANNER="${VITE_FEATURE_PROFILE_BANNER:-false}"
export VITE_FEATURE_EXTRAS_ENABLED=true
export VITE_FEATURE_MAP_CHECKINS=true
export VITE_FEATURE_SPOT_PRESENCE=false  # testers only via override
export VITE_FEATURE_TIPS=true
export VITE_FEATURE_PRO_BLESSING=true
export VITE_FEATURE_PRO_PROFILES=true
export REQUIRE_SW_CONFIG=1
npm run build

# 4. GoogleService-Info.plist (gitignored) from the secret.
node .github/scripts/install-google-service-info.mjs

npx cap sync ios

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
