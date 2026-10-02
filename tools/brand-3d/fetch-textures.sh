#!/bin/sh
# Downloads the CC0 textures used by orbit-pbr.js into ./textures (sources in textures/README.md).
set -eu
cd "$(dirname "$0")/textures"
for id in Metal009 Metal011; do
  [ -d "$id" ] && continue
  curl -sfL -o "$id.zip" "https://ambientcg.com/get?file=${id}_2K-JPG.zip"
  mkdir -p "$id"
  unzip -qo "$id.zip" "$id/*" -d . 2>/dev/null || unzip -qo "$id.zip" -d "$id"
  rm "$id.zip"
done
for hdri in studio_small_03 studio_small_09; do
  [ -f "${hdri}_2k.hdr" ] || curl -sfLO "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/${hdri}_2k.hdr"
done
echo "textures ready"
