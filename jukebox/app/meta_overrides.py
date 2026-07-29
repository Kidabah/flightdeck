"""Vinyl-only display metadata overrides. Cindy files stay untouched."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

DATA_DIR = Path(os.environ.get("VINYL_DATA", "/vinyl-data"))
STORE_PATH = DATA_DIR / "meta-overrides.json"
_lock = threading.Lock()


def _empty() -> dict[str, Any]:
    return {"albums": {}, "songs": {}}


def _load() -> dict[str, Any]:
    try:
        if not STORE_PATH.is_file():
            return _empty()
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return _empty()
        data.setdefault("albums", {})
        data.setdefault("songs", {})
        return data
    except (OSError, json.JSONDecodeError):
        return _empty()


def _save(data: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STORE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(STORE_PATH)


def get_store() -> dict[str, Any]:
    with _lock:
        return _load()


def patch_album(album_id: str, fields: dict[str, str]) -> dict[str, Any]:
    with _lock:
        data = _load()
        cur = dict(data["albums"].get(album_id) or {})
        for key in ("name", "artist"):
            if key in fields and fields[key] is not None:
                val = str(fields[key]).strip()
                if val:
                    cur[key] = val
                else:
                    cur.pop(key, None)
        if cur:
            data["albums"][album_id] = cur
        else:
            data["albums"].pop(album_id, None)
        _save(data)
        return cur


def patch_song(song_id: str, fields: dict[str, str]) -> dict[str, Any]:
    with _lock:
        data = _load()
        cur = dict(data["songs"].get(song_id) or {})
        for key in ("title", "artist", "album"):
            if key in fields and fields[key] is not None:
                val = str(fields[key]).strip()
                if val:
                    cur[key] = val
                else:
                    cur.pop(key, None)
        if cur:
            data["songs"][song_id] = cur
        else:
            data["songs"].pop(song_id, None)
        _save(data)
        return cur


def apply_song(song: dict[str, Any] | None) -> dict[str, Any] | None:
    if not song:
        return song
    sid = song.get("id")
    if not sid:
        return song
    ov = get_store()["songs"].get(sid) or {}
    out = dict(song)
    if ov.get("title"):
        out["title"] = ov["title"]
    if ov.get("artist"):
        out["artist"] = ov["artist"]
    if ov.get("album"):
        out["album"] = ov["album"]
    if ov:
        out["vinylOverride"] = True
    return out


def apply_album(album: dict[str, Any] | None) -> dict[str, Any] | None:
    if not album:
        return album
    out = dict(album)
    aid = out.get("id")
    if aid:
        ov = get_store()["albums"].get(aid) or {}
        if ov.get("name"):
            out["name"] = ov["name"]
            out["title"] = ov["name"]
        if ov.get("artist"):
            out["artist"] = ov["artist"]
            out["displayArtist"] = ov["artist"]
        if ov:
            out["vinylOverride"] = True
    songs = out.get("song")
    if isinstance(songs, list):
        out["song"] = [apply_song(s) or s for s in songs]
    return out


def apply_album_list(albums: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [apply_album(a) or a for a in albums]


def apply_song_list(songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [apply_song(s) or s for s in songs]
