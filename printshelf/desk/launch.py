"""Open the local MeshFinder window. The Pi library is left alone."""
from __future__ import annotations

import ctypes
import sys
import threading
import time
import urllib.request
from pathlib import Path

MUTEX_NAME = "Local\\MeshFinderDesktop"

sys.path.insert(0, str(Path(__file__).resolve().parent))

from server import HOST, PORT, serve  # noqa: E402


class Api:
    def pick_folder(self) -> str:
        import webview

        choice = webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)
        if not choice:
            return ""
        return str(choice[0])


def _wait_ready() -> None:
    url = f"http://{HOST}:{PORT}/api/roots"
    for _ in range(50):
        try:
            with urllib.request.urlopen(url, timeout=0.4) as resp:
                if resp.status == 200:
                    return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError(f"MeshFinder did not start on {url}")


def _focus_existing() -> bool:
    if sys.platform != "win32":
        return False
    user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    found: list[int] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def enum_proc(hwnd, _lparam):  # noqa: N803
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value or ""
        if title == "MeshFinder" or title.startswith("MeshFinder "):
            found.append(int(hwnd))
        return True

    user32.EnumWindows(enum_proc, 0)
    if not found:
        return False
    hwnd = found[0]
    user32.ShowWindow(hwnd, 9)
    user32.SetForegroundWindow(hwnd)
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
    if int(kernel32.GetLastError()) != 183:
        return False
    _focus_existing()
    return True


def main() -> int:
    if _already_running():
        return 0
    thread = threading.Thread(target=serve, name="meshfinder-desk", daemon=True)
    thread.start()
    _wait_ready()
    import webview

    webview.create_window(
        "MeshFinder",
        f"http://{HOST}:{PORT}/",
        width=1500,
        height=980,
        min_size=(960, 640),
        js_api=Api(),
        confirm_close=False,
    )
    storage = Path.home() / "AppData" / "Roaming" / "MeshFinder" / "desk-webview"
    storage.mkdir(parents=True, exist_ok=True)
    try:
        webview.start(gui="edgechromium", private_mode=False, storage_path=str(storage))
    except TypeError:
        webview.start(gui="edgechromium", private_mode=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
