#!/usr/bin/env python3
"""Amy desktop launcher - wrap existing server + Hands.

Hands and Amy run as separate console processes (visible Hands window).
Default UI: Chrome/Edge app window (mic works). Pass --webview for pywebview.
"""
from __future__ import annotations

import json
import os
import subprocess
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
# ?desktop=1 enables Whisper STT (WebView2 can't use Google SpeechRecognition).
AMY_URL = f"http://127.0.0.1:{AMY_PORT}/?desktop=1"
HANDS_HEALTH = f"http://127.0.0.1:{HANDS_PORT}/health"
AMY_HEALTH = f"http://127.0.0.1:{AMY_PORT}/api/health"

_children: list[subprocess.Popen] = []


def _clipboard_get() -> str:
    """Read Unicode text from the Windows clipboard."""
    if sys.platform != "win32":
        return ""
    # tkinter is the most reliable stdlib clipboard bridge on Windows.
    try:
        import tkinter as tk

        root = tk.Tk()
        root.withdraw()
        try:
            root.update()
            return str(root.clipboard_get())
        except tk.TclError:
            return ""
        finally:
            root.destroy()
    except Exception:
        pass
    try:
        import ctypes

        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        CF_UNICODETEXT = 13
        if not user32.OpenClipboard(None):
            return ""
        try:
            handle = user32.GetClipboardData(CF_UNICODETEXT)
            if not handle:
                return ""
            ptr = kernel32.GlobalLock(handle)
            if not ptr:
                return ""
            try:
                return ctypes.wstring_at(ptr)
            finally:
                kernel32.GlobalUnlock(handle)
        finally:
            user32.CloseClipboard()
    except Exception:
        return ""


def _clipboard_set(text: str) -> bool:
    """Write Unicode text to the Windows clipboard."""
    if sys.platform != "win32":
        return False
    data = str(text or "")
    try:
        import tkinter as tk

        root = tk.Tk()
        root.withdraw()
        try:
            root.clipboard_clear()
            root.clipboard_append(data)
            root.update()
            return True
        finally:
            root.destroy()
    except Exception:
        pass
    try:
        import ctypes

        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        CF_UNICODETEXT = 13
        GMEM_MOVEABLE = 0x0002
        if not user32.OpenClipboard(None):
            return False
        try:
            user32.EmptyClipboard()
            encoded = data.encode("utf-16-le") + b"\x00\x00"
            handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(encoded))
            if not handle:
                return False
            ptr = kernel32.GlobalLock(handle)
            if not ptr:
                kernel32.GlobalFree(handle)
                return False
            try:
                ctypes.memmove(ptr, encoded, len(encoded))
            finally:
                kernel32.GlobalUnlock(handle)
            if not user32.SetClipboardData(CF_UNICODETEXT, handle):
                kernel32.GlobalFree(handle)
                return False
            return True
        finally:
            user32.CloseClipboard()
    except Exception:
        return False


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


def _apply_env() -> dict[str, str]:
    root = jarvis_root()
    cfg = ensure_desktop_config()
    env = os.environ.copy()
    env["AMY_ROOT"] = str(root)
    env["AMY_CONFIG"] = str(cfg)
    env["AMY_UPLOADS"] = str(uploads_dir())
    env["AMY_BIND"] = "127.0.0.1"
    env.setdefault("PYTHONUTF8", "1")
    prev = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(root) if not prev else f"{root}{os.pathsep}{prev}"
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    return env


def _python() -> str:
    # Prefer the interpreter running this launcher (Python 3.12 desktop).
    return sys.executable


def _spawn(script: Path, title: str, *, visible: bool, env: dict[str, str]) -> subprocess.Popen:
    if not script.exists():
        raise FileNotFoundError(f"missing {script}")
    creationflags = 0
    if sys.platform == "win32":
        if visible:
            creationflags = subprocess.CREATE_NEW_CONSOLE  # type: ignore[attr-defined]
        else:
            creationflags = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
    print(f"[amy-desktop] starting {title} -> {script} ({'console' if visible else 'background'})")
    proc = subprocess.Popen(
        [_python(), str(script)],
        cwd=str(script.parent),
        env=env,
        creationflags=creationflags,
    )
    _children.append(proc)
    return proc


def start_hands(env: dict[str, str]) -> None:
    if _http_ok(HANDS_HEALTH):
        print("[amy-desktop] Amy Hands already running on :4701 - reusing")
        return
    # Background — no console window (logs go nowhere; health is on :4701)
    _spawn(hands_script(), "Amy Hands", visible=False, env=env)


def start_amy(env: dict[str, str]) -> None:
    if _http_ok(AMY_HEALTH):
        print("[amy-desktop] Amy already listening on :4700 - reusing")
        return
    root = jarvis_root()
    graph = root / "viewer" / "graph-data.js"
    if not graph.exists():
        print("[amy-desktop] building notes index...")
        build = root / "build.py"
        if build.exists():
            subprocess.check_call([_python(), str(build)], cwd=str(root), env=env)
    _spawn(server_script(), "Amy brain", visible=False, env=env)


