#!/bin/sh
# Renders the icon: `LAYER=full|bleed|foreground|background|mono sh render.sh` (default full).
# Writes out/icon-<layer>-2048.png (full also gets a soft drop shadow and a 1024 copy).
# Needs Google Chrome and ImageMagick (`magick`), and the textures from fetch-textures.sh.
set -eu
cd "$(dirname "$0")"
PORT=5198
LAYER="${LAYER:-full}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT="out/icon-$LAYER-2048.png"
mkdir -p out
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1
"$CHROME" --headless=new --hide-scrollbars --ignore-gpu-blocklist --enable-unsafe-swiftshader \
  --use-angle=swiftshader --default-background-color=00000000 --force-device-scale-factor=2 \
  --window-size=1024,1024 --virtual-time-budget=20000 \
  --screenshot="$PWD/$OUT" "http://localhost:$PORT/index.html?render=1&layer=$LAYER" >/dev/null 2>&1
if [ "$LAYER" = full ]; then
  # soft drop shadow under the key, composited from the render's own silhouette
  magick "$OUT" \( +clone -background black -shadow 60x44+0+56 \) +swap -background none -layers merge +repage \
    -gravity center -extent 2048x2048 "$OUT"
  magick "$OUT" -filter Lanczos -resize 1024x1024 out/icon-full-1024.png
fi
echo "wrote $OUT"
