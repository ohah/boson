#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
case "${SPINON_ENABLE_S04_IOS_FIXTURE:-0}" in
  0|1) ;;
  *)
    echo "SPINON_ENABLE_S04_IOS_FIXTURE은 0 또는 1이어야 합니다." >&2
    exit 2
    ;;
esac

if command -v mise >/dev/null 2>&1; then
  mise exec -- xcodebuild \
    -project "$repo_root/platforms/ios/SpinonBootstrap.xcodeproj" \
    -scheme SpinonBootstrap \
    -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$repo_root/build/spinon/DerivedData" \
    "SPINON_ENABLE_S04_IOS_FIXTURE=${SPINON_ENABLE_S04_IOS_FIXTURE:-0}" \
    CODE_SIGNING_ALLOWED=NO build
else
  xcodebuild \
    -project "$repo_root/platforms/ios/SpinonBootstrap.xcodeproj" \
    -scheme SpinonBootstrap \
    -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$repo_root/build/spinon/DerivedData" \
    "SPINON_ENABLE_S04_IOS_FIXTURE=${SPINON_ENABLE_S04_IOS_FIXTURE:-0}" \
    CODE_SIGNING_ALLOWED=NO build
fi
