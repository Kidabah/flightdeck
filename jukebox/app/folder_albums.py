"""Folder-pack merging over Navidrome's DB (read-only). Cindy files are never modified."""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
from functools import lru_cache
from pathlib import PurePosixPath
from typing import Any

# PMEDIA / weekly packs that are tagged as per-track singles.
PACK_NAME_RE = re.compile(
    r"(new\s*music\s*releases|\bnmr\b|week\s*\d+\s*(of\s*)?\d{4}|best of new music)",
    re.I,
)

DB_PATH = os.environ.get("NAVIDROME_DB", "/data/navidrome.db")


def _connect() -> sqlite3.Connection | None:
    if not os.path.isfile(DB_PATH):
        return None
    try:
        con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5.0)
        con.row_factory = sqlite3.Row
        return con
    except sqlite3.Error:
        return None


def folder_key_from_path(path: str | None) -> str | None:
    if not path:
        return None
    p = PurePosixPath(path.replace("\\", "/"))
    if not p.parts:
        return None
    return str(p.parent)


def folder_album_id(folder_key: str) -> str:
    digest = hashlib.sha1(folder_key.encode("utf-8")).hexdigest()[:20]
    return f"folder:{digest}"


def nice_folder_name(folder_key: str) -> str:
    name = PurePosixPath(folder_key).name
    name = re.sub(r"^VA\s*-\s*", "", name, flags=re.I)
    name = re.sub(r"\s*Mp3\s*320kbps.*$", "", name, flags=re.I)
    name = re.sub(r"\s*\[PMEDIA\].*$", "", name, flags=re.I)
    name = name.replace("⭐️", "").strip(" -_")
    return name or folder_key


def should_merge_folder(folder_key: str, track_count: int, distinct_albums: int) -> bool:
    name = PurePosixPath(folder_key).name
    if PACK_NAME_RE.search(name):
        return track_count >= 3
    # Fragmented singles dumped in one folder.
    if track_count >= 8 and distinct_albums >= 5:
        return True
    return False


def _folder_tracks(con: sqlite3.Connection, folder_key: str) -> list[sqlite3.Row]:
    return list(
        con.execute(
            """
            SELECT id, path, title, album, artist, album_artist, album_id,
                   track_number, disc_number, duration, year, has_cover_art,
                   suffix, bit_rate, size
            FROM media_file
            WHERE missing = 0
              AND path LIKE ? || '/%'
              AND instr(substr(path, length(?) + 2), '/') = 0
            ORDER BY disc_number, track_number, path
            """,
            (folder_key, folder_key),
        )
    )


@lru_cache(maxsize=1)
def _merge_maps() -> tuple[dict[str, str], dict[str, str]]:
    """
    Returns:
      album_id → folder_key (for mergeable packs)
      folder_album_id → folder_key
    """
    con = _connect()
    if not con:
        return {}, {}
    try:
        folders: dict[str, set[str]] = {}
        counts: dict[str, int] = {}
        for r in con.execute("SELECT path, album_id FROM media_file WHERE missing = 0"):
            fk = folder_key_from_path(r["path"])
            if not fk:
                continue
            counts[fk] = counts.get(fk, 0) + 1
            folders.setdefault(fk, set()).add(r["album_id"])

        album_to_folder: dict[str, str] = {}
        folder_id_to_key: dict[str, str] = {}
        for fk, aids in folders.items():
            if not should_merge_folder(fk, counts[fk], len(aids)):
                continue
            fid = folder_album_id(fk)
            folder_id_to_key[fid] = fk
            for aid in aids:
                if aid:
                    album_to_folder[aid] = fk
        return album_to_folder, folder_id_to_key
    except sqlite3.Error:
        return {}, {}
    finally:
        con.close()


def invalidate_caches() -> None:
    _merge_maps.cache_clear()


def folder_for_album_id(album_id: str) -> str | None:
    if not album_id or album_id.startswith("folder:"):
        return None
    return _merge_maps()[0].get(album_id)


def resolve_folder_key(album_id: str) -> str | None:
    if album_id.startswith("folder:"):
        return _merge_maps()[1].get(album_id)
    return folder_for_album_id(album_id)


def build_folder_album(folder_key: str) -> dict[str, Any] | None:
    con = _connect()
    if not con:
        return None
    try:
        rows = _folder_tracks(con, folder_key)
        if not rows:
            return None
        aids = {r["album_id"] for r in rows if r["album_id"]}
        if not should_merge_folder(folder_key, len(rows), len(aids)):
            return None

        songs: list[dict[str, Any]] = []
        cover = None
        years: list[int] = []
        for i, r in enumerate(rows, start=1):
            sid = r["id"]
            if cover is None and r["has_cover_art"]:
                cover = sid
            if r["year"]:
                try:
                    years.append(int(r["year"]))
                except (TypeError, ValueError):
                    pass
            songs.append(
                {
                    "id": sid,
                    "title": r["title"] or PurePosixPath(r["path"]).stem,
                    "album": nice_folder_name(folder_key),
                    "artist": r["artist"] or r["album_artist"] or "Unknown",
                    "albumId": folder_album_id(folder_key),
                    "track": r["track_number"] or i,
                    "discNumber": r["disc_number"] or 1,
                    "duration": r["duration"] or 0,
                    "year": r["year"],
                    "path": r["path"],
                    "suffix": r["suffix"],
                    "bitRate": r["bit_rate"],
                    "size": r["size"],
                    "coverArt": sid if r["has_cover_art"] else None,
                    "isDir": False,
                    "type": "music",
                }
            )
        if cover is None and songs:
            cover = songs[0]["id"]
            for s in songs:
                if not s.get("coverArt"):
                    s["coverArt"] = cover
        else:
            for s in songs:
                if not s.get("coverArt"):
                    s["coverArt"] = cover

        name = nice_folder_name(folder_key)
        return {
            "id": folder_album_id(folder_key),
            "name": name,
            "title": name,
            "artist": "Various Artists",
            "displayArtist": "Various Artists",
            "albumArtist": "Various Artists",
            "songCount": len(songs),
            "duration": sum(float(s.get("duration") or 0) for s in songs),
            "year": min(years) if years else None,
            "coverArt": cover,
            "song": songs,
            "folderKey": folder_key,
            "merged": True,
        }
    except sqlite3.Error:
        return None
    finally:
        con.close()


def collapse_album_list(albums: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Replace fragmented singles from the same pack folder with one sleeve."""
    if not albums:
        return albums
    album_to_folder = _merge_maps()[0]
    if not album_to_folder:
        return albums

    out: list[dict[str, Any]] = []
    seen_folders: set[str] = set()
    for al in albums:
        aid = al.get("id") or ""
        fk = album_to_folder.get(aid)
        if not fk:
            out.append(al)
            continue
        if fk in seen_folders:
            continue
        seen_folders.add(fk)
        merged = build_folder_album(fk)
        if not merged:
            out.append(al)
            continue
        out.append(
            {
                "id": merged["id"],
                "name": merged["name"],
                "artist": merged["artist"],
                "songCount": merged["songCount"],
                "duration": merged["duration"],
                "year": merged.get("year"),
                "coverArt": merged.get("coverArt") or al.get("coverArt"),
                "created": al.get("created"),
                "merged": True,
            }
        )
    return out
