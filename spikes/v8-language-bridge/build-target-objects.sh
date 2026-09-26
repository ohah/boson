#!/usr/bin/env bash
set -euo pipefail

spike_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$spike_dir/../.." && pwd)"
output_dir="$repo_dir/build/v8-language-bridge"
ndk_dir="${ANDROID_NDK_HOME:-$(find "$HOME/Library/Android/sdk/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)}"
android_cxx="$ndk_dir/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android24-clang++"
node_headers="${V8_HEADERS:-$(brew --prefix node)/include/node}"

mkdir -p "$output_dir"
rustup target add aarch64-apple-ios aarch64-apple-ios-sim aarch64-linux-android

for platform in iphoneos iphonesimulator; do
  if [[ "$platform" == iphoneos ]]; then
    suffix=ios
    target=arm64-apple-ios16.0
  else
    suffix=ios_sim
    target=arm64-apple-ios16.0-simulator
  fi
  xcrun --sdk "$platform" clang++ -std=c++20 -target "$target" \
    -isysroot "$(xcrun --sdk "$platform" --show-sdk-path)" -fPIC \
    -I"$spike_dir/include" -I"$node_headers" \
    -c "$spike_dir/bridge/boson_v8.cc" -o "$output_dir/boson_v8_$suffix.o"
  xcrun --sdk "$platform" clang++ -std=c++20 -target "$target" \
    -isysroot "$(xcrun --sdk "$platform" --show-sdk-path)" -fPIC \
    -I"$node_headers" -c "$spike_dir/cpp/direct.cc" \
    -o "$output_dir/cpp_direct_$suffix.o"
done

"$android_cxx" -std=c++20 -fPIC -I"$spike_dir/include" -I"$node_headers" \
  -c "$spike_dir/bridge/boson_v8.cc" -o "$output_dir/boson_v8_android.o"
"$android_cxx" -std=c++20 -fPIC -I"$node_headers" \
  -c "$spike_dir/cpp/direct.cc" -o "$output_dir/cpp_direct_android.o"

for target in aarch64-apple-ios aarch64-apple-ios-sim aarch64-linux-android; do
  rustc --edition=2024 --target "$target" --emit=obj \
    "$spike_dir/rust/main.rs" -o "$output_dir/rust_$target.o"
done

zig build-obj "$spike_dir/zig/core.zig" -target aarch64-ios \
  -femit-bin="$output_dir/zig_ios.o"
zig build-obj "$spike_dir/zig/core.zig" -target aarch64-ios-simulator \
  -femit-bin="$output_dir/zig_ios_sim.o"
zig build-obj "$spike_dir/zig/core.zig" -target aarch64-linux-android \
  -femit-bin="$output_dir/zig_android.o"

echo "대상별 오브젝트 컴파일 완료: $output_dir"