def stop_children() -> None:
    for proc in list(_children):
        if proc.poll() is not None:
            continue
        try:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
        except Exception:
            pass
    _children.clear()


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


def _open_chrome_app(url: str) -> bool:
    candidates = [
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
    ]
    for exe in candidates:
        if exe and exe.exists():
            subprocess.Popen([str(exe), f"--app={url}", "--new-window"])
            print(f"[amy-desktop] opened {exe.name} app window -> {url}")
            return True
    return False


def _patch_webview2_auto_media() -> None:
    """Inject Chromium flags so WebView2 never shows mic/camera allow dialogs."""
    try:
        import inspect
        import textwrap

        import webview.platforms.edgechromium as ec  # type: ignore
    except Exception as exc:
        print(f"[amy-desktop] edgechromium patch skipped: {exc}", file=sys.stderr)
        return
    if getattr(ec.EdgeChrome, "_amy_media_patched", False):
        return
    try:
        src = textwrap.dedent(inspect.getsource(ec.EdgeChrome.__init__))
        old = "props.AdditionalBrowserArguments = '--disable-features=ElasticOverscroll'"
        new = (
            "props.AdditionalBrowserArguments = ("
            "'--disable-features=ElasticOverscroll "
            "--use-fake-ui-for-media-stream "
            "--autoplay-policy=no-user-gesture-required'"
            ")"
        )
        if old not in src:
            print("[amy-desktop] warning: could not locate browser-args line to patch", file=sys.stderr)
            return
        src = src.replace(old, new, 1)
        # Strip the `def __init__...` so exec can bind a function
        ns: dict = {}
        # Build a closure namespace from the edgechromium module dict
        exec(compile(src, "<amy-edgechromium-init>", "exec"), ec.__dict__, ns)
        ec.EdgeChrome.__init__ = ns["__init__"]  # type: ignore[method-assign]
        ec.EdgeChrome._amy_media_patched = True  # type: ignore[attr-defined]
        print("[amy-desktop] WebView2 mic/camera auto-accept flags injected")
    except Exception as exc:
        print(f"[amy-desktop] browser-args patch failed: {exc}", file=sys.stderr)


def _install_auto_media_permissions(window) -> None:
    """PermissionRequested handler — backup if Chromium flags are ignored."""

    def attach() -> None:
        try:
            form = getattr(window, "native", None)
            browser = getattr(form, "browser", None) if form is not None else None
            wv = getattr(browser, "webview", None) if browser is not None else None
            if wv is None:
                return

            def hook() -> None:
                core = getattr(wv, "CoreWebView2", None)
                if core is None or getattr(window, "_amy_perm_hooked", False):
                    return

                def on_permission(_sender, args) -> None:  # noqa: ANN001
                    deferral = None
                    try:
                        try:
                            deferral = args.GetDeferral()
                        except Exception:
                            deferral = None
                        kind = str(getattr(args, "PermissionKind", ""))
                        if any(
                            tok in kind
                            for tok in ("Microphone", "Camera", "Media", "ClipboardRead", "Clipboard")
                        ):
                            args.State = 1  # Allow
                            args.Handled = True
                            try:
                                args.SavesInProfile = True
                            except Exception:
                                pass
                    except Exception:
                        pass
                    finally:
                        if deferral is not None:
                            try:
                                deferral.Complete()
                            except Exception:
                                pass

                core.PermissionRequested += on_permission
                window._amy_perm_hooked = True  # type: ignore[attr-defined]
                print("[amy-desktop] PermissionRequested auto-allow ready")

            try:
                from System import Action  # type: ignore

                wv.BeginInvoke(Action(hook))
            except Exception:
                hook()
        except Exception as exc:
            print(f"[amy-desktop] permission hook skipped: {exc}", file=sys.stderr)

    try:
        window.events.loaded += lambda: attach()
    except Exception:
        threading.Thread(target=lambda: (time.sleep(1.0), attach()), daemon=True).start()


