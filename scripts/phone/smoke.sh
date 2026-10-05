#!/usr/bin/env bash
# Smoke-test a branch on the Android emulator before it merges.
#
#   pnpm phone:smoke task/T-0185-mobile-machines   (or any branch or commit)
#
#   ZILAR_SMOKE_MOCK=1 pnpm phone:smoke main
#
# Builds the branch into the build worktree, installs it on the emulator, opens
# every static screen under apps/mobile/src/app that the branch changed (through
# the zilar:// deep link), and FAILS if the app crashed on any of them. Pages
# with route params ([id]) cannot be opened without data and are listed as
# skipped. Screenshots land in $ZILAR_SMOKE_DIR for the lead to look at.
# The emulator must already be signed in (see docs/LEAD_HANDOFF.md).
set -uo pipefail

REF="${1:?usage: pnpm phone:smoke <branch-or-commit>}"
SERIAL="${ZILAR_EMULATOR:-emulator-5554}"
OUT="${ZILAR_SMOKE_DIR:-${CLAUDE_JOB_DIR:-/tmp}/zilar-smoke}"
PACKAGE="app.zilar.chat"
export PATH="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

if [ "$(adb -s "$SERIAL" get-state 2>/dev/null || true)" != "device" ]; then
  echo "emulator $SERIAL is not running (start it from Android Studio or with emulator -avd <name>; list the names with emulator -list-avds)" >&2
  exit 2
fi

ROUTES="$(git -C "$REPO" diff --name-only "main...$REF" -- apps/mobile/src/app | python3 "$HERE/routes.py")"
# ZILAR_ROUTES (space separated, e.g. "/ /settings /explore") replaces the changed-screen list.
[ -n "${ZILAR_ROUTES:-}" ] && ROUTES="$(echo "$ZILAR_ROUTES" | tr ' ' '\n')"
# ZILAR_SMOKE_MOCK=1 builds a mock-mode app (emulator only) and opens the mock AI screens.
if [ "${ZILAR_SMOKE_MOCK:-}" = "1" ] && [ -z "${ZILAR_ROUTES:-}" ]; then
  ROUTES="/ /ais /ais/ai-dev-1"
elif [ -z "$ROUTES" ]; then
  ROUTES="/"
fi

BUILD_LABEL="$REF for $SERIAL"
if [ "${ZILAR_SMOKE_MOCK:-}" = "1" ]; then
  BUILD_LABEL="mock build $REF for $SERIAL"
  export ZILAR_MOCK=1
fi
echo "building $BUILD_LABEL"
ZILAR_PHONE="$SERIAL" ZILAR_REF="$REF" bash "$HERE/install.sh" >"$OUT.build.log" 2>&1 || {
  echo "SMOKE FAIL: the build or install failed, see $OUT.build.log" >&2
  tail -20 "$OUT.build.log" >&2
  exit 1
}

mkdir -p "$OUT"
adb -s "$SERIAL" logcat -b crash -c
failed=0
for route in $ROUTES; do
  if echo "$route" | grep -q '\['; then
    echo "SKIP  $route (route parameter)"
    continue
  fi
  adb -s "$SERIAL" shell am start -W -a android.intent.action.VIEW -d "zilar:/${route}" "$PACKAGE" >/dev/null 2>&1
  sleep 4
  name="$(echo "$route" | tr '/' '_')"
  adb -s "$SERIAL" exec-out screencap -p >"$OUT/${name:-_root}.png" 2>/dev/null
  crash="$(adb -s "$SERIAL" logcat -b crash -d 2>/dev/null | grep -c 'FATAL EXCEPTION')"
  alive="$(adb -s "$SERIAL" shell pidof "$PACKAGE" 2>/dev/null)"
  if [ "$crash" -gt 0 ] || [ -z "$alive" ]; then
    echo "FAIL  $route (crashed)"
    adb -s "$SERIAL" logcat -b crash -d 2>/dev/null | grep -v '^---' | tail -25
    failed=1
    break
  fi
  echo "PASS  $route"
done

if [ "$failed" -eq 0 ]; then
  echo "SMOKE PASS  screenshots in $OUT"
else
  echo "SMOKE FAIL"
  exit 1
fi
