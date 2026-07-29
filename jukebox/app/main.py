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

NAVIDROME = os.environ.get("NAVIDROME_URL", "http://127.0.0.1:4533").rstrip("/")
USER = os.environ.get("JUKEBOX_USER", "jukebox")
PASSWORD = os.environ.get("JUKEBOX_PASSWORD", "")
STATIC = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="Cindy Vinyl", docs_url=None, redoc_url=None)


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


@app.get("/api/health")
async def health():
    try:
        sub = await _nd_get("ping.view")
        return {"ok": True, "navidrome": sub.get("status"), "user": USER}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/random-album")
async def random_album():
    sub = await _nd_get("getAlbumList2.view", {"type": "random", "size": 1})
    albums = (sub.get("albumList2") or {}).get("album") or []
    if not albums:
        # Fallback: newest
        sub = await _nd_get("getAlbumList2.view", {"type": "newest", "size": 40})
        albums = (sub.get("albumList2") or {}).get("album") or []
        if not albums:
            raise HTTPException(404, "No albums yet — Navidrome may still be scanning")
        albums = [random.choice(albums)]
    album = albums[0]
    detail = await _nd_get("getAlbum.view", {"id": album["id"]})
    return detail.get("album") or album


@app.get("/api/albums")
async def albums(
    list_type: str = Query("newest", alias="type"),
    size: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    sub = await _nd_get(
        "getAlbumList2.view",
        {"type": list_type, "size": size, "offset": offset},
    )
    return {"albums": (sub.get("albumList2") or {}).get("album") or []}


@app.get("/api/album/{album_id}")
async def album(album_id: str):
    sub = await _nd_get("getAlbum.view", {"id": album_id})
    return sub.get("album") or {}


@app.get("/api/search")
async def search(q: str = Query(..., min_length=1)):
    sub = await _nd_get("search3.view", {"query": q, "artistCount": 10, "albumCount": 24, "songCount": 24})
    result = sub.get("searchResult3") or {}
    return {
        "artists": result.get("artist") or [],
        "albums": result.get("album") or [],
        "songs": result.get("song") or [],
    }


@app.get("/api/cover/{cover_id}")
async def cover(cover_id: str, size: int = Query(600, ge=40, le=1200)):
    params = _auth_params()
    params.update({"id": cover_id, "size": str(size)})
    url = f"{NAVIDROME}/rest/getCoverArt.view?{urlencode(params)}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.get(url)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, "cover missing")
    return Response(content=r.content, media_type=r.headers.get("content-type", "image/jpeg"))


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


if STATIC.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
