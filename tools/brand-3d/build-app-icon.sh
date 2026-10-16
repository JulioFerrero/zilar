#!/bin/sh
# Builds the phone app icons from the flat mark: `sh build-app-icon.sh`.
# Needs only rsvg-convert and ImageMagick (`magick`), no Chrome.
# Reads assets/brand/icon-flat.svg and writes the four PNGs in apps/mobile/assets/images/.
# Called by build-assets.sh; splash-icon.png and favicon.png are left alone.
set -eu
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
BRAND="$ROOT/assets/brand"
MOBILE="$ROOT/apps/mobile/assets/images"
SRC="$BRAND/icon-flat.svg"
OUT=out
mkdir -p "$MOBILE" "$OUT"

# iOS / store icon: the flat mark on a full-bleed square. iOS masks the corners itself,
# so drop the rounded `rx` from the SVG's rect before rendering.
sed 's/ rx="230"//' "$SRC" | rsvg-convert -w 1024 -h 1024 -o "$MOBILE/icon.png"

# Android adaptive layers: the glyph alone (the rect is removed), scaled so the whole mark
# fits the central safe zone. 563px is ~55% of 1024, inside the 66% mask safe zone.
sed '/<rect /d' "$SRC" | rsvg-convert -w 1024 -h 1024 -o "$OUT/app-glyph.png"
magick "$OUT/app-glyph.png" -trim +repage -resize 563x563 \
  -background none -gravity center -extent 1024x1024 "$MOBILE/android-icon-foreground.png"

# Themed (monochrome) icon: the same glyph and placement, all white including the moon.
sed -e '/<rect /d' -e 's/#fafafa/#ffffff/g' -e 's/#f0b445/#ffffff/g' "$SRC" \
  | rsvg-convert -w 1024 -h 1024 -o "$OUT/app-glyph-white.png"
magick "$OUT/app-glyph-white.png" -trim +repage -resize 563x563 \
  -background none -gravity center -extent 1024x1024 "$MOBILE/android-icon-monochrome.png"

# Solid near-black adaptive background layer.
magick -size 1024x1024 xc:'#0a0a0a' "$MOBILE/android-icon-background.png"

echo "app icons ready"
