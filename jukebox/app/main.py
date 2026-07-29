from __future__ import annotations

import asyncio
import hashlib
import os
import random
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .folder_albums import (
    build_folder_album,
    collapse_album_list,
    invalidate_caches,
    resolve_folder_key,
)
from .locate import locate_song
from . import meta_overrides as meta

NAVIDROME = os.environ.get("NAVIDROME_URL", "http://127.0.0.1:4533").rstrip("/")
USER = os.environ.get("JUKEBOX_USER", "jukebox")
PASSWORD = os.environ.get("JUKEBOX_PASSWORD", "")
STATIC = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="Cindy Vinyl", docs_url=None, redoc_url=None)

_http: httpx.AsyncClient | None = None
_alpha_lock = asyncio.Lock()
_alpha_index: list[tuple[str, dict[str, Any]]] | None = None
_alpha_built = 0.0
_ALPHA_TTL = 600.0
_genres_lock = asyncio.Lock()
_genres_cache: list[dict[str, Any]] | None = None
_genres_built = 0.0
_GENRES_TTL = 600.0


class AlbumMetaPatch(BaseModel):
    id: str = Field(min_length=1)
    name: str | None = None
    artist: str | None = None


class SongMetaPatch(BaseModel):
    id: str = Field(min_length=1)
    title: str | None = None
    artist: str | None = None
    album: str | None = None


def _auth_params() -> dict[str, str]:
    if not PASSWORD:
        raise HTTPException(503, "JUKEBOX_PASSWORD not configured")
    salt = f"{random.randint(100000, 999999)}"
    token = hashlib.md5(f"{PASSWORD}{salt}".encode()).hexdigest()
    return {
        "u": USER,
        "t": token,
        "s": salt,
        "v": "1.16.1",
        "c": "cindy-vinyl",
        "f": "json",
    }


async def _http_client() -> httpx.AsyncClient:
    global _http
    if _http is None or _http.is_closed:
        _http = httpx.AsyncClient(
            timeout=60.0,
            limits=httpx.Limits(max_connections=24, max_keepalive_connections=12),
        )
    return _http


async def _nd_get(view: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    params = _auth_params()
    if extra:
        params.update({k: str(v) for k, v in extra.items() if v is not None})
    url = f"{NAVIDROME}/rest/{view}"
    client = await _http_client()
    r = await client.get(url, params=params)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text[:400])
    data = r.json()
    sub = data.get("subsonic-response") or {}
    if sub.get("status") != "ok":
        err = sub.get("error") or {}
        raise HTTPException(502, err.get("message") or "Navidrome error")
    return sub


async def _ensure_alpha_index(force: bool = False) -> list[tuple[str, dict[str, Any]]]:
    """Alphabetical pass without folder-collapse (collapse only the letter slice)."""
    global _alpha_index, _alpha_built
    async with _alpha_lock:
        now = time.monotonic()
        if (
            not force
            and _alpha_index is not None
            and now - _alpha_built < _ALPHA_TTL
        ):
            return _alpha_index
        out: list[tuple[str, dict[str, Any]]] = []
        seen: set[str] = set()
        page_size = 500
        for page in range(200):
            sub = await _nd_get(
                "getAlbumList2.view",
                {
                    "type": "alphabeticalByName",
                    "size": str(page_size),
                    "offset": str(page * page_size),
                },
            )
            raw = (sub.get("albumList2") or {}).get("album") or []
            if not raw:
                break
            # Skip collapse here — build_folder_album across the whole library is too slow.
            for a in meta.apply_album_list(raw if isinstance(raw, list) else [raw]):
                aid = str(a.get("id") or "")
                if not aid or aid in seen:
                    continue
                seen.add(aid)
                slim = {
                    "id": a.get("id"),
                    "name": a.get("name") or a.get("title"),
                    "artist": a.get("artist") or a.get("displayArtist"),
                    "coverArt": a.get("coverArt"),
                    "songCount": a.get("songCount"),
                    "year": a.get("year"),
                }
                out.append((_album_index_letter(slim), slim))
            if len(raw) < page_size:
                break
        _alpha_index = out
        _alpha_built = time.monotonic()
        return out


async def _ensure_genre_buckets(force: bool = False) -> list[dict[str, Any]]:
    global _genres_cache, _genres_built
    async with _genres_lock:
        now = time.monotonic()
        if (
            not force
            and _genres_cache is not None
            and now - _genres_built < _GENRES_TTL
        ):
            return _genres_cache
        sub = await _nd_get("getGenres.view", {})
        _genres_cache = _genre_buckets(_parse_genre_rows(sub))
        _genres_built = time.monotonic()
        return _genres_cache


