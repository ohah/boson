#ifndef SPINON_WGPU_R08_H
#define SPINON_WGPU_R08_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum SpinonWgpuR08Backend {
  SPINON_WGPU_R08_VULKAN = 1,
  SPINON_WGPU_R08_GLES = 2,
  SPINON_WGPU_R08_METAL = 3,
};

enum SpinonWgpuR13InjectedFailure {
  SPINON_WGPU_R13_SURFACE_LOST = 1,
  SPINON_WGPU_R13_DEVICE_LOST = 2,
  SPINON_WGPU_R13_SURFACE_OUTDATED = 3,
  SPINON_WGPU_R13_TEMPORARY_ERROR = 4,
};

// R08 실험 호출 계약: 생성에 성공하면 반환 핸들을 정확히 한 번 destroy한다.
// 전달한 ANativeWindow 또는 UIView/CAMetalLayer는 destroy가 끝날 때까지 유효해야 한다.
// 핸들별 호출은 생성한 UI 스레드에서 직렬 실행하며, draw·resize와 destroy를 경합시키지 않는다.
void *spinon_wgpu_create_android(void *native_window, uint32_t width,
                                 uint32_t height, uint32_t backend,
                                 char *output, size_t output_capacity);
#if defined(SPINON_ENABLE_S04_ANDROID_FIXTURE)
// S04 내부 Android fixture 전용: CSS·레이아웃 snapshot을 생성해 wgpu에 연결한다.
void *spinon_wgpu_create_android_s04(void *native_window, uint32_t width,
                                    uint32_t height, uint32_t backend,
                                    float density, uint64_t surface_generation,
                                    char *output, size_t output_capacity);
#endif
void *spinon_wgpu_create_uikit(void *ui_view, uint32_t width, uint32_t height,
                               uint32_t backend, char *output,
                               size_t output_capacity);
int32_t spinon_wgpu_draw(void *renderer, uint32_t activation_count,
                         char *output, size_t output_capacity);
#if defined(SPINON_ENABLE_S04_ANDROID_FIXTURE)
// S04 fixture는 프레임을 제출하고 surface readback 검증을 비동기로 시작한다.
int32_t spinon_wgpu_s04_draw(void *renderer, char *output,
                             size_t output_capacity);
// 반환값은 1=완료, 0=대기, 음수=실패이며 호출은 device poll에서 대기하지 않는다.
int32_t spinon_wgpu_s04_poll_readback(void *renderer, char *output,
                                      size_t output_capacity);
// S04 내부 Android fixture 전용: 세대·밀도·크기가 바뀐 표면을 재구성한다.
int32_t spinon_wgpu_s04_resize(void *renderer, uint32_t width, uint32_t height,
                               float density, uint64_t surface_generation);
#endif
int32_t spinon_wgpu_resize(void *renderer, uint32_t width, uint32_t height);
// R13 실험 전용: 다음 draw에서 지정한 오류 결과를 한 번 주입한다.
int32_t spinon_wgpu_r13_inject_failure(void *renderer, uint32_t failure_kind);
void spinon_wgpu_destroy(void *renderer);

#ifdef __cplusplus
}
#endif

#endif
