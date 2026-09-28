#ifndef SPINON_FFI_H
#define SPINON_FFI_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* 실험용 앱 시작 API. 성공 0, 인자 오류 -1, V8 생성 실패 -2,
   버퍼 부족 -3, JavaScript 평가·이벤트 오류 -4를 반환합니다. */
int32_t spinon_app_run(const char *source, char *output, size_t output_capacity);

/* 개발용 Taffy 실험 진입점입니다. SPINON_ENABLE_R10_EXPERIMENT=1로 빌드해야 활성화됩니다.
   성공 0, 인자 오류 -1, 레이아웃 오류 -2, 버퍼 부족 -3, 실험 기능 꺼짐 -4를 반환합니다. */
int32_t spinon_taffy_r10_run(float width, float height, float scale,
                             char *output, size_t output_capacity);

#ifdef __cplusplus
}
#endif

#endif
