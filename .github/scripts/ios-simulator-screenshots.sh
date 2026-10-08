#!/usr/bin/env bash
# Boot a notched iPhone and an iPhone SE, install the unsigned simulator
# build, and screenshot the landing, sign-in, and privacy screens.
# Run on the macOS GitHub runner after xcodebuild. See ios-build.yml.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${ROOT}/ios/build/screenshots"
mkdir -p "$OUT"

APP=""
while IFS= read -r candidate; do
  APP="$candidate"
  break
done < <(find "${ROOT}/ios/build/DerivedData/Build/Products" -type d -name 'App.app' 2>/dev/null || true)
if [[ -z "$APP" ]]; then
  echo "::error::App.app was not found under ios/build/DerivedData. The simulator build did not produce an app."
  exit 1
fi

pick_device() {
  local mode="$1"
  python3 - "$mode" <<'PY'
import json, re, subprocess, sys
mode = sys.argv[1]
raw = subprocess.check_output(["xcrun", "simctl", "list", "devices", "available", "-j"], text=True)
data = json.loads(raw)
iphones = []
for runtime, devices in data.get("devices", {}).items():
    if "iOS" not in runtime:
        continue
    for device in devices:
        if not device.get("isAvailable"):
            continue
        name = device.get("name") or ""
        if "iPhone" not in name:
            continue
        iphones.append((name, device["udid"]))

def exact(name):
    return [item for item in iphones if item[0] == name]

if mode == "se":
    matches = [item for item in iphones if "SE" in item[0]]
    if not matches:
        sys.stderr.write("No iPhone SE simulator is installed.\n")
        sys.exit(1)
    name, udid = matches[0]
else:
    for preferred in ("iPhone 16", "iPhone 17", "iPhone 15"):
        matches = exact(preferred)
        if matches:
            name, udid = matches[0]
            break
    else:
        others = [item for item in iphones if "SE" not in item[0]]
        if not others:
            sys.stderr.write("No notched iPhone simulator is installed.\n")
            sys.exit(1)
        name, udid = others[0]
print(f"{udid}\t{name}")
PY
}

shoot() {
  local udid="$1"
  local slug="$2"
  echo "Screenshot device ${slug} (${udid})"
  xcrun simctl boot "$udid" || true
  xcrun simctl bootstatus "$udid" -b
  xcrun simctl status_bar "$udid" override --time "9:41" --batteryState charged --batteryLevel 100 || true
  xcrun simctl install "$udid" "$APP"
  xcrun simctl launch "$udid" com.skatehubba.app
  sleep 12
  xcrun simctl io "$udid" screenshot "${OUT}/${slug}-landing.png"
  xcrun simctl openurl "$udid" "skatehubba://app/auth"
  sleep 6
  xcrun simctl io "$udid" screenshot "${OUT}/${slug}-auth.png"
  xcrun simctl openurl "$udid" "skatehubba://app/privacy"
  sleep 6
  xcrun simctl io "$udid" screenshot "${OUT}/${slug}-privacy.png"
  xcrun simctl shutdown "$udid" || true
}

slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-'
}

NOTCH="$(pick_device notch)"
SE="$(pick_device se)"
NOTCH_UDID="${NOTCH%%$'\t'*}"
NOTCH_NAME="${NOTCH#*$'\t'}"
SE_UDID="${SE%%$'\t'*}"
SE_NAME="${SE#*$'\t'}"

echo "Notched device: ${NOTCH_NAME}"
echo "SE device: ${SE_NAME}"

shoot "$NOTCH_UDID" "$(slugify "$NOTCH_NAME")"
shoot "$SE_UDID" "$(slugify "$SE_NAME")"

echo "Wrote screenshots to ${OUT}"
ls -l "$OUT"
