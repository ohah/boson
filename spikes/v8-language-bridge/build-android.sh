#!/usr/bin/env bash
set -euo pipefail

spike_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$spike_dir/../.." && pwd)"
v8_dir="${V8_ANDROID_CHECKOUT:-$repo_dir/build/v8-android-source/checkout/v8}"
v8_archive="$v8_dir/out/boson-android/obj/libv8_monolith.a"
output_dir="$repo_dir/build/v8-language-bridge/android"
ndk_dir="${ANDROID_NDK_HOME:-$(find "$HOME/Library/Android/sdk/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)}"
ndk_bin="$ndk_dir/toolchains/llvm/prebuilt/darwin-x86_64/bin"
android_cxx="$ndk_bin/aarch64-linux-android24-clang++"

if [[ ! -f "$v8_archive" ]]; then
  echo "먼저 Android용 V8을 빌드하세요: $v8_archive" >&2
  exit 1
fi

mkdir -p "$output_dir"
"$android_cxx" -std=c++20 -O2 -fPIC -I"$v8_dir/include" \
  -I"$spike_dir/include" -c "$spike_dir/bridge/boson_v8.cc" \
  -o "$output_dir/bridge.o"
"$android_cxx" -c "$spike_dir/cpp/cli_entry.cc" \
  -o "$output_dir/cli_entry.o"
rustc --edition=2024 --crate-type staticlib --target aarch64-linux-android \
  -O -C debuginfo=0 -C panic=abort "$spike_dir/rust/main.rs" \
  -o "$output_dir/librust.a"
zig build-obj "$spike_dir/zig/core.zig" -target aarch64-linux-android \
  -O ReleaseFast -femit-bin="$output_dir/zig.o"

for language in cpp_direct cpp rust zig; do
  case "$language" in
    cpp_direct|cpp)
      if [[ "$language" == cpp_direct ]]; then
        source="$spike_dir/cpp/direct.cc"
      else
        source="$spike_dir/cpp/main.cc"
      fi
      "$android_cxx" -std=c++20 -O2 -fPIC -DBOSON_NO_MAIN \
        -I"$v8_dir/include" -I"$spike_dir/include" -c "$source" \
        -o "$output_dir/$language.o"
      inputs=("$output_dir/cli_entry.o" "$output_dir/$language.o")
      if [[ "$language" == cpp ]]; then
        inputs+=("$output_dir/bridge.o")
      fi
      ;;
    rust) inputs=("$output_dir/cli_entry.o" "$output_dir/librust.a" "$output_dir/bridge.o") ;;
    zig) inputs=("$output_dir/cli_entry.o" "$output_dir/zig.o" "$output_dir/bridge.o") ;;
  esac
  "$android_cxx" "${inputs[@]}" "$v8_archive" \
    -Wl,--gc-sections -static-libstdc++ -llog -ldl \
    -o "$output_dir/$language"
  echo "$language: $output_dir/$language"
done
