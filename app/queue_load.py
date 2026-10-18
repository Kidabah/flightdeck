"""Choose a queued file to load. Loading never starts or sends a print."""
from __future__ import annotations

from typing import Any, Callable

OFFLINE_STATES = {"", "offline", "error", "estop"}


def match_queued_file(jobs: list[dict[str, Any]], query: str) -> dict[str, Any]:
    """Match a stable id or path first, then an exact filename."""
    text = str(query or "").strip().strip("\"'")
    if not text:
        return {"ok": False, "error": "malformed", "detail": "file is required"}

    id_hits = [job for job in jobs if str(job.get("id")) == text]
    if len(id_hits) == 1:
        return {"ok": True, "job": id_hits[0], "matched": "id"}

    path_hits = [job for job in jobs if str(job.get("file_path") or "") == text]
    if len(path_hits) == 1:
        return {"ok": True, "job": path_hits[0], "matched": "path"}
    if len(path_hits) > 1:
        return _multiple(text, path_hits)

    wanted = text.lower()
    name_hits = []
    for job in jobs:
        name = str(job.get("filename") or "")
        base = name.replace("\\", "/").rsplit("/", 1)[-1]
        if name.lower() == wanted or base.lower() == wanted:
            name_hits.append(job)
    if len(name_hits) == 1:
        return {"ok": True, "job": name_hits[0], "matched": "filename"}
    if len(name_hits) > 1:
        return _multiple(text, name_hits)
    return {
        "ok": False,
        "error": "no_match",
        "detail": f"No queued file matches {text}",
    }


def decide_queue_load(
    jobs: list[dict[str, Any]],
    query: str,
    *,
    file_exists: Callable[[str], bool],
    printer_state: Callable[[str], str],
) -> dict[str, Any]:
    """Resolve a load. start_print is always false."""
    found = match_queued_file(jobs, query)
    if not found.get("ok"):
        return found
    job = found["job"]
    path = str(job.get("file_path") or "")
    if not path or not file_exists(path):
        return {
            "ok": False,
            "error": "missing_file",
            "detail": f"Queued file is missing on disk: {job.get('filename') or path}",
            "job": job,
        }
    state = str(printer_state(str(job.get("printer_id") or "")) or "").strip().lower()
    if state in OFFLINE_STATES:
        return {
            "ok": False,
            "error": "printer_offline",
            "detail": "Printer is offline",
            "job": job,
        }
    return {
        "ok": True,
        "job": job,
        "matched": found.get("matched"),
        "start_print": False,
    }


def _multiple(text: str, jobs: list[dict[str, Any]]) -> dict[str, Any]:
    names = [f"#{job.get('id')} {job.get('filename')}" for job in jobs[:6]]
    return {
        "ok": False,
        "error": "multiple",
        "detail": f"More than one queued file matches {text}: {', '.join(names)}",
        "matches": [{"id": job.get("id"), "filename": job.get("filename")} for job in jobs],
    }