def main() -> int:
    app_data_dir()
    env = _apply_env()
    print("[amy-desktop] root", jarvis_root())
    print("[amy-desktop] frozen" if is_frozen() else "[amy-desktop] dev")
    print("[amy-desktop]", _config_hint())

    smoke = "--smoke" in sys.argv or os.environ.get("AMY_DESKTOP_SMOKE") == "1"
    # Default: real pywebview Amy app + Whisper mic (?desktop=1).
    # Pass --chrome for Chrome app mode instead.
    prefer_chrome = "--chrome" in sys.argv
    prefer_webview = not prefer_chrome

    try:
        start_hands(env)
        start_amy(env)
        _wait_url(HANDS_HEALTH, "Hands")
        _wait_url(AMY_HEALTH, "Amy")
    except Exception as exc:
        print(f"[amy-desktop] startup failed: {exc}", file=sys.stderr)
        stop_children()
        return 1

    if smoke:
        print("[amy-desktop] smoke OK - Hands + Amy healthy")
        stop_children()
        return 0

    if prefer_chrome and _open_chrome_app(AMY_URL):
        print("[amy-desktop] Amy app window opened (Chrome app mode - mic works)")
        print("[amy-desktop] Hands console should be open too")
        print("[amy-desktop] leave THIS terminal open - Ctrl+C stops Amy + Hands")
        try:
            while True:
                time.sleep(2)
                if not _http_ok(HANDS_HEALTH):
                    print("[amy-desktop] WARNING: Hands stopped responding on :4701")
                    break
        except KeyboardInterrupt:
            print("\n[amy-desktop] bye")
        finally:
            stop_children()
        return 0

    try:
        import webview
    except ImportError:
        print("[amy-desktop] pywebview missing - opening Chrome instead", file=sys.stderr)
        if not _open_chrome_app(AMY_URL):
            webbrowser.open(AMY_URL)
        print("[amy-desktop] servers running - Ctrl+C to stop")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            print("\n[amy-desktop] bye")
        finally:
            stop_children()
        return 0

    _patch_webview2_auto_media()

    class AmyApi:
        def go_small(self) -> bool:
            if not webview.windows:
                return False
            w = webview.windows[0]
            try:
                w.resize(420, 780)
                w.on_top = True
                return True
            except Exception as exc:
                print(f"[amy-desktop] go_small failed: {exc}", file=sys.stderr)
                return False

        def go_big(self) -> bool:
            if not webview.windows:
                return False
            w = webview.windows[0]
            try:
                w.resize(1400, 900)
                w.on_top = True
                return True
            except Exception as exc:
                print(f"[amy-desktop] go_big failed: {exc}", file=sys.stderr)
                return False

        def minimize_window(self) -> bool:
            if not webview.windows:
                return False
            w = webview.windows[0]
            try:
                w.on_top = False
                w.minimize()
                return True
            except Exception as exc:
                print(f"[amy-desktop] minimize failed: {exc}", file=sys.stderr)
                return False

        def restore_window(self) -> bool:
            if not webview.windows:
                return False
            w = webview.windows[0]
            try:
                w.restore()
                w.show()
                w.on_top = True
                return True
            except Exception as exc:
                print(f"[amy-desktop] restore failed: {exc}", file=sys.stderr)
                return False

        def set_on_top(self, enabled: bool = True) -> bool:
            if not webview.windows:
                return False
            try:
                webview.windows[0].on_top = bool(enabled)
                return True
            except Exception as exc:
                print(f"[amy-desktop] on_top failed: {exc}", file=sys.stderr)
                return False

        def clipboard_get(self) -> str:
            try:
                return _clipboard_get()
            except Exception as exc:
                print(f"[amy-desktop] clipboard_get failed: {exc}", file=sys.stderr)
                return ""

        def clipboard_set(self, text: str = "") -> bool:
            try:
                return bool(_clipboard_set(str(text or "")))
            except Exception as exc:
                print(f"[amy-desktop] clipboard_set failed: {exc}", file=sys.stderr)
                return False

    api = AmyApi()
    window = webview.create_window(
        "Amy - Flightdeck",
        AMY_URL,
        width=1400,
        height=900,
        min_size=(360, 480),
        confirm_close=False,
        js_api=api,
        on_top=True,
    )
    # Hook before start so events.loaded fires on the UI path.
    _install_auto_media_permissions(window)

    print(f"[amy-desktop] opening webview {AMY_URL}")
    print("[amy-desktop] mic uses OpenAI Whisper (Google speech is broken in WebView2)")
    print("[amy-desktop] always on top — say 'minimise' to drop, 'come back' to restore")
    print("[amy-desktop] mic/camera prompts auto-allowed for localhost")
    print("[amy-desktop] clipboard: Ctrl+C / Ctrl+V / right-click (no menu bar)")
    storage = str(app_data_dir() / "webview")
    start_kwargs: dict = {"gui": "edgechromium", "private_mode": False, "storage_path": storage}
    try:
        webview.start(**start_kwargs)
    except TypeError:
        # Older pywebview may not take storage_path
        try:
            webview.start(gui="edgechromium", private_mode=False)
        except Exception as exc:
            print(f"[amy-desktop] edgechromium failed ({exc}); default gui")
            webview.start(private_mode=False)
    except Exception as exc:
        print(f"[amy-desktop] edgechromium failed ({exc}); default gui")
        try:
            webview.start(private_mode=False, storage_path=storage)
        except TypeError:
            webview.start(private_mode=False)
    finally:
        stop_children()
    print("[amy-desktop] window closed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
