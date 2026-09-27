#!/usr/bin/env python3
"""Aggregate three actual-app runs, each with 20 successful touches."""

import json
from pathlib import Path
from statistics import median
import sys


for name in sys.argv[1:]:
    path = Path(name)
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    print(path.name)
    for count in sorted({row["count"] for row in rows}):
        for variant in ("scan", "indexed"):
            group = [row for row in rows if row["count"] == count and row["variant"] == variant]
            if len(group) != 3 or {row["round"] for row in group} != {1, 2, 3}:
                raise ValueError(f"{path}: missing three repeats for {count} {variant}")
            if any(row["successes"] != 20 or len(row["render_us"]) != 20 for row in group):
                raise ValueError(f"{path}: incomplete event data for {count} {variant}")
            parts = []
            for key in ("snapshot_us", "dispatch_us", "render_us", "core_layout_us"):
                if all(key in row for row in group):
                    parts.append(f"{key}={median(median(row[key]) for row in group):.1f}")
            if all(row["pss_kib"] is not None for row in group):
                parts.append(f"PSS_MiB={median(row['pss_kib'] for row in group) / 1024:.1f}")
            parts.append("inputs=" + "/".join(str(row.get("input_attempts", 20)) for row in group))
            print(f"  n={count} {variant}: " + " ".join(parts))
