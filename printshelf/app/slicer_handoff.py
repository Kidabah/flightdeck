"""Open PrintShelf assets in desktop Bambu/Orca the same way Flightdeck does.

Flightdeck never uses bambustudio://open?file=https://… for local models.
It launches bambu-studio.exe with a real path via the Windows slicer worker.
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import load_config
from .paths import to_windows_path
from .preview import (
    entry_kind,
    get_asset_row,
    path_is_allowed,
    read_zip_entry_bytes,
)

log = logging.getLogger("printshelf.slicer")

_FLIGHTDECK_SETTINGS_URL = "http://127.0.0.1:8000/api/settings"
_DEFAULT_TARGET = "bambu_studio"


def resolve_worker_url(cfg: dict[str, Any] | None = None) -> str:
    cfg = cfg or load_config()
    explicit = str(cfg.get("slicer_worker_url") or "").strip().rstrip("/")
    if explicit:
        return explicit
    try:
        with urlopen(_FLIGHTDECK_SETTINGS_URL, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if isinstance(data, dict):
            return str(data.get("orcaslicer_worker_url") or "").strip().rstrip("/")
    except Exception as exc:
        log.info("Could not read Flightdeck slicer worker URL: %s", exc)
    return ""


def _safe_name(name: str, fallback: str = "model.stl") -> str:
    base = Path(name or "").name.strip() or fallback
    return base.replace("\\", "_").replace("/", "_") or fallback


def _http_json(method: str, url: str, *, body: bytes | None = None, headers: dict[str, str] | None = None, timeout: float = 30.0) -> tuple[int, Any]:
    req = Request(url, data=body, method=method, headers=headers or {})
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            ctype = resp.headers.get("Content-Type") or ""
            if "application/json" in ctype and raw:
                return resp.status, json.loads(raw.decode("utf-8"))
            return resp.status, raw.decode("utf-8", errors="replace") if raw else {}
    except HTTPError as exc:
        raw = exc.read() if exc.fp else b""
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            payload = raw.decode("utf-8", errors="replace") if raw else {}
        return exc.code, payload
    except URLError as exc:
        raise RuntimeError(str(exc.reason or exc)) from exc


def _multipart_upload(url: str, filename: str, data: bytes, target: str, timeout: float = 120.0) -> tuple[int, Any]:
    boundary = f"----PrintShelfBoundary{uuid.uuid4().hex}"
    disposition = (
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8")
    target_part = (
        f'Content-Disposition: form-data; name="target"\r\n\r\n{target}\r\n'
    ).encode("utf-8")
    body = (
        f"--{boundary}\r\n".encode("ascii")
        + disposition
        + data
        + b"\r\n"
        + f"--{boundary}\r\n".encode("ascii")
        + target_part
        + f"--{boundary}--\r\n".encode("ascii")
    )
    return _http_json(
        "POST",
        url,
        body=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
        timeout=timeout,
    )


def open_asset_in_desktop_slicer(
    asset_id: int,
    *,
    entry: str | None = None,
    target: str = _DEFAULT_TARGET,
) -> dict[str, Any]:
    cfg = load_config()
    asset = get_asset_row(asset_id)
    if not asset:
        raise ValueError("Asset not found")
    abs_path = str(asset.get("abs_path") or "")
    if not path_is_allowed(abs_path):
        raise PermissionError("File is outside watched folders")
    src = Path(abs_path)
    if not src.is_file():
        raise FileNotFoundError("Asset file missing on disk")

    kind = str(asset.get("kind") or "")
    worker = resolve_worker_url(cfg)
    if not worker:
        raise RuntimeError(
            "Windows slicer worker is not configured. "
            "Set slicer_worker_url in PrintShelf config, or configure "
            "orcaslicer_worker_url in Flightdeck Settings → Slicer."
        )

    target = (target or _DEFAULT_TARGET).strip().lower() or _DEFAULT_TARGET
    folders = list(cfg.get("watched_folders") or [])
    win_path = to_windows_path(abs_path, folders) if not entry else None

    # Prefer NAS UNC path — identical to File → Open on the real STL.
    if win_path and not entry:
        try:
            status, payload = _http_json(
                "POST",
                f"{worker}/api/slicer/worker/open-path",
                body=json.dumps({"path": win_path, "target": target}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                timeout=30.0,
            )
            if status < 400:
                if isinstance(payload, dict):
                    payload["via"] = "open-path"
                    payload["windows_path"] = win_path
                    payload["worker_url"] = worker
                    return payload
                return {"ok": True, "via": "open-path", "windows_path": win_path, "worker_url": worker}
            detail = payload.get("detail") if isinstance(payload, dict) else payload
            log.warning("open-path failed (%s): %s — falling back to upload", status, detail)
        except Exception as exc:
            log.warning("open-path unreachable (%s) — falling back to upload", exc)

    # Upload original bytes (STL/OBJ/3MF as-is) — same as Flightdeck /api/slicer/open.
    if entry:
        raw, inner_name = read_zip_entry_bytes(src, entry)
        filename = _safe_name(inner_name)
        ek = entry_kind(inner_name) or ""
        if ek not in ("stl", "obj", "3mf", "gcode.3mf"):
            raise ValueError("Zip entry is not a printable mesh")
    else:
        if kind not in ("stl", "obj", "3mf", "gcode.3mf"):
            raise ValueError(f"Cannot open kind={kind} in slicer")
        raw = src.read_bytes()
        filename = _safe_name(str(asset.get("file_name") or src.name))

    try:
        status, payload = _multipart_upload(
            f"{worker}/api/slicer/worker/open",
            filename,
            raw,
            target,
            timeout=120.0,
        )
    except RuntimeError as exc:
        raise RuntimeError(
            f"Windows slicer worker unreachable at {worker}. "
            "Start Flightdeck’s Windows worker (orcaslicer_worker_url), then try again."
        ) from exc

    if status >= 400:
        detail = payload.get("detail") if isinstance(payload, dict) else payload
        raise RuntimeError(detail or f"Worker open failed ({status})")
    if isinstance(payload, dict):
        payload["via"] = "upload"
        payload["worker_url"] = worker
        payload["filename"] = filename
        return payload
    return {"ok": True, "via": "upload", "worker_url": worker, "filename": filename}
