from __future__ import annotations

import struct
from pathlib import Path
from typing import Any


def parse_stl(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    n_tri = 0
    bbox = None
    binary = False
    try:
        if len(data) >= 84:
            n = struct.unpack_from("<I", data, 80)[0]
            expected = 84 + n * 50
            if expected == len(data) or (n > 0 and expected <= len(data) + 50):
                binary = True
                n_tri = n
                mins = [1e30, 1e30, 1e30]
                maxs = [-1e30, -1e30, -1e30]
                off = 84
                for _ in range(min(n_tri, 2_000_000)):
                    if off + 50 > len(data):
                        break
                    # normal + 3 verts
                    for vi in range(3):
                        x, y, z = struct.unpack_from("<fff", data, off + 12 + vi * 12)
                        mins[0] = min(mins[0], x); maxs[0] = max(maxs[0], x)
                        mins[1] = min(mins[1], y); maxs[1] = max(maxs[1], y)
                        mins[2] = min(mins[2], z); maxs[2] = max(maxs[2], z)
                    off += 50
                if n_tri:
                    bbox = {"min": mins, "max": maxs}
    except Exception:
        binary = False

    if not binary:
        text = data.decode("utf-8", "ignore")
        n_tri = text.lower().count("facet normal")
        # light bbox skip for ascii

    return {
        "kind": "stl",
        "triangle_count": n_tri,
        "bbox": bbox,
        "meta": {"encoding": "binary" if binary else "ascii"},
        "sidecars": [],
        "thumb_bytes": None,
        "is_sliced": False,
        "has_textures": False,
    }
