#ifndef SPINON_V8_H
#define SPINON_V8_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct SpinonV8Runtime SpinonV8Runtime;
typedef void (*SpinonNodeCallback)(void *user_data, int32_t node_id, const char *tag);
typedef void (*SpinonTextCallback)(void *user_data, const char *text);
typedef struct SpinonDocumentOperation {
  int32_t kind;
  int32_t node_id;
  int32_t parent_id;
  int32_t before_id;
  const uint16_t *namespace_utf16;
  size_t namespace_length;
  const uint16_t *name_utf16;
  size_t name_length;
  const uint16_t *value_utf16;
  size_t value_length;
} SpinonDocumentOperation;
typedef struct SpinonDocumentReceipt {
  uint64_t document_revision;
  uint64_t render_tree_revision;
  uint64_t node_count;
  int32_t changed;
} SpinonDocumentReceipt;
typedef int32_t (*SpinonDocumentCommitCallback)(
    void *document_user_data, const SpinonDocumentOperation *operations,
    size_t operation_count, SpinonDocumentReceipt *receipt,
    char *error_output, size_t error_capacity);

SpinonV8Runtime *spinon_v8_runtime_new(SpinonNodeCallback node_callback,
                                      SpinonTextCallback text_callback,
                                      SpinonDocumentCommitCallback document_commit_callback,
                                      void *user_data,
                                      void *document_user_data);
int32_t spinon_v8_runtime_eval(SpinonV8Runtime *runtime, const char *source);
int32_t spinon_v8_runtime_dispatch(SpinonV8Runtime *runtime, int32_t node_id);
const char *spinon_v8_runtime_last_error(SpinonV8Runtime *runtime);
int32_t spinon_v8_runtime_was_terminated(SpinonV8Runtime *runtime);
/* TerminateExecution은 V8가 다른 스레드 호출을 허용하는 유일한 취소 경로입니다. */
void spinon_v8_runtime_terminate(SpinonV8Runtime *runtime);
void spinon_v8_runtime_cancel_termination(SpinonV8Runtime *runtime);
void spinon_v8_runtime_free(SpinonV8Runtime *runtime);
uint64_t spinon_v8_current_thread_id(void);

#ifdef __cplusplus
}
#endif

#endif
