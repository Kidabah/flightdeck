from __future__ import annotations

from io import BytesIO
from typing import Optional, Sequence

try:
    from PIL import Image, ImageDraw
except Exception:  # pragma: no cover
    Image = None
    ImageDraw = None


def render_triangles_png(
    triangles: Sequence[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]],
    *,
    size: int = 320,
    fill=(214, 163, 92, 235),
    edge=(40, 32, 28, 90),
    bg=(20, 28, 40, 255),
) -> Optional[bytes]:
    """Simple isometric preview from triangle list. Returns PNG bytes."""
    if Image is None or ImageDraw is None or not triangles:
        return None

    def project(x: float, y: float, z: float) -> tuple[float, float, float]:
        px = (x - z) * 0.8660254
        py = y + (x + z) * 0.2
        depth = -(x + y + z)
        return px, py, depth

    projected = []
    min_x = min_y = 1e30
    max_x = max_y = -1e30
    for a, b, c in triangles:
        pa, pb, pc = project(*a), project(*b), project(*c)
        projected.append((pa, pb, pc))
        for p in (pa, pb, pc):
            min_x = min(min_x, p[0])
            max_x = max(max_x, p[0])
            min_y = min(min_y, p[1])
            max_y = max(max_y, p[1])

    w = max(max_x - min_x, 1e-6)
    h = max(max_y - min_y, 1e-6)
    pad = 28
    scale = (size - pad * 2) / max(w, h)

    def to_screen(p):
        x = (p[0] - min_x - w / 2) * scale + size / 2
        y = size / 2 - (p[1] - min_y - h / 2) * scale
        return (x, y)

    projected.sort(key=lambda t: (t[0][2] + t[1][2] + t[2][2]) / 3)

    im = Image.new("RGBA", (size, size), bg)
    draw = ImageDraw.Draw(im, "RGBA")
    for a, b, c in projected:
        poly = [to_screen(a), to_screen(b), to_screen(c)]
        (x1, y1), (x2, y2), (x3, y3) = poly
        cross = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1)
        lum = 0.72 if cross >= 0 else 0.48
        col = (int(fill[0] * lum), int(fill[1] * lum), int(fill[2] * lum), fill[3])
        draw.polygon(poly, fill=col, outline=edge)

    buf = BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def sample_stride(n: int, max_tris: int = 40_000) -> int:
    if n <= max_tris:
        return 1
    return max(1, (n + max_tris - 1) // max_tris)
