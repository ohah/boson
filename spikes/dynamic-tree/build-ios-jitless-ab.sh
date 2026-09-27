#!/usr/bin/env bash
set -euo pipefail

spike="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$spike/../.." && pwd)"
v8="${V8_CHECKOUT:-$repo/build/v8-source/v8}"
out=out/boson-ios-sim-jitless
args="$v8/$out/args.gn"

mkdir -p "$(dirname "$args")"
python3 - "$v8/out/boson-ios-sim/args.gn" "$args" <<'PY'
from pathlib import Path
import sys

source, target = map(Path, sys.argv[1:])
args = source.read_text()
if 'v8_jitless = false' not in args:
    raise SystemExit(f'expected a JIT-enabled simulator baseline: {source}')
args = args.replace('v8_jitless = false', 'v8_jitless = true')
args += '\nv8_enable_sparkplug = false\nv8_enable_maglev = false\n'
args += 'v8_enable_turbofan = false\ntreat_warnings_as_errors = false\n'
target.write_text(args)
PY

export PATH="$repo/build/depot_tools:$PATH"
(cd "$v8" && gn gen "$out" && ninja -C "$out" v8_monolith)
V8_IOS_SIM_OUT="$out" BOSON_AB_PLATFORM=ios \
  BOSON_AB_OUTPUT="$repo/build/dynamic-tree/ab-jitless" \
  bash "$spike/build-ab.sh"
