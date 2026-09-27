#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
platform="${1:?usage: build.sh macos|ios-simulator|android}"
out="$repo/build/core-language-bench/$platform"
mkdir -p "$out"

case "$platform" in
  macos)
    rustc --edition=2024 -O -C panic=abort --crate-type cdylib \
      "$here/rust/core.rs" -o "$out/librust.dylib"
    clang++ -std=c++20 -O3 -dynamiclib "$here/cpp/core.cpp" -o "$out/libcpp.dylib"
    zig build-lib -dynamic -fPIC -lc -O ReleaseFast "$here/zig/core.zig" \
      -femit-bin="$out/libzig.dylib"
    clang++ -std=c++20 -O2 "$here/runner.cpp" -o "$out/runner"
    ;;
  ios-simulator)
    sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
    target=arm64-apple-ios18.0-simulator
    rustc --edition=2024 -O -C panic=abort --crate-type cdylib \
      --target aarch64-apple-ios-sim "$here/rust/core.rs" -o "$out/librust.dylib"
    xcrun --sdk iphonesimulator clang++ -std=c++20 -O3 -dynamiclib \
      -target "$target" -isysroot "$sdk" "$here/cpp/core.cpp" -o "$out/libcpp.dylib"
    zig build-obj -O ReleaseFast -fPIC -lc -target aarch64-ios-simulator \
      "$here/zig/core.zig" -femit-bin="$out/zig.o"
    xcrun --sdk iphonesimulator clang++ -dynamiclib -target "$target" -isysroot "$sdk" \
      "$out/zig.o" -o "$out/libzig.dylib"
    xcrun --sdk iphonesimulator clang++ -std=c++20 -O2 -target "$target" -isysroot "$sdk" \
      "$here/runner.cpp" -o "$out/runner"
    for language in rust cpp zig; do codesign --force --sign - "$out/lib${language}.dylib"; done
    ;;
  android)
    ndk="${ANDROID_NDK_HOME:-$(find "$HOME/Library/Android/sdk/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)}"
    bin="$ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin"
    rustc --edition=2024 -O -C panic=abort --crate-type cdylib \
      --target aarch64-linux-android -C linker="$bin/aarch64-linux-android29-clang" \
      "$here/rust/core.rs" -o "$out/librust.so"
    "$bin/aarch64-linux-android29-clang++" -std=c++20 -O3 -shared -fPIC \
      "$here/cpp/core.cpp" -o "$out/libcpp.so"
    zig build-obj -O ReleaseFast -fPIC -lc -target aarch64-linux-android.29 \
      "$here/zig/core.zig" -femit-bin="$out/zig.o"
    "$bin/aarch64-linux-android29-clang++" -shared "$out/zig.o" -o "$out/libzig.so"
    "$bin/aarch64-linux-android29-clang++" -std=c++20 -O2 "$here/runner.cpp" \
      -ldl -o "$out/runner"
    ;;
  *) echo "unknown platform: $platform" >&2; exit 2 ;;
esac

echo "$out"
