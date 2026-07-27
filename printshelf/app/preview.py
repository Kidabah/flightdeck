from __future__ import annotations

import hashlib
import struct
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from .config import data_dir, load_config
from .db import db_session, row_to_dict
from .parsers.threemf import extract_3mf_triangles


MAX_DIRECT_BYTES = 24_000_000
MAX_PREVIEW_TRIS = 400_000
MAX_PREVIEW_TRIS_HIGH = 750_000


def get_asset_row(asset_id: int) -> dict[str, Any] | None:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = conn.execute(
            "SELECT * FROM assets WHERE id = ? AND missing = 0 AND COALESCE(hidden, 0) = 0",
            (asset_id,),
        ).fetchone()
    return row_to_dict(row)


def path_under_watched(abs_path: str, cfg: dict[str, Any] | None = None) -> bool:
    """True if path resolves under a watched folder root (file need not exist)."""
    cfg = cfg or load_config()
    try:
        target = Path(abs_path).resolve()
    except Exception:
        return False
    for folder in cfg.get("watched_folders") or []:
        root = Path(folder.get("path") or "")
        if not root.exists():
            continue
        try:
            target.relative_to(root.resolve())
            return True
        except Exception:
            continue
    return False


def path_is_allowed(abs_path: str, cfg: dict[str, Any] | None = None) -> bool:
    cfg = cfg or load_config()
    try:
        target = Path(abs_path).resolve()
    except Exception:
        return False
    if not target.is_file():
        return False
    return path_under_watched(str(target), cfg)


def _write_binary_stl(tris: list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]]) -> bytes:
    header = b"PrintShelf preview".ljust(80, b"\0")
    out = [header, struct.pack("<I", len(tris))]
    for a, b, c in tris:
        # rough normal
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        out.append(struct.pack("<3f", nx, ny, nz))
        out.append(struct.pack("<3f", *a))
        out.append(struct.pack("<3f", *b))
        out.append(struct.pack("<3f", *c))
        out.append(struct.pack("<H", 0))
    return b"".join(out)


