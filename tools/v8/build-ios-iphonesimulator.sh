#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
v8_dir="${SPINON_V8_DIR:-$repo_root/build/v8-source/v8}"
revision="$(cat "$repo_root/tools/v8/v8-revision.txt")"
out="out/boson-ios-sim"

if [[ "$(git -C "$v8_dir" rev-parse HEAD 2>/dev/null || true)" != "$revision" ]]; then
  echo "V8 checkout을 tools/v8/checkout.sh로 먼저 준비하세요." >&2
  exit 1
fi
cat > "$v8_dir/$out/args.gn" <<'EOF'
target_os = "ios"
target_cpu = "arm64"
target_environment = "simulator"
is_debug = false
is_component_build = false
v8_monolithic = true
use_custom_libcxx = false
v8_enable_i18n_support = false
v8_use_external_startup_data = false
v8_enable_pointer_compression = false
v8_enable_sandbox = false
v8_jitless = false
v8_enable_webassembly = false
v8_enable_temporal_support = false
enable_rust = false
ios_deployment_target = "18.0"
v8_use_metagen_instance_types = false
EOF
export PATH="$repo_root/build/depot_tools:$PATH"
(cd "$v8_dir" && gn gen "$out")
"$repo_root/build/depot_tools/ninja" -C "$v8_dir/$out" -j "${SPINON_V8_JOBS:-6}" v8_monolith
