"""Scoped Windows desktop actions for Amy Hands — no arbitrary shell."""
from __future__ import annotations

import ctypes
import os
import re
import subprocess
import time
from ctypes import wintypes
from pathlib import Path
from typing import Any

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

WM_CLOSE = 0x0010
SW_MINIMIZE = 6
SW_RESTORE = 9
SW_SHOWMINNOACTIVE = 7
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
VK_MEDIA = {
    "play_pause": 0xB3,
    "play": 0xB3,
    "pause": 0xB3,
    "next": 0xB0,
    "previous": 0xB1,
    "prev": 0xB1,
    "stop": 0xB2,
    "volume_up": 0xAF,
    "vol_up": 0xAF,
    "louder": 0xAF,
    "volume_down": 0xAE,
    "vol_down": 0xAE,
    "quieter": 0xAE,
    "mute": 0xAD,
    "unmute": 0xAD,
    "volume_mute": 0xAD,
}

# Built-in allowlist. Config can add/override via "apps".
DEFAULT_APPS: dict[str, dict[str, Any]] = {
    "spotify": {
        "label": "Spotify",
        "uri": "spotify:",
        "process": ["Spotify.exe"],
        "exe": [
            str(Path(os.environ.get("APPDATA", "")) / "Spotify" / "Spotify.exe"),
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WindowsApps" / "Spotify.exe"),
        ],
    },
    "chrome": {
        "label": "Google Chrome",
        "process": ["chrome.exe"],
        "exe": [
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google" / "Chrome" / "Application" / "chrome.exe"),
            str(Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Google" / "Chrome" / "Application" / "chrome.exe"),
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "Application" / "chrome.exe"),
        ],
    },
    "edge": {
        "label": "Microsoft Edge",
        "process": ["msedge.exe"],
        "exe": [
            str(Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Microsoft" / "Edge" / "Application" / "msedge.exe"),
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft" / "Edge" / "Application" / "msedge.exe"),
        ],
    },
    "notepad": {"label": "Notepad", "exe": ["notepad.exe"], "process": ["notepad.exe"]},
    "calculator": {"label": "Calculator", "uri": "calculator:", "process": ["CalculatorApp.exe", "Calculator.exe"]},
    "calc": {"label": "Calculator", "uri": "calculator:", "process": ["CalculatorApp.exe", "Calculator.exe"]},
    "explorer": {"label": "File Explorer", "exe": ["explorer.exe"], "process": ["explorer.exe"]},
    "photos": {"label": "Photos", "uri": "ms-photos:", "process": ["Photos.exe", "Microsoft.Photos.exe"]},
    "settings": {"label": "Settings", "uri": "ms-settings:"},
    "terminal": {
        "label": "Windows Terminal",
        "process": ["WindowsTerminal.exe", "wt.exe"],
        "exe": [
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WindowsApps" / "wt.exe"),
        ],
        "uri": "wt:",
    },
    "vscode": {
        "label": "VS Code",
        "process": ["Code.exe"],
        "exe": [
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Microsoft VS Code" / "Code.exe"),
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft VS Code" / "Code.exe"),
        ],
    },
    "code": {
        "label": "VS Code",
        "process": ["Code.exe"],
        "exe": [
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Microsoft VS Code" / "Code.exe"),
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft VS Code" / "Code.exe"),
        ],
    },
    "cursor": {
        "label": "Cursor",
        "process": ["Cursor.exe"],
        "exe": [
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "cursor" / "Cursor.exe"),
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Cursor" / "Cursor.exe"),
        ],
    },
}

# Refuse closing / bulk-minimising these window-title patterns.
PROTECTED_TITLE = re.compile(
    r"(program manager|windows input experience|amy\s*-\s*flightdeck|amy hands|"
    r"cursor|windows shell experience|search host|start)",
    re.I,
)


def _unsafe_chars(s: str) -> bool:
    return any(ch in s for ch in "\n\r\0;&|`$<>")


def normalize_local_path(path: str) -> dict[str, Any]:
    raw = str(path or "").strip().strip('"').strip("'")
    if not raw:
        return {"ok": False, "detail": "path required"}
    if _unsafe_chars(raw):
        return {"ok": False, "detail": "path has unsafe characters"}
    if re.fullmatch(r"[A-Za-z]:", raw):
        raw = raw + "\\"
    raw = raw.replace("/", "\\")
    if not re.match(r"^[A-Za-z]:\\", raw):
        return {"ok": False, "detail": "only local Windows paths like C:\\… are allowed"}
    try:
        text = os.path.normpath(raw)
    except Exception as exc:
        return {"ok": False, "detail": f"bad path: {exc}"}
    if not re.match(r"^[A-Za-z]:\\", text):
        return {"ok": False, "detail": "refused non-local path"}
    return {"ok": True, "path": text}


