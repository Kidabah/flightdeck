"""Resolve Cindy library paths for the currently playing track."""

from __future__ import annotations

import os
import sqlite3
from pathlib import PurePosixPath
from typing import Any

from .folder_albums import DB_PATH

# LAN share host for Explorer / UNC links (Cindy is read-only CIFS).
CINDY_SMB_HOST = os.environ.get("CINDY_SMB_HOST", "192.168.4.53")


def _connect() -> sqlite3.Connection | None:
    if not os.path.isfile(DB_PATH):
        return None
    try:
        con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5.0)
        con.row_factory = sqlite3.Row
        return con
    except sqlite3.Error:
        return None


def media_row(song_id: str) -> dict[str, Any] | None:
    if not song_id:
        return None
    con = _connect()
    if not con:
        return None
    try:
        row = con.execute(
            """
            SELECT id, path, title, album, artist, album_artist, album_id
            FROM media_file
            WHERE id = ?
            """,
            (song_id,),
        ).fetchone()
        return dict(row) if row else None
    except sqlite3.Error:
        return None
    finally:
        con.close()


def normalize_library_path(path: str | None) -> str | None:
    if not path:
        return None
    p = path.replace("\\", "/").lstrip("/")
    # Strip container music-root prefixes if present.
    for prefix in ("music/", "/music/"):
        if p.lower().startswith(prefix.lstrip("/")):
            p = p[len(prefix.lstrip("/")) :]
            break
    return p


def unc_from_library_path(path: str | None) -> str | None:
    rel = normalize_library_path(path)
    if not rel:
        return None
    return f"\\\\{CINDY_SMB_HOST}\\" + rel.replace("/", "\\")


def folder_unc_from_library_path(path: str | None) -> str | None:
    rel = normalize_library_path(path)
    if not rel:
        return None
    parent = str(PurePosixPath(rel).parent)
    if parent in (".", ""):
        return f"\\\\{CINDY_SMB_HOST}\\{rel.split('/')[0]}"
    return f"\\\\{CINDY_SMB_HOST}\\" + parent.replace("/", "\\")


def locate_song(song_id: str, fallback_path: str | None = None) -> dict[str, Any]:
    row = media_row(song_id) or {}
    path = row.get("path") or fallback_path
    rel = normalize_library_path(path)
    share = PurePosixPath(rel).parts[0] if rel else None
    return {
        "id": song_id,
        "title": row.get("title"),
        "album": row.get("album"),
        "artist": row.get("artist") or row.get("album_artist"),
        "path": rel,
        "unc": unc_from_library_path(rel),
        "folderUnc": folder_unc_from_library_path(rel),
        "share": share,
        "smbHost": CINDY_SMB_HOST,
        "found": bool(rel),
    }
