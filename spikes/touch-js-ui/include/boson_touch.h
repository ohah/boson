#ifndef BOSON_TOUCH_H
#define BOSON_TOUCH_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*BosonTouchTextCallback)(void *user_data, const char *text);

void *boson_touch_new(const char *source, BosonTouchTextCallback callback,
                      void *user_data);
int32_t boson_touch_dispatch(void *runtime, int32_t node_id);
const char *boson_touch_last_error(void *runtime);
void boson_touch_free(void *runtime);

#ifdef __cplusplus
}
#endif

#endif
