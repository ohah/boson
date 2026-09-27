#include <dlfcn.h>
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>

int main(int argc, char **argv) {
  if (argc != 2) { std::fprintf(stderr, "usage: runner <core library>\n"); return 2; }
  void *lib = dlopen(argv[1], RTLD_NOW);
  if (!lib) { std::fprintf(stderr, "%s\n", dlerror()); return 2; }
  auto make = reinterpret_cast<void *(*)(int)>(dlsym(lib, "bench_new"));
  auto free_tree = reinterpret_cast<void (*)(void *)>(dlsym(lib, "bench_free"));
  auto step = reinterpret_cast<uint64_t (*)(void *, uint32_t, int)>(dlsym(lib, "bench_step"));
  if (!make || !free_tree || !step) return 2;
  for (int count : {100, 1000}) for (int scan : {0, 1}) {
    const int events = scan ? (count == 100 ? 1000 : 100) : 10000;
    std::vector<double> times;
    uint64_t expected = 0;
    for (int trial = 0; trial < 7; ++trial) {
      void *tree = make(count);
      if (!tree) return 2;
      for (int i = 0; i < 10; ++i) step(tree, static_cast<uint32_t>(i), scan);
      uint64_t checksum = 0;
      auto start = std::chrono::steady_clock::now();
      for (int i = 0; i < events; ++i)
        checksum += step(tree, static_cast<uint32_t>(i), scan);
      auto end = std::chrono::steady_clock::now();
      free_tree(tree);
      if (trial && checksum != expected) return 3;
      expected = checksum;
      times.push_back(std::chrono::duration<double, std::micro>(end - start).count() / events);
    }
    std::sort(times.begin(), times.end());
    std::printf("nodes=%d mode=%s events=%d median_us=%.3f min_us=%.3f max_us=%.3f checksum=%llu\n",
                count, scan ? "scan" : "indexed", events, times[3], times[0], times[6],
                static_cast<unsigned long long>(expected));
  }
  dlclose(lib);
}