def app_catalog(cfg: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    cat = {k: dict(v) for k, v in DEFAULT_APPS.items()}
    extra = (cfg or {}).get("apps") or {}
    if isinstance(extra, dict):
        for key, val in extra.items():
            if not isinstance(val, dict):
                continue
            name = str(key).strip().lower()
            if not name:
                continue
            base = cat.get(name, {})
            merged = {**base, **val}
            cat[name] = merged
    return cat


def resolve_app(name: str, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    key = re.sub(r"\s+", " ", str(name or "").strip().lower())
    if not key:
        return {"ok": False, "detail": "app name required"}
    cat = app_catalog(cfg)
    if key in cat:
        return {"ok": True, "key": key, "spec": cat[key]}
    # Fuzzy: startswith / contains
    for k, spec in cat.items():
        label = str(spec.get("label") or k).lower()
        if key == label or key in k or key in label or k.startswith(key):
            return {"ok": True, "key": k, "spec": spec}
    known = ", ".join(sorted({str(v.get("label") or k) for k, v in cat.items()}))
    return {"ok": False, "detail": f"app “{name}” not in allowlist. Known: {known}"}


def _start_uri(uri: str) -> None:
    os.startfile(uri)  # noqa: S606 — intentional ShellExecute for allowlisted URI


def _start_exe(exe: str, args: list[str] | None = None) -> None:
    cmd = [exe, *(args or [])]
    subprocess.Popen(cmd, shell=False, close_fds=True)


def launch_app(name: str, *, cfg: dict[str, Any] | None = None, play: bool = False) -> dict[str, Any]:
    hit = resolve_app(name, cfg)
    if not hit.get("ok"):
        return hit
    spec = hit["spec"]
    label = str(spec.get("label") or hit["key"])
    started_via = ""
    try:
        uri = str(spec.get("uri") or "").strip()
        if uri:
            _start_uri(uri)
            started_via = f"uri:{uri}"
        else:
            exes = spec.get("exe") or []
            if isinstance(exes, str):
                exes = [exes]
            launched = False
            for exe in exes:
                exe_s = str(exe)
                if "\\" in exe_s or "/" in exe_s:
                    if not Path(exe_s).exists():
                        continue
                _start_exe(exe_s)
                started_via = exe_s
                launched = True
                break
            if not launched:
                return {"ok": False, "detail": f"could not find executable for {label}"}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    out: dict[str, Any] = {"ok": True, "app": label, "via": started_via}
    if play:
        time.sleep(1.6)
        media = media_control("play_pause")
        out["media"] = media
    return out


def open_file(path: str) -> dict[str, Any]:
    norm = normalize_local_path(path)
    if not norm.get("ok"):
        return norm
    text = str(norm["path"])
    p = Path(text)
    if not p.exists():
        return {"ok": False, "detail": f"path not found: {text}"}
    if p.is_dir():
        return open_file_explorer(text)
    try:
        os.startfile(text)  # noqa: S606 — default file association
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "path": text, "how": "default app"}


def open_file_explorer(path: str | None = None) -> dict[str, Any]:
    raw = str(path or "C:\\").strip().strip('"').strip("'") or "C:\\"
    if re.fullmatch(r"[A-Za-z]:", raw):
        raw = raw + "\\"
    norm = normalize_local_path(raw)
    if not norm.get("ok"):
        return norm
    text = str(norm["path"])
    is_drive = bool(re.fullmatch(r"[A-Za-z]:\\", text))
    if not is_drive and not Path(text).exists():
        return {"ok": False, "detail": f"path not found: {text}"}
    try:
        subprocess.Popen(["explorer.exe", text], shell=False, close_fds=True)
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "path": text}


def open_file_with(path: str, app: str, *, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    norm = normalize_local_path(path)
    if not norm.get("ok"):
        return norm
    text = str(norm["path"])
    if not Path(text).exists():
        return {"ok": False, "detail": f"path not found: {text}"}
    hit = resolve_app(app, cfg)
    if not hit.get("ok"):
        return hit
    spec = hit["spec"]
    label = str(spec.get("label") or hit["key"])
    try:
        exes = spec.get("exe") or []
        if isinstance(exes, str):
            exes = [exes]
        for exe in exes:
            exe_s = str(exe)
            if ("\\" in exe_s or "/" in exe_s) and not Path(exe_s).exists():
                continue
            _start_exe(exe_s, [text])
            return {"ok": True, "path": text, "app": label, "via": exe_s}
        # URI apps can't open arbitrary files cleanly.
        return {"ok": False, "detail": f"{label} has no executable for open-with"}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}


