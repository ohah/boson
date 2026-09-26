#!/usr/bin/env python3
"""Summarize frame callback gaps during the first-to-last successful tap window."""

from datetime import datetime, timedelta
from pathlib import Path
import re
import statistics
import sys


def summarize(path: Path) -> None:
    rows = []
    for line in path.read_text().splitlines():
        timestamp = re.match(r"(?:2026-)?(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)", line)
        if timestamp:
            rows.append((datetime.strptime("2026-" + timestamp[1], "%Y-%m-%d %H:%M:%S.%f"), line))

    touches = [time for time, line in rows if "BOSON_TOUCH_RESULT=0" in line]
    if len(touches) != 20:
        raise ValueError(f"{path}: expected 20 successful touches, got {len(touches)}")
    start, end = touches[0] - timedelta(milliseconds=100), touches[-1] + timedelta(milliseconds=100)
    dispatch, render, gaps = [], [], []
    for time, line in rows:
        if not start <= time <= end:
            continue
        if match := re.search(r"BOSON_METRIC dispatch_us=([0-9.]+) render_us=([0-9.]+)", line):
            dispatch.append(float(match[1]) / 1000)
            render.append(float(match[2]) / 1000)
        if match := re.search(r"BOSON_FRAME_GAP_MS=([0-9.]+)", line):
            gaps.append(float(match[1]))
    if len(dispatch) != 20 or not gaps:
        raise ValueError(f"{path}: incomplete metrics ({len(dispatch)} events, {len(gaps)} frames)")
    print(f"{path.name}: touch=20 window={((end-start).total_seconds()):.3f}s "
          f"dispatch_median={statistics.median(dispatch):.3f}ms "
          f"render_median={statistics.median(render):.3f}ms "
          f"frames={len(gaps)} gap>25ms={sum(g > 25 for g in gaps)} "
          f"gap_max={max(gaps):.3f}ms")


for name in sys.argv[1:]:
    summarize(Path(name))
