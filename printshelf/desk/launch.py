"""Open the local MeshFinder window. The Pi library is left alone."""
from __future__ import annotations

import sys
import threading
import time
import urllib.request
from pathlib import Path

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


def main() -> int:
    thread = threading.Thread(target=serve, name="meshfinder-desk", daemon=True)
    thread.start()
    _wait_ready()
    import webview

    webview.create_window(
        "MeshFinder",
        f"http://{HOST}:{PORT}/",
        width=1440,
        height=900,
        min_size=(980, 640),
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
