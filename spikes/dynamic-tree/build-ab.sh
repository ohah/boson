#!/usr/bin/env bash
set -euo pipefail

spike="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$spike/../.." && pwd)"
output="$repo/build/dynamic-tree/ab"

for variant in scan indexed; do
  flag=0
  if [[ "$variant" == indexed ]]; then flag=1; fi
  mkdir -p "$output/android-$variant" "$output/ios-$variant"
  BOSON_TREE_INDEXED="$flag" bash "$spike/build-android.sh"
  cp "$repo/build/dynamic-tree/android/boson-dynamic-tree.apk" "$output/android-$variant/app.apk"
  BOSON_TREE_INDEXED="$flag" bash "$spike/build-ios-sim.sh"
  ditto "$repo/build/dynamic-tree/ios-sim/BosonDynamicTree.app" \
        "$output/ios-$variant/BosonDynamicTree.app"
done

echo "$output"
