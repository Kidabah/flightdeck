from __future__ import annotations

import hashlib
import os
import random
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


async def _nd_get(view: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    params = _auth_params()
    if extra:
        params.update({k: str(v) for k, v in extra.items() if v is not None})
    url = f"{NAVIDROME}/rest/{view}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.get(url, params=params)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text[:400])
    data = r.json()
    sub = data.get("subsonic-response") or {}
    if sub.get("status") != "ok":
        err = sub.get("error") or {}
        raise HTTPException(502, err.get("message") or "Navidrome error")
    return sub


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


@app.get("/api/albums")
async def albums(
    list_type: str = Query("newest", alias="type"),
    size: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    # Over-fetch so folder collapse still fills the rail.
    fetch_size = min(200, max(size * 4, size))
    sub = await _nd_get(
        "getAlbumList2.view",
        {"type": list_type, "size": fetch_size, "offset": offset},
    )
    raw = (sub.get("albumList2") or {}).get("album") or []
    merged = meta.apply_album_list(collapse_album_list(raw))
    return {"albums": merged[:size]}


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
