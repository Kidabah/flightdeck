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


def _read_config() -> dict:
    path = config_path()
    if not path.is_file():
        return {"roots": default_roots(), "favourites": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"roots": default_roots(), "favourites": []}
    return data if isinstance(data, dict) else {"roots": default_roots(), "favourites": []}


def _write_config(data: dict) -> None:
    config_path().write_text(json.dumps(data, indent=2), encoding="utf-8")


def load_roots() -> list[str]:
    data = _read_config()
    raw_roots = data.get("roots")
    if not isinstance(raw_roots, list):
        raw_roots = default_roots()
        data["roots"] = raw_roots
        _write_config(data)
    roots = []
    for raw in raw_roots:
        try:
            folder = Path(raw).expanduser().resolve()
        except Exception:
            continue
        if folder.is_dir():
            roots.append(str(folder))
    return roots


def save_roots(roots: list[str]) -> None:
    data = _read_config()
    data["roots"] = roots
    _write_config(data)


def load_favourites() -> list[dict]:
    data = _read_config()
    roots = load_roots()
    items = []
    for raw in data.get("favourites") or []:
        if not isinstance(raw, dict):
            continue
        try:
            target = Path(str(raw.get("path") or "")).resolve()
        except Exception:
            continue
        if not target.is_file() or not _under_root(target, roots):
            continue
        try:
            size = int(raw.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        items.append({
            "path": str(target),
            "entry": str(raw.get("entry") or ""),
            "name": str(raw.get("name") or target.name),
            "kind": str(raw.get("kind") or "file"),
            "size": size,
        })
    return items


def save_favourites(items: list[dict]) -> None:
    data = _read_config()
    data["favourites"] = items
    _write_config(data)


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


def _load_stl_tris(data: bytes):
    import numpy as np

    if len(data) < 84:
        raise ValueError("empty mesh")
    count = struct.unpack_from("<I", data, 80)[0]
    if count <= 0 or 84 + count * 50 > len(data):
        raise ValueError("not a binary stl")
    recs = np.frombuffer(data, dtype=np.uint8, offset=84, count=count * 50).reshape(count, 50)
    verts = np.empty((count, 3, 3), np.float32)
    for corner in range(3):
        chunk = np.ascontiguousarray(recs[:, 12 + corner * 12 : 24 + corner * 12])
        verts[:, corner] = chunk.view(np.float32).reshape(count, 3)
    return verts


def _load_obj_tris(data: bytes):
    import numpy as np

    verts = []
    faces = []
    for line in data.splitlines():
        if line.startswith((b"v ", b"v\t")):
            parts = line.split()
            if len(parts) < 4:
                continue
            try:
                verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
            except ValueError:
                continue
            continue
        if not line.startswith((b"f ", b"f\t")):
            continue
        indexes = []
        total = len(verts)
        for token in line.split()[1:]:
            head = token.split(b"/", 1)[0]
            if not head:
                indexes = []
                break
            try:
                raw = int(head)
            except ValueError:
                indexes = []
                break
            indexes.append(total + raw if raw < 0 else raw - 1)
        if len(indexes) < 3:
            continue
        for slot in range(1, len(indexes) - 1):
            faces.append((indexes[0], indexes[slot], indexes[slot + 1]))
    if not verts or not faces:
        raise ValueError("empty mesh")
    points = np.asarray(verts, np.float32)
    tris = np.asarray(faces, np.int32)
    ok = (tris >= 0).all(axis=1) & (tris < len(points)).all(axis=1)
    return points[tris[ok]]


def _cluster_tris(tris, grid: int = 120):
    import numpy as np

    mins = tris.min(axis=(0, 1))
    span = np.maximum(tris.max(axis=(0, 1)) - mins, 1e-8)
    quantized = np.floor((tris - mins) / span * (grid - 1)).astype(np.int32)
    quantized = np.clip(quantized, 0, grid - 1)
    keys = (quantized[..., 0] + (quantized[..., 1] + quantized[..., 2] * grid) * grid).reshape(-1)
    positions = tris.reshape(-1, 3).astype(np.float64)
    _uniq, inverse = np.unique(keys, return_inverse=True)
    totals = np.zeros((int(inverse.max()) + 1, 3), np.float64)
    weight = np.zeros(totals.shape[0], np.float64)
    np.add.at(totals, inverse, positions)
    np.add.at(weight, inverse, 1.0)
    centers = totals / weight[:, None]
    faces = inverse.reshape(-1, 3)
    keep = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    return centers[faces[keep]]


def _shade_png(tris, up: str) -> bytes:
    import io
    import math

    import numpy as np
    from PIL import Image, ImageDraw

    if len(tris) == 0:
        raise ValueError("empty mesh")
    if up == "z":
        x = tris[..., 0].copy()
        y = tris[..., 1].copy()
        z = tris[..., 2].copy()
        tris = np.stack([x, z, -y], axis=-1)
    tris = tris.astype(np.float64)
    center = tris.mean(axis=1)
    tris = tris - np.array([
        (center[:, 0].min() + center[:, 0].max()) * 0.5,
        center[:, 1].min(),
        (center[:, 2].min() + center[:, 2].max()) * 0.5,
    ])
    yaw, pitch = math.radians(42), math.radians(26)
    cos_yaw, sin_yaw = math.cos(yaw), math.sin(yaw)
    cos_pitch, sin_pitch = math.cos(pitch), math.sin(pitch)
    x = tris[..., 0] * cos_yaw + tris[..., 2] * sin_yaw
    z = -tris[..., 0] * sin_yaw + tris[..., 2] * cos_yaw
    y2 = tris[..., 1] * cos_pitch - z * sin_pitch
    z2 = tris[..., 1] * sin_pitch + z * cos_pitch
    width, height = 640, 480
    span_x = max(float(np.ptp(x)), 1e-6)
    span_y = max(float(np.ptp(y2)), 1e-6)
    scale = min(width * 0.88 / span_x, height * 0.88 / span_y)
    sx = width * 0.5 + (x - float((x.min() + x.max()) * 0.5)) * scale
    sy = height * 0.5 - (y2 - float((y2.min() + y2.max()) * 0.5)) * scale
    normal = np.cross(
        np.stack([x[:, 1] - x[:, 0], y2[:, 1] - y2[:, 0], z2[:, 1] - z2[:, 0]], axis=1),
        np.stack([x[:, 2] - x[:, 0], y2[:, 2] - y2[:, 0], z2[:, 2] - z2[:, 0]], axis=1),
    )
    length = np.linalg.norm(normal, axis=1)
    length[length < 1e-8] = 1.0
    normal /= length[:, None]
    light = np.array([0.25, 0.85, 0.45])
    light /= np.linalg.norm(light)
    shade = 0.28 + 0.72 * np.abs(normal @ light)
    order = np.argsort(z2.mean(axis=1))
    image = Image.new("RGB", (width, height), (26, 32, 40))
    draw = ImageDraw.Draw(image)
    base = np.array([232, 236, 242])
    for index in order:
        tone = float(shade[index])
        color = tuple(int(channel * tone) for channel in base)
        draw.polygon(
            [
                (float(sx[index, 0]), float(sy[index, 0])),
                (float(sx[index, 1]), float(sy[index, 1])),
                (float(sx[index, 2]), float(sy[index, 2])),
            ],
            fill=color,
        )
    image = image.resize((480, 360), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _xf_matrix(text: str):
    import numpy as np

    eye = np.eye(4)
    parts = (text or "").split()
    if len(parts) != 12:
        return eye
    try:
        n = [float(part) for part in parts]
    except ValueError:
        return eye
    eye = np.eye(4)
    eye[0, :3] = n[0:3]
    eye[1, :3] = n[3:6]
    eye[2, :3] = n[6:9]
    eye[0, 3], eye[1, 3], eye[2, 3] = n[9], n[10], n[11]
    return eye


def _xml_local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _load_3mf_tris(data: bytes):
    """Triangles from a 3MF package, in the build layout, Z-up millimetres."""
    import io

    import numpy as np
    from xml.etree import ElementTree as ET

    archive = zipfile.ZipFile(io.BytesIO(data))
    names = {item.replace("\\", "/").lstrip("/"): item for item in archive.namelist()}
    parsed: dict = {}

    def parse_model(zip_name: str):
        if zip_name in parsed:
            return parsed[zip_name]
        root = ET.fromstring(archive.read(zip_name))
        objects: dict = {}
        for node in root.iter():
            if _xml_local(node.tag) != "object":
                continue
            oid = node.attrib.get("id")
            if not oid:
                continue
            verts: list[tuple[float, float, float]] = []
            faces: list[tuple[int, int, int]] = []
            comps: list[dict] = []
            for child in list(node):
                tag = _xml_local(child.tag)
                if tag == "mesh":
                    for part in list(child):
                        part_tag = _xml_local(part.tag)
                        if part_tag == "vertices":
                            for vert in list(part):
                                if _xml_local(vert.tag) != "vertex":
                                    continue
                                try:
                                    verts.append((
                                        float(vert.attrib.get("x", 0)),
                                        float(vert.attrib.get("y", 0)),
                                        float(vert.attrib.get("z", 0)),
                                    ))
                                except ValueError:
                                    continue
                        elif part_tag == "triangles":
                            for tri in list(part):
                                if _xml_local(tri.tag) != "triangle":
                                    continue
                                try:
                                    faces.append((
                                        int(tri.attrib.get("v1", -1)),
                                        int(tri.attrib.get("v2", -1)),
                                        int(tri.attrib.get("v3", -1)),
                                    ))
                                except ValueError:
                                    continue
                elif tag == "components":
                    for comp in list(child):
                        if _xml_local(comp.tag) == "component":
                            comps.append(comp.attrib)
            objects[oid] = (verts, faces, comps)
        parsed[zip_name] = root
        parsed[zip_name + "\0objects"] = objects
        return root, objects

    def objects_of(zip_name: str):
        parse_model(zip_name)
        return parsed[zip_name + "\0objects"]

    def resolve_name(path: str, fallback: str) -> str:
        key = (path or "").replace("\\", "/").lstrip("/")
        return names.get(key, fallback)

    def component_fields(attrib: dict) -> tuple[str, str, str]:
        path = ""
        oid = ""
        transform = ""
        for key, value in attrib.items():
            local = _xml_local(key)
            if local == "path":
                path = value
            elif local == "objectid":
                oid = value
            elif local == "transform":
                transform = value
        return path, oid, transform

    chunks = []

    def collect(zip_name: str, oid: str, transform, stack: set):
        key = (zip_name, oid)
        if key in stack:
            return
        stack.add(key)
        try:
            verts, faces, comps = objects_of(zip_name).get(oid, ([], [], []))
            if verts and faces:
                points = np.asarray(verts, np.float64)
                index = np.asarray(faces, np.int32)
                ok = (index >= 0).all(axis=1) & (index < len(points)).all(axis=1)
                index = index[ok]
                if len(index):
                    xyz = np.c_[points, np.ones(len(points))]
                    world = (transform @ xyz.T).T[:, :3]
                    chunks.append(world[index].astype(np.float32))
            for attrib in comps:
                path, child_id, raw = component_fields(attrib)
                if not child_id:
                    continue
                child_name = resolve_name(path, zip_name)
                collect(child_name, child_id, transform @ _xf_matrix(raw), stack)
        finally:
            stack.discard(key)

    root_name = names.get("3D/3dmodel.model") or names.get("3d/3dmodel.model")
    if root_name is None:
        models = [real for key, real in names.items() if key.lower().endswith(".model")]
        root_name = models[0] if models else ""
    if not root_name:
        raise ValueError("No mesh in this 3MF")
    root, _objects = parse_model(root_name)
    for node in root.iter():
        if _xml_local(node.tag) != "item":
            continue
        oid = node.attrib.get("objectid")
        if oid:
            collect(root_name, oid, _xf_matrix(node.attrib.get("transform", "")), set())
    if not chunks:
        for key, real in names.items():
            if not key.lower().endswith(".model"):
                continue
            for oid in objects_of(real):
                collect(real, oid, np.eye(4), set())
    if not chunks:
        raise ValueError("No mesh in this 3MF")
    return np.concatenate(chunks, axis=0)


def _cap_tris(tris, limit: int = 180000):
    import numpy as np

    count = len(tris)
    if count <= limit:
        return tris
    step = int(np.ceil(count / limit))
    return tris[::step]


def _pack_mesh(tris) -> bytes:
    import numpy as np

    flat = np.ascontiguousarray(tris.reshape(-1), dtype=np.float32)
    return struct.pack("<I", len(tris)) + flat.tobytes()


def _view_mesh(tris):
    # Stride-sampling a round model leaves a cloud of specks. Clustering keeps a solid surface.
    return _cluster_tris(tris, 200)


def mesh_preview(path: Path, entry: str = "") -> bytes:
    cache = _preview_cache(path, entry).with_suffix(".m2")
    if cache.is_file() and cache.stat().st_size > 16:
        return cache.read_bytes()
    with _preview_lock:
        if cache.is_file() and cache.stat().st_size > 16:
            return cache.read_bytes()
        data = _mesh_bytes(path, entry)
        packed = _pack_mesh(_view_mesh(_load_3mf_tris(data)))
        tmp = cache.with_suffix(".tmp")
        tmp.write_bytes(packed)
        tmp.replace(cache)
        return packed


def _mesh_bytes(path: Path, entry: str) -> bytes:
    if not entry:
        return path.read_bytes()
    entry = entry.replace("\\", "/").lstrip("/")
    with zipfile.ZipFile(path) as zf:
        return zf.read(entry)


def preview_png(path: Path, entry: str = "") -> bytes:
    cache = _preview_cache(path, entry).with_suffix(".s5.png")
    if cache.is_file() and cache.stat().st_size > 32:
        return cache.read_bytes()
    with _preview_lock:
        if cache.is_file() and cache.stat().st_size > 32:
            return cache.read_bytes()
        kind = _kind_for(Path(entry).name if entry else path.name)
        data = _mesh_bytes(path, entry)
        if kind in {"3mf", "gcode.3mf"}:
            tris = _load_3mf_tris(data)
            mesh_cache = _preview_cache(path, entry).with_suffix(".m2")
            if not mesh_cache.is_file():
                packed = _pack_mesh(_view_mesh(tris))
                tmp_mesh = mesh_cache.with_suffix(".tmp")
                tmp_mesh.write_bytes(packed)
                tmp_mesh.replace(mesh_cache)
            png = _shade_png(_cluster_tris(tris), "z")
        elif kind == "obj":
            tris = _cluster_tris(_load_obj_tris(data))
            png = _shade_png(tris, "y")
        else:
            tris = _cluster_tris(_load_stl_tris(data))
            png = _shade_png(tris, "z")
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
        if path == "/api/mesh":
            self._mesh(query)
            return
        if path == "/api/favourites":
            self._json(200, {"items": load_favourites()})
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
        if parsed.path == "/api/favourites":
            self._add_favourite()
            return
        self._json(404, {"error": "Not found"})

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/api/favourites":
            self._remove_favourite(query)
            return
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

    def _favourite_from_body(self, body: dict) -> dict | None:
        raw = str(body.get("path") or "")
        entry = str(body.get("entry") or "")
        try:
            target = Path(raw).resolve()
        except Exception:
            return None
        if not target.is_file() or not self._allowed(target):
            return None
        try:
            size = int(body.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        return {
            "path": str(target),
            "entry": entry,
            "name": str(body.get("name") or target.name),
            "kind": str(body.get("kind") or "file"),
            "size": size,
        }

    def _add_favourite(self) -> None:
        item = self._favourite_from_body(self._read_json())
        if not item:
            self._json(400, {"error": "That file is not in the library"})
            return
        items = [
            saved for saved in load_favourites()
            if not (saved["path"] == item["path"] and saved["entry"] == item["entry"])
        ]
        items.insert(0, item)
        save_favourites(items)
        self._json(200, {"items": items})

    def _remove_favourite(self, query: dict) -> None:
        raw = (query.get("path") or [""])[0]
        entry = (query.get("entry") or [""])[0]
        try:
            target = str(Path(raw).resolve())
        except Exception:
            target = raw
        items = [
            saved for saved in load_favourites()
            if not (saved["path"] == target and saved["entry"] == entry)
        ]
        save_favourites(items)
        self._json(200, {"items": items})

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
        if kind not in {"stl", "obj", "3mf", "gcode.3mf"}:
            self._json(400, {"error": "No mesh preview for this file"})
            return
        try:
            data = preview_png(target, entry)
        except (OSError, zipfile.BadZipFile, ValueError, FileNotFoundError, KeyError, ImportError) as exc:
            self._json(404, {"error": str(exc)})
            return
        self._send(200, data, "image/png")

    def _mesh(self, query: dict) -> None:
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
        if kind not in {"3mf", "gcode.3mf"}:
            self._json(400, {"error": "No mesh for this file"})
            return
        try:
            data = mesh_preview(target, entry)
        except (OSError, zipfile.BadZipFile, ValueError, FileNotFoundError, KeyError, ImportError) as exc:
            self._json(404, {"error": str(exc)})
            return
        self._send(200, data, "application/octet-stream")

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
