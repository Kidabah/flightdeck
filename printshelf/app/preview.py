from __future__ import annotations

import hashlib
import io
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


def cached_slicer_3mf_path(content_hash: str, kind: str, entry_key: str = "") -> Path:
    prev = data_dir() / "previews"
    prev.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(f"{content_hash}|{kind}|{entry_key}".encode("utf-8")).hexdigest()[:20]
    return prev / f"{key}_slicer.3mf"


def _parse_binary_stl_tris(data: bytes) -> list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]]:
    if len(data) < 84:
        return []
    # ASCII STL — fall back via a temp decode path.
    head = data[:80].lstrip().lower()
    if head.startswith(b"solid") and b"facet" in data[:4096].lower():
        text = data.decode("utf-8", errors="ignore")
        tris = []
        verts: list[tuple[float, float, float]] = []
        for line in text.splitlines():
            parts = line.strip().split()
            if len(parts) >= 4 and parts[0].lower() == "vertex":
                try:
                    verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
                except Exception:
                    continue
                if len(verts) == 3:
                    tris.append((verts[0], verts[1], verts[2]))
                    verts = []
        return tris
    n = struct.unpack_from("<I", data, 80)[0]
    if n <= 0 or 84 + n * 50 > len(data) + 50:
        return []
    tris = []
    off = 84
    for _ in range(n):
        if off + 50 > len(data):
            break
        v0 = struct.unpack_from("<fff", data, off + 12)
        v1 = struct.unpack_from("<fff", data, off + 24)
        v2 = struct.unpack_from("<fff", data, off + 36)
        tris.append((v0, v1, v2))
        off += 50
    return tris


def _tris_to_3mf_bytes(
    tris: list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]],
    object_name: str = "model",
) -> bytes:
    """Minimal Core 3MF so Bambu Studio's URL-open path accepts the download (.3mf only)."""
    if not tris:
        raise ValueError("No triangles to pack into 3MF")

    def fmt(v: float) -> str:
        return f"{v:.6f}".rstrip("0").rstrip(".") if isinstance(v, float) else str(v)

    verts_xml: list[str] = []
    tris_xml: list[str] = []
    for i, (a, b, c) in enumerate(tris):
        base = i * 3
        verts_xml.append(f'<vertex x="{fmt(a[0])}" y="{fmt(a[1])}" z="{fmt(a[2])}"/>')
        verts_xml.append(f'<vertex x="{fmt(b[0])}" y="{fmt(b[1])}" z="{fmt(b[2])}"/>')
        verts_xml.append(f'<vertex x="{fmt(c[0])}" y="{fmt(c[1])}" z="{fmt(c[2])}"/>')
        tris_xml.append(f'<triangle v1="{base}" v2="{base + 1}" v3="{base + 2}"/>')

    safe_name = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in (object_name or "model"))[:80] or "model"
    model_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xml:lang="en-US" '
        'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
        "  <resources>\n"
        f'    <object id="1" name="{safe_name}" type="model">\n'
        "      <mesh>\n"
        "        <vertices>\n"
        + "".join(f"          {v}\n" for v in verts_xml)
        + "        </vertices>\n"
        "        <triangles>\n"
        + "".join(f"          {t}\n" for t in tris_xml)
        + "        </triangles>\n"
        "      </mesh>\n"
        "    </object>\n"
        "  </resources>\n"
        "  <build>\n"
        '    <item objectid="1"/>\n'
        "  </build>\n"
        "</model>\n"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
        '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
        '  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
        "</Types>\n"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
        '  <Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
        "</Relationships>\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("3D/3dmodel.model", model_xml)
    return buf.getvalue()


