#!/usr/bin/env python3
"""Phase 0 isolation tool: draw one PNG in the current terminal, no dependencies.

usage: python3 -I show-image.py kitty|iterm2 /absolute/path/to/image.png [columns]

kitty  - Kitty graphics protocol (what Herdr renders and passes to the outer terminal)
iterm2 - iTerm2 inline images (OSC 1337), for a shell directly in iTerm2

It only reads the given file and writes escape sequences to stdout.
"""
import base64
import sys


def kitty(data: bytes, columns: int) -> None:
    payload = base64.standard_b64encode(data)
    chunks = [payload[i:i + 4096] for i in range(0, len(payload), 4096)] or [b""]
    out = sys.stdout.buffer
    for index, chunk in enumerate(chunks):
        more = 1 if index < len(chunks) - 1 else 0
        if index == 0:
            head = f"a=T,f=100,t=d,c={columns},m={more}".encode()
        else:
            head = f"m={more}".encode()
        out.write(b"\x1b_G" + head + b";" + chunk + b"\x1b\\")
    out.write(b"\n")
    out.flush()


def iterm2(data: bytes, columns: int) -> None:
    payload = base64.standard_b64encode(data)
    head = f"\x1b]1337;File=inline=1;size={len(data)};width={columns};preserveAspectRatio=1:".encode()
    out = sys.stdout.buffer
    out.write(head + payload + b"\x07\n")
    out.flush()


def main() -> int:
    if len(sys.argv) not in (3, 4) or sys.argv[1] not in ("kitty", "iterm2"):
        print(__doc__, file=sys.stderr)
        return 2
    columns = int(sys.argv[3]) if len(sys.argv) == 4 else 40
    with open(sys.argv[2], "rb") as handle:
        data = handle.read()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        print("not a PNG", file=sys.stderr)
        return 1
    (kitty if sys.argv[1] == "kitty" else iterm2)(data, columns)
    return 0


if __name__ == "__main__":
    sys.exit(main())
