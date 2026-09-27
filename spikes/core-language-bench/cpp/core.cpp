#include <cstdint>
#include <vector>

struct Node {
  int32_t id, height;
  uint8_t text[16];
};
static_assert(sizeof(Node) == 24);
struct Tree { std::vector<Node> nodes; };

__attribute__((noinline)) static uint64_t snapshot_sum(const std::vector<Node> &nodes) {
  auto *data = reinterpret_cast<volatile const Node *>(nodes.data());
  uint64_t sum = 0;
  for (size_t i = 0; i < nodes.size(); ++i) sum += data[i].text[0];
  return sum;
}

extern "C" void *bench_new(int count) {
  if (count <= 0) return nullptr;
  auto *tree = new Tree;
  tree->nodes.reserve(count);
  for (int i = 0; i < count; ++i) {
    Node node{ i + 1, 24 + (i % 3), {} };
    node.text[0] = static_cast<uint8_t>(i);
    tree->nodes.push_back(node);
  }
  return tree;
}
extern "C" void bench_free(void *handle) { delete static_cast<Tree *>(handle); }
extern "C" uint64_t bench_step(void *handle, uint32_t iteration, int scan) {
  auto *tree = static_cast<Tree *>(handle);
  auto snapshot = tree->nodes;
  auto &nodes = tree->nodes;
  nodes[iteration % nodes.size()].text[0] = static_cast<uint8_t>(iteration);
  int32_t y = 0;
  uint64_t hash = 0;
  for (size_t i = 0; i < nodes.size(); ++i) {
    const Node *node = &nodes[i];
    if (scan) {
      for (const auto &candidate : nodes) {
        if (candidate.id == static_cast<int32_t>(i + 1)) { node = &candidate; break; }
      }
    }
    hash = hash * 131 + static_cast<uint64_t>(node->id * 31 + y * 7 + node->text[0]);
    y += node->height + 1;
  }
  return hash + snapshot_sum(snapshot);
}
