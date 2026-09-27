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

#ifdef __cplusplus
}
#endif

#endif
