#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
depot_revision="$(cat "$repo_root/tools/v8/depot-tools-revision.txt")"
v8_revision="$(cat "$repo_root/tools/v8/v8-revision.txt")"
depot_dir="$repo_root/build/depot_tools"
source_root="$repo_root/build/v8-source"
v8_dir="$source_root/v8"

mkdir -p "$repo_root/build"
new_depot_checkout=false
if [[ ! -d "$depot_dir/.git" ]]; then
  git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git "$depot_dir"
  new_depot_checkout=true
fi
if [[ "$(git -C "$depot_dir" rev-parse HEAD)" != "$depot_revision" ]]; then
  if [[ "$new_depot_checkout" == true ]]; then
    git -C "$depot_dir" fetch origin "$depot_revision"
    git -C "$depot_dir" checkout --detach "$depot_revision"
  else
    echo "depot_tools checkout이 고정 커밋과 다릅니다. 기존 파일을 덮어쓰지 않습니다." >&2
    echo "필요 커밋: $depot_revision" >&2
    exit 1
  fi
fi

export DEPOT_TOOLS_UPDATE=0
export PATH="$depot_dir:$PATH"
mkdir -p "$source_root"
new_v8_checkout=false
if [[ ! -d "$v8_dir/.git" ]]; then
  (cd "$source_root" && fetch v8)
  new_v8_checkout=true
fi

actual_revision="$(git -C "$v8_dir" rev-parse HEAD)"
if [[ "$actual_revision" != "$v8_revision" ]]; then
  if [[ "$new_v8_checkout" == true ]]; then
    git -C "$v8_dir" fetch origin "$v8_revision"
    git -C "$v8_dir" checkout --detach "$v8_revision"
  else
    echo "V8 checkout 커밋이 다릅니다. 기존 파일을 덮어쓰지 않습니다." >&2
    echo "필요 커밋: $v8_revision" >&2
    echo "현재 커밋: $actual_revision" >&2
    exit 1
  fi
fi
if [[ -n "$(git -C "$v8_dir" status --porcelain)" ]]; then
  echo "V8 checkout에 수정된 파일이 있습니다. 덮어쓰지 않고 중단합니다." >&2
  git -C "$v8_dir" status --short >&2
  exit 1
fi

(cd "$v8_dir" && gclient sync --revision="v8@$v8_revision")
echo "V8 및 DEPS 동기화 완료: $v8_revision"
