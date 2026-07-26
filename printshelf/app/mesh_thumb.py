from __future__ import annotations

import math
from array import array
from io import BytesIO
from typing import Optional, Sequence

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None


Vec3 = tuple[float, float, float]
Tri = tuple[Vec3, Vec3, Vec3]


def sample_stride(n: int, max_tris: int = 140_000) -> int:
    if n <= max_tris:
        return 1
    return max(1, (n + max_tris - 1) // max_tris)


def _sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a: Vec3) -> Vec3:
    length = math.sqrt(_dot(a, a)) or 1.0
    return (a[0] / length, a[1] / length, a[2] / length)


def render_triangles_png(
    triangles: Sequence[Tri],
    *,
    size: int = 320,
    fill=(214, 163, 92),
    bg=(20, 28, 40),
) -> Optional[bytes]:
    """Solid shaded orthographic preview with z-buffer + 2x supersampling."""
    if Image is None or not triangles:
        return None

    min_v = [1e30, 1e30, 1e30]
    max_v = [-1e30, -1e30, -1e30]
    for a, b, c in triangles:
        for p in (a, b, c):
            for i in range(3):
                min_v[i] = min(min_v[i], p[i])
                max_v[i] = max(max_v[i], p[i])
    center = (
        (min_v[0] + max_v[0]) * 0.5,
        (min_v[1] + max_v[1]) * 0.5,
        (min_v[2] + max_v[2]) * 0.5,
    )
    extent = max(max_v[0] - min_v[0], max_v[1] - min_v[1], max_v[2] - min_v[2], 1e-6)

    yaw = math.radians(40)
    pitch = math.radians(-30)
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)

    def transform(p: Vec3) -> Vec3:
        x = (p[0] - center[0]) / extent
        y = (p[1] - center[1]) / extent
        z = (p[2] - center[2]) / extent
        x1 = x * cy + z * sy
        z1 = -x * sy + z * cy
        y2 = y * cp - z1 * sp
        z2 = y * sp + z1 * cp
        return (x1, y2, z2)

    light = _norm((0.55, 0.85, 0.4))
    ambient = 0.2
    rs = size * 2
    scale = rs * 0.82
    zbuf = array("f", [1e30]) * (rs * rs)
    bg_px = bytes((bg[0], bg[1], bg[2]))
    pixels = bytearray(bg_px * (rs * rs))
    ox = rs * 0.5
    oy = rs * 0.5

    for a0, b0, c0 in triangles:
        a = transform(a0)
        b = transform(b0)
        c = transform(c0)
        n = _norm(_cross(_sub(b, a), _sub(c, a)))

        ax, ay = ox + a[0] * scale, oy - a[1] * scale
        bx, by = ox + b[0] * scale, oy - b[1] * scale
        cx, cy_s = ox + c[0] * scale, oy - c[1] * scale
        az, bz, cz = -a[2], -b[2], -c[2]

        area = (bx - ax) * (cy_s - ay) - (by - ay) * (cx - ax)
        if abs(area) < 1e-6:
            continue
        # Y-flip can invert winding vs camera normals — fix screen winding only.
        if area < 0:
            bx, by, bz, cx, cy_s, cz = cx, cy_s, cz, bx, by, bz
            area = -area
        # Light the side facing the camera.
        if n[2] < 0:
            n = (-n[0], -n[1], -n[2])

        lambert = max(0.0, _dot(n, light))
        shade = ambient + (1.0 - ambient) * (0.22 + 0.78 * lambert)
        cr = min(255, int(fill[0] * shade))
        cg = min(255, int(fill[1] * shade))
        cb = min(255, int(fill[2] * shade + 14 * (1.0 - shade)))

        inv_area = 1.0 / area
        min_x = max(0, int(math.floor(min(ax, bx, cx))))
        max_x = min(rs - 1, int(math.ceil(max(ax, bx, cx))))
        min_y = max(0, int(math.floor(min(ay, by, cy_s))))
        max_y = min(rs - 1, int(math.ceil(max(ay, by, cy_s))))

        for y in range(min_y, max_y + 1):
            py = y + 0.5
            row = y * rs
            for x in range(min_x, max_x + 1):
                px = x + 0.5
                w0 = ((bx - px) * (cy_s - py) - (by - py) * (cx - px)) * inv_area
                w1 = ((cx - px) * (ay - py) - (cy_s - py) * (ax - px)) * inv_area
                w2 = 1.0 - w0 - w1
                if w0 < 0.0 or w1 < 0.0 or w2 < 0.0:
                    continue
                depth = w0 * az + w1 * bz + w2 * cz
                idx = row + x
                if depth >= zbuf[idx]:
                    continue
                zbuf[idx] = depth
                pi = idx * 3
                pixels[pi] = cr
                pixels[pi + 1] = cg
                pixels[pi + 2] = cb

    resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.LANCZOS)
    im = Image.frombytes("RGB", (rs, rs), bytes(pixels))
    im = im.resize((size, size), resample)
    buf = BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
