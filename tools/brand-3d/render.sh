#!/bin/sh
# Renders the icon (VARIANT=index|crystal) to out/$OUT-2048.png and out/$OUT-1024.png (transparent corners).
# Needs Google Chrome and ImageMagick (`magick`). Serves this folder on port 5199 while it runs.
set -eu
cd "$(dirname "$0")"
PORT=5198
PAGE="${VARIANT:-index}"
OUT="icon-3d"
[ "$PAGE" = "index" ] || OUT="icon-$PAGE"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
mkdir -p out
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1
"$CHROME" --headless=new --hide-scrollbars --ignore-gpu-blocklist --enable-unsafe-swiftshader \
  --use-angle=swiftshader --default-background-color=00000000 --force-device-scale-factor=2 \
  --window-size=1024,1024 --virtual-time-budget=20000 \
  --screenshot="$PWD/out/$OUT-2048.png" "http://localhost:$PORT/$PAGE.html?render=1" >/dev/null 2>&1
# soft drop shadow under the key, composited from the render's own silhouette
magick out/$OUT-2048.png \( +clone -background black -shadow 60x44+0+56 \) +swap -background none -layers merge +repage \
  -gravity center -extent 2048x2048 out/$OUT-2048.png
magick out/$OUT-2048.png -filter Lanczos -resize 1024x1024 out/$OUT-1024.png
echo "wrote out/$OUT-2048.png and out/$OUT-1024.png"
