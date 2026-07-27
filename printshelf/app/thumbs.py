from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional

try:
    from PIL import Image, ImageDraw
except Exception:  # pragma: no cover
    Image = None
    ImageDraw = None


def thumb_suffix(kind: str) -> str:
    if kind == "stl":
        return "stl5"
    if kind == "obj":
        return "obj4"
    if kind in ("3mf", "gcode.3mf"):
        return "3mf2"
    return kind or "file"


def thumb_filename(content_hash: str, kind: str) -> str:
    # Version suffixes bust caches when preview quality improves.
    return f"{content_hash[:16]}_{thumb_suffix(kind)}.png"


def resolve_thumb_name(
    thumbs_dir: Path,
    *,
    thumb_path: str | None,
    content_hash: str | None,
    kind: str | None,
) -> str | None:
    """Return an on-disk thumb filename, or None if nothing usable exists."""
    thumbs_dir = Path(thumbs_dir)
    if thumb_path:
        p = thumbs_dir / thumb_path
        if p.is_file() and p.stat().st_size > 0:
            return thumb_path
    if content_hash and kind:
        # Prefer current naming, then a few legacy names.
        candidates = [
            thumb_filename(content_hash, kind),
            f"{content_hash[:16]}_{kind}.png",
            f"{content_hash[:16]}_stl.png",
            f"{content_hash[:16]}_stl4.png",
            f"{content_hash[:16]}_obj.png",
            f"{content_hash[:16]}_obj2.png",
            f"{content_hash[:16]}_obj3.png",
            f"{content_hash[:16]}_3mf.png",
        ]
        seen: set[str] = set()
        for name in candidates:
            if name in seen:
                continue
            seen.add(name)
            p = thumbs_dir / name
            if p.is_file() and p.stat().st_size > 0:
                return name
    return None


def save_thumb_bytes(thumbs_dir: Path, content_hash: str, kind: str, data: bytes) -> Optional[str]:
    if not data:
        return None
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    name = thumb_filename(content_hash, kind)
    out = thumbs_dir / name
    # Prefer Pillow resize; fall back to writing the raw image bytes.
    if Image is not None:
        try:
            from io import BytesIO
            im = Image.open(BytesIO(data))
            im = im.convert("RGBA")
            im.thumbnail((320, 320))
            im.save(out, format="PNG")
            return name
        except Exception:
            pass
    try:
        out.write_bytes(data)
        return name
    except Exception:
        return None


def make_placeholder_thumb(thumbs_dir: Path, content_hash: str, kind: str, label: str) -> Optional[str]:
    if Image is None or ImageDraw is None:
        return None
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    name = thumb_filename(content_hash, kind)
    out = thumbs_dir / name
    if out.exists():
        return name
    # deterministic colour from hash
    h = hashlib.md5(content_hash.encode("utf-8")).hexdigest()
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    im = Image.new("RGBA", (320, 320), (20, 28, 40, 255))
    draw = ImageDraw.Draw(im)
    draw.rounded_rectangle((24, 24, 296, 296), radius=28, fill=(r // 3 + 40, g // 3 + 50, b // 3 + 60, 255))
    draw.text((40, 140), (label or kind).upper()[:12], fill=(240, 245, 255, 255))
    im.save(out, format="PNG")
    return name
