#ifndef BOSON_V8_H
#define BOSON_V8_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct BosonRuntime BosonRuntime;
typedef void (*BosonNodeCallback)(void *user_data, int32_t node_id, const char *tag);

BosonRuntime *boson_runtime_new(BosonNodeCallback callback, void *user_data);
int32_t boson_runtime_eval(BosonRuntime *runtime, const char *source);
int32_t boson_runtime_dispatch(BosonRuntime *runtime, int32_t node_id);
const char *boson_runtime_last_error(BosonRuntime *runtime);
void boson_runtime_free(BosonRuntime *runtime);

#ifdef __cplusplus
}
#endif

#endif
