#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
v8_dir="${SPINON_V8_DIR:-$repo_root/build/v8-source/v8}"
v8_revision="$(cat "$repo_root/tools/v8/v8-revision.txt")"
platform_name="${PLATFORM_NAME:-iphonesimulator}"

case "${SPINON_ENABLE_R10_EXPERIMENT:-0}" in
  0|1) ;;
  *)
    echo "SPINON_ENABLE_R10_EXPERIMENT은 0 또는 1이어야 합니다." >&2
    exit 2
    ;;
esac

case "$platform_name" in
  iphonesimulator)
    v8_out="out/boson-ios-sim"
    rust_target="aarch64-apple-ios-sim"
    rustup_target="aarch64-apple-ios-sim"
    sdk="iphonesimulator"
    target="arm64-apple-ios18.0-simulator"
    ;;
  iphoneos)
    v8_out="out/boson-ios-device"
    rust_target="aarch64-apple-ios"
    rustup_target="aarch64-apple-ios"
    sdk="iphoneos"
    target="arm64-apple-ios18.0"
    ;;
  *)
    echo "지원하지 않는 iOS 플랫폼입니다: $platform_name" >&2
    exit 1
    ;;
esac

if [[ ! -d "$v8_dir" ]] || [[ "$(git -C "$v8_dir" rev-parse HEAD 2>/dev/null || true)" != "$v8_revision" ]]; then
  echo "V8 소스가 고정 커밋과 다릅니다. 먼저 bash tools/v8/checkout.sh를 실행하세요." >&2
  exit 1
fi
v8_archive="$v8_dir/$v8_out/obj/libv8_monolith.a"
if [[ ! -f "$v8_archive" ]]; then
  echo "iOS용 V8 산출물이 없습니다: $v8_archive" >&2
  echo "먼저 bash tools/v8/build-ios-${sdk}.sh를 실행하세요." >&2
  exit 1
fi

if command -v mise >/dev/null 2>&1; then
  mise exec -- bun run bundle:bootstrap
  mise exec -- rustup target add "$rustup_target"
  if [[ "${SPINON_ENABLE_R10_EXPERIMENT:-0}" == "1" ]]; then
    mise exec -- env CARGO_PROFILE_RELEASE_PANIC=abort cargo build --locked --release --target "$rust_target" -p spinon-ffi --features r10-experiment
  else
    mise exec -- env CARGO_PROFILE_RELEASE_PANIC=abort cargo build --locked --release --target "$rust_target" -p spinon-ffi
  fi
  mise exec -- cargo build --manifest-path "$repo_root/spikes/wgpu-backend/Cargo.toml" --locked --release --target "$rust_target"
else
  bun run bundle:bootstrap
  rustup target add "$rustup_target"
  if [[ "${SPINON_ENABLE_R10_EXPERIMENT:-0}" == "1" ]]; then
    CARGO_PROFILE_RELEASE_PANIC=abort cargo build --locked --release --target "$rust_target" -p spinon-ffi --features r10-experiment
  else
    CARGO_PROFILE_RELEASE_PANIC=abort cargo build --locked --release --target "$rust_target" -p spinon-ffi
  fi
  cargo build --manifest-path "$repo_root/spikes/wgpu-backend/Cargo.toml" --locked --release --target "$rust_target"
fi

output_dir="$repo_root/build/spinon/$platform_name"
mkdir -p "$output_dir"
sdk_path="$(xcrun --sdk "$sdk" --show-sdk-path)"
xcrun --sdk "$sdk" clang++ -std=c++20 -O2 -fPIC -target "$target" \
  -isysroot "$sdk_path" -I"$v8_dir/include" \
  -I"$repo_root/native/v8/include" \
  -c "$repo_root/native/v8/src/spinon_v8.cc" \
  -o "$output_dir/spinon_v8.o"
cp "$repo_root/target/$rust_target/release/libspinon_ffi.a" \
  "$output_dir/libspinon_ffi.a"
cp "$repo_root/spikes/wgpu-backend/target/$rust_target/release/libspinon_wgpu_r08_spike.a" \
  "$output_dir/libspinon_wgpu_r08_spike.a"
echo "iOS $platform_name 네이티브 입력 준비 완료: $output_dir"
