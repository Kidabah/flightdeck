from __future__ import annotations

"""PrintShelf scanner facade.

The inventory implementation lives in :mod:`scanner_core`. This facade owns
background scan launch state so API callers never receive a stale ``idle``
response in the tiny window between starting the worker thread and the worker
entering ``run_scan``.
"""

import threading
from typing import Any

from . import scanner_core as _core
from .scanner_core import *  # noqa: F401,F403 - preserve the scanner public API

# Keep the exact same state object used by scanner_core.run_scan().
SCAN_STATE = _core.SCAN_STATE
_SCAN_START_LOCK = threading.Lock()


def run_scan(
    progress=None,
    *,
    root_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Run a scan synchronously using the core implementation."""
    return _core.run_scan(progress=progress, root_ids=root_ids)


def start_scan_background(root_ids: list[str] | None = None) -> dict[str, Any]:
    """Start one background scan and report ``starting`` immediately.

    Older code started the thread first and returned SCAN_STATE straight away.
    On a fast HTTP round trip that meant POST /api/scan could say ``idle`` even
    though the scan had just been launched. Serialising launch here also closes
    the double-click race where two requests could both observe running=False.
    """
    requested = [str(r).strip() for r in (root_ids or []) if str(r).strip()]

    with _SCAN_START_LOCK:
        if SCAN_STATE.get("running"):
            return {"ok": True, **get_scan_state(), "root_ids": requested}

        SCAN_STATE.update({
            "running": True,
            "status": "starting",
            "files_seen": 0,
            "files_upserted": 0,
            "files_skipped": 0,
            "files_failed": 0,
            "current_path": "Preparing scan…",
            "error": None,
            "skipped_roots": [],
            "started_at": _core.utcnow(),
            "finished_at": None,
        })

        def _run() -> None:
            try:
                _core.run_scan(root_ids=requested or None)
            except Exception as exc:  # defensive: core normally handles its own errors
                SCAN_STATE.update({
                    "running": False,
                    "status": "error",
                    "current_path": "",
                    "error": str(exc),
                    "finished_at": _core.utcnow(),
                })

        thread = threading.Thread(
            target=_run,
            name="printshelf-scan",
            daemon=True,
        )
        thread.start()
        return {"ok": True, **get_scan_state(), "root_ids": requested}
