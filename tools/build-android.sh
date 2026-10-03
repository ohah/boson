#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
source "$repo_root/tools/android-ndk.sh"
v8_dir="${SPINON_V8_DIR:-$repo_root/build/v8-source/v8}"
v8_revision="$(cat "$repo_root/tools/v8/v8-revision.txt")"
v8_out="out/boson-android-mac"
v8_archive="$v8_dir/$v8_out/obj/libv8_monolith.a"
v8_libcxx="$v8_dir/$v8_out/obj/buildtools/third_party/libc++/libc++.a"
v8_libcxxabi="$v8_dir/$v8_out/obj/buildtools/third_party/libc++abi/libc++abi.a"
ndk_dir="$(spinon_android_ndk_dir "$repo_root")"

case "${SPINON_ENABLE_R10_EXPERIMENT:-0}" in
  0|1) ;;
  *)
    echo "SPINON_ENABLE_R10_EXPERIMENT은 0 또는 1이어야 합니다." >&2
    exit 2
    ;;
esac
case "${SPINON_ENABLE_S04_ANDROID_FIXTURE:-0}" in
  0|1) ;;
  *)
    echo "SPINON_ENABLE_S04_ANDROID_FIXTURE은 0 또는 1이어야 합니다." >&2
    exit 2
    ;;
esac
s04_android_cpp_flags=()
if [[ "${SPINON_ENABLE_S04_ANDROID_FIXTURE:-0}" == "1" ]]; then
  s04_android_cpp_flags=(-DSPINON_ENABLE_S04_ANDROID_FIXTURE=1)
fi

if [[ ! -d "$v8_dir" ]] || [[ "$(git -C "$v8_dir" rev-parse HEAD 2>/dev/null || true)" != "$v8_revision" ]]; then
  echo "V8 소스가 고정 커밋과 다릅니다. 먼저 bash tools/v8/checkout.sh를 실행하세요." >&2
  exit 1
fi
for required in "$v8_archive" "$v8_libcxx" "$v8_libcxxabi"; do
  if [[ ! -f "$required" ]]; then
    echo "Android용 V8 산출물이 없습니다: $required" >&2
    echo "먼저 bash tools/v8/build-android-macos.sh를 실행하세요." >&2
    exit 1
  fi
done
ndk_root="$(find "$ndk_dir/toolchains/llvm/prebuilt" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
v8_cxx="$v8_dir/third_party/llvm-build/Release+Asserts/bin/clang++"
v8_lld="$v8_dir/third_party/llvm-build/Release+Asserts/bin/ld.lld"
if [[ ! -x "$v8_cxx" || ! -x "$v8_lld" ]]; then
  echo "V8 도구 체인이 없습니다. tools/v8/build-android-macos.sh 결과를 확인하세요." >&2
  exit 1
fi

if command -v mise >/dev/null 2>&1; then
  mise exec -- bun run bundle:bootstrap
  if [[ "${SPINON_ENABLE_R10_EXPERIMENT:-0}" == "1" ]]; then
    mise exec -- env CARGO_PROFILE_RELEASE_PANIC=abort cargo build --locked --release --target aarch64-linux-android -p spinon-ffi --features r10-experiment
  else
    mise exec -- env CARGO_PROFILE_RELEASE_PANIC=abort cargo build --locked --release --target aarch64-linux-android -p spinon-ffi
  fi
  if [[ "${SPINON_ENABLE_S04_ANDROID_FIXTURE:-0}" == "1" ]]; then
    mise exec -- cargo build --manifest-path "$repo_root/spikes/wgpu-backend/Cargo.toml" --locked --release --target aarch64-linux-android --features s04-android-fixture
  else
    mise exec -- cargo build --manifest-path "$repo_root/spikes/wgpu-backend/Cargo.toml" --locked --release --target aarch64-linux-android
  fi
else
  bun run bundle:bootstrap
  if [[ "${SPINON_ENABLE_R10_EXPERIMENT:-0}" == "1" ]]; then
    CARGO_PROFILE_RELEASE_PANIC=abort cargo build --locked --release --target aarch64-linux-android -p spinon-ffi --features r10-experiment
  else
    CARGO_PROFILE_RELEASE_PANIC=abort cargo build --locked --release --target aarch64-linux-android -p spinon-ffi
  fi
  if [[ "${SPINON_ENABLE_S04_ANDROID_FIXTURE:-0}" == "1" ]]; then
    cargo build --manifest-path "$repo_root/spikes/wgpu-backend/Cargo.toml" --locked --release --target aarch64-linux-android --features s04-android-fixture
  else
    cargo build --manifest-path "$repo_root/spikes/wgpu-backend/Cargo.toml" --locked --release --target aarch64-linux-android
  fi
fi

output_dir="$repo_root/build/spinon/android"
mkdir -p "$output_dir/obj" "$output_dir/jniLibs/arm64-v8a"
target="--target=aarch64-linux-android29"
sysroot="--sysroot=$ndk_root/sysroot"
common=("$target" "$sysroot" -std=c++20 -O2 -fPIC
  -fexperimental-relative-c++-abi-vtables -nostdinc++
  -D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE
  -I"$v8_dir/buildtools/third_party/libc++"
  -isystem "$v8_dir/third_party/libc++/src/include"
  -isystem "$v8_dir/third_party/libc++abi/src/include"
  -I"$v8_dir/include"
  -I"$repo_root/native/v8/include"
  -I"$repo_root/crates/spinon-ffi/include"
  -I"$repo_root/spikes/wgpu-backend/include")

"$v8_cxx" "${common[@]}" -c "$repo_root/native/v8/src/spinon_v8.cc" \
  -o "$output_dir/obj/spinon_v8.o"
if [[ "${SPINON_ENABLE_S04_ANDROID_FIXTURE:-0}" == "1" ]]; then
  "$v8_cxx" "${common[@]}" -I"$repo_root/platforms/android/app/src/main/cpp" \
    "${s04_android_cpp_flags[@]}" \
    -c "$repo_root/platforms/android/app/src/main/cpp/spinon_jni.cc" \
    -o "$output_dir/obj/spinon_jni.o"
else
  "$v8_cxx" "${common[@]}" -I"$repo_root/platforms/android/app/src/main/cpp" \
    -c "$repo_root/platforms/android/app/src/main/cpp/spinon_jni.cc" \
    -o "$output_dir/obj/spinon_jni.o"
fi

"$v8_cxx" "${common[@]}" -shared \
  "$output_dir/obj/spinon_jni.o" \
  "$output_dir/obj/spinon_v8.o" \
  "$repo_root/target/aarch64-linux-android/release/libspinon_ffi.a" \
  "$repo_root/spikes/wgpu-backend/target/aarch64-linux-android/release/libspinon_wgpu_r08_spike.a" \
  "$v8_archive" "$v8_libcxx" "$v8_libcxxabi" \
  "-fuse-ld=$v8_lld" -Wl,--gc-sections -nostdlib++ --unwindlib=none -landroid -llog -ldl \
  -o "$output_dir/jniLibs/arm64-v8a/libspinon_bootstrap.so"

echo "Android ARM64 V8 smoke 라이브러리 준비 완료: $output_dir/jniLibs/arm64-v8a/libspinon_bootstrap.so"
