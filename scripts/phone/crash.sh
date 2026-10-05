#!/usr/bin/env bash
# Read the phone's crash buffer and the app's last log lines, and print the
# likely cause. Use it when Julio says "it crashed".
#
#   pnpm phone:crash
set -uo pipefail

SERIAL="${ZILAR_PHONE:-10AFAT234E00746}"
export PATH="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools:$PATH"

if [ "$(adb -s "$SERIAL" get-state 2>/dev/null || true)" != "device" ]; then
  echo "phone $SERIAL is not connected (adb get-state)." >&2
  exit 1
fi

CRASH="$(adb -s "$SERIAL" logcat -b crash -d -t 200 2>/dev/null | grep -v '^---')"
echo "== crash buffer (newest last) =="
echo "$CRASH" | tail -40

echo
echo "== app log (React Native, runtime, Zilar) =="
adb -s "$SERIAL" logcat -d -t 800 2>/dev/null \
  | grep -E "ReactNativeJS|AndroidRuntime|app\.zilar\.chat|ZilarWhistle|FATAL" | tail -40

echo
echo "== likely cause =="
CAUSE="$(echo "$CRASH" | grep -E "FATAL EXCEPTION|Exception|Error" | grep -v "^.*Process:" | tail -3)"
if [ -z "$CAUSE" ]; then
  echo "no exception in the crash buffer: the app was probably killed (memory) or closed normally."
else
  echo "$CAUSE"
fi