def media_control(action: str = "play_pause", steps: int = 1, app: str | None = None) -> dict[str, Any]:
    key_name = str(action or "play_pause").strip().lower().replace("-", "_").replace(" ", "_")
    # Friendly aliases
    aliases = {
        "up": "volume_up",
        "down": "volume_down",
        "volumeup": "volume_up",
        "volumedown": "volume_down",
        "increase": "volume_up",
        "decrease": "volume_down",
        "lower": "volume_down",
        "raise": "volume_up",
        "turn_up": "volume_up",
        "turn_down": "volume_down",
    }
    key_name = aliases.get(key_name, key_name)
    # Per-app volume/mute — does NOT touch Amy's voice (system / other apps).
    vol_actions = {"volume_up", "volume_down", "mute", "unmute", "volume_mute"}
    target = str(app or "").strip()
    if key_name in vol_actions and target and target.lower() not in ("system", "master", "pc"):
        return app_audio(target, key_name, steps=steps)
    # Default volume nudges prefer Spotify when it's running, so Amy stays audible.
    if key_name in vol_actions and not target:
        spot = app_audio("spotify", key_name, steps=steps)
        if spot.get("ok"):
            spot["via"] = "spotify_session"
            return spot
        # fall through to system keys if Spotify isn't open
    vk = VK_MEDIA.get(key_name)
    if vk is None:
        return {
            "ok": False,
            "detail": (
                f"unknown media action “{action}”. "
                "Use play_pause/next/previous/stop/volume_up/volume_down/mute."
            ),
        }
    try:
        n = max(1, min(int(steps or 1), 20))
    except (TypeError, ValueError):
        n = 1
    # Volume taps: a few keypresses feel like a real nudge
    if key_name in ("volume_up", "volume_down") and n == 1:
        n = 2
    try:
        for _ in range(n):
            user32.keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, 0)
            time.sleep(0.03)
            user32.keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)
            time.sleep(0.04)
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "action": key_name, "steps": n, "via": "system"}


