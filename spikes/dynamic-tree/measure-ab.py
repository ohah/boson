#!/usr/bin/env python3
"""Run the same stress screen against scan/indexed Rust cores on local devices."""
from __future__ import annotations

import argparse
from functools import lru_cache
import json
from pathlib import Path
import re
import subprocess
import time

BASE = Path(__file__).resolve().parents[2]
BUILD = BASE / "build/dynamic-tree/ab"
EVIDENCE = Path(__file__).resolve().parent / "evidence/ab"
SIMULATOR = "booted"


@lru_cache(maxsize=1)
def simulator_udid() -> str:
    data = json.loads(command("xcrun", "simctl", "list", "-j", "devices", "booted"))
    booted = [device["udid"] for group in data["devices"].values()
              for device in group if device["state"] == "Booted"]
    if len(booted) != 1:
        raise RuntimeError(f"expected one booted iOS simulator, found {len(booted)}")
    return booted[0]


def command(*args: str, check: bool = True) -> str:
    result = subprocess.run(args, text=True, capture_output=True, check=check)
    return result.stdout


def adb(serial: str, *args: str) -> str:
    return command("adb", "-s", serial, *args)


def android(serial: str, variant: str, count: int, taps: int) -> tuple[str, int | None, str | None, int]:
    apk = BUILD / f"android-{variant}/app.apk"
    adb(serial, "install", "-r", str(apk))
    adb(serial, "shell", "am", "force-stop", "dev.boson.tree")
    adb(serial, "shell", "am", "start", "-W", "-n", "dev.boson.tree/.TreeActivity",
        "--es", "boson_scenario", "stress", "--ei", "boson_count", str(count))
    pid = adb(serial, "shell", "pidof", "dev.boson.tree").strip()
    if not pid:
        raise RuntimeError("Android app exited before measurement")
    time.sleep(0.5)
    attempts = 0
    for _ in range(taps):
        adb(serial, "shell", "input", "tap", "500", "100")
        attempts += 1
        time.sleep(0.2)
    log = adb(serial, "logcat", "-d", f"--pid={pid}", "-s", "BosonTree:I", "*:S")
    for _ in range(5):
        if len(re.findall(r"BOSON_TOUCH_RESULT=0\b", log)) >= taps:
            break
        time.sleep(0.4)
        log = adb(serial, "logcat", "-d", f"--pid={pid}", "-s", "BosonTree:I", "*:S")
        if len(re.findall(r"BOSON_TOUCH_RESULT=0\b", log)) < taps:
            adb(serial, "shell", "input", "tap", "500", "100")
            attempts += 1
    time.sleep(0.4)
    log = adb(serial, "logcat", "-d", f"--pid={pid}", "-s", "BosonTree:I", "*:S")
    meminfo = adb(serial, "shell", "dumpsys", "meminfo", "dev.boson.tree")
    match = re.search(r"TOTAL PSS:\s*(\d+)", meminfo)
    pss_kib = int(match[1]) if match else None
    return log, pss_kib, None, attempts


def ios(variant: str, count: int, taps: int) -> tuple[str, None, str, int]:
    target_id = simulator_udid()
    app = BUILD / f"ios-{variant}/BosonDynamicTree.app"
    command("xcrun", "simctl", "terminate", SIMULATOR, "dev.boson.dynamic-tree", check=False)
    command("xcrun", "simctl", "install", SIMULATOR, str(app))
    launch = command("xcrun", "simctl", "launch", SIMULATOR, "dev.boson.dynamic-tree",
                     "--boson-scenario", "stress", "--boson-count", str(count))
    pid = launch.strip().split(": ")[-1]
    time.sleep(0.5)
    attempts = 0
    for _ in range(taps):
        command("idb", "ui", "tap", "--udid", target_id, "200", "100")
        attempts += 1
        time.sleep(0.2)
    label = None
    for _ in range(6):
        screen = json.loads(command("idb", "ui", "describe-all", "--udid", target_id))
        labels = [item.get("AXLabel", "") for item in screen]
        label = next((re.search(r"boson-node:2:Stress \d+: (\d+)", value)
                      for value in labels if "boson-node:2:Stress" in value), None)
        if label and int(label[1]) >= taps:
            break
        command("idb", "ui", "tap", "--udid", target_id, "200", "100")
        attempts += 1
        time.sleep(0.4)
    log = command("xcrun", "simctl", "spawn", SIMULATOR, "log", "show", "--last", "3m",
                  "--style", "compact", "--predicate",
                  f'process == "BosonDynamicTree" AND processID == {pid} AND eventMessage CONTAINS "BOSON_"')
    return log, None, label[1] if label else "missing", attempts


