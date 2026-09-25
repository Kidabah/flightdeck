#!/usr/bin/env python3
"""Cindy Vinyl desktop window. The player stays on Mora."""
from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path

URL = "http://flightdeck-nas:4541"
MUTEX_NAME = "Local\\CindyVinylDesktop"
# Small player is 680×210. The room can still open large.
MIN_SIZE = (640, 160)

# The page only resizes itself in a Chrome app window, and WebView2 ignores
# window.resizeTo. This makes Small player / ROOM drive the real window.
_BRIDGE = r"""
(function () {
  if (window.__cindyDesktop) return;
  window.__cindyDesktop = true;
  window.isStandaloneApp = function () { return true; };
  var pos = { x: 40, y: 40, w: 1440, h: 960 };
  function apply() {
    var api = window.pywebview && window.pywebview.api;
    if (!api || !api.set_bounds) return;
    api.set_bounds(Math.round(pos.w), Math.round(pos.h), Math.round(pos.x), Math.round(pos.y));
  }
  window.moveTo = function (x, y) { pos.x = x; pos.y = y; apply(); };
  window.resizeTo = function (w, h) { pos.w = w; pos.h = h; apply(); };
})();
"""


class VinylApi:
    def __init__(self) -> None:
        self.window = None

    def set_bounds(self, width: int, height: int, x: int, y: int) -> bool:
        window = self.window
        if window is None:
            return False
        w = max(MIN_SIZE[0], min(int(width), 2400))
        h = max(MIN_SIZE[1], min(int(height), 1600))
        window.resize(w, h)
        window.move(int(x), int(y))
        return True


def _storage() -> str:
    base = os.environ.get("APPDATA") or str(Path.home())
    path = Path(base) / "CindyVinyl" / "webview"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def _is_vinyl_title(title: str) -> bool:
    text = " ".join(title.replace("·", " ").split())
    return text == "Cindy Vinyl" or text.startswith("Cindy Vinyl ")


def _focus_existing() -> bool:
    if sys.platform != "win32":
        return False
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    found: list[int] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def enum_proc(hwnd, _lparam):  # noqa: N803
        style = user32.GetWindowLongW(hwnd, -16) & 0xFFFFFFFF
        visible = bool(user32.IsWindowVisible(hwnd) or user32.IsIconic(hwnd) or (style & 0x00C00000))
        if not visible:
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        if _is_vinyl_title(buf.value or ""):
            found.append(int(hwnd))
        return True

    user32.EnumWindows(enum_proc, 0)
    if not found:
        return False
    hwnd = found[0]
    user32.keybd_event(0x12, 0, 0, 0)
    user32.keybd_event(0x12, 0, 2, 0)
    user32.ShowWindow(hwnd, 9)
    user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0002 | 0x0001 | 0x0040)
    user32.SetWindowPos(hwnd, -2, 0, 0, 0, 0, 0x0002 | 0x0001 | 0x0040)
    fg = user32.GetForegroundWindow()
    current = kernel32.GetCurrentThreadId()
    fg_thread = user32.GetWindowThreadProcessId(fg, None)
    target_thread = user32.GetWindowThreadProcessId(hwnd, None)
    if fg_thread and fg_thread != current:
        user32.AttachThreadInput(current, fg_thread, True)
    if target_thread and target_thread != current:
        user32.AttachThreadInput(current, target_thread, True)
    user32.BringWindowToTop(hwnd)
    user32.SetForegroundWindow(hwnd)
    if fg_thread and fg_thread != current:
        user32.AttachThreadInput(current, fg_thread, False)
    if target_thread and target_thread != current:
        user32.AttachThreadInput(current, target_thread, False)
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

    api = VinylApi()
    window = webview.create_window(
        "Cindy Vinyl",
        URL,
        width=1440,
        height=960,
        min_size=MIN_SIZE,
        confirm_close=False,
        js_api=api,
    )
    api.window = window
    window.events.loaded += lambda: window.evaluate_js(_BRIDGE)
    storage = _storage()
    try:
        webview.start(gui="edgechromium", private_mode=False, storage_path=storage)
    except TypeError:
        webview.start(gui="edgechromium", private_mode=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
