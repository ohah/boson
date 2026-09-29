# R13 플랫폼 생명주기·GPU 복구 실험

이 문서는 R13 실험에서만 쓰는 호스트 동작과 내부 C ABI를 기록합니다. 제품 API가 아니며 릴리스 호환성 보장을 제공하지 않습니다. 실험 결과와 기기 범위는 [검증 기록](evidence/r13-platform-gpu-recovery-2026-09-29.md)에 있습니다.

## 실험 ABI v1

`spikes/wgpu-backend/include/spinon_wgpu_r08.h`의 실험용 선언입니다. 렌더러 핸들은 생성된 UI 스레드에서 직렬로 호출하고 `spinon_wgpu_destroy`를 한 번 호출해 해제합니다. 이 주입 함수는 R13 개발 모드에서만 호출합니다.

```c
int32_t spinon_wgpu_r13_inject_failure(void *renderer, uint32_t failure_kind);
```

| 값 | 의미 |
| --- | --- |
| `failure_kind = 1` | 다음 `draw`에서 표면 손실 `-3`을 한 번 반환합니다. |
| `failure_kind = 2` | 실제 wgpu 장치 손실 콜백이 기록하는 원자 상태를 세웁니다. 다음 `draw`가 장치 손실 `-5`를 반환합니다. |
| `failure_kind = 3` | 다음 `draw`에서 표면 재구성 필요 `-4`를 한 번 반환합니다. |
| `failure_kind = 4` | 다음 `draw`에서 임시 오류 `-2`를 한 번 반환합니다. 자동 복구가 시작되지 않는지 확인하는 용도입니다. |
| 반환 `0` | 주입 요청 성공. 손실 복구가 완료되었다는 뜻은 아닙니다. |
| 반환 `-1` | 렌더러 핸들이 null입니다. |
| 반환 `-2` | 지원하지 않는 주입 값입니다. |

`spinon_wgpu_draw` 결과 중 호스트 복구 대상은 표면 손실 `-3`, 표면 재구성 필요 `-4`, 장치 손실 `-5`입니다. 임시 획득·가림·검증 오류는 `-2`이며 이 실험에서는 렌더러를 자동으로 폐기하지 않습니다. 이후 입력·레이아웃 등 다음 정상 draw 요청은 같은 렌더러에서 다시 시도할 수 있습니다. `0`은 프레임 제출 성공입니다. null 렌더러는 `-1`입니다.

R13 호스트는 `-3`, `-4`, `-5`에서 이전 렌더러를 폐기하고 현재 표면으로 새 렌더러를 만든 뒤 한 번 다시 그립니다. 재생성 또는 재그리기가 실패하면 해당 복구 시도 안에서 오류를 기록하고 자동 재귀 재시도하지 않습니다. 이후 새 호스트 이벤트가 발생할 때의 재시도 정책은 이 실험에서 별도 보장하지 않습니다. `-2`에서는 기존 렌더러를 유지하고 자동 복구를 시작하지 않습니다. R08 모드 동작에는 이 자동 복구를 적용하지 않습니다.

## 플랫폼 생명주기

| 플랫폼 | 호스트 신호 | 복구 동작 |
| --- | --- | --- |
| Android | `Activity.onPause`·`onResume`, `SurfaceHolder.Callback` | 비활성 중 draw를 막습니다. 표면 파괴 때 렌더러를 해제하고 표면이 다시 생기면 크기에 맞춰 생성·그립니다. |
| iOS | 앱의 비활성·활성 알림, 뷰의 `didMoveToWindow`, 레이아웃 크기 | 비활성 중 draw를 막고 다시 활성화될 때 레이아웃을 갱신해 그립니다. 창에서 분리될 때 렌더러를 해제하고 재부착·레이아웃 시 다시 만듭니다. |

Android 실행은 `--ez spinon_r13 true`에 `--ei spinon_r13_failure 1|2|3|4`를 더합니다. iOS 실행은 `--spinon-r13`에 `--spinon-r13-failure=surface|device|outdated|temporary`를 더합니다. 복구 후 한 번의 재그리기 실패를 확인할 때는 Android에 `--ei spinon_r13_recovery_failure 1|2|3|4`, iOS에 `--spinon-r13-recovery-failure=surface|device|outdated|temporary`를 함께 전달합니다. 이 경우 최초 주입값은 복구를 시작하고 두 번째 주입값은 복구 렌더러의 재그리기에서 실패시킵니다. iOS 뷰의 창 분리·재부착 경로는 `--spinon-r13-window-cycle`로 개발용 앱에서 한 번 실행할 수 있습니다. 이 인자와 주입 경로는 앱 개발자용 CLI나 공개 API가 아닙니다.