@app.on_event("startup")
async def _warm_crate_caches() -> None:
    async def _run() -> None:
        try:
            await _ensure_genre_buckets()
        except Exception:
            pass
        try:
            await _ensure_alpha_index()
        except Exception:
            pass

    asyncio.create_task(_run())


def _expand_album(album: dict[str, Any]) -> dict[str, Any]:
    """If this ND album is a fragment of a folder pack, return the merged sleeve."""
    aid = album.get("id") or ""
    fk = resolve_folder_key(aid)
    if not fk:
        return meta.apply_album(album) or album
    merged = build_folder_album(fk)
    return meta.apply_album(merged or album) or album


@app.get("/api/health")
async def health():
    try:
        sub = await _nd_get("ping.view")
        return {"ok": True, "navidrome": sub.get("status"), "user": USER}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/random-album")
async def random_album():
    sub = await _nd_get("getAlbumList2.view", {"type": "random", "size": 12})
    albums = (sub.get("albumList2") or {}).get("album") or []
    if not albums:
        sub = await _nd_get("getAlbumList2.view", {"type": "newest", "size": 40})
        albums = (sub.get("albumList2") or {}).get("album") or []
        if not albums:
            raise HTTPException(404, "No albums yet — Navidrome may still be scanning")
    albums = meta.apply_album_list(collapse_album_list(albums))
    album = random.choice(albums)
    return await album_detail(album["id"])


def _album_index_letter(album: dict[str, Any]) -> str:
    name = (album.get("name") or album.get("title") or "").lstrip(" \t\"'`“”‘’")
    if not name:
        return "#"
    ch = name[0].upper()
    return ch if ch.isalpha() else "#"


# Broad crate categories — map messy Cindy tags up to these buckets.
_CANONICAL_GENRES = (
    "Rock",
    "Pop",
    "Country",
    "Hip-Hop",
    "R&B",
    "Soul",
    "Jazz",
    "Blues",
    "Metal",
    "Punk",
    "Indie",
    "Electronic",
    "Classical",
    "Folk",
    "Reggae",
    "Soundtrack",
    "Latin",
    "Gospel",
    "World",
)

# First matching rule wins (more specific phrases before short ones like "pop"/"rock").
_GENRE_RULES: tuple[tuple[str, str], ...] = (
    ("country", "Country"),
    ("bluegrass", "Country"),
    ("americana", "Country"),
    ("nashville", "Country"),
    ("hip hop", "Hip-Hop"),
    ("hip-hop", "Hip-Hop"),
    ("hiphop", "Hip-Hop"),
    ("rap", "Hip-Hop"),
    ("trap", "Hip-Hop"),
    ("r&b", "R&B"),
    ("rnb", "R&B"),
    ("rhythm and blues", "R&B"),
    ("rhythm & blues", "R&B"),
    ("motown", "Soul"),
    ("soul", "Soul"),
    ("funk", "Soul"),
    ("disco", "Soul"),
    ("jazz", "Jazz"),
    ("blues", "Blues"),
    ("metal", "Metal"),
    ("punk", "Punk"),
    ("indie", "Indie"),
    ("alternative", "Indie"),
    ("alt ", "Indie"),
    ("electronic", "Electronic"),
    ("electronica", "Electronic"),
    ("dance", "Electronic"),
    ("edm", "Electronic"),
    ("house", "Electronic"),
    ("techno", "Electronic"),
    ("trance", "Electronic"),
    ("classical", "Classical"),
    ("orchestra", "Classical"),
    ("opera", "Classical"),
    ("folk", "Folk"),
    ("acoustic", "Folk"),
    ("singer-songwriter", "Folk"),
    ("reggae", "Reggae"),
    ("ska", "Reggae"),
    ("dancehall", "Reggae"),
    ("soundtrack", "Soundtrack"),
    ("score", "Soundtrack"),
    ("musical", "Soundtrack"),
    ("latin", "Latin"),
    ("salsa", "Latin"),
    ("reggaeton", "Latin"),
    ("gospel", "Gospel"),
    ("christian", "Gospel"),
    ("worship", "Gospel"),
    ("world", "World"),
    ("afro", "World"),
    ("celtic", "World"),
    ("pop", "Pop"),
    ("rock", "Rock"),
)


def _canonicalize_genre(tag: str) -> str | None:
    g = " ".join(str(tag or "").lower().replace("_", " ").split())
    if not g or not any(c.isalpha() for c in g):
        return None
    for needle, bucket in _GENRE_RULES:
        if needle in g:
            return bucket
    return None


