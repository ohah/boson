#!/usr/bin/env bash
set -euo pipefail

spike_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$spike_dir/../.." && pwd)"
v8_dir="${V8_CHECKOUT:-$repo_dir/build/v8-source/v8}"
v8_archive="$v8_dir/out/boson-ios-device/obj/libv8_monolith.a"
output_dir="$repo_dir/build/v8-language-bridge/ios-device"
sdk="$(xcrun --sdk iphoneos --show-sdk-path)"
target=arm64-apple-ios18.0

if [[ ! -f "$v8_archive" ]]; then
  echo "먼저 iOS 시뮬레이터용 V8을 빌드하세요: $v8_archive" >&2
  exit 1
fi

mkdir -p "$output_dir"
common=(-std=c++20 -target "$target" -isysroot "$sdk" -I"$v8_dir/include")
rust_libs=()
while IFS= read -r library; do
  rust_libs+=("$v8_dir/out/boson-ios-device/$library")
done < <(
  "$repo_dir/build/depot_tools/ninja" -C "$v8_dir/out/boson-ios-device" \
    -t commands d8 | python3 -c '
import re, sys
links = [line for line in sys.stdin if "linker_driver.py" in line and "libtemporal_capi_lib.rlib" in line]
if links:
    print("\n".join(re.findall(r"(?<!\S)(?:obj|local_rustc_sysroot)/[^\s]+\.rlib(?=\s|$)", links[-1])))
'
)
xcrun --sdk iphoneos clang++ "${common[@]}" -fPIC \
  -I"$spike_dir/include" -c "$spike_dir/bridge/boson_v8.cc" \
  -o "$output_dir/bridge.o"
xcrun --sdk iphoneos clang++ "${common[@]}" -fPIC -fobjc-arc \
  -c "$spike_dir/ios/app.mm" -o "$output_dir/app.o"
rustc --edition=2024 --crate-type staticlib --target aarch64-apple-ios \
  -O -C debuginfo=0 -C panic=abort "$spike_dir/rust/main.rs" \
  -o "$output_dir/librust.a"
zig build-obj "$spike_dir/zig/core.zig" -target aarch64-ios \
  -O ReleaseFast -femit-bin="$output_dir/zig.o"

for language in cpp_direct cpp rust zig; do
  app_dir="$output_dir/$language.app"
  mkdir -p "$app_dir"
  cp "$spike_dir/ios/Info.plist" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c \
    "Set :CFBundleIdentifier dev.boson.v8spike.$language" "$app_dir/Info.plist"
  case "$language" in
    cpp_direct|cpp)
      if [[ "$language" == cpp_direct ]]; then
        source="$spike_dir/cpp/direct.cc"
      else
        source="$spike_dir/cpp/main.cc"
      fi
      xcrun --sdk iphoneos clang++ "${common[@]}" -DBOSON_NO_MAIN \
        -I"$spike_dir/include" -fPIC -c "$source" \
        -o "$output_dir/$language.o"
      inputs=("$output_dir/$language.o")
      if [[ "$language" == cpp ]]; then
        inputs+=("$output_dir/bridge.o")
      fi
      ;;
    rust) inputs=("$output_dir/librust.a" "$output_dir/bridge.o") ;;
    zig) inputs=("$output_dir/zig.o" "$output_dir/bridge.o") ;;
  esac
  xcrun --sdk iphoneos clang++ -target "$target" -isysroot "$sdk" \
    "$output_dir/app.o" "${inputs[@]}" "$v8_archive" "${rust_libs[@]}" \
    -framework UIKit -framework Foundation -framework CoreFoundation \
    -framework BrowserEngineCore \
    -Wl,-dead_strip \
    -o "$app_dir/BosonV8"
  codesign --force --sign - "$app_dir"
  echo "$language: $app_dir"
done