## 완료 판정 범위와 한계

- Android 에뮬레이터에서 회전으로 Activity·표면이 재생성된 후 렌더러가 다시 만들어지고, 세로·가로 방향에서 입력이 동작하는 것을 확인했습니다.
- iOS 시뮬레이터의 [세로 화면 캡처](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-touch-portrait.png)는 중앙 GPU 도형을 한 번 탭한 뒤의 상태입니다. 도형이 주황색으로 바뀌고 활성화 횟수가 1회로 표시됩니다. 이는 R13 데모 입력 경로의 검증이며 제품 이벤트 API 지원을 뜻하지 않습니다.
- Android API 36 에뮬레이터에서 Spinon과 Chrome을 실제 분할 화면 작업으로 열고 구분선을 움직였습니다. GPU 표면은 `1080x1187`에서 `1080x735`로 바뀐 뒤 다시 `1080x1187`로 재생성되었습니다. 작은 패널에서는 데모 콘텐츠가 겹치거나 잘려, 반응형 레이아웃은 검증되지 않았습니다. 화면과 로그는 [멀티윈도우 검증 기록](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-multiwindow.log)에 있습니다.
- Android와 iOS 시뮬레이터에서 표면 손실·장치 손실 상태를 각각 주입해 새 렌더러 생성과 재그리기를 확인했습니다.
- 양쪽에서 백그라운드 복귀를 확인했습니다. Android는 실제 `SurfaceHolder` 파괴·생성 로그가 남았습니다. iOS는 비활성·활성 이후 다시 그려지는 동작을 확인했습니다.
- iOS 회전에서는 `CAMetalLayer` drawable 크기 갱신과 wgpu surface 재구성을 확인했습니다. iPadOS Stage Manager에서 앱을 부동 창으로 전환하고 표면 크기 로그 한 건을 확인했지만, 반복적인 실시간 크기 변경 처리는 확인하지 못했습니다. 창 분리·재부착은 `--spinon-r13-window-cycle` 개발 진단으로도 확인했습니다. 실제 기기와 외부 디스플레이는 검증하지 않았습니다.
- 실제 GPU 드라이버·OS에 의한 장치 손실은 재현하지 않았습니다. `device` 주입은 실제 드라이버 손실 대신 같은 원자 손실 상태와 호스트 오류 경계를 검사합니다.
- `outdated` 주입은 OS에서 실제 `wgpu::CurrentSurfaceTexture::Outdated`가 발생한 결과가 아니라 호스트의 `-4` 복구 분기를 검사합니다. `temporary`는 `-2` 자동 복구 제외 분기를 검사하며, 이 결과만으로 모든 일시 오류의 정책을 확정하지 않습니다.
- 렌더러 핸들의 FFI 호출은 UI 스레드에서 직렬화하는 계약입니다. 동시 `draw`·`resize`·`destroy` 호출 경합은 계약 밖이므로 시험하지 않았습니다. 장치 손실 주입도 원자 상태만 동기적으로 세우며 실제 wgpu 비동기 손실 콜백과 UI 스레드의 경합은 재현하지 않았습니다.
- Android 결과는 API 36 ARM64 에뮬레이터의 Vulkan backend와 SwiftShader CPU 어댑터에서 나왔습니다. iOS 결과는 iOS 26.2 시뮬레이터의 Metal 경로입니다. 실기기 성능이나 GPU 복구 안정성을 증명하지 않습니다.
- 이 실험은 이벤트·JS 콜백·트리 상태를 렌더러 재생성 뒤 보존하는 S11 계약을 구현하거나 완료하지 않습니다. Android 실험 화면의 탭 횟수도 Activity 재생성 시 보존하지 않습니다.
- `queue.present` 호출 뒤 남기는 `SPINON_R13_FRAME=submitted` 로그는 프레임 제출을 나타냅니다. OS compositor가 실제 화면에 표시했음을 확인하는 present 완료 콜백은 아닙니다.
