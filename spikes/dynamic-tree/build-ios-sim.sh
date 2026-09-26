#!/usr/bin/env bash
set -euo pipefail

spike_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$spike_dir/../.." && pwd)"
v8_dir="${V8_CHECKOUT:-$repo_dir/build/v8-source/v8}"
v8_archive="$v8_dir/out/boson-ios-sim/obj/libv8_monolith.a"
output_dir="$repo_dir/build/dynamic-tree/ios-sim"
sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
target=arm64-apple-ios18.0-simulator

if [[ ! -f "$v8_archive" ]]; then
  echo "먼저 iOS 시뮬레이터용 V8을 빌드하세요: $v8_archive" >&2
  exit 1
fi

mkdir -p "$output_dir"
rust_libs=()
while IFS= read -r library; do rust_libs+=("$v8_dir/out/boson-ios-sim/$library"); done < <(
  "$repo_dir/build/depot_tools/ninja" -C "$v8_dir/out/boson-ios-sim" \
    -t commands d8 | python3 -c '
import re, sys
links = [line for line in sys.stdin if "linker_driver.py" in line and "libtemporal_capi_lib.rlib" in line]
if links:
    print("\n".join(re.findall(r"(?<!\S)(?:obj|local_rustc_sysroot)/[^\s]+\.rlib(?=\s|$)", links[-1])))
')

xcrun --sdk iphonesimulator clang++ -std=c++20 -target "$target" -isysroot "$sdk" \
  -I"$v8_dir/include" -I"$spike_dir/runtime" -fPIC \
  -c "$spike_dir/runtime/v8_tree.cc" -o "$output_dir/runtime.o"
xcrun --sdk iphonesimulator clang++ -std=c++20 -target "$target" -isysroot "$sdk" \
  -I"$spike_dir/runtime" -fPIC -fobjc-arc \
  -c "$spike_dir/ios/app.mm" -o "$output_dir/app.o"
rustc --edition=2024 --crate-type staticlib --target aarch64-apple-ios-sim \
  -O -C debuginfo=0 -C panic=abort "$spike_dir/rust/tree.rs" \
  -o "$output_dir/libboson_tree_core.a"

app_dir="$output_dir/BosonDynamicTree.app"
mkdir -p "$app_dir"
cp "$repo_dir/spikes/v8-language-bridge/ios/Info.plist" "$app_dir/Info.plist"
cp "$spike_dir/tree.js" "$app_dir/tree.js"
cp "$spike_dir/scenarios/contention.js" "$app_dir/contention.js"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier dev.boson.dynamic-tree' "$app_dir/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName Boson Dynamic Tree' "$app_dir/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleExecutable BosonDynamicTree' "$app_dir/Info.plist"
xcrun --sdk iphonesimulator clang++ -target "$target" -isysroot "$sdk" \
  "$output_dir/app.o" "$output_dir/runtime.o" "$output_dir/libboson_tree_core.a" \
  "$v8_archive" "${rust_libs[@]}" \
  -framework UIKit -framework Foundation -framework CoreFoundation -framework QuartzCore -framework BrowserEngineCore \
  -Wl,-dead_strip -o "$app_dir/BosonDynamicTree"
codesign --force --sign - "$app_dir"
echo "$app_dir"
