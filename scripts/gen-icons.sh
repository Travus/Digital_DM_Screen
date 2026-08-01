#!/bin/bash
# Regenerates build/icon.png and the build/icons/ set from build/icon.svg.
# Runs inside the smoke image, which already carries the SVG rasteriser:
#
#   docker compose run --rm --entrypoint bash smoke -lc scripts/gen-icons.sh
#
# The set exists because electron-builder does not resize a lone png — it ships
# it at whatever size it already is. These are the sizes the freedesktop hicolor
# theme defines a directory for; anything else lands where icon lookup never
# looks. icon.png stays 1024 because Windows converts it to .ico, where one
# large source is what you want.
set -e

mkdir -p build/icons
for s in 16 24 32 48 64 128 256 512; do
  rsvg-convert -w "$s" -h "$s" build/icon.svg -o "build/icons/${s}x${s}.png"
done
rsvg-convert -w 1024 -h 1024 build/icon.svg -o build/icon.png

ls -la build/icons build/icon.png
