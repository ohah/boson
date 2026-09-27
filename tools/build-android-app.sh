#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
sdk_dir="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
if [[ ! -x "$sdk_dir/platform-tools/adb" ]]; then
  echo "Android SDK 경로가 올바르지 않습니다: $sdk_dir" >&2
  echo "ANDROID_SDK_ROOT 또는 ANDROID_HOME에 Android SDK 경로를 지정하세요." >&2
  exit 1
fi
export ANDROID_HOME="$sdk_dir"
export ANDROID_SDK_ROOT="$sdk_dir"
exec "$repo_root/platforms/android/gradlew" \
  -p "$repo_root/platforms/android" :app:assembleDebug "$@"