def _parse_genre_rows(sub: dict[str, Any]) -> list[dict[str, Any]]:
    rows = sub.get("genres", {}).get("genre") or []
    if isinstance(rows, dict):
        rows = [rows]
    out: list[dict[str, Any]] = []
    for g in rows:
        if isinstance(g, str):
            value = g.strip()
            if value:
                out.append({"value": value, "albumCount": 0, "songCount": 0})
            continue
        value = str(g.get("value") or g.get("name") or "").strip()
        if not value:
            continue
        out.append(
            {
                "value": value,
                "albumCount": int(g.get("albumCount") or 0),
                "songCount": int(g.get("songCount") or 0),
            }
        )
    return out


def _genre_buckets(raw_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {
        name: {"value": name, "albumCount": 0, "songCount": 0, "tags": []}
        for name in _CANONICAL_GENRES
    }
    for row in raw_rows:
        value = row["value"]
        canon = _canonicalize_genre(value)
        if not canon or canon not in buckets:
            continue
        b = buckets[canon]
        if value not in b["tags"]:
            b["tags"].append(value)
        b["albumCount"] += int(row.get("albumCount") or 0)
        b["songCount"] += int(row.get("songCount") or 0)
    return [buckets[name] for name in _CANONICAL_GENRES if buckets[name]["tags"]]


async def _albums_for_genre_tags(tags: list[str], size: int) -> list[dict[str, Any]]:
    seen: set[str] = set()
    collected: list[dict[str, Any]] = []
    # Cap + parallel batches — Cindy tags per bucket can be huge.
    use_tags = tags[:18]
    per = max(24, min(80, size * 2))

    async def _one(tag: str) -> list[dict[str, Any]]:
        sub = await _nd_get(
            "getAlbumList2.view",
            {"type": "byGenre", "genre": tag, "size": str(per), "offset": "0"},
        )
        raw = (sub.get("albumList2") or {}).get("album") or []
        return meta.apply_album_list(collapse_album_list(raw))

    for i in range(0, len(use_tags), 4):
        if len(collected) >= size:
            break
        batch = use_tags[i : i + 4]
        chunks = await asyncio.gather(*[_one(t) for t in batch], return_exceptions=True)
        for chunk in chunks:
            if isinstance(chunk, BaseException):
                continue
            for a in chunk:
                aid = a.get("id")
                if not aid or aid in seen:
                    continue
                seen.add(aid)
                collected.append(a)
                if len(collected) >= size:
                    return collected
    return collected


@app.get("/api/albums")
async def albums(
    list_type: str = Query("newest", alias="type"),
    size: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
    letter: str | None = Query(None, min_length=1, max_length=1),
    genre: str | None = Query(None, min_length=1, max_length=80),
):
    if list_type == "alphabeticalByName" and letter:
        ch = letter.upper()
        index = await _ensure_alpha_index()
        matched = [a for L, a in index if L == ch]
        # Collapse folder packs only for this letter's slice.
        collapsed = meta.apply_album_list(collapse_album_list(matched))
        return {
            "albums": collapsed[:size],
            "type": list_type,
            "letter": letter,
            "genre": genre,
            "total": len(collapsed),
        }

    if list_type == "byGenre":
        if not genre:
            raise HTTPException(400, "genre required for byGenre")
        buckets = {b["value"]: b for b in await _ensure_genre_buckets()}
        tags = list((buckets.get(genre) or {}).get("tags") or [])
        if not tags:
            tags = [genre]
        merged = await _albums_for_genre_tags(tags, size)
        return {"albums": merged[:size], "type": list_type, "letter": letter, "genre": genre}

    params: dict[str, str] = {
        "type": list_type,
        "offset": str(offset),
        "size": str(min(500, max(size * 4, size))),
    }
    sub = await _nd_get("getAlbumList2.view", params)
    raw = (sub.get("albumList2") or {}).get("album") or []
    merged = meta.apply_album_list(collapse_album_list(raw))
    return {"albums": merged[:size], "type": list_type, "letter": letter, "genre": genre}


@app.get("/api/genres")
async def genres():
    buckets = await _ensure_genre_buckets()
    return {"genres": buckets, "mode": "canonical"}


@app.get("/api/album/{album_id:path}")
async def album_detail(album_id: str):
    if album_id.startswith("folder:"):
        fk = resolve_folder_key(album_id)
        if not fk:
            invalidate_caches()
            fk = resolve_folder_key(album_id)
        if not fk:
            raise HTTPException(404, "Folder pack not found")
        merged = build_folder_album(fk)
        if not merged:
            raise HTTPException(404, "Folder pack empty")
        return meta.apply_album(merged)

    sub = await _nd_get("getAlbum.view", {"id": album_id})
    album = sub.get("album") or {}
    if not album:
        raise HTTPException(404, "Album not found")
    return _expand_album(album)

@app.get("/api/search")
async def search(q: str = Query(..., min_length=1)):
    sub = await _nd_get("search3.view", {"query": q, "artistCount": 10, "albumCount": 24, "songCount": 24})
    result = sub.get("searchResult3") or {}
    albums = meta.apply_album_list(collapse_album_list(result.get("album") or []))
    return {
        "artists": result.get("artist") or [],
        "albums": albums,
        "songs": meta.apply_song_list(result.get("song") or []),
    }


@app.get("/api/locate/{song_id}")
async def locate(song_id: str):
    fallback = None
    song: dict[str, Any] = {}
    try:
        sub = await _nd_get("getSong.view", {"id": song_id})
        song = sub.get("song") or {}
        fallback = song.get("path")
    except HTTPException:
        pass
    info = locate_song(song_id, fallback_path=fallback)
    if song:
        if not info.get("title"):
            info["title"] = song.get("title")
        if not info.get("album"):
            info["album"] = song.get("album")
        if not info.get("artist"):
            info["artist"] = song.get("artist")
    if not info.get("found"):
        raise HTTPException(404, "Track path not found in Cindy index")
    return info


@app.post("/api/meta/album")
async def meta_album(body: AlbumMetaPatch):
    saved = meta.patch_album(body.id, {"name": body.name, "artist": body.artist})
    return {"ok": True, "id": body.id, "override": saved, "note": "Vinyl display only — Cindy files unchanged"}


@app.post("/api/meta/song")
async def meta_song(body: SongMetaPatch):
    saved = meta.patch_song(
        body.id,
        {"title": body.title, "artist": body.artist, "album": body.album},
    )
    return {"ok": True, "id": body.id, "override": saved, "note": "Vinyl display only — Cindy files unchanged"}


@app.post("/api/refresh-packs")
async def refresh_packs():
    invalidate_caches()
    return {"ok": True}


@app.get("/api/cover/{cover_id}")
async def cover(cover_id: str, size: int = Query(600, ge=40, le=1200)):
    params = _auth_params()
    params.update({"id": cover_id, "size": str(size)})
    url = f"{NAVIDROME}/rest/getCoverArt.view?{urlencode(params)}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.get(url)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, "cover missing")
    return Response(
        content=r.content,
        media_type=r.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "public, max-age=604800, immutable"},
    )


