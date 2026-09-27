# Rust · C++ · Zig 코어 비교

## 비교 대상

언어 선택이 트리 계산 성능에 미치는 영향을 좁혀 보기 위한 **별도 합성 커널**이다. 세 언어에 같은 C ABI `bench_new` / `bench_step` / `bench_free`를 구현하고 하나의 C++ 실행기가 `dlopen`으로 호출한다. 각 노드는 ID, 높이, 16바이트 텍스트를 가진다. 이벤트마다 전체 노드 배열을 스냅샷으로 복사하고, 텍스트 1개를 변경하고, 위에서 아래로 좌표를 순회해 체크섬을 계산한다. 스냅샷의 텍스트도 `volatile`로 읽어 복사 결과를 실제로 사용한다.

`indexed`는 배열 위치로 노드를 찾고, `scan`은 각 노드 ID를 배열 앞에서부터 선형 검색한다. 후자는 현재 보손 Rust 코어가 레이아웃 중 `Vec`에서 ID를 찾는 패턴을 축소해 나타낸다. **현재 제품 코어를 세 언어로 완전히 포팅한 비교는 아니다.** Flex 계산, 문자열 할당, V8 실행, JNI/UIKit 뷰 갱신, 스크롤, 스레드 간 전달은 측정하지 않는다.

Rust `rustc 1.96.1 -O`, Zig `0.16.0 ReleaseFast`, Apple Clang `17.0.0 -O3`/Android NDK Clang을 사용했다. Zig도 C 런타임 할당자를 사용해 처음 시도에서 발생한 페이지 할당자 차이를 없앴다. 각 실행은 10회 준비 이벤트 후 7회 측정의 중앙값을 출력한다. Rust→C++→Zig, Zig→Rust→C++, C++→Zig→Rust 순서로 세 번 실행해 **세 중앙값의 중앙값**을 아래에 적었다. 같은 작업의 체크섬은 세 언어와 모든 플랫폼에서 일치했다. `dlopen`, 트리 최초 생성, 실행 파일 시작은 측정 구간 밖이다.

## 결과: 이벤트당 시간

| 기기·실행 환경 | 1000개 직접 접근 Rust / C++ / Zig | 1000개 선형 검색 Rust / C++ / Zig |
| --- | --- | --- |
| Mac ARM64 | **1.337 / 1.510 / 1.493µs** | **137.028 / 136.531 / 136.289µs** |
| iPhone 17 Pro 시뮬레이터 | **1.510 / 1.499 / 1.499µs** | **137.678 / 137.018 / 138.007µs** |
| Samsung SM-S731N Android 16 실기기 | **2.015 / 1.598 / 1.536µs** | **166.559 / 166.512 / 172.703µs** |

100개 노드까지 포함한 전체 출력: [Mac](evidence/macos.txt), [iOS 시뮬레이터](evidence/ios-simulator.txt), [Android 실기기](evidence/android-device.txt). [분석 스크립트](analyze.py)는 3회 반복과 플랫폼·언어 간 체크섬 일치를 검사한다.

이 작은 작업에서 플랫폼마다 가장 빠른 언어가 달랐다. Android 1000개 직접 접근은 Zig가 Rust보다 약 0.48µs 빨랐지만, iOS 시뮬레이터의 세 값은 0.011µs 안에 모였다. **선형 검색을 직접 접근으로 바꾸는 효과는 이 언어 차이보다 훨씬 크다.** 현재 Rust 코어는 `Vec`의 ID 선형 검색과 이벤트마다 전체 트리 복제를 사용하므로, 이 자료는 먼저 자료구조와 변경 범위를 개선할 근거다. 조건당 세 번의 짧은 실행, 기기 온도·CPU 클록 미고정, 단순화된 노드 구조 때문에 최종 프레임 성능이나 언어의 절대적인 우열을 뜻하지 않는다. iOS 결과는 실기기가 아닌 Mac 위의 시뮬레이터다.

## 재현

빌드 결과는 저장소의 `build/core-language-bench/<플랫폼>`에 놓인다. Mac에서는 다음 명령으로 세 플랫폼을 빌드한다. Android에는 로컬 SDK/NDK와 Rust Android 대상, iOS에는 시뮬레이터 대상이 설치되어 있어야 한다.

```sh
bash spikes/core-language-bench/build.sh macos
bash spikes/core-language-bench/build.sh ios-simulator
bash spikes/core-language-bench/build.sh android
```

각 플랫폼에서 순서를 바꿔 세 번씩 실행한다. Android는 대상 실기기 ID를 명시해야 한다.

```sh
bash spikes/core-language-bench/run.sh macos > spikes/core-language-bench/evidence/macos.txt
bash spikes/core-language-bench/run.sh ios-simulator > spikes/core-language-bench/evidence/ios-simulator.txt
ANDROID_SERIAL=<실기기-ID> bash spikes/core-language-bench/run.sh android > spikes/core-language-bench/evidence/android-device.txt
python3 spikes/core-language-bench/analyze.py spikes/core-language-bench/evidence/*.txt
```
