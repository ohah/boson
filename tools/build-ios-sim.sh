#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
if command -v mise >/dev/null 2>&1; then
  mise exec -- xcodebuild \
    -project "$repo_root/platforms/ios/SpinonBootstrap.xcodeproj" \
    -scheme SpinonBootstrap \
    -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$repo_root/build/spinon/DerivedData" \
    CODE_SIGNING_ALLOWED=NO build
else
  xcodebuild \
    -project "$repo_root/platforms/ios/SpinonBootstrap.xcodeproj" \
    -scheme SpinonBootstrap \
    -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$repo_root/build/spinon/DerivedData" \
    CODE_SIGNING_ALLOWED=NO build
fi
