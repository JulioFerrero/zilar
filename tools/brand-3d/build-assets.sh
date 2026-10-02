#!/bin/sh
# Builds every Zilar brand asset from the 3D scene: `sh build-assets.sh`.
# Needs Chrome, ImageMagick (`magick`), potrace and rsvg-convert, plus the textures from fetch-textures.sh.
# Writes assets/brand/*, apps/web/public/* and apps/mobile/assets/images/*.
set -eu
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
BRAND="$ROOT/assets/brand"
WEB="$ROOT/apps/web/public"
MOBILE="$ROOT/apps/mobile/assets/images"
for layer in full bleed foreground background mono mono-rest mono-moon; do LAYER=$layer sh render.sh >/dev/null; done
mkdir -p "$BRAND" "$WEB/icons" "$MOBILE"

# --- the 3D icon: rounded key with its drop shadow (transparent), and a full-bleed square for stores / maskable
cp out/icon-full-1024.png "$BRAND/icon.png"
magick out/icon-bleed-2048.png -filter Lanczos -resize 1024x1024 -background '#0a0a0a' -alpha remove -alpha off "$BRAND/icon-bleed.png"

# --- monochrome mark: trace the flat renders into SVG paths (all three share one crop, so they line up)
CROP="$(magick out/icon-mono-2048.png -alpha off -colorspace Gray -threshold 50% -format %@ info:)"
for part in mono mono-rest mono-moon; do
  magick out/icon-$part-2048.png -alpha off -colorspace Gray -threshold 50% -crop "$CROP" +repage out/$part.pbm
  potrace -b svg -u 1 --turdsize 40 --opttolerance 0.6 --flat -o out/$part-raw.svg out/$part.pbm
done
python3 - "$BRAND" <<'PY'
import re, sys
brand = sys.argv[1]

def read(part):
    raw = open(f'out/{part}-raw.svg').read()
    w, h = (float(v) for v in re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', raw).groups())
    group = re.search(r'<g .*?</g>', raw, re.S).group(0)
    group = re.sub(r'stroke="[^"]*"', 'stroke="none"', group)
    return w, h, group

w, h, whole = read('mono')
_, _, rest = read('mono-rest')
_, _, moon = read('mono-moon')

def fill(group, colour):
    return re.sub(r'fill="[^"]*"', f'fill="{colour}"', group)

def mark(colour):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" role="img" aria-label="Zilar">\n'
            f'  <title>Zilar</title>\n  {fill(whole, colour)}\n</svg>\n')

open(f'{brand}/logo-mark.svg', 'w').write(mark('currentColor'))
open(f'{brand}/logo-mark-black.svg', 'w').write(mark('#000000'))
open(f'{brand}/logo-mark-white.svg', 'w').write(mark('#ffffff'))
# flat app icon (favicon): white planet and ring with a gold moon on the near-black key, 70% of the width
scale = 1024 * 0.70 / w
open(f'{brand}/icon-flat.svg', 'w').write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Zilar">\n'
    '  <rect width="1024" height="1024" rx="230" fill="#0a0a0a"/>\n'
    f'  <g transform="translate({(1024 - w * scale) / 2:g} {(1024 - h * scale) / 2:g}) scale({scale:g})">'
    f'{fill(rest, "#fafafa")}{fill(moon, "#f0b445")}</g>\n'
    '</svg>\n')
PY

# --- web: favicon (flat, legible at 16px), PWA icons, iOS touch icon
cp "$BRAND/icon-flat.svg" "$WEB/favicon.svg"
for size in 16 32 48; do rsvg-convert -w $size -h $size "$BRAND/icon-flat.svg" -o out/favicon-$size.png; done
magick out/favicon-16.png out/favicon-32.png out/favicon-48.png "$WEB/favicon.ico"
magick "$BRAND/icon.png" -resize 192x192 "$WEB/icons/icon-192.png"
magick "$BRAND/icon.png" -resize 512x512 "$WEB/icons/icon-512.png"
magick "$BRAND/icon-bleed.png" -resize 512x512 "$WEB/icons/icon-maskable-512.png"
magick "$BRAND/icon-bleed.png" -resize 180x180 "$WEB/icons/apple-touch-icon.png"

# --- mobile: store icon, Android adaptive layers, themed (monochrome) icon, splash, favicon
magick "$BRAND/icon-bleed.png" "$MOBILE/icon.png"
magick out/icon-foreground-2048.png -filter Lanczos -resize 1024x1024 "$MOBILE/android-icon-foreground.png"
magick out/icon-background-2048.png -filter Lanczos -resize 1024x1024 -background '#0a0a0a' -alpha remove -alpha off "$MOBILE/android-icon-background.png"
magick out/icon-mono-2048.png -alpha off -colorspace Gray -negate -filter Lanczos -resize 1024x1024 out/mono-mask.png
magick -size 1024x1024 xc:white out/mono-mask.png -compose CopyOpacity -composite "$MOBILE/android-icon-monochrome.png"
magick out/icon-foreground-2048.png -trim +repage -filter Lanczos -resize 480x480 -background none -gravity center -extent 512x512 "$MOBILE/splash-icon.png"
rsvg-convert -w 48 -h 48 "$BRAND/icon-flat.svg" -o "$MOBILE/favicon.png"
echo "brand assets ready"
