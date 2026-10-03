#!/bin/bash
# Downloads the pinned Needle engine (libneedle.a + needle.h) for the
# ZilarWhistle local Expo module and verifies both sha256 checksums.
# Binaries land in android/third_party/needle/ (gitignored, never committed).
# Gradle runs this automatically before the native build when the files are
# missing; run `pnpm --filter zilar-whistle fetch-engine` by hand to refresh.
set -euo pipefail

NEEDLE_REPO="Cactus-Compute/needle3"
NEEDLE_REVISION="c7c415a3d1b3d929014bc6e866d51ebb971f7089"
LIB_SHA256="16752fb75adea7af89bbc435a97d1cda7e71bc74d04578d551d0d3bbd5f9e633"
HEADER_SHA256="90f347f9dca1199de79967ab199a56e0588bd473fe306051f8d80d146976a324"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="$SCRIPT_DIR/../android/third_party/needle"
mkdir -p "$DEST_DIR"

download() {
  local path="$1"
  local dest="$2"
  local url="https://huggingface.co/$NEEDLE_REPO/resolve/$NEEDLE_REVISION/$path"
  echo "fetching $url"
  curl -fsSL --retry 3 "$url" -o "$dest"
}

LIB_TMP="$DEST_DIR/libneedle.a.tmp"
HEADER_TMP="$DEST_DIR/needle.h.tmp"
download "android-arm64/libneedle.a" "$LIB_TMP"
download "android-arm64/needle.h" "$HEADER_TMP"

check_sha256() {
  local file="$1"
  local expected="$2"
  local actual
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  fi
  if [ "$actual" != "$expected" ]; then
    echo "sha256 mismatch for $file: expected $expected, got $actual" >&2
    rm -f "$file"
    exit 1
  fi
}

check_sha256 "$LIB_TMP" "$LIB_SHA256"
check_sha256 "$HEADER_TMP" "$HEADER_SHA256"

mv -f "$LIB_TMP" "$DEST_DIR/libneedle.a"
mv -f "$HEADER_TMP" "$DEST_DIR/needle.h"
echo "needle engine ready in $DEST_DIR"
