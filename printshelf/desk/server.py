"""Local MeshFinder. Lists folders on this PC and serves a file into the viewer.

The Pi is not on this path. Nothing here starts a print.
"""
from __future__ import annotations

import array
import hashlib
import json
import mimetypes
import os
import random
import struct
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

HOST = "127.0.0.1"
PORT = 8111
STATIC = Path(__file__).resolve().parent / "static"

MESH = {".stl", ".obj"}
IMAGE = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
DOC = {".pdf", ".txt", ".md", ".csv"}
SKIP_NAMES = {
    "desktop.ini",
    "thumbs.db",
    ".ds_store",
}


def config_path() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home())
    path = Path(base) / "MeshFinder" / "desk.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def default_roots() -> list[str]:
    downloads = Path.home() / "Downloads"
    if downloads.is_dir():
        return [str(downloads)]
    return []


def load_roots() -> list[str]:
    path = config_path()
    if not path.is_file():
        roots = default_roots()
        save_roots(roots)
        return roots
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default_roots()
    roots = []
    for raw in data.get("roots") or []:
        try:
            folder = Path(raw).expanduser().resolve()
        except Exception:
            continue
        if folder.is_dir():
            roots.append(str(folder))
    return roots


def save_roots(roots: list[str]) -> None:
    config_path().write_text(
        json.dumps({"roots": roots}, indent=2),
        encoding="utf-8",
    )


def _under_root(path: Path, roots: list[str]) -> bool:
    resolved = path.resolve()
    for root in roots:
        try:
            resolved.relative_to(Path(root).resolve())
            return True
        except ValueError:
            continue
    return False


def _kind_for(name: str) -> str:
    lower = name.lower()
    if lower.endswith(".gcode.3mf"):
        return "gcode.3mf"
    suffix = Path(lower).suffix
    if suffix == ".zip":
        return "zip"
    if suffix in MESH:
        return suffix[1:]
    if suffix == ".3mf":
        return "3mf"
    if suffix in IMAGE:
        return "image"
    if suffix in DOC:
        return "doc"
    if lower.endswith((".gcode", ".gco")):
        return "gcode"
    return "file"


def _skip_name(name: str) -> bool:
    base = Path(name).name
    if not base or base.startswith("._") or base.startswith("."):
        return True
    if base.lower() in SKIP_NAMES:
        return True
    if "__macosx" in name.replace("\\", "/").lower():
        return True
    return False


def list_folder(folder: Path) -> dict:
    folders = []
    files = []
    try:
        children = list(folder.iterdir())
    except OSError as exc:
        return {"error": str(exc), "folders": [], "files": []}
    for child in children:
        if _skip_name(child.name):
            continue
        try:
            if child.is_dir():
                folders.append({"name": child.name, "path": str(child), "kind": "folder"})
            elif child.is_file():
                kind = _kind_for(child.name)
                item = {
                    "name": child.name,
                    "path": str(child),
                    "kind": "zip" if kind == "zip" else kind,
                    "size": child.stat().st_size,
                    "entry": "",
                }
                if kind == "zip":
                    folders.append({"name": child.name, "path": str(child), "kind": "zip"})
                else:
                    files.append(item)
        except OSError:
            continue
    folders.sort(key=lambda item: (item["kind"] != "folder", item["name"].lower()))
    files.sort(key=lambda item: item["name"].lower())
    return {"folders": folders, "files": files}


CARD_KINDS = {"stl", "obj", "image", "doc", "3mf", "gcode.3mf"}


def _card_from_name(path: Path, name: str, size: int, entry: str = "") -> dict | None:
    kind = _kind_for(Path(name).name)
    if kind not in CARD_KINDS:
        return None
    return {
        "name": Path(name).name,
        "path": str(path),
        "kind": kind,
        "size": int(size or 0),
        "entry": entry,
    }


def _iter_zip_cards(zip_path: Path):
    try:
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                name = info.filename.replace("\\", "/")
                if not name or name.endswith("/") or _skip_name(name):
                    continue
                card = _card_from_name(zip_path, name, int(info.file_size or 0), name)
                if card:
                    yield card
    except (OSError, zipfile.BadZipFile):
        return


