# 보손 동적 UI 트리 PoC

## 동작 경로

Android 실기기와 iOS 시뮬레이터에서 V8 JavaScript가 UI 노드를 만들고 삭제한다. C++은 V8 API를 Rust 코어의 C ABI에 연결한다. Rust 코어는 노드 ID, 부모, 형제 순서, 텍스트, 스타일을 보관하고 화면 크기에 맞춰 좌표를 계산한다. Android는 계산된 프레임을 `TextView`와 `Button`에, iOS는 `UILabel`과 `UIButton`에 적용한다.

```text
tree.js: createNode / setText / setStyle / removeNode
  → C++ V8 어댑터
  → Rust 노드 트리와 레이아웃 계산
  → JNI 프레임 전달
  → Android FrameLayout의 TextView / Button 또는 iOS UIKit의 UILabel / UIButton
  → 버튼 터치 → JS onEvent → 트리 변경 → 재계산
```

`tree.js`는 처음에 세로 컨테이너, 카운터, 버튼, 가로 행과 두 텍스트 노드를 선언한다. 첫 터치에서 상세 텍스트 노드 `4`를 생성한다. 두 번째 터치에서 그 노드를 삭제한다. 아래 행의 위치가 `y=180 → 244 → 180`으로 이동한다. [Android 실기기 기록](evidence/physical-device-results.md)과 [iOS 시뮬레이터 기록](evidence/ios-simulator-results.md)에 화면·로그·영상을 보관했다. [구조도](diagram/architecture.html)는 두 호스트가 공통 코어를 쓰는 관계를 보여 준다.

[추가 검증 결과](evidence/verification-results.md)에는 트리 무결성, 100회 연속 터치, 오류 복원, 회전, 긴 텍스트, 100~1000개 노드의 실기기 시간·메모리 측정을 기록했다.

## 빌드와 실행

[V8 언어 연결 실험](../v8-language-bridge/README.md)의 Android ARM64용 공식 V8 정적 라이브러리와 Android SDK/NDK, Rust `aarch64-linux-android` 대상이 필요하다. 저장소 루트에서 로컬 빌드한다.

```sh
bash spikes/dynamic-tree/build-android.sh
adb devices -l
adb -s <기기-ID> install -r build/dynamic-tree/android/boson-dynamic-tree.apk
adb -s <기기-ID> shell am start -n dev.boson.tree/.TreeActivity
adb -s <기기-ID> logcat -d -s BosonTree:I '*:S'
```

iOS 시뮬레이터용 공식 V8 정적 라이브러리와 Rust `aarch64-apple-ios-sim` 대상이 준비된 Mac에서는 다음과 같이 실행한다.

```sh
bash spikes/dynamic-tree/build-ios-sim.sh
xcrun simctl install booted build/dynamic-tree/ios-sim/BosonDynamicTree.app
xcrun simctl launch --console booted dev.boson.dynamic-tree
```

화면에서 `Toggle details`를 두 번 누르면 `Taps: 0 → 1 → 2`로 바뀌고 상세 텍스트가 나타났다 사라진다. `boson-node:<ID>:<텍스트>` 접근성 설명으로 현재 노드를 읽을 수 있다. Android 에뮬레이터도 함께 연결된 경우 반드시 `-s`로 대상을 지정한다.

Rust 경계 테스트는 `rustc --edition=2024 --test spikes/dynamic-tree/rust/tree.rs -o build/dynamic-tree/tree-tests && build/dynamic-tree/tree-tests`로 실행한다. 실기기 검증용 JS는 APK에 함께 넣은 `stress.js`, `long_text.js`, `error.js`로 선택할 수 있다. 예를 들어 `adb -s <기기-ID> shell am start -n dev.boson.tree/.TreeActivity --es boson_scenario stress --ei boson_count 1000`을 사용한다. 각 시나리오 전에 앱 프로세스를 종료해 초기 상태로 시작한다.

## 구현 범위

레이아웃은 Rust 표준 라이브러리만 사용한 **작은 행·열 엔진**이다. `width`, `height`, `padding`, `gap`, `flexGrow`의 정수 논리 단위 값과 형제 `order`를 다룬다. Android에서는 dp, iOS에서는 pt로 해석한다. 화면 프레임은 이벤트마다 재계산하고, 양쪽 호스트는 뷰를 노드 ID로 재사용하거나 제거한다. 이 구현은 CSS Flexbox 전체 사양, 자동 텍스트 측정, 스크롤, 클리핑, 비동기 렌더링을 제공하지 않는다. Android의 `TextView`와 iOS의 `UILabel`은 고정된 프레임 안에서 글을 그리지만 Rust는 그 높이를 측정하지 않는다. UI 스레드에서 JS 실행과 레이아웃 계산이 동기적으로 일어난다. 이벤트 오류 시 Rust 트리는 이전 상태로 복원하고 실행을 중단하지만 JS 힙까지 되돌리지는 못한다. 따라서 이 실험은 **동적 트리와 제한된 레이아웃 경로의 동작 확인**이지 완성된 렌더러나 다른 프레임워크와의 성능 비교가 아니다. iOS 실기기 동작은 아직 확인하지 않았다.
