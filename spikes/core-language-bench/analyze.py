#!/usr/bin/env python3
"""Validate equal checksums and report median of three balanced-order runs."""

from pathlib import Path
from statistics import median
import re
import sys


for name in sys.argv[1:]:
    path = Path(name)
    data = {}
    language = None
    for line in path.read_text().splitlines():
        if line.startswith("language="):
            language = line.split("=", 1)[1]
            continue
        match = re.fullmatch(
            r"nodes=(\d+) mode=(\w+) events=(\d+) median_us=([0-9.]+) "
            r"min_us=([0-9.]+) max_us=([0-9.]+) checksum=(\d+)", line
        )
        if not match:
            raise ValueError(f"{path}: invalid line: {line}")
        key = (int(match[1]), match[2], int(match[3]))
        data.setdefault(key, {}).setdefault(language, []).append((float(match[4]), match[7]))
    print(path.name)
    for key in sorted(data):
        runs = data[key]
        if set(runs) != {"rust", "cpp", "zig"} or any(len(values) != 3 for values in runs.values()):
            raise ValueError(f"{path}: missing repeated runs for {key}")
        if len({checksum for values in runs.values() for _, checksum in values}) != 1:
            raise ValueError(f"{path}: checksum mismatch for {key}")
        print(f"  {key[0]} {key[1]}: " + ", ".join(
            f"{language}={median(time for time, _ in runs[language]):.3f}us"
            for language in ("rust", "cpp", "zig")
        ))
