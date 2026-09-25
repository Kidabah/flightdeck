#!/usr/bin/env python3
"""Flightdeck desktop window. The dashboard stays on the Pi."""
from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path

URL = "https://flightdeck.tail7de73e.ts.net"
MUTEX_NAME = "Local\\FlightdeckDesktop"


def _storage() -> str:
    base = os.environ.get("APPDATA") or str(Path.home())
    path = Path(base) / "Flightdeck" / "webview"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def _focus_existing() -> bool:
    if sys.platform != "win32":
        return False
    user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    found: list[int] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def enum_proc(hwnd, _lparam):  # noqa: N803
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value or ""
        if title == "Flightdeck" or title.startswith("Flightdeck "):
            found.append(int(hwnd))
        return True

    user32.EnumWindows(enum_proc, 0)
    if not found:
        return False
    hwnd = found[0]
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    return True


def _already_running() -> bool:
    if sys.platform != "win32":
        return False
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    kernel32.CreateMutexW(None, False, MUTEX_NAME)
    already = int(kernel32.GetLastError()) == 183
    if not already:
        return False
    _focus_existing()
    return True


def main() -> int:
    if _already_running():
        return 0
    import webview

    webview.create_window(
        "Flightdeck",
        URL,
        width=1500,
        height=980,
        min_size=(960, 640),
        confirm_close=False,
    )
    storage = _storage()
    try:
        webview.start(gui="edgechromium", private_mode=False, storage_path=storage)
    except TypeError:
        webview.start(gui="edgechromium", private_mode=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