def _iter_dir_cards(folder: Path, recursive: bool):
    if not recursive:
        try:
            children = sorted(folder.iterdir(), key=lambda item: item.name.lower())
        except OSError:
            return
        for child in children:
            if _skip_name(child.name) or not child.is_file():
                continue
            if child.suffix.lower() == ".zip":
                yield from _iter_zip_cards(child)
                continue
            try:
                size = child.stat().st_size
            except OSError:
                continue
            card = _card_from_name(child, child.name, size)
            if card:
                yield card
        return
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = sorted((name for name in dirnames if not _skip_name(name)), key=str.lower)
        for name in sorted(filenames, key=str.lower):
            if _skip_name(name):
                continue
            path = Path(dirpath) / name
            if path.suffix.lower() == ".zip":
                yield from _iter_zip_cards(path)
                continue
            try:
                size = path.stat().st_size
            except OSError:
                continue
            card = _card_from_name(path, name, size)
            if card:
                yield card


def gallery_page(folder: Path, *, recursive: bool, offset: int, limit: int) -> dict:
    items = []
    skipped = 0
    truncated = False
    source = _iter_zip_cards(folder) if folder.is_file() and folder.suffix.lower() == ".zip" else _iter_dir_cards(folder, recursive)
    for card in source:
        if skipped < offset:
            skipped += 1
            continue
        if len(items) >= limit:
            truncated = True
            break
        items.append(card)
    return {"items": items, "offset": offset, "limit": limit, "truncated": truncated}


def list_zip(zip_path: Path, prefix: str) -> dict:
    prefix = prefix.replace("\\", "/").lstrip("/")
    if prefix and not prefix.endswith("/"):
        prefix += "/"
    folders: dict[str, dict] = {}
    files = []
    try:
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                name = info.filename.replace("\\", "/")
                if not name or name.endswith("/") or _skip_name(name):
                    continue
                if prefix and not name.startswith(prefix):
                    continue
                rest = name[len(prefix):]
                if not rest:
                    continue
                head, sep, tail = rest.partition("/")
                if sep:
                    folders.setdefault(head, {
                        "name": head,
                        "path": str(zip_path),
                        "kind": "zipdir",
                        "prefix": f"{prefix}{head}",
                    })
                    continue
                files.append({
                    "name": head,
                    "path": str(zip_path),
                    "kind": _kind_for(head),
                    "size": int(info.file_size or 0),
                    "entry": name,
                })
    except (OSError, zipfile.BadZipFile) as exc:
        return {"error": str(exc), "folders": [], "files": []}
    folder_rows = sorted(folders.values(), key=lambda item: item["name"].lower())
    files.sort(key=lambda item: item["name"].lower())
    return {"folders": folder_rows, "files": files}


MAX_PREVIEW_TRIS = 8000
_preview_lock = threading.Lock()


def _preview_cache(path: Path, entry: str) -> Path:
    folder = config_path().parent / "previews"
    folder.mkdir(parents=True, exist_ok=True)
    st = path.stat()
    raw = f"{path.resolve()}|{entry}|{st.st_mtime_ns}|{st.st_size}|solid2"
    name = hashlib.sha1(raw.encode("utf-8", "replace")).hexdigest()
    return folder / f"{name}.bin"


def _pack_tris(verts: array.array) -> bytes:
    count = len(verts) // 9
    return struct.pack("<I", count) + verts.tobytes()


def _stl_triangle_count(head: bytes, size: int) -> int | None:
    if len(head) < 84 or size < 84:
        return None
    count = struct.unpack_from("<I", head, 80)[0]
    if count <= 0:
        return None
    expect = 84 + count * 50
    if size == expect:
        return count
    if size > expect and size - expect < 1024 and head[:5].lower() != b"solid":
        return count
    return None


