#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
resource_dir="${1:?Xcode 리소스 디렉터리가 필요합니다}"
source="$repo_root/build/spinon/bootstrap/app.js"
if [[ ! -f "$source" ]]; then
  echo "Bun 번들이 없습니다. bun run bundle:bootstrap을 먼저 실행하세요." >&2
  exit 1
fi
mkdir -p "$resource_dir"
cp "$source" "$resource_dir/app.js"
