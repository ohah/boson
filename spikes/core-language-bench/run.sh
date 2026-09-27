#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
platform="${1:?usage: run.sh macos|ios-simulator|android}"
out="$repo/build/core-language-bench/$platform"

if [[ "$platform" == android ]]; then
  serial="${ANDROID_SERIAL:?set ANDROID_SERIAL to the intended physical device ID}"
  remote=/data/local/tmp/boson-core-language-bench
  adb -s "$serial" shell mkdir -p "$remote"
  adb -s "$serial" push "$out/runner" "$out/librust.so" "$out/libcpp.so" "$out/libzig.so" "$remote/" >/dev/null
  adb -s "$serial" shell chmod 755 "$remote/runner"
fi

for order in 'rust cpp zig' 'zig rust cpp' 'cpp zig rust'; do
  read -r -a languages <<< "$order"
  for language in "${languages[@]}"; do
    printf 'language=%s\n' "$language"
    case "$platform" in
      macos) "$out/runner" "$out/lib${language}.dylib" ;;
      ios-simulator) xcrun simctl spawn booted "$out/runner" "$out/lib${language}.dylib" ;;
      android) adb -s "$serial" shell "$remote/runner" "$remote/lib${language}.so" ;;
      *) echo "unknown platform: $platform" >&2; exit 2 ;;
    esac
  done
done
