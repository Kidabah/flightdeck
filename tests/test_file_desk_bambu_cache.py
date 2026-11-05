"""Printer Bay file lists: a slow FTP listing must not blank a bay that has a list."""
from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

from app import main
from app.printers import bambu_ftp


def _run(monkeypatch, delay, rounds):
    calls = []

    def slow_list(ip, code, path="/"):
        calls.append(time.monotonic())
        time.sleep(delay)
        return [{"name": "a.gcode.3mf", "path": "a.gcode.3mf", "kind": "file", "size": 1, "modified": None}]

    printer = SimpleNamespace(id="x1c", custom_name="Little Boy", model_name="X1C", _ip="x", _access_code="x")
    monkeypatch.setattr(bambu_ftp, "list_bambu_files", slow_list)
    monkeypatch.setattr(main, "_bambu", [printer])
    monkeypatch.setattr(main, "_moonraker", [])
    monkeypatch.setattr(main, "_simulated", [])
    monkeypatch.setattr(main, "_local_library_files", lambda: [])
    monkeypatch.setattr(main, "_print_library_path", lambda raw=None: main.Path("."))
    main._file_desk_target_cache.clear()
    main._bambu_file_list_tasks.clear()

    async def go():
        out = []
        for wait in rounds:
            data = await main.get_file_desk(printer_id="x1c")
            out.append([t for t in data["targets"] if t["id"] == "x1c"][0])
            await asyncio.sleep(wait)
        return out

    return asyncio.run(go()), calls


def test_slow_listing_keeps_last_good_list(monkeypatch):
    monkeypatch.setattr(main, "_BAMBU_FILE_LIST_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(main, "_BAMBU_FILE_LIST_FIRST_TIMEOUT_SECONDS", 1.0)
    monkeypatch.setattr(main, "_FILE_DESK_TARGET_CACHE_SECONDS", 0.0)  # every poll refreshes
    targets, calls = _run(monkeypatch, delay=0.2, rounds=[0.0, 0.0, 0.3, 0.0])
    assert targets[0]["files"] and targets[0]["error"] is None  # first load waits
    for t in targets[1:]:
        assert t["files"], "bay went blank while a refresh was running"
        assert t["error"] is None
    assert len(calls) <= 3, "polls should share one in-flight listing"


def test_first_load_timeout_says_loading(monkeypatch):
    monkeypatch.setattr(main, "_BAMBU_FILE_LIST_FIRST_TIMEOUT_SECONDS", 0.05)
    targets, _ = _run(monkeypatch, delay=0.2, rounds=[0.0])
    assert targets[0]["files"] == [] and "still loading" in targets[0]["error"]
