# iOS 시뮬레이터 JIT 없는 V8 재측정

기존 [실제 앱 A/B 측정](ab-results.md)의 iOS 시뮬레이터 빌드는 `v8_jitless = false`였다. iOS 실기기 배포용 V8과 실행 모드를 맞추기 위해 **같은 V8 소스 커밋** `7b50b62cb18f28617959e8452e2cd18195b38bcf`를 `v8_jitless = true`로 별도 빌드했다. JIT 최적화 단계인 Sparkplug, Maglev, Turbofan도 비활성화했다. 기존 빌드와 측정 원본은 보존했다.

iPhone 17 Pro / iOS 26.2 시뮬레이터에서 동일한 `stress.js`, Rust 트리, UIKit 호스트, 입력 간격으로 선형 검색·ID 인덱스 검색을 비교했다. 각 조건마다 앱을 다시 설치·실행하고 성공 터치 20건을 모아 3회 반복했다. 표는 각 실행의 이벤트 중앙값을 구한 뒤 3회 중앙값을 다시 취한 값이다. 단위는 ms다.

| 노드 | V8 | 검색 | 이벤트 처리 `dispatch` | 실제 렌더 `render` | 별도 코어 레이아웃 `core` |
| ---: | --- | --- | ---: | ---: | ---: |
| 100 | JIT 가능 | 선형 | 0.040 | 0.984 | 0.012 |
| 100 | JIT 가능 | 인덱스 | 0.044 | 0.991 | 0.012 |
| 100 | JIT 없음 | 선형 | 0.042 | 1.063 | 0.015 |
| 100 | JIT 없음 | 인덱스 | 0.046 | 1.114 | 0.015 |
| 1000 | JIT 가능 | 선형 | 0.077 | 6.935 | 0.172 |
| 1000 | JIT 가능 | 인덱스 | 0.086 | 6.591 | 0.035 |
| 1000 | JIT 없음 | 선형 | 0.081 | 7.019 | 0.174 |
| 1000 | JIT 없음 | 인덱스 | 0.088 | 6.477 | 0.034 |
| 5000 | JIT 가능 | 선형 | 0.132 | 16.700 | 4.543 |
| 5000 | JIT 가능 | 인덱스 | 0.148 | 10.338 | 0.134 |
| 5000 | JIT 없음 | 선형 | 0.122 | 16.842 | 4.706 |
| 5000 | JIT 없음 | 인덱스 | 0.139 | 10.354 | 0.134 |

5000개 조건에서 인덱스 검색으로 실제 렌더 시간이 **16.842 → 10.354ms**로 줄었다. JIT 가능 빌드의 **16.700 → 10.338ms**와 같은 방향이다. 두 빌드의 절대값 차이는 이 작은 화면의 JS 실행 비용과 시뮬레이터 실행 간 변동이 섞인 결과로, JIT 유무의 일반적인 성능 차이라고 해석할 수 없다. JIT 가능 빌드에서 실제로 어떤 JS 함수가 JIT 컴파일됐는지도 추적하지 않았다.

`dispatch`에는 Rust 트리 스냅샷 복사와 V8 이벤트 호출이 포함된다. `core`는 실제 렌더 **후** 빈 콜백으로 같은 트리 레이아웃을 추가 실행한 값이다. `render - core`를 정확한 UIKit 비용으로 계산할 수 없다. `render`는 실제 픽셀 표시 완료 시각이 아니다. 모든 100·1000개 실행에서 주입 20회와 성공 콜백 20회가 일치했다. 5000개는 두 검색 방식의 매 실행에서 주입 21회, 성공 콜백·접근성 카운터 20회였다. 사용자 터치 손실률로 일반화할 수 없다.

**iOS 실기기 실행 결과는 아니다.** 현재 Mac에 연결된 iOS 기기가 없어 실기기 JIT 없는 앱의 설치·실행·성능은 확인하지 못했다. 시뮬레이터의 CPU, 메모리, 화면 표시 경로는 실기기와 다르다.

## 원본과 재현

[JIT 없는 실행별 JSONL](ab/ios-jitless.jsonl)과 18개 개별 로그([5000개 선형 예시](ab/ios-jitless-5000-r3-scan.log), [인덱스 예시](ab/ios-jitless-5000-r3-indexed.log))에 원본 이벤트를 보관했다. 기존 JIT 가능 빌드의 [JSONL](ab/ios-probe.jsonl)도 그대로 유지했다. 빌드 스크립트는 기존 시뮬레이터용 `args.gn`을 복사해 JIT 없는 설정을 만들고 별도 V8 및 앱 출력 디렉터리에 빌드한다.

```sh
bash spikes/dynamic-tree/build-ios-jitless-ab.sh
BOSON_AB_OUTPUT="$PWD/build/dynamic-tree/ab-jitless" \
  python3 spikes/dynamic-tree/measure-ab.py ios --tag jitless
python3 spikes/dynamic-tree/analyze-ab.py \
  spikes/dynamic-tree/evidence/ab/ios-probe.jsonl \
  spikes/dynamic-tree/evidence/ab/ios-jitless.jsonl
```
