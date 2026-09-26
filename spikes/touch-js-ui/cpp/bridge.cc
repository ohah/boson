#include "boson_touch.h"
#include "boson_v8.h"

#include <cstdio>

namespace {
void OnNode(void *, int32_t node_id, const char *tag) {
  std::printf("node=%d tag=%s\n", node_id, tag);
  std::fflush(stdout);
}
}

extern "C" void *boson_touch_new(const char *source,
                                   BosonTouchTextCallback callback,
                                   void *user_data) {
  if (!source || !callback) return nullptr;
  BosonRuntime *runtime = boson_runtime_new(OnNode, nullptr);
  if (!runtime) return nullptr;
  boson_runtime_set_text_callback(runtime, callback, user_data);
  if (boson_runtime_eval(runtime, source) != 0) {
    std::fprintf(stderr, "JS: %s\n", boson_runtime_last_error(runtime));
    boson_runtime_free(runtime);
    return nullptr;
  }
  return runtime;
}

extern "C" int32_t boson_touch_dispatch(void *runtime, int32_t node_id) {
  return boson_runtime_dispatch(static_cast<BosonRuntime *>(runtime), node_id);
}

extern "C" const char *boson_touch_last_error(void *runtime) {
  return boson_runtime_last_error(static_cast<BosonRuntime *>(runtime));
}

extern "C" void boson_touch_free(void *runtime) {
  boson_runtime_free(static_cast<BosonRuntime *>(runtime));
}
