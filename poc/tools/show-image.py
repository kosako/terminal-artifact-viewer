#!/usr/bin/env python3
"""Phase 0 isolation tool: draw one PNG in the current terminal, no dependencies.

usage: python3 -I show-image.py kitty|iterm2 /absolute/path/to/image.png [columns]

kitty  - Kitty graphics protocol (what Herdr renders and passes to the outer terminal)
iterm2 - iTerm2 inline images (OSC 1337), for a shell directly in iTerm2

It only reads the given file and writes escape sequences to stdout.
columns is a whole number from 1 to 1000 (default 40). The file must be a PNG:
the signature, an IHDR chunk first with a non-zero size, and an IEND chunk last.
exit: 0 = drawn / 1 = not a PNG / 2 = usage, or the file cannot be read
"""
import base64
import struct
import sys

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
IEND = b"\x00\x00\x00\x00IEND\xaeB`\x82"


def is_png(data: bytes) -> bool:
    if len(data) < 8 + 25 + 12 or not data.startswith(PNG_SIGNATURE):
        return False
    length, kind = struct.unpack(">I4s", data[8:16])
    if kind != b"IHDR" or length != 13:
        return False
    width, height = struct.unpack(">II", data[16:24])
    return width > 0 and height > 0 and data.endswith(IEND)


def parse_columns(text: str) -> int | None:
    if not (text.isascii() and text.isdigit()):
        return None
    value = int(text)
    return value if 1 <= value <= 1000 else None


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
    columns = parse_columns(sys.argv[3]) if len(sys.argv) == 4 else 40
    if columns is None:
        print("columns must be a whole number from 1 to 1000", file=sys.stderr)
        return 2
    try:
        with open(sys.argv[2], "rb") as handle:
            data = handle.read()
    except OSError as error:
        print(f"cannot read the file: {error.strerror}", file=sys.stderr)
        return 2
    if not is_png(data):
        print("not a PNG", file=sys.stderr)
        return 1
    (kitty if sys.argv[1] == "kitty" else iterm2)(data, columns)
    return 0


if __name__ == "__main__":
    sys.exit(main())
