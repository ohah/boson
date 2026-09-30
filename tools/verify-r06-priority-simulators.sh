#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
android_package="dev.spinon.bootstrap"
ios_bundle_id="dev.spinon.bootstrap"
expected_order='order=[user-blocking:1#seq4,user-blocking:2#seq6,user-visible:101#seq3,user-visible:102#seq7,background:201#seq2,background:202#seq5]'
pass_marker='status=0 priority_probe=PASS blocker_status=-8 cancel_status=0'
run_id="$(date -u +%Y%m%dT%H%M%SZ)"
result_dir="${SPINON_R06_PRIORITY_OUTPUT_DIR:-$repo_root/build/spinon/priority-validation/$run_id}"
ios_stream_pid=""

fail() {
  printf '실패: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ -n "$ios_stream_pid" ]]; then
    kill "$ios_stream_pid" 2>/dev/null || true
    wait "$ios_stream_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

[[ "$(uname -s)" == "Darwin" ]] || fail "이 검증은 Android 에뮬레이터와 iOS 시뮬레이터가 있는 macOS에서 실행해야 합니다"
command -v mise >/dev/null 2>&1 || fail "mise를 찾을 수 없습니다"
command -v adb >/dev/null 2>&1 || fail "Android SDK platform-tools의 adb를 찾을 수 없습니다"
command -v xcrun >/dev/null 2>&1 || fail "Xcode의 xcrun을 찾을 수 없습니다"
command -v rg >/dev/null 2>&1 || fail "ripgrep의 rg를 찾을 수 없습니다"

android_serial="${SPINON_ANDROID_EMULATOR_SERIAL:-}"
if [[ -n "$android_serial" ]]; then
  [[ "$android_serial" =~ ^emulator-[0-9]+$ ]] || fail "Android 대상은 emulator-숫자 형식이어야 합니다. 실기기 serial은 허용하지 않습니다"
  if ! adb devices | awk -v serial="$android_serial" '$1 == serial && $2 == "device" { found = 1 } END { exit !found }'; then
    fail "지정한 Android 에뮬레이터가 연결·실행 중이지 않습니다: $android_serial"
  fi
else
  android_emulators=()
  while IFS=$'\t' read -r serial state _; do
    if [[ "$serial" =~ ^emulator-[0-9]+$ && "$state" == "device" ]]; then
      android_emulators+=("$serial")
    fi
  done < <(adb devices | tail -n +2)
  if [[ "${#android_emulators[@]}" -ne 1 ]]; then
    fail "실행 중인 Android 에뮬레이터가 ${#android_emulators[@]}개입니다. 하나만 연결하거나 SPINON_ANDROID_EMULATOR_SERIAL을 지정하세요"
  fi
  android_serial="${android_emulators[0]}"
fi

booted_ios="$(xcrun simctl list devices booted)"
ios_simulator_udid="${SPINON_IOS_SIMULATOR_UDID:-}"
if [[ -n "$ios_simulator_udid" ]]; then
  printf '%s\n' "$booted_ios" | rg -Fq "($ios_simulator_udid) (Booted)" \
    || fail "지정한 iOS 시뮬레이터가 부팅되어 있지 않습니다: $ios_simulator_udid"
else
  ios_simulators=()
  while IFS= read -r udid; do
    [[ -n "$udid" ]] && ios_simulators+=("$udid")
  done < <(printf '%s\n' "$booted_ios" | sed -nE 's/.*\(([0-9A-Fa-f-]{36})\) \(Booted\)[[:space:]]*$/\1/p')
  if [[ "${#ios_simulators[@]}" -ne 1 ]]; then
    fail "실행 중인 iOS 시뮬레이터가 ${#ios_simulators[@]}개입니다. 하나만 부팅하거나 SPINON_IOS_SIMULATOR_UDID를 지정하세요"
  fi
  ios_simulator_udid="${ios_simulators[0]}"
fi

mkdir -p "$result_dir"
android_log="$result_dir/android.log"
ios_log="$result_dir/ios.log"
ios_stream_log="$result_dir/ios-stream.log"
android_build_log="$result_dir/android-build.log"
ios_build_log="$result_dir/ios-build.log"

android_model="$(adb -s "$android_serial" shell getprop ro.product.model | tr -d '\r')"
android_release="$(adb -s "$android_serial" shell getprop ro.build.version.release | tr -d '\r')"
android_abi="$(adb -s "$android_serial" shell getprop ro.product.cpu.abi | tr -d '\r')"
[[ "$android_abi" == "arm64-v8a" ]] || fail "현재 Android smoke APK는 arm64-v8a 에뮬레이터만 지원합니다: $android_abi"
printf 'Android 에뮬레이터: %s · %s · Android %s · %s\n' \
  "$android_serial" "$android_model" "$android_release" "$android_abi"
printf 'iOS 시뮬레이터: %s\n' "$ios_simulator_udid"

printf '\nAndroid 앱을 빌드합니다.\n'
cd "$repo_root"
if ! mise exec -- bun run build:android > "$android_build_log" 2>&1; then
  tail -n 80 "$android_build_log" >&2
  fail "Android 시뮬레이터 빌드가 실패했습니다"
fi
printf 'Android 빌드 통과 · 로그: %s\n' "$android_build_log"
android_apk="$repo_root/platforms/android/app/build/outputs/apk/debug/app-debug.apk"
[[ -f "$android_apk" ]] || fail "Android APK가 없습니다: $android_apk"

printf '\nAndroid 에뮬레이터에서 실제 V8 검증을 실행합니다.\n'
adb -s "$android_serial" install -r "$android_apk"
adb -s "$android_serial" logcat -c
adb -s "$android_serial" shell am force-stop "$android_package"
adb -s "$android_serial" shell am start -n "$android_package/.MainActivity" --ez spinon_priority_probe true \
  > "$result_dir/android-launch.txt"

android_passed=false
for _ in $(seq 1 45); do
  adb -s "$android_serial" logcat -d -s SpinonBootstrap:I \
    | rg 'SPINON_PRIORITY_PROBE' > "$android_log" || true
  if rg -Fq "$pass_marker" "$android_log" && rg -Fq "$expected_order" "$android_log"; then
    android_passed=true
    break
  fi
  if rg -Fq 'priority_probe=FAIL' "$android_log"; then
    cat "$android_log" >&2
    fail "Android 실제 V8 우선순위 진단이 실패했습니다"
  fi
  sleep 1
done
[[ "$android_passed" == "true" ]] || {
  cat "$android_log" >&2
  fail "45초 안에 Android 검증 통과 로그를 받지 못했습니다"
}
rg -q 'owner_tid=[1-9][0-9]*' "$android_log" || fail "Android 로그에 유효한 owner thread가 없습니다"
adb -s "$android_serial" exec-out screencap -p > "$result_dir/android.png"
printf 'Android 검증 통과 · 원본: %s · 화면: %s\n' "$android_log" "$result_dir/android.png"

printf '\niOS 시뮬레이터 앱을 빌드합니다.\n'
if ! mise exec -- bun run build:ios-sim > "$ios_build_log" 2>&1; then
  tail -n 80 "$ios_build_log" >&2
  fail "iOS 시뮬레이터 빌드가 실패했습니다"
fi
printf 'iOS 빌드 통과 · 로그: %s\n' "$ios_build_log"
ios_app="$repo_root/build/spinon/DerivedData/Build/Products/Debug-iphonesimulator/SpinonBootstrap.app"
[[ -d "$ios_app" ]] || fail "iOS 시뮬레이터 앱이 없습니다: $ios_app"

printf '\niOS 시뮬레이터에서 실제 V8 검증을 실행합니다.\n'
xcrun simctl install "$ios_simulator_udid" "$ios_app"
xcrun simctl spawn "$ios_simulator_udid" log stream --style compact \
  --predicate 'process == "SpinonBootstrap" AND eventMessage CONTAINS[c] "SPINON_PRIORITY_PROBE"' \
  > "$ios_stream_log" 2>&1 &
ios_stream_pid=$!
sleep 1
xcrun simctl terminate "$ios_simulator_udid" "$ios_bundle_id" >/dev/null 2>&1 || true
xcrun simctl launch --terminate-running-process "$ios_simulator_udid" "$ios_bundle_id" \
  --spinon-priority-probe > "$result_dir/ios-launch.txt"

ios_passed=false
for _ in $(seq 1 45); do
  if rg -Fq "$pass_marker" "$ios_stream_log" && rg -Fq "$expected_order" "$ios_stream_log"; then
    ios_passed=true
    break
  fi
  if rg -Fq 'priority_probe=FAIL' "$ios_stream_log"; then
    cat "$ios_stream_log" >&2
    fail "iOS 실제 V8 우선순위 진단이 실패했습니다"
  fi
  sleep 1
done
kill "$ios_stream_pid" 2>/dev/null || true
wait "$ios_stream_pid" 2>/dev/null || true
ios_stream_pid=""
[[ "$ios_passed" == "true" ]] || {
  cat "$ios_stream_log" >&2
  fail "45초 안에 iOS 검증 통과 로그를 받지 못했습니다"
}
rg 'SPINON_PRIORITY_PROBE status=' "$ios_stream_log" > "$ios_log" || true
rg -q 'owner_tid=[1-9][0-9]*' "$ios_log" || fail "iOS 로그에 유효한 owner thread가 없습니다"
xcrun simctl io "$ios_simulator_udid" screenshot "$result_dir/ios.png" >/dev/null
printf 'iOS 검증 통과 · 원본: %s · 화면: %s\n' "$ios_log" "$result_dir/ios.png"

printf '\n두 시뮬레이터에서 실제 V8 우선순위와 등급별 FIFO 검증을 통과했습니다.\n결과 폴더: %s\n' "$result_dir"