def build_slicer_3mf(
    asset: dict[str, Any],
    entry: str | None = None,
) -> tuple[bytes, str]:
    """
    Bambu Studio's bambustudio://open?file=… downloader only accepts .3mf.
    Wrap STL/OBJ (and zip printables) into a minimal 3MF; pass through real 3MFs.
    """
    kind = asset.get("kind") or ""
    src = Path(asset["abs_path"])
    content_hash = asset.get("content_hash") or src.name
    base_name = Path(asset.get("file_name") or src.name).stem or "model"

    if entry:
        raw, inner_name = read_zip_entry_bytes(src, entry)
        ek = entry_kind(inner_name) or ""
        out_name = f"{Path(inner_name).stem or base_name}.3mf"
        cache = cached_slicer_3mf_path(content_hash, ek or "zip", entry)
        if cache.exists() and cache.stat().st_size > 64:
            return cache.read_bytes(), out_name
        if ek in ("3mf", "gcode.3mf"):
            cache.write_bytes(raw)
            return raw, out_name
        if ek == "stl":
            tris = _parse_binary_stl_tris(raw)
        elif ek == "obj":
            tmp = data_dir() / "previews" / f"_tmp_{cache.stem}.obj"
            tmp.write_bytes(raw)
            try:
                stl_blob = decimate_obj_to_stl(tmp, max_tris=5_000_000)
            finally:
                try:
                    tmp.unlink()
                except Exception:
                    pass
            if not stl_blob:
                raise ValueError("Could not read OBJ for slicer 3MF")
            tris = _parse_binary_stl_tris(stl_blob)
        else:
            raise ValueError("Zip entry is not a printable mesh")
        blob = _tris_to_3mf_bytes(tris, Path(inner_name).stem)
        cache.write_bytes(blob)
        return blob, out_name

    out_name = f"{base_name}.3mf"
    if kind in ("3mf", "gcode.3mf"):
        return src.read_bytes(), out_name

    cache = cached_slicer_3mf_path(content_hash, kind)
    if cache.exists() and cache.stat().st_mtime >= src.stat().st_mtime and cache.stat().st_size > 64:
        return cache.read_bytes(), out_name

    if kind == "stl":
        tris = _parse_binary_stl_tris(src.read_bytes())
    elif kind == "obj":
        stl_blob = decimate_obj_to_stl(src, max_tris=5_000_000)
        if not stl_blob:
            raise ValueError("Could not read OBJ for slicer 3MF")
        tris = _parse_binary_stl_tris(stl_blob)
    else:
        raise ValueError(f"Cannot build slicer 3MF for kind={kind}")
    blob = _tris_to_3mf_bytes(tris, base_name)
    cache.write_bytes(blob)
    return blob, out_name


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


def read_zip_entry_bytes(src: Path, entry: str) -> tuple[bytes, str]:
    """Read bytes for a flat or nested (`outer.zip/inner.stl`) zip member."""
    from .parsers.ziparchive import split_nested_entry

    entry = safe_zip_entry(entry)
    nested, inner = split_nested_entry(entry)
    with zipfile.ZipFile(src, "r") as zf:
        names = {n.replace("\\", "/"): n for n in zf.namelist()}
        if nested:
            real_nested = names.get(nested)
            if real_nested is None:
                lower_map = {k.lower(): v for k, v in names.items()}
                real_nested = lower_map.get(nested.lower())
            if real_nested is None:
                raise FileNotFoundError(f"Nested zip not found: {nested}")
            raw_nested = zf.read(real_nested)
            with zipfile.ZipFile(io.BytesIO(raw_nested), "r") as inner_zf:
                inner_names = {n.replace("\\", "/"): n for n in inner_zf.namelist()}
                real = inner_names.get(inner)
                if real is None:
                    lower_map = {k.lower(): v for k, v in inner_names.items()}
                    real = lower_map.get(inner.lower())
                if real is None:
                    raise FileNotFoundError(f"Entry not found in nested zip: {inner}")
                return inner_zf.read(real), Path(inner).name
        real = names.get(entry)
        if real is None:
            lower_map = {k.lower(): v for k, v in names.items()}
            real = lower_map.get(entry.lower())
        if real is None:
            raise FileNotFoundError(f"Entry not found in zip: {entry}")
        return zf.read(real), Path(entry).name


def build_zip_entry_preview(
    asset: dict[str, Any],
    entry: str,
    max_tris: int = MAX_PREVIEW_TRIS,
) -> tuple[Path, bool]:
    """Extract one printable from a ZIP (or one level of nested ZIP) and build a preview STL."""
    if (asset.get("kind") or "") != "zip":
        raise ValueError("Not a zip asset")
    entry = safe_zip_entry(entry)
    from .parsers.ziparchive import split_nested_entry
    nested, inner = split_nested_entry(entry)
    mesh_name = inner if nested else entry
    ekind = entry_kind(mesh_name)
    if not ekind:
        raise ValueError("Zip entry is not a printable mesh (stl/obj/3mf)")

    src = Path(asset["abs_path"])
    content_hash = asset.get("content_hash") or src.name
    entry_key = hashlib.sha1(entry.encode("utf-8")).hexdigest()[:12]
    cache = cached_preview_path(str(content_hash), f"zip_{entry_key}_{ekind}", max_tris)
    if cache.exists() and cache.stat().st_mtime >= src.stat().st_mtime:
        return cache, True

    raw, file_name = read_zip_entry_bytes(src, entry)

    suffix = Path(mesh_name).suffix.lower() or ".bin"
    if mesh_name.lower().endswith(".gcode.3mf"):
        suffix = ".gcode.3mf"
    with tempfile.TemporaryDirectory(prefix="printshelf-zip-") as tmp:
        tmp_path = Path(tmp) / f"entry{suffix}"
        tmp_path.write_bytes(raw)
        fake = {
            "kind": ekind,
            "abs_path": str(tmp_path),
            "content_hash": f"{content_hash}_{entry_key}",
            "file_name": file_name,
        }
        # Build via temp file, then copy into stable cache key
        path, simplified = build_preview_stl(fake, max_tris=max_tris)
        data = path.read_bytes()
        cache.write_bytes(data)
        return cache, True
