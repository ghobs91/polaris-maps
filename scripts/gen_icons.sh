#!/bin/bash
set -e
DIR="/Users/andrewg/Projects/polaris-maps/ios/PolarisMaps/Images.xcassets/AppIcon.appiconset"
SRC="$DIR/1024.png"
for size in 180 120 87 80 76 72 60 58 57 50 40 29 20 167 152 144 114 100; do
  magick "$SRC" -resize "${size}x${size}!" "$DIR/${size}.png"
  echo "Generated ${size}.png"
done
echo "All done."