@app.get("/api/stream/{song_id}")
async def stream(song_id: str, request: Request):
    params = _auth_params()
    params["id"] = song_id
    url = f"{NAVIDROME}/rest/stream.view?{urlencode(params)}"
    headers = {}
    if range_h := request.headers.get("range"):
        headers["Range"] = range_h
    client = httpx.AsyncClient(timeout=None)
    req = client.build_request("GET", url, headers=headers)
    r = await client.send(req, stream=True)
    if r.status_code >= 400:
        await r.aclose()
        await client.aclose()
        raise HTTPException(r.status_code, "stream failed")

    async def body():
        try:
            async for chunk in r.aiter_bytes():
                yield chunk
        finally:
            await r.aclose()
            await client.aclose()

    out_headers = {}
    for h in ("content-type", "content-length", "content-range", "accept-ranges"):
        if h in r.headers:
            out_headers[h] = r.headers[h]
    return StreamingResponse(body(), status_code=r.status_code, headers=out_headers, media_type=r.headers.get("content-type"))


@app.get("/")
async def index():
    index_path = STATIC / "index.html"
    if not index_path.exists():
        raise HTTPException(404, "UI missing")
    return FileResponse(index_path)


def _pwa_file(name: str, media_type: str) -> FileResponse:
    path = STATIC / name
    if not path.is_file():
        raise HTTPException(404, f"{name} missing")
    return FileResponse(path, media_type=media_type)


@app.get("/manifest.json")
async def manifest():
    return _pwa_file("manifest.json", "application/manifest+json")


@app.get("/sw.js")
async def service_worker():
    return _pwa_file("sw.js", "application/javascript; charset=utf-8")


@app.get("/icon-192.png")
async def icon_192():
    return _pwa_file("icon-192.png", "image/png")


@app.get("/icon-512.png")
async def icon_512():
    return _pwa_file("icon-512.png", "image/png")


@app.get("/apple-touch-icon.png")
async def apple_touch_icon():
    return _pwa_file("apple-touch-icon.png", "image/png")


@app.get("/cindy-vinyl-icon.svg")
async def cindy_icon_svg():
    return _pwa_file("cindy-vinyl-icon.svg", "image/svg+xml")


if STATIC.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
