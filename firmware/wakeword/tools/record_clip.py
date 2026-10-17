#!/usr/bin/env python3
"""Save three-second training clips from the XIAO nRF52840 Sense microphone.

The firmware records a single classifier window only after this script sends
`c`. Those samples are printed on USB serial. They are not stored on the
board and they are not sent over Bluetooth.

Stop `pio device monitor` before running this. It holds the USB port.
"""

from __future__ import annotations

import argparse
import struct
import sys
import time
import wave
from datetime import datetime, timezone
from pathlib import Path

LABELS = ("hello_nearby", "noise", "unknown")
# Edge Impulse label for the wake phrase. The folder name stays filesystem-safe.
EI_LABELS = {
    "hello_nearby": "hello nearby",
    "noise": "noise",
    "unknown": "unknown",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True, choices=LABELS)
    parser.add_argument("--port", default="/dev/cu.usbmodem101")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "dataset",
    )
    return parser.parse_args()


def import_serial():
    try:
        import serial
    except ImportError:
        sys.exit("Install pyserial first: python3 -m pip install pyserial")
    return serial


def read_line(port, deadline: float) -> str:
    chunks: list[bytes] = []
    while time.time() < deadline:
        byte = port.read(1)
        if not byte:
            continue
        if byte == b"\n":
            return b"".join(chunks).decode("utf-8", "replace").strip()
        if byte != b"\r":
            chunks.append(byte)
    raise TimeoutError("timed out waiting for the board")


def wait_until_ready(port) -> None:
    deadline = time.time() + 6
    try:
        while time.time() < deadline:
            line = read_line(port, deadline)
            if "[ready]" in line or "[mic]" in line or "[stats]" in line:
                return
    except TimeoutError:
        pass
    port.write(b"s")
    deadline = time.time() + 3
    while time.time() < deadline:
        line = read_line(port, deadline)
        if "[stats]" in line or "[ready]" in line:
            return
    raise TimeoutError(
        "board did not answer; flash firmware/wakeword with -e xiaoblesense"
    )


def parse_samples(lines: list[str]) -> tuple[list[int], int, int]:
    expected = 0
    rate = 16000
    samples: list[int] = []
    for line in lines:
        if line.startswith("[clip] samples="):
            parts = dict(
                item.split("=", 1) for item in line.split() if "=" in item
            )
            expected = int(parts.get("samples", "0"))
            rate = int(parts.get("rate", "16000"))
            continue
        if not line.startswith("[clip] "):
            continue
        payload = line[len("[clip] ") :]
        if payload in {"start", "end", "busy"} or payload.startswith("abort"):
            continue
        for token in payload.split():
            if len(token) != 4:
                raise ValueError(f"bad sample token {token!r}")
            value = int(token, 16)
            if value >= 32768:
                value -= 65536
            samples.append(value)
    if expected and len(samples) != expected:
        raise ValueError(f"expected {expected} samples, got {len(samples)}")
    if not samples:
        raise ValueError("clip contained no samples")
    return samples, expected, rate


def capture_one(port) -> tuple[list[int], int]:
    port.reset_input_buffer()
    print("Speak the whole phrase while the onboard LED is on (about 3 seconds).")
    port.write(b"c")
    deadline = time.time() + 60
    started = False
    lines: list[str] = []
    while time.time() < deadline:
        line = read_line(port, deadline)
        if "[clip] busy" in line:
            raise RuntimeError("board is busy with another capture")
        if "[clip] abort" in line:
            raise RuntimeError(line)
        if "[clip] start" in line:
            started = True
            continue
        if not started:
            continue
        lines.append(line)
        if line == "[clip] end":
            samples, _expected, rate = parse_samples(lines)
            return samples, rate
    raise TimeoutError("clip did not finish")


def write_wav(path: Path, samples: list[int], rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(struct.pack("<" + "h" * len(samples), *samples))


def main() -> None:
    args = parse_args()
    if args.count < 1:
        sys.exit("--count must be at least 1")
    serial = import_serial()
    try:
        port = serial.Serial(args.port, args.baud, timeout=0.2)
    except serial.SerialException as error:
        sys.exit(
            f"Could not open {args.port} ({error}). "
            "Stop pio device monitor if it is using the port."
        )

    saved: list[Path] = []
    try:
        with port:
            wait_until_ready(port)
            folder = args.dataset / args.label
            print(
                f"Label {args.label} -> Edge Impulse label "
                f"{EI_LABELS[args.label]!r}. Files: {folder}"
            )
            for index in range(args.count):
                if args.count > 1:
                    input(f"Take {index + 1}/{args.count}. Press Enter when ready.")
                else:
                    input("Press Enter, then say the whole phrase while the LED is on.")
                samples, rate = capture_one(port)
                stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                path = folder / f"{stamp}.wav"
                write_wav(path, samples, rate)
                saved.append(path)
                print(f"Wrote {path} ({len(samples)} samples at {rate} Hz)")
    except (TimeoutError, RuntimeError, ValueError, serial.SerialException) as error:
        sys.exit(str(error))

    print(f"Saved {len(saved)} clip(s).")


if __name__ == "__main__":
    main()
