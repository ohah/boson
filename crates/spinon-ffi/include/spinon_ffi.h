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

/* 장기 실행 V8 스레드 소유권 실험용 API입니다. 제품 공개 API가 아닙니다.
   session_new는 초기화 보고 문자열을 출력하고, 실패하면 NULL을 반환합니다.
   eval/dispatch는 호출 스레드를 막으므로 UI 스레드에서 부르지 마세요.
   성공 0, 인자 오류 -1, 출력 버퍼 부족 -3, JS 오류 -4, 큐 포화 -5,
   종료 중 -6, 실행기 오류 -7, 취소된 JS -8을 반환합니다.
   cancel은 취소 요청 0, 실행 중인 JS 없음 1, 오류는 음수를 반환합니다.
   free 전에 eval/dispatch/cancel 호출을 모두 끝내야 합니다. */
typedef struct SpinonRuntimeSession SpinonRuntimeSession;
SpinonRuntimeSession *spinon_runtime_session_new(char *output,
                                                 size_t output_capacity);
int32_t spinon_runtime_session_eval(SpinonRuntimeSession *session,
                                   const char *source, char *output,
                                   size_t output_capacity);
int32_t spinon_runtime_session_dispatch(SpinonRuntimeSession *session,
                                       int32_t node_id, char *output,
                                       size_t output_capacity);
int32_t spinon_runtime_session_cancel(SpinonRuntimeSession *session);
void spinon_runtime_session_free(SpinonRuntimeSession *session);

#ifdef __cplusplus
}
#endif

#endif
