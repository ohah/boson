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
};

// R08 실험 호출 계약: 생성에 성공하면 반환 핸들을 정확히 한 번 destroy한다.
// 전달한 ANativeWindow 또는 UIView/CAMetalLayer는 destroy가 끝날 때까지 유효해야 한다.
// 핸들별 호출은 생성한 UI 스레드에서 직렬 실행하며, draw·resize와 destroy를 경합시키지 않는다.
void *spinon_wgpu_create_android(void *native_window, uint32_t width,
                                 uint32_t height, uint32_t backend,
                                 char *output, size_t output_capacity);
void *spinon_wgpu_create_uikit(void *ui_view, uint32_t width, uint32_t height,
                               uint32_t backend, char *output,
                               size_t output_capacity);
int32_t spinon_wgpu_draw(void *renderer, uint32_t activation_count,
                         char *output, size_t output_capacity);
int32_t spinon_wgpu_resize(void *renderer, uint32_t width, uint32_t height);
// R13 실험 전용: 다음 draw에서 표면 손실 또는 장치 손실 결과를 한 번 주입한다.
int32_t spinon_wgpu_r13_inject_failure(void *renderer, uint32_t failure_kind);
void spinon_wgpu_destroy(void *renderer);

#ifdef __cplusplus
}
#endif

#endif
