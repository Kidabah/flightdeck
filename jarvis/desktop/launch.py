#!/usr/bin/env python3
"""Amy desktop launcher - wrap existing server + Hands in a WebView2 window.

Does not rewrite the UI. Pi browser Amy stays untouched.
"""
from __future__ import annotations

import json
import os
import runpy
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

_DESKTOP = Path(__file__).resolve().parent
_JARVIS = _DESKTOP.parent
if str(_DESKTOP) not in sys.path:
    sys.path.insert(0, str(_DESKTOP))
if str(_JARVIS) not in sys.path:
    sys.path.insert(0, str(_JARVIS))

from paths import (  # noqa: E402
    app_data_dir,
    config_path,
    ensure_desktop_config,
    hands_script,
    is_frozen,
    jarvis_root,
    server_script,
    uploads_dir,
)

AMY_PORT = 4700
HANDS_PORT = 4701
AMY_URL = f"http://127.0.0.1:{AMY_PORT}"
HANDS_HEALTH = f"http://127.0.0.1:{HANDS_PORT}/health"
AMY_HEALTH = f"http://127.0.0.1:{AMY_PORT}/api/health"

_started_local = {"hands": False, "amy": False}


def _http_ok(url: str, timeout: float = 1.5) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return 200 <= int(resp.status) < 300
    except Exception:
        return False


def _wait_url(url: str, label: str, timeout_s: float = 30.0) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if _http_ok(url):
            print(f"[amy-desktop] {label} ready")
            return
        time.sleep(0.25)
    raise RuntimeError(f"{label} did not become ready at {url}")


def _apply_env() -> None:
    root = jarvis_root()
    cfg = ensure_desktop_config()
    os.environ["AMY_ROOT"] = str(root)
    os.environ["AMY_CONFIG"] = str(cfg)
    os.environ["AMY_UPLOADS"] = str(uploads_dir())
    os.environ["AMY_BIND"] = "127.0.0.1"
    os.environ.setdefault("PYTHONUTF8", "1")
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))


def _run_script(script: Path, label: str) -> None:
    try:
        print(f"[amy-desktop] {label} thread -> {script}")
        runpy.run_path(str(script), run_name="__main__")
    except SystemExit:
        pass
    except Exception as exc:
        print(f"[amy-desktop] {label} crashed: {exc}", file=sys.stderr)


def start_hands() -> None:
    if _http_ok(HANDS_HEALTH):
        print("[amy-desktop] Amy Hands already running - reusing")
        return
    script = hands_script()
    if not script.exists():
        raise FileNotFoundError(f"Amy Hands missing: {script}")
    threading.Thread(target=_run_script, args=(script, "Hands"), daemon=True).start()
    _started_local["hands"] = True


def start_amy() -> None:
    if _http_ok(AMY_HEALTH):
        print("[amy-desktop] Amy already listening on :4700 - reusing")
        return
    script = server_script()
    if not script.exists():
        raise FileNotFoundError(f"Amy server missing: {script}")
    root = jarvis_root()
    graph = root / "viewer" / "graph-data.js"
    if not graph.exists():
        print("[amy-desktop] building notes index...")
        build = root / "build.py"
        if build.exists():
            runpy.run_path(str(build), run_name="__main__")
    threading.Thread(target=_run_script, args=(script, "Amy"), daemon=True).start()
    _started_local["amy"] = True


def _config_hint() -> str:
    cfg = config_path()
    try:
        data = json.loads(cfg.read_text(encoding="utf-8"))
    except Exception:
        return f"Edit keys in {cfg}"
    missing = []
    key = str(data.get("openai_api_key") or "")
    if not key or "PUT-YOUR" in key:
        missing.append("openai_api_key")
    el = str(data.get("elevenlabs_api_key") or "")
    if not el or "PUT-YOUR" in el:
        missing.append("elevenlabs_api_key (optional for Laura)")
    if not missing:
        return f"Config OK - {cfg}"
    return f"Add {', '.join(missing)} in {cfg}"


def main() -> int:
    app_data_dir()
    _apply_env()
    print("[amy-desktop] root", jarvis_root())
    print("[amy-desktop] frozen" if is_frozen() else "[amy-desktop] dev")
    print("[amy-desktop]", _config_hint())

    smoke = "--smoke" in sys.argv or os.environ.get("AMY_DESKTOP_SMOKE") == "1"

    try:
        start_hands()
        start_amy()
        _wait_url(HANDS_HEALTH, "Hands")
        _wait_url(AMY_HEALTH, "Amy")
    except Exception as exc:
        print(f"[amy-desktop] startup failed: {exc}", file=sys.stderr)
        return 1

    if smoke:
        print("[amy-desktop] smoke OK - Hands + Amy healthy")
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{HANDS_PORT}/search",
                data=b'{"query":"SESSION","limit":2}',
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            print("[amy-desktop] search sample:", body[:240])
        except Exception as exc:
            print(f"[amy-desktop] search probe: {exc}")
        return 0

    try:
        import webview
    except ImportError:
        print(
            "[amy-desktop] pywebview missing - pip install -r jarvis/desktop/requirements.txt\n"
            f"Opening browser fallback: {AMY_URL}",
            file=sys.stderr,
        )
        webbrowser.open(AMY_URL)
        print("[amy-desktop] servers running - Ctrl+C to stop")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            print("\n[amy-desktop] bye")
        return 0

    webview.create_window(
        "Amy - Flightdeck",
        AMY_URL,
        width=1400,
        height=900,
        min_size=(900, 600),
        confirm_close=False,
    )
    print(f"[amy-desktop] opening {AMY_URL}")
    try:
        webview.start(gui="edgechromium")
    except Exception as exc:
        print(f"[amy-desktop] edgechromium failed ({exc}); default gui")
        webview.start()
    print("[amy-desktop] window closed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
