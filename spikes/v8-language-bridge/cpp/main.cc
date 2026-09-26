#include "boson_v8.h"
#include <cstdio>

static void on_node(void *, int32_t id, const char *tag) {
  std::printf("node=%d tag=%s\n", id, tag);
  std::fflush(stdout);
}

extern "C" int boson_run() {
  auto *runtime = boson_runtime_new(on_node, nullptr);
  if (!runtime) return 1;
  const char *source =
      "boson.createNode(1, 'view');"
      "boson.onEvent(id => boson.createNode(id + 1, 'text'));";
  int result = boson_runtime_eval(runtime, source);
  if (result == 0) result = boson_runtime_dispatch(runtime, 1);
  if (result != 0) std::fprintf(stderr, "%s\n", boson_runtime_last_error(runtime));
  boson_runtime_free(runtime);
  return result == 0 ? 0 : 1;
}

#ifndef BOSON_NO_MAIN
int main() { return boson_run(); }
#endif
