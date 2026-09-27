#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
source "$repo_root/tools/android-ndk.sh"
v8_dir="${SPINON_V8_DIR:-$repo_root/build/v8-source/v8}"
revision="$(cat "$repo_root/tools/v8/v8-revision.txt")"
out="out/boson-android-mac"
build_config="$v8_dir/build/config/BUILDCONFIG.gn"
ndk_dir="$(spinon_android_ndk_dir "$repo_root")"
ndk_prebuilt="$(find "$ndk_dir/toolchains/llvm/prebuilt" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n 1)"
v8_prebuilt="$v8_dir/third_party/android_toolchain/ndk/toolchains/llvm/prebuilt/$(basename "$ndk_prebuilt")"

if [[ "$(git -C "$v8_dir" rev-parse HEAD 2>/dev/null || true)" != "$revision" ]]; then
  echo "V8 checkout을 tools/v8/checkout.sh로 먼저 준비하세요." >&2
  exit 1
fi
if [[ -z "$ndk_prebuilt" || ! -d "$ndk_prebuilt" || ! -f "$build_config" ]]; then
  echo "V8 Android 빌드 입력 또는 Android NDK가 없습니다." >&2
  exit 1
fi

mkdir -p "$v8_dir/$out"
cp "$repo_root/tools/v8/android-v8.args.gn" "$v8_dir/$out/args.gn"
backup="$(mktemp)"
cp "$build_config" "$backup"
created_ndk_link=false
restore() {
  cp "$backup" "$build_config"
  rm -f "$backup"
  if [[ "$created_ndk_link" == true ]]; then
    rm -f "$v8_prebuilt"
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
path.write_text(source.replace(line, '  # Spinon macOS cross-build smoke.', 1))
PY

if [[ ! -e "$v8_prebuilt" ]]; then
  ln -s "$ndk_prebuilt" "$v8_prebuilt"
  created_ndk_link=true
fi

export DEPOT_TOOLS_UPDATE=0
export PATH="$repo_root/build/depot_tools:$PATH"
(cd "$v8_dir" && gn gen "$out")
"$repo_root/build/depot_tools/ninja" -C "$v8_dir/$out" \
  -j "${SPINON_V8_JOBS:-6}" \
  v8_monolith \
  obj/buildtools/third_party/libc++/libc++.a \
  obj/buildtools/third_party/libc++abi/libc++abi.a
