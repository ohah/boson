#ifndef SPINON_V8_H
#define SPINON_V8_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct SpinonV8Runtime SpinonV8Runtime;
typedef void (*SpinonNodeCallback)(void *user_data, int32_t node_id, const char *tag);
typedef void (*SpinonTextCallback)(void *user_data, const char *text);

SpinonV8Runtime *spinon_v8_runtime_new(SpinonNodeCallback node_callback,
                                      SpinonTextCallback text_callback,
                                      void *user_data);
int32_t spinon_v8_runtime_eval(SpinonV8Runtime *runtime, const char *source);
int32_t spinon_v8_runtime_dispatch(SpinonV8Runtime *runtime, int32_t node_id);
const char *spinon_v8_runtime_last_error(SpinonV8Runtime *runtime);
void spinon_v8_runtime_free(SpinonV8Runtime *runtime);

#ifdef __cplusplus
}
#endif

#endif
