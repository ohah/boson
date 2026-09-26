# UI 스레드와 계산 부하 검증

## 목적과 조건

현재 Android와 iOS 호스트는 버튼의 메인/UI 스레드 콜백에서 V8 이벤트를 실행하고 Rust 레이아웃을 계산한 뒤 네이티브 뷰를 갱신한다. 이 동기 경로가 프레임 콜백에 미치는 영향을 확인했다. `contention.js`는 버튼 터치마다 `Date.now()`를 이용해 지정한 시간 동안 JS 계산 루프를 돌리고 카운터를 바꾼다. 별도 CPU 워커는 네이티브/Java 스레드에서 정수 계산을 반복한다. **워커는 V8이나 레이아웃을 별도 스레드로 옮긴 구현이 아니다.**

- Android: USB 연결 Samsung `SM-S731N`, Android 16, 표시 주사율 120Hz. `adb shell input tap 500 370`을 조건마다 20회 실행하고 접근성 화면에서 `Taps: 20`을 확인했다.
- iOS: iPhone 17 Pro 시뮬레이터, iOS 26.2, `CADisplayLink` 60Hz. `idb ui tap 201 194`를 조건마다 20회 실행하고 접근성 화면에서 `Taps: 20`을 확인했다.
- 매 조건마다 앱 프로세스를 새로 시작했다. 프레임 간격은 Android `Choreographer.FrameCallback`, iOS `CADisplayLink.timestamp`로 기록했다. 첫 성공 터치 100ms 전부터 마지막 성공 터치 100ms 후까지 집계했다. `dispatch`는 V8 이벤트와 Rust 트리 변경, `render`는 레이아웃 순회와 네이티브 뷰 갱신에 걸린 호스트 콜백 시간이다.

| 플랫폼 | 메인 스레드 JS 계산 | 백그라운드 CPU 워커 | 터치 20회 구간 | `dispatch` 중앙값 | `render` 중앙값 | 프레임 간격 >25ms / 기록 수 | 최대 간격 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Android 실기기 | 0ms | 0 | 1.899초 | 0.128ms | 0.574ms | 1 / 221 | 31.373ms |
| Android 실기기 | 40ms | 0 | 1.642초 | 39.517ms | 0.324ms | 20 / 129 | 41.712ms |
| Android 실기기 | 0ms | 4 | 2.376초 | 0.044ms | 0.104ms | 0 / 284 | 8.441ms |
| Android 실기기 | 40ms | 4 | 1.576초 | 39.491ms | 0.230ms | 21 / 123 | 41.688ms |
| iOS 시뮬레이터 | 0ms | 0 | 2.184초 | 0.035ms | 0.387ms | 0 / 130 | 16.667ms |
| iOS 시뮬레이터 | 40ms | 0 | 2.199초 | 39.567ms | 0.219ms | 38 / 73 | 59.778ms |
| iOS 시뮬레이터 | 0ms | 4 | 2.232초 | 0.022ms | 0.172ms | 0 / 132 | 16.667ms |
| iOS 시뮬레이터 | 40ms | 4 | 2.282초 | 39.501ms | 0.218ms | 38 / 77 | 62.796ms |

메인 스레드의 40ms 계산은 두 플랫폼 모두에서 프레임 콜백 간격을 반복해서 벌렸다. 이번 짧은 단일 실행에서 백그라운드 워커 4개만 추가한 조건은 25ms 초과 간격이 없었다. 이는 **별도 스레드가 항상 안전하거나 더 빠르다는 증거는 아니다.** CPU 코어 수, 발열, 우선순위, 메모리 대역폭, 긴 사용 시간에 따라 경합이 달라질 수 있다. 특히 iOS는 실기기가 아니라 Mac의 시뮬레이터다.

이 값은 프레임 **콜백 간격**이다. 화면의 실제 표시 완료 시점이나 터치부터 픽셀 변화까지의 지연을 측정하지 않았다. 매 프레임 로그를 남기는 계측 비용이 있고, 조건당 1회·20회 터치뿐이라 통계적 비교나 프레임 드롭률 일반화에 사용할 수 없다. 25ms는 두 플랫폼을 같은 표에 보이기 위한 공통 기준일 뿐 각각의 주사율에 맞춘 합격선은 아니다. 또한 현재 PoC에는 스크롤·가상화 리스트가 없어 리스트 스크롤 경합은 검증하지 않았다.

## 재현과 원본 로그

빌드 후 Android에서 앱을 강제 종료하고 다음과 같이 조건별로 시작한다. `0/40ms`와 워커 `0/4`의 네 조합을 각각 실행한다. 화면의 버튼 중앙을 20회 누른 뒤 대상 PID로 `adb logcat -d --pid=<PID> -s BosonTree:I '*:S'`를 저장한다.

```sh
adb -s <기기-ID> shell am force-stop dev.boson.tree
adb -s <기기-ID> shell am start -W -n dev.boson.tree/.TreeActivity \
  --es boson_scenario contention --ei boson_busy_ms 40 --ei boson_background_workers 4
```

iOS 시뮬레이터도 매 조합마다 종료 후 실행해 버튼을 20회 누르고, 해당 프로세스 ID의 통합 로그를 저장한다.

```sh
xcrun simctl terminate booted dev.boson.dynamic-tree
xcrun simctl launch booted dev.boson.dynamic-tree \
  --boson-scenario contention --boson-busy-ms 40 --boson-background-workers 4
```

원본: [Android 0/0](contention-android-0.log), [40/0](contention-android-40.log), [0/4](contention-android-workers4.log), [40/4](contention-android-40-workers4.log); [iOS 0/0](contention-ios-0.log), [40/0](contention-ios-40.log), [0/4](contention-ios-workers4.log), [40/4](contention-ios-40-workers4.log). [집계 스크립트](../analyze-contention.py)는 성공 터치 20건과 시간 기록을 요구한다.
