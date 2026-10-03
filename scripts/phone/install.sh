#!/usr/bin/env bash
# Build main for Julio's Android phone and install it ONCE.
#
#   pnpm phone:install
#
# ZILAR_PHONE picks the device (an emulator serial works), ZILAR_REF the branch
# or commit to build (default main).
#
# It uses the detached build worktree (ZILAR_BUILD_DIR), rebuilds the native
# project only when a native input changed (package.json, app.json, modules,
# plugins, the lockfile), and otherwise rebundles the JavaScript only (about
# 35 s). It installs a single time and prints what changed since the last build
# so Julio knows what to test. Never loop this script; one build, one install.
set -euo pipefail

SERIAL="${ZILAR_PHONE:-10AFAT234E00746}"
BUILD="${ZILAR_BUILD_DIR:-$HOME/personal-projects/zilar-phone-build}"
REF="${ZILAR_REF:-main}"
API_URL="${EXPO_PUBLIC_ZILAR_API_URL:-https://chat.zilar.app}"

export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

if [ "$(adb -s "$SERIAL" get-state 2>/dev/null || true)" != "device" ]; then
  echo "phone $SERIAL is not connected (adb get-state). Unlock it, allow USB debugging, retry." >&2
  exit 1
fi

cd "$BUILD"
git checkout -q --detach "$REF"
HEAD_SHORT="$(git rev-parse --short HEAD)"
pnpm install --frozen-lockfile >/dev/null

STATE_DIR="$BUILD/.zilar-phone"
mkdir -p "$STATE_DIR"
FINGERPRINT="$(git ls-files -s apps/mobile/package.json apps/mobile/app.json apps/mobile/modules apps/mobile/plugins pnpm-lock.yaml 2>/dev/null | shasum | cut -d' ' -f1)"
LAST_FINGERPRINT="$(cat "$STATE_DIR/native-fingerprint" 2>/dev/null || true)"
LAST_COMMIT="$(cat "$STATE_DIR/commit" 2>/dev/null || true)"

cd apps/mobile
if [ ! -d android ] || [ "$FINGERPRINT" != "$LAST_FINGERPRINT" ]; then
  echo "native inputs changed: prebuild + full release build (about 6 minutes)"
  pnpm exec expo prebuild --platform android --clean --no-install >/dev/null
  cd android
  EXPO_PUBLIC_ZILAR_API_URL="$API_URL" NODE_ENV=production ./gradlew assembleRelease --console=plain -q
else
  echo "JavaScript-only change: rebundle (about 35 s)"
  cd android
  EXPO_PUBLIC_ZILAR_API_URL="$API_URL" NODE_ENV=production \
    ./gradlew :app:createBundleReleaseJsAndAssets --rerun assembleRelease --console=plain -q
fi

APK="app/build/outputs/apk/release/app-release.apk"
[ "$(unzip -p "$APK" assets/index.android.bundle | grep -c "$API_URL")" -gt 0 ] || {
  echo "the server URL $API_URL is not inside the bundle; not installing" >&2
  exit 1
}
adb -s "$SERIAL" install -r "$APK"

echo "$FINGERPRINT" >"$STATE_DIR/native-fingerprint"
echo "$HEAD_SHORT" >"$STATE_DIR/commit"
echo
echo "installed $HEAD_SHORT on $SERIAL"
if [ -n "$LAST_COMMIT" ]; then
  echo "changes since the last build ($LAST_COMMIT):"
  git log --format='  %s' "$LAST_COMMIT..HEAD" | grep -v '^  board:' || true
fi