def decimate_binary_stl(path: Path, max_tris: int = MAX_PREVIEW_TRIS) -> bytes | None:
    data = path.read_bytes()
    if len(data) < 84:
        return None
    n = struct.unpack_from("<I", data, 80)[0]
    expected = 84 + n * 50
    if n <= 0 or expected > len(data) + 50:
        return None
    if n <= max_tris:
        return data
    stride = max(1, (n + max_tris - 1) // max_tris)
    tris = []
    off = 84
    for i in range(n):
        if off + 50 > len(data):
            break
        if i % stride == 0:
            v0 = struct.unpack_from("<fff", data, off + 12)
            v1 = struct.unpack_from("<fff", data, off + 24)
            v2 = struct.unpack_from("<fff", data, off + 36)
            tris.append((v0, v1, v2))
        off += 50
        if len(tris) >= max_tris:
            break
    return _write_binary_stl(tris)


def decimate_obj_to_stl(path: Path, max_tris: int = MAX_PREVIEW_TRIS) -> bytes | None:
    verts: list[tuple[float, float, float]] = []
    tris: list = []
    with path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.startswith("v "):
                parts = line.split()
                if len(parts) >= 4:
                    try:
                        verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
                    except Exception:
                        continue
            elif line.startswith("f "):
                idxs = []
                for tok in line.split()[1:]:
                    try:
                        vi = int(tok.split("/", 1)[0])
                    except Exception:
                        continue
                    if vi < 0:
                        vi = len(verts) + vi
                    else:
                        vi -= 1
                    if 0 <= vi < len(verts):
                        idxs.append(vi)
                if len(idxs) < 3:
                    continue
                for i in range(1, len(idxs) - 1):
                    tris.append((verts[idxs[0]], verts[idxs[i]], verts[idxs[i + 1]]))
    if not tris:
        return None
    if len(tris) > max_tris:
        stride = max(1, (len(tris) + max_tris - 1) // max_tris)
        tris = tris[::stride][:max_tris]
    return _write_binary_stl(tris)


def cached_preview_path(content_hash: str, kind: str, max_tris: int) -> Path:
    prev = data_dir() / "previews"
    prev.mkdir(parents=True, exist_ok=True)
    return prev / f"{(content_hash or 'x')[:20]}_{kind}_{max_tris}.stl"


def build_preview_stl(asset: dict[str, Any], max_tris: int = MAX_PREVIEW_TRIS) -> tuple[Path, bool]:
    """Return (path_to_stl, is_simplified)."""
    kind = asset.get("kind") or ""
    src = Path(asset["abs_path"])
    content_hash = asset.get("content_hash") or src.name
    cache = cached_preview_path(str(content_hash), kind, max_tris)

    if kind == "stl":
        size = src.stat().st_size
        # Small enough: serve original
        if size <= MAX_DIRECT_BYTES:
            data = src.read_bytes()
            if len(data) >= 84:
                n = struct.unpack_from("<I", data, 80)[0]
                if 0 < n <= max_tris and 84 + n * 50 <= len(data) + 50:
                    return src, False
        if cache.exists() and cache.stat().st_mtime >= src.stat().st_mtime:
            return cache, True
        blob = decimate_binary_stl(src, max_tris=max_tris)
        if not blob:
            return src, False
        cache.write_bytes(blob)
        return cache, True

    if kind == "obj":
        if cache.exists() and cache.stat().st_mtime >= src.stat().st_mtime:
            return cache, True
        blob = decimate_obj_to_stl(src, max_tris=max_tris)
        if not blob:
            raise FileNotFoundError("Could not build OBJ preview")
        cache.write_bytes(blob)
        return cache, True

    if kind in ("3mf", "gcode.3mf"):
        if cache.exists() and cache.stat().st_mtime >= src.stat().st_mtime:
            return cache, True
        tris = extract_3mf_triangles(src, max_tris=max_tris)
        if not tris:
            raise FileNotFoundError("No mesh found inside 3MF (settings/profile only?)")
        if len(tris) > max_tris:
            stride = max(1, (len(tris) + max_tris - 1) // max_tris)
            tris = tris[::stride][:max_tris]
        blob = _write_binary_stl(tris)
        cache.write_bytes(blob)
        return cache, True

    raise ValueError(f"Unsupported kind for 3D preview: {kind}")


def safe_zip_entry(name: str) -> str:
    n = (name or "").replace("\\", "/").lstrip("/")
    if not n or n.endswith("/") or ".." in n.split("/"):
        raise ValueError("Invalid zip entry path")
    return n


# Back-compat alias used by older call sites.
_safe_zip_entry = safe_zip_entry


def entry_kind(name: str) -> str | None:
    lower = name.lower()
    if lower.endswith(".gcode.3mf"):
        return "gcode.3mf"
    if lower.endswith(".3mf"):
        return "3mf"
    if lower.endswith(".stl"):
        return "stl"
    if lower.endswith(".obj"):
        return "obj"
    return None


_entry_kind = entry_kind


def resolve_zip_member(src: Path, entry: str) -> str:
    """Return the real ZipInfo filename for a logical entry path."""
    entry = safe_zip_entry(entry)
    with zipfile.ZipFile(src, "r") as zf:
        names = {n.replace("\\", "/"): n for n in zf.namelist()}
        real = names.get(entry)
        if real is None:
            lower_map = {k.lower(): v for k, v in names.items()}
            real = lower_map.get(entry.lower())
        if real is None:
            raise FileNotFoundError(f"Entry not found in zip: {entry}")
        return real


def build_zip_entry_preview(
    asset: dict[str, Any],
    entry: str,
    max_tris: int = MAX_PREVIEW_TRIS,
) -> tuple[Path, bool]:
    """Extract one printable from a ZIP and build a preview STL."""
    if (asset.get("kind") or "") != "zip":
        raise ValueError("Not a zip asset")
    entry = safe_zip_entry(entry)
    ekind = entry_kind(entry)
    if not ekind:
        raise ValueError("Zip entry is not a printable mesh (stl/obj/3mf)")

    src = Path(asset["abs_path"])
    content_hash = asset.get("content_hash") or src.name
    entry_key = hashlib.sha1(entry.encode("utf-8")).hexdigest()[:12]
    cache = cached_preview_path(str(content_hash), f"zip_{entry_key}_{ekind}", max_tris)
    if cache.exists() and cache.stat().st_mtime >= src.stat().st_mtime:
        return cache, True

    with zipfile.ZipFile(src, "r") as zf:
        names = {n.replace("\\", "/"): n for n in zf.namelist()}
        real = names.get(entry)
        if real is None:
            # case-insensitive fallback
            lower_map = {k.lower(): v for k, v in names.items()}
            real = lower_map.get(entry.lower())
        if real is None:
            raise FileNotFoundError(f"Entry not found in zip: {entry}")
        raw = zf.read(real)

    suffix = Path(entry).suffix.lower() or ".bin"
    if entry.lower().endswith(".gcode.3mf"):
        suffix = ".gcode.3mf"
    with tempfile.TemporaryDirectory(prefix="printshelf-zip-") as tmp:
        tmp_path = Path(tmp) / f"entry{suffix}"
        tmp_path.write_bytes(raw)
        fake = {
            "kind": ekind,
            "abs_path": str(tmp_path),
            "content_hash": f"{content_hash}_{entry_key}",
            "file_name": Path(entry).name,
        }
        # Build via temp file, then copy into stable cache key
        path, simplified = build_preview_stl(fake, max_tris=max_tris)
        data = path.read_bytes()
        cache.write_bytes(data)
        return cache, True
