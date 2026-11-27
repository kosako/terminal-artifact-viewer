#!/usr/bin/env python3
"""Fail when a tracked file holds an absolute path under a home directory.

The repository is public, so a local path under /Users/<name>/ or /home/<name>/
must not be committed. Rules:

- A path counts only where it starts: at the start of a line, or after a
  character that a file name does not use.
- URLs get no special treatment: the rule above applies inside them as well,
  so a URL cannot hide a path. A URL that carries the same shape (a query
  such as ?next=/home/<name>/) fails too;
  write a placeholder for the name, or percent-encode the slashes (%2F).
  A URL path such as https://example.com/home/<name>/ passes, as the slash
  before "home" follows a letter there, not the start of a path.
- Binary files are read too. A tracked symlink is checked by its target.

Only the file name and the line number are printed, never the line, so the CI
log does not repeat the path.

usage: python3 -I scripts/check-home-paths.py   (from the repository root)
exit: 0 = none found / 1 = found / 2 = git failed
"""
import os
import re
import subprocess
import sys

HOME_PATH = re.compile(rb"(?:^|[^A-Za-z0-9._~%-])/(?:Users|home)/[A-Za-z0-9._-]+/")


def tracked_files() -> list[bytes]:
    listed = subprocess.run(["git", "ls-files", "-z"], check=True, capture_output=True).stdout
    return [name for name in listed.split(b"\0") if name]


def content(name: bytes) -> bytes | None:
    if os.path.islink(name):
        return os.fsencode(os.readlink(name))
    if not os.path.isfile(name):  # a submodule, or removed from the work tree
        return None
    with open(name, "rb") as handle:
        return handle.read()


def main() -> int:
    try:
        names = tracked_files()
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"::error::git ls-files failed: {error}", file=sys.stderr)
        return 2
    found = 0
    for name in names:
        data = content(name)
        if data is None:
            continue
        for number, line in enumerate(data.split(b"\n"), start=1):
            if HOME_PATH.search(line):
                shown = name.decode("utf-8", errors="replace")
                print(f"::error file={shown},line={number}::a home path in a tracked file; use a repo-relative path or a placeholder")
                found += 1
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