def parse(log: str, variant: str, count: int, taps: int) -> dict:
    expected = 1 if variant == "indexed" else 0
    modes = re.findall(r"BOSON_TREE_VARIANT=(\d+)", log)
    successes = len(re.findall(r"BOSON_TOUCH_RESULT=0\b", log))
    metrics = [tuple(map(int, match)) for match in re.findall(
        r"BOSON_METRIC snapshot_us=(\d+) dispatch_us=(\d+) render_us=(\d+) core_layout_us=(\d+)", log)]
    if modes != [str(expected)] or successes != taps or len(metrics) != taps:
        raise ValueError(f"invalid run: variant={modes}, successes={successes}, metrics={len(metrics)}")
    frames = [int(value) for value in re.findall(r"BOSON_FRAME(?: result=\d+)? nodes=(\d+)", log)]
    if not frames or any(value not in (count + 1, count + 2) for value in frames):
        raise ValueError(f"wrong frame node counts: {frames}")
    init = re.search(r"BOSON_METRIC init_total_us=(\d+)", log)
    return {"snapshot_us": [item[0] for item in metrics],
            "dispatch_us": [item[1] for item in metrics],
            "render_us": [item[2] for item in metrics],
            "core_layout_us": [item[3] for item in metrics],
            "init_total_us": int(init[1]) if init else None,
            "successes": successes}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("platform", choices=("android", "ios"))
    parser.add_argument("--serial", default="")
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--taps", type=int, default=20)
    parser.add_argument("--counts", type=int, nargs="+", default=(100, 1000, 5000))
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--tag", default="probe")
    args = parser.parse_args()
    if args.platform == "android" and not args.serial:
        parser.error("--serial is required for Android")
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    results = EVIDENCE / f"{args.platform}-{args.tag}.jsonl"
    existing = set()
    if args.resume and results.exists():
        existing = {(row["round"], row["count"], row["variant"])
                    for row in (json.loads(line) for line in results.read_text().splitlines())}
    with results.open("a" if args.resume else "w") as output:
        for round_index in range(args.rounds):
            for count in args.counts:
                order = ("scan", "indexed") if round_index % 2 == 0 else ("indexed", "scan")
                for variant in order:
                    if (round_index + 1, count, variant) in existing:
                        continue
                    log, pss_kib, label, attempts = (
                        android(args.serial, variant, count, args.taps) if args.platform == "android"
                        else ios(variant, count, args.taps)
                    )
                    metrics = parse(log, variant, count, args.taps)
                    if label is not None and label != str(args.taps):
                        raise ValueError(f"screen counter is {label}; expected {args.taps}")
                    raw = EVIDENCE / f"{args.platform}-{args.tag}-{count}-r{round_index + 1}-{variant}.log"
                    raw.write_text(log)
                    row = {"platform": args.platform, "count": count, "round": round_index + 1,
                           "variant": variant, "pss_kib": pss_kib, "input_attempts": attempts,
                           "screen_taps": int(label) if label is not None else None,
                           "raw_log": raw.name, **metrics}
                    output.write(json.dumps(row, ensure_ascii=False) + "\n")
                    output.flush()
                    print(f"{args.platform} n={count} round={round_index + 1} {variant}: "
                          f"{len(row['dispatch_us'])} touches/{attempts} inputs, PSS={pss_kib}", flush=True)
    if args.platform == "android":
        adb(args.serial, "shell", "am", "force-stop", "dev.boson.tree")
    else:
        command("xcrun", "simctl", "terminate", SIMULATOR, "dev.boson.dynamic-tree", check=False)


if __name__ == "__main__":
    main()