def _session_volumes_for_app(app: str, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return pycaw SimpleAudioVolume controls for an allowlisted app's processes."""
    try:
        from pycaw.pycaw import AudioUtilities, ISimpleAudioVolume
    except ImportError:
        return {
            "ok": False,
            "detail": "Per-app volume needs pycaw — run: pip install pycaw comtypes",
        }
    hit = resolve_app(app, cfg)
    if not hit.get("ok"):
        return hit
    spec = hit["spec"]
    label = str(spec.get("label") or hit["key"])
    names = [str(n).lower() for n in (spec.get("process") or [])]
    if not names:
        # Derive from exe basenames
        for exe in spec.get("exe") or []:
            names.append(Path(str(exe)).name.lower())
    names = [n for n in names if n]
    if not names:
        return {"ok": False, "detail": f"no process name mapped for {label}"}

    controls = []
    try:
        sessions = AudioUtilities.GetAllSessions()
    except Exception as exc:
        return {"ok": False, "detail": f"audio session error: {exc}"}
    for session in sessions:
        proc = session.Process
        if not proc:
            continue
        try:
            pname = str(proc.name() or "").lower()
        except Exception:
            continue
        if pname not in names:
            continue
        try:
            vol = session._ctl.QueryInterface(ISimpleAudioVolume)
            controls.append((pname, vol))
        except Exception:
            continue
    if not controls:
        return {"ok": False, "detail": f"{label} isn’t playing audio right now (no session)."}
    return {"ok": True, "app": label, "controls": controls}


def app_audio(
    app: str,
    action: str = "volume_down",
    *,
    steps: int = 1,
    level: float | None = None,
    cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Per-app volume/mute via Windows audio sessions — leaves Amy's TTS alone."""
    act = str(action or "volume_down").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "up": "volume_up",
        "down": "volume_down",
        "lower": "volume_down",
        "louder": "volume_up",
        "raise": "volume_up",
        "increase": "volume_up",
        "decrease": "volume_down",
        "unmute": "unmute",
        "mute": "mute",
        "set": "set",
        "volume_mute": "mute",
    }
    act = aliases.get(act, act)
    found = _session_volumes_for_app(app, cfg)
    if not found.get("ok"):
        return found
    controls = found["controls"]
    label = found["app"]
    try:
        n = max(1, min(int(steps or 1), 20))
    except (TypeError, ValueError):
        n = 1
    if act in ("volume_up", "volume_down") and n == 1:
        n = 2
    step = 0.06
    touched = 0
    try:
        for _pname, vol in controls:
            if act == "mute":
                vol.SetMute(1, None)
                touched += 1
            elif act == "unmute":
                vol.SetMute(0, None)
                touched += 1
            elif act == "set":
                if level is None:
                    return {"ok": False, "detail": "level 0.0–1.0 required for set"}
                lv = max(0.0, min(1.0, float(level)))
                vol.SetMute(0, None)
                vol.SetMasterVolume(lv, None)
                touched += 1
            elif act == "volume_up":
                vol.SetMute(0, None)
                cur = float(vol.GetMasterVolume())
                for _ in range(n):
                    cur = min(1.0, cur + step)
                vol.SetMasterVolume(cur, None)
                touched += 1
            elif act == "volume_down":
                cur = float(vol.GetMasterVolume())
                for _ in range(n):
                    cur = max(0.0, cur - step)
                vol.SetMasterVolume(cur, None)
                touched += 1
            else:
                return {"ok": False, "detail": f"unknown app audio action “{action}”"}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    out: dict[str, Any] = {"ok": True, "app": label, "action": act, "sessions": touched}
    if act in ("volume_up", "volume_down"):
        out["steps"] = n
    if act == "set" and level is not None:
        out["level"] = max(0.0, min(1.0, float(level)))
    return out


def _find_windows(query: str) -> dict[str, Any]:
    q = str(query or "").strip().lower()
    if len(q) < 2:
        return {"ok": False, "detail": "window title query too short"}
    if _unsafe_chars(q):
        return {"ok": False, "detail": "unsafe query"}

    matches: list[tuple[int, str]] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def enum_proc(hwnd, _lparam):  # noqa: N803
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value or ""
        if not title:
            return True
        if PROTECTED_TITLE.search(title):
            return True
        if q in title.lower():
            matches.append((int(hwnd), title))
        return True

    user32.EnumWindows(enum_proc, 0)
    if not matches:
        return {"ok": False, "detail": f"no visible window matched “{query}”"}
    matches.sort(key=lambda t: len(t[1]))
    return {"ok": True, "matches": matches}


def close_window(query: str) -> dict[str, Any]:
    found = _find_windows(query)
    if not found.get("ok"):
        return found
    hwnd, title = found["matches"][0]
    try:
        user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "title": title, "hwnd": hwnd, "action": "close"}


def minimize_window(query: str) -> dict[str, Any]:
    found = _find_windows(query)
    if not found.get("ok"):
        return found
    hwnd, title = found["matches"][0]
    try:
        user32.ShowWindow(hwnd, SW_MINIMIZE)
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "title": title, "hwnd": hwnd, "action": "minimize"}


def minimize_all_windows() -> dict[str, Any]:
    """Minimise every visible titled window except protected ones (Amy stays up)."""
    matches: list[tuple[int, str]] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def enum_proc(hwnd, _lparam):  # noqa: N803
        if not user32.IsWindowVisible(hwnd):
            return True
        # Skip already-minimised
        if user32.IsIconic(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value or ""
        if not title:
            return True
        if PROTECTED_TITLE.search(title):
            return True
        matches.append((int(hwnd), title))
        return True

    user32.EnumWindows(enum_proc, 0)
    done: list[str] = []
    for hwnd, title in matches:
        try:
            user32.ShowWindow(hwnd, SW_SHOWMINNOACTIVE)
            done.append(title)
        except Exception:
            continue
    return {"ok": True, "action": "minimize_all", "count": len(done), "titles": done[:30]}


def restore_window(query: str) -> dict[str, Any]:
    found = _find_windows(query)
    if not found.get("ok"):
        return found
    hwnd, title = found["matches"][0]
    try:
        user32.ShowWindow(hwnd, SW_RESTORE)
        user32.SetForegroundWindow(hwnd)
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "title": title, "hwnd": hwnd, "action": "restore"}


def list_apps(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cat = app_catalog(cfg)
    apps = sorted({str(v.get("label") or k) for k, v in cat.items()})
    return {"ok": True, "apps": apps}
