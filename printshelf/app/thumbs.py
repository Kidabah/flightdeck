from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional

try:
    from PIL import Image, ImageDraw
except Exception:  # pragma: no cover
    Image = None
    ImageDraw = None


def thumb_filename(content_hash: str, kind: str) -> str:
    # Version suffixes bust caches when preview quality improves.
    if kind == "stl":
        kind = "stl5"
    elif kind == "obj":
        kind = "obj4"
    return f"{content_hash[:16]}_{kind}.png"


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
