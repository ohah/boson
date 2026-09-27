#!/usr/bin/env bash

spinon_android_ndk_dir() {
  local repo_root="$1"
  local ndk_version
  local configured_ndk
  local sdk_dir
  local pinned_ndk

  ndk_version="$(cat "$repo_root/tools/android-ndk-version.txt")"
  configured_ndk="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
  sdk_dir="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
  pinned_ndk="$sdk_dir/ndk/$ndk_version"

  if [[ "$configured_ndk" == */"$ndk_version" && -d "$configured_ndk/toolchains/llvm/prebuilt" ]]; then
    printf '%s\n' "$configured_ndk"
    return 0
  fi

  if [[ -d "$pinned_ndk/toolchains/llvm/prebuilt" ]]; then
    if [[ -n "$configured_ndk" ]]; then
      echo "ANDROID_NDK_HOME/ROOT가 고정 버전과 달라 무시하고 SDK의 NDK $ndk_version 을 사용합니다." >&2
    fi
    printf '%s\n' "$pinned_ndk"
    return 0
  fi

  echo "Android NDK $ndk_version 이 필요합니다. SDK 경로의 $pinned_ndk 또는 ANDROID_NDK_HOME을 확인하세요." >&2
  return 1
}