def _sample_binary_seek(handle, count: int, origin: int = 84) -> bytes:
    step = max(1, count // MAX_PREVIEW_TRIS)
    out = array.array("f")
    for index in range(0, count, step):
        handle.seek(origin + index * 50 + 12)
        chunk = handle.read(36)
        if len(chunk) < 36:
            break
        out.frombytes(chunk)
        if len(out) // 9 >= MAX_PREVIEW_TRIS:
            break
    return _pack_tris(out)


def _sample_binary_seq(handle, count: int) -> bytes:
    step = max(1, count // MAX_PREVIEW_TRIS)
    out = array.array("f")
    for index in range(count):
        rec = handle.read(50)
        if len(rec) < 50:
            break
        if index % step == 0:
            out.frombytes(rec[12:48])
            if len(out) // 9 >= MAX_PREVIEW_TRIS:
                break
    return _pack_tris(out)


def _sample_ascii_stl(data: bytes) -> bytes:
    verts = array.array("f")
    for line in data.splitlines():
        stripped = line.lstrip()
        if stripped[:6].lower() != b"vertex":
            continue
        parts = stripped.split()
        if len(parts) < 4:
            continue
        try:
            verts.extend((float(parts[1]), float(parts[2]), float(parts[3])))
        except ValueError:
            continue
    count = len(verts) // 9
    if count <= MAX_PREVIEW_TRIS:
        return _pack_tris(verts[: count * 9])
    step = max(1, count // MAX_PREVIEW_TRIS)
    sampled = array.array("f")
    for index in range(0, count, step):
        start = index * 9
        sampled.extend(verts[start : start + 9])
        if len(sampled) // 9 >= MAX_PREVIEW_TRIS:
            break
    return _pack_tris(sampled)


def _sample_stl_handle(handle, size: int, *, seek: bool) -> bytes:
    head = handle.read(84)
    count = _stl_triangle_count(head, size)
    if count is not None:
        if seek:
            return _sample_binary_seek(handle, count, 84)
        return _sample_binary_seq(handle, count)
    rest = handle.read()
    return _sample_ascii_stl(head + rest)


def _face_indexes(tokens: list[bytes], nverts: int) -> list[int] | None:
    indexes = []
    for token in tokens:
        head = token.split(b"/", 1)[0]
        if not head:
            return None
        try:
            raw = int(head)
        except ValueError:
            return None
        if raw < 0:
            raw = nverts + raw
        else:
            raw -= 1
        indexes.append(raw)
    return indexes if len(indexes) >= 3 else None


def _sample_obj_handle(handle) -> bytes:
    verts = array.array("f")
    faces: list[tuple[int, int, int]] = []
    seen = 0
    for line in handle:
        if line.startswith((b"v ", b"v\t")):
            parts = line.split()
            if len(parts) < 4:
                continue
            try:
                verts.extend((float(parts[1]), float(parts[2]), float(parts[3])))
            except ValueError:
                continue
            continue
        if not line.startswith((b"f ", b"f\t")):
            continue
        nverts = len(verts) // 3
        indexes = _face_indexes(line.split()[1:], nverts)
        if not indexes:
            continue
        for slot in range(1, len(indexes) - 1):
            tri = (indexes[0], indexes[slot], indexes[slot + 1])
            seen += 1
            if len(faces) < MAX_PREVIEW_TRIS:
                faces.append(tri)
            else:
                pick = random.randrange(seen)
                if pick < MAX_PREVIEW_TRIS:
                    faces[pick] = tri
    nverts = len(verts) // 3
    out = array.array("f")
    for a, b, c in faces:
        if not (0 <= a < nverts and 0 <= b < nverts and 0 <= c < nverts):
            continue
        out.extend(verts[a * 3 : a * 3 + 3])
        out.extend(verts[b * 3 : b * 3 + 3])
        out.extend(verts[c * 3 : c * 3 + 3])
    return _pack_tris(out)


def _raster_png(payload: bytes, up: str) -> bytes:
    """Draw a small shaded picture of a sampled mesh. Cards already show real images."""
    import io
    import math

    import numpy as np
    from PIL import Image, ImageDraw

    count = struct.unpack_from("<I", payload, 0)[0]
    if count <= 0 or len(payload) < 4 + count * 36:
        raise ValueError("empty mesh")
    verts = np.frombuffer(payload, dtype="<f4", offset=4, count=count * 9).astype(np.float64).reshape(-1, 3)
    if up == "z":
        x = verts[:, 0].copy()
        y = verts[:, 1].copy()
        z = verts[:, 2].copy()
        verts[:, 0] = x
        verts[:, 1] = z
        verts[:, 2] = -y
    verts[:, 0] -= float((verts[:, 0].min() + verts[:, 0].max()) * 0.5)
    verts[:, 1] -= float(verts[:, 1].min())
    verts[:, 2] -= float((verts[:, 2].min() + verts[:, 2].max()) * 0.5)
    yaw, pitch = math.radians(42), math.radians(26)
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    x = verts[:, 0] * cy + verts[:, 2] * sy
    z = -verts[:, 0] * sy + verts[:, 2] * cy
    y2 = verts[:, 1] * cp - z * sp
    z2 = verts[:, 1] * sp + z * cp
    width, height = 480, 360
    span_x = max(float(np.ptp(x)), 1e-6)
    span_y = max(float(np.ptp(y2)), 1e-6)
    scale = min(width * 0.88 / span_x, height * 0.88 / span_y)
    sx = width * 0.5 + (x - float((x.min() + x.max()) * 0.5)) * scale
    sy = height * 0.5 - (y2 - float((y2.min() + y2.max()) * 0.5)) * scale
    view = np.stack([x, y2, z2], axis=1).reshape(-1, 3, 3)
    normal = np.cross(view[:, 1] - view[:, 0], view[:, 2] - view[:, 0])
    length = np.linalg.norm(normal, axis=1)
    length[length < 1e-8] = 1.0
    normal /= length[:, None]
    light = np.array([0.2, 0.72, 0.66], dtype=np.float64)
    light /= np.linalg.norm(light)
    shade = 0.42 + 0.58 * np.abs(normal @ light)
    # One dot per triangle. The three corners of a sampled facet land on the same pixel,
    # so drawing all three leaves a hole between facets.
    px = sx.reshape(-1, 3).mean(axis=1)
    py = sy.reshape(-1, 3).mean(axis=1)
    pz = z2.reshape(-1, 3).mean(axis=1)
    spacing = math.sqrt(max(span_x * scale * span_y * scale, 1.0) / max(int(px.size), 1))
    radius = min(18.0, max(4.5, spacing * 1.55))
    order = np.argsort(pz)
    image = Image.new("RGB", (width, height), (42, 48, 56))
    draw = ImageDraw.Draw(image)
    base = np.array([214, 220, 228], dtype=np.float64)
    for index in order:
        tone = float(shade[index])
        color = tuple(int(channel * tone) for channel in base)
        cx = float(px[index])
        cy = float(py[index])
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=color)
    from PIL import ImageFilter
    # Close small gaps between the dots, then soften the edges.
    image = image.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.MinFilter(11))
    image = image.filter(ImageFilter.GaussianBlur(radius=1.25))
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def preview_png(path: Path, entry: str = "") -> bytes:
    cache = _preview_cache(path, entry).with_suffix(".s4.png")
    if cache.is_file() and cache.stat().st_size > 32:
        return cache.read_bytes()
    kind = _kind_for(Path(entry).name if entry else path.name)
    png = _raster_png(build_preview(path, entry), "y" if kind == "obj" else "z")
    tmp = cache.with_suffix(".tmp")
    tmp.write_bytes(png)
    tmp.replace(cache)
    return png


def build_preview(path: Path, entry: str = "") -> bytes:
    cache = _preview_cache(path, entry)
    if cache.is_file() and cache.stat().st_size >= 4:
        return cache.read_bytes()
    with _preview_lock:
        if cache.is_file() and cache.stat().st_size >= 4:
            return cache.read_bytes()
        kind = _kind_for(Path(entry).name if entry else path.name)
        if entry:
            if path.suffix.lower() != ".zip":
                raise ValueError("Entry only works on a zip")
            entry = entry.replace("\\", "/").lstrip("/")
            with zipfile.ZipFile(path) as zf:
                info = zf.getinfo(entry)
                with zf.open(info, "r") as handle:
                    if kind == "obj":
                        data = _sample_obj_handle(handle)
                    else:
                        data = _sample_stl_handle(handle, int(info.file_size or 0), seek=False)
        elif kind == "obj":
            with path.open("rb") as handle:
                data = _sample_obj_handle(handle)
        else:
            with path.open("rb") as handle:
                data = _sample_stl_handle(handle, path.stat().st_size, seek=True)
        tmp = cache.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(cache)
        return data


def read_zip_entry(zip_path: Path, entry: str) -> bytes:
    entry = entry.replace("\\", "/").lstrip("/")
    if not entry or ".." in entry.split("/"):
        raise ValueError("Bad entry")
    with zipfile.ZipFile(zip_path) as zf:
        try:
            zf.getinfo(entry)
        except KeyError as exc:
            raise FileNotFoundError(entry) from exc
        return zf.read(entry)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _send(self, code: int, body: bytes, content_type: str, extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def _allowed(self, path: Path) -> bool:
        return _under_root(path, load_roots())

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)
        if path in ("/", "/index.html"):
            self._file(STATIC / "index.html", "text/html; charset=utf-8")
            return
        if path.startswith("/static/"):
            rel = path[len("/static/"):]
            target = (STATIC / rel).resolve()
            if STATIC.resolve() not in target.parents and target != STATIC.resolve():
                self._json(404, {"error": "Not found"})
                return
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if target.suffix == ".js":
                ctype = "text/javascript; charset=utf-8"
            if target.suffix == ".css":
                ctype = "text/css; charset=utf-8"
            self._file(target, ctype)
            return
        if path == "/api/roots":
            self._json(200, {"roots": load_roots()})
            return
        if path == "/api/list":
            self._list(query)
            return
        if path == "/api/gallery":
            self._gallery(query)
            return
        if path == "/api/file":
            self._file_bytes(query)
            return
        if path == "/api/preview":
            self._preview(query)
            return
        self._json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/roots":
            body = self._read_json()
            raw = str(body.get("path") or "").strip().strip('"')
            if not raw:
                self._json(400, {"error": "Pick a folder"})
                return
            folder = Path(raw).expanduser()
            if not folder.is_dir():
                self._json(400, {"error": "That folder is not on this PC"})
                return
            resolved = str(folder.resolve())
            roots = load_roots()
            if resolved not in roots:
                roots.append(resolved)
                save_roots(roots)
            self._json(200, {"roots": roots, "added": resolved})
            return
        if parsed.path == "/api/open":
            self._open_external()
            return
        self._json(404, {"error": "Not found"})

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path != "/api/roots":
            self._json(404, {"error": "Not found"})
            return
        raw = (query.get("path") or [""])[0]
        try:
            target = str(Path(raw).resolve())
        except Exception:
            target = raw
        roots = [item for item in load_roots() if item != target]
        save_roots(roots)
        self._json(200, {"roots": roots})

    def _file(self, target: Path, content_type: str) -> None:
        if not target.is_file():
            self._json(404, {"error": "Not found"})
            return
        data = target.read_bytes()
        self._send(200, data, content_type)

    def _gallery(self, query: dict) -> None:
        raw = (query.get("path") or [""])[0]
        recursive = (query.get("recursive") or ["0"])[0] in {"1", "true", "yes"}
        try:
            offset = max(0, int((query.get("offset") or ["0"])[0]))
            limit = int((query.get("limit") or ["120"])[0])
        except ValueError:
            offset, limit = 0, 120
        limit = min(240, max(1, limit))
        if not raw:
            self._json(400, {"error": "Pick a folder"})
            return
        try:
            target = Path(raw).resolve()
        except Exception:
            self._json(400, {"error": "Bad path"})
            return
        if not self._allowed(target) or not (target.is_dir() or target.suffix.lower() == ".zip"):
            self._json(404, {"error": "Folder not found"})
            return
        payload = gallery_page(target, recursive=recursive, offset=offset, limit=limit)
        payload["path"] = str(target)
        self._json(200, payload)

    def _list(self, query: dict) -> None:
        raw = (query.get("path") or [""])[0]
        prefix = (query.get("prefix") or [""])[0]
        roots = load_roots()
        if not raw:
            self._json(200, {
                "path": "",
                "prefix": "",
                "folders": [{"name": Path(root).name or root, "path": root, "kind": "folder"} for root in roots],
                "files": [],
                "roots": roots,
            })
            return
        try:
            target = Path(raw).resolve()
        except Exception:
            self._json(400, {"error": "Bad path"})
            return
        if not self._allowed(target):
            self._json(403, {"error": "Folder is outside the library"})
            return
        if target.is_dir():
            payload = list_folder(target)
        elif target.is_file() and target.suffix.lower() == ".zip":
            payload = list_zip(target, prefix)
        else:
            self._json(400, {"error": "Not a folder"})
            return
        payload["path"] = str(target)
        payload["prefix"] = prefix.replace("\\", "/").strip("/")
        payload["roots"] = roots
        self._json(200, payload)

    def _preview(self, query: dict) -> None:
        raw = (query.get("path") or [""])[0]
        entry = (query.get("entry") or [""])[0]
        try:
            target = Path(raw).resolve()
        except Exception:
            self._json(400, {"error": "Bad path"})
            return
        if not target.is_file() or not self._allowed(target):
            self._json(404, {"error": "File not found"})
            return
        kind = _kind_for(Path(entry).name if entry else target.name)
        if kind not in {"stl", "obj"}:
            self._json(400, {"error": "No mesh preview for this file"})
            return
        try:
            data = preview_png(target, entry)
        except (OSError, zipfile.BadZipFile, ValueError, FileNotFoundError, KeyError, ImportError) as exc:
            self._json(404, {"error": str(exc)})
            return
        self._send(200, data, "image/png")

    def _file_bytes(self, query: dict) -> None:
        raw = (query.get("path") or [""])[0]
        entry = (query.get("entry") or [""])[0]
        try:
            target = Path(raw).resolve()
        except Exception:
            self._json(400, {"error": "Bad path"})
            return
        if not target.is_file() or not self._allowed(target):
            self._json(404, {"error": "File not found"})
            return
        try:
            if entry:
                if target.suffix.lower() != ".zip":
                    self._json(400, {"error": "Entry only works on a zip"})
                    return
                data = read_zip_entry(target, entry)
                name = Path(entry).name
            else:
                data = target.read_bytes()
                name = target.name
        except (OSError, zipfile.BadZipFile, ValueError, FileNotFoundError) as exc:
            self._json(404, {"error": str(exc)})
            return
        ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        self._send(200, data, ctype, {"X-MeshFinder-Name": name})

    def _open_external(self) -> None:
        body = self._read_json()
        raw = str(body.get("path") or "")
        entry = str(body.get("entry") or "")
        try:
            target = Path(raw).resolve()
        except Exception:
            self._json(400, {"error": "Bad path"})
            return
        if not target.is_file() or not self._allowed(target):
            self._json(404, {"error": "File not found"})
            return
        try:
            if entry:
                data = read_zip_entry(target, entry)
                dest_dir = config_path().parent / "open"
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / Path(entry).name
                dest.write_bytes(data)
                os.startfile(dest)  # noqa: S606  Windows shell open of a file the user picked
                self._json(200, {"ok": True, "opened": str(dest)})
                return
            os.startfile(target)  # noqa: S606
        except Exception as exc:
            self._json(500, {"error": str(exc)})
            return
        self._json(200, {"ok": True, "opened": str(target)})


def serve(port: int = PORT) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer((HOST, port), Handler)
    httpd.serve_forever()
    return httpd


if __name__ == "__main__":
    print(f"MeshFinder desk on http://{HOST}:{PORT}")
    serve()
