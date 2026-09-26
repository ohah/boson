#!/usr/bin/env bash
set -euo pipefail

spike_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$spike_dir/../.." && pwd)"
v8_dir="${V8_CHECKOUT:-$repo_dir/build/v8-source/v8}"
v8_revision=7b50b62cb18f28617959e8452e2cd18195b38bcf
v8_out=out/boson-android-mac
build_config="$v8_dir/build/config/BUILDCONFIG.gn"
ndk_dir="${ANDROID_NDK_HOME:-$(find "$HOME/Library/Android/sdk/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)}"
ndk_prebuilt="$ndk_dir/toolchains/llvm/prebuilt/darwin-x86_64"
v8_prebuilt="$v8_dir/third_party/android_toolchain/ndk/toolchains/llvm/prebuilt/darwin-x86_64"

if [[ "$(git -C "$v8_dir" rev-parse HEAD)" != "$v8_revision" ]]; then
  echo "V8 소스 커밋이 실험 기준과 다릅니다: $v8_revision" >&2
  exit 1
fi
if [[ ! -d "$ndk_prebuilt" || ! -f "$build_config" ]]; then
  echo "V8의 Android 의존성 또는 로컬 Android NDK가 없습니다." >&2
  exit 1
fi

mkdir -p "$v8_dir/$v8_out"
sed 's/use_custom_libcxx = false/use_custom_libcxx = true/' \
  "$spike_dir/android-v8.args.gn" > "$v8_dir/$v8_out/args.gn"

backup="$(mktemp)"
cp "$build_config" "$backup"
created_ndk_link=false
restore() {
  cp "$backup" "$build_config"
  rm -f "$backup"
  if [[ "$created_ndk_link" == true ]]; then
    rm "$v8_prebuilt"
  fi
}
trap restore EXIT

python3 - "$build_config" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text()
line = '  assert(host_os == "linux", "Android builds are only supported on Linux.")'
if source.count(line) != 1:
    raise SystemExit("V8의 Android 호스트 검사 위치가 달라졌습니다.")
path.write_text(source.replace(line, '  # Boson macOS cross-build experiment.', 1))
PY

if [[ ! -e "$v8_prebuilt" ]]; then
  ln -s "$ndk_prebuilt" "$v8_prebuilt"
  created_ndk_link=true
fi

export PATH="$repo_dir/build/depot_tools:$PATH"
cd "$v8_dir"
gn gen "$v8_out"
ninja -C "$v8_out" -j "${BOSON_V8_JOBS:-6}" \
  v8_monolith \
  obj/buildtools/third_party/libc++/libc++.a \
  obj/buildtools/third_party/libc++abi/libc++abi.a
