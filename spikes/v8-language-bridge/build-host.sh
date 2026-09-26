#!/usr/bin/env bash
set -euo pipefail

spike_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$spike_dir/../.." && pwd)"
output_dir="$repo_dir/build/v8-language-bridge"
node_prefix="${NODE_PREFIX:-$(brew --prefix node)}"
node_library="$(find "$node_prefix/lib" -maxdepth 1 -name 'libnode.*.dylib' -print -quit)"

if [[ -z "$node_library" ]]; then
  echo "Node V8 library not found under $node_prefix/lib" >&2
  exit 1
fi

mkdir -p "$output_dir"
clang++ -std=c++20 -O2 -fPIC \
  -I"$spike_dir/include" -I"$node_prefix/include/node" \
  -c "$spike_dir/bridge/boson_v8.cc" -o "$output_dir/boson_v8.o"
clang++ -std=c++20 -I"$spike_dir/include" "$spike_dir/cpp/main.cc" \
  "$output_dir/boson_v8.o" "$node_library" -o "$output_dir/cpp"
clang++ -std=c++20 -I"$node_prefix/include/node" \
  "$spike_dir/cpp/direct.cc" "$node_library" -o "$output_dir/cpp_direct"
rustc --edition=2024 "$spike_dir/rust/main.rs" \
  -C "link-arg=$output_dir/boson_v8.o" \
  -C "link-arg=$node_library" -C link-arg=-lc++ -o "$output_dir/rust"
zig build-exe "$spike_dir/zig/main.zig" "$output_dir/boson_v8.o" \
  "$node_library" -lc++ -femit-bin="$output_dir/zig"

for language in cpp_direct cpp rust zig; do
  echo "[$language]"
  "$output_dir/$language"
done
