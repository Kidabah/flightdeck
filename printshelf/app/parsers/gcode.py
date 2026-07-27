from __future__ import annotations

import base64
import re
from pathlib import Path
from typing import Any

# Header + Prusa embedded thumbs live near the start; footer meta near the end.
_HEAD_BYTES = 256 * 1024
_TAIL_BYTES = 32 * 1024

_THUMB_BEGIN = re.compile(
    r";\s*thumbnail(?:_PNG)?\s+begin\s+(\d+)x(\d+)\s+(\d+)",
    re.IGNORECASE,
)
_THUMB_END = re.compile(r";\s*thumbnail(?:_PNG)?\s+end", re.IGNORECASE)


def _comment_value(line: str) -> str | None:
    s = line.strip()
    if not s.startswith(";"):
        return None
    return s[1:].strip()


def _parse_kv_comments(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in text.splitlines():
        body = _comment_value(raw)
        if not body or "=" not in body:
            continue
        key, _, val = body.partition("=")
        key = key.strip().lower()
        val = val.strip()
        if key and val and key not in out:
            out[key] = val
        elif key and val:
            # Prefer later values (footer often has richer Prusa stats).
            out[key] = val
    return out


def _extract_cura_headers(text: str) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    bounds: dict[str, float] = {}
    for raw in text.splitlines():
        body = _comment_value(raw)
        if not body:
            continue
        upper = body.upper()
        if upper.startswith("FLAVOR:"):
            meta["flavor"] = body.split(":", 1)[1].strip()
        elif upper.startswith("TIME:"):
            try:
                secs = int(body.split(":", 1)[1].strip())
                meta["time_seconds"] = secs
                meta["print_time"] = _fmt_duration(secs)
            except ValueError:
                meta["print_time"] = body.split(":", 1)[1].strip()
        elif upper.startswith("FILAMENT USED:"):
            meta["filament_used"] = body.split(":", 1)[1].strip()
        elif upper.startswith("LAYER HEIGHT:"):
            meta["layer_height"] = body.split(":", 1)[1].strip()
        elif upper.startswith("LAYER_COUNT:"):
            try:
                meta["layer_count"] = int(body.split(":", 1)[1].strip())
            except ValueError:
                pass
        elif upper.startswith("GENERATED WITH"):
            meta["generator"] = body
        else:
            low = body.lower()
            for key in ("minx", "maxx", "miny", "maxy", "minz", "maxz"):
                if low.startswith(f"{key}:"):
                    try:
                        bounds[key] = float(body.split(":", 1)[1])
                    except ValueError:
                        pass
                    break
    if bounds:
        meta["bounds"] = bounds
    return meta

def _fmt_duration(secs: int) -> str:
    secs = max(0, int(secs))
    h, rem = divmod(secs, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m}m" if not s else f"{h}h {m}m {s}s"
    if m:
        return f"{m}m {s}s" if s else f"{m}m"
    return f"{s}s"


def _extract_prusa_thumb(text: str) -> bytes | None:
    """Pick the largest PNG thumbnail embedded in PrusaSlicer-style comments."""
    best: tuple[int, bytes] | None = None
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        m = _THUMB_BEGIN.search(lines[i])
        if not m:
            i += 1
            continue
        w, h, declared = int(m.group(1)), int(m.group(2)), int(m.group(3))
        i += 1
        chunks: list[str] = []
        while i < len(lines):
            if _THUMB_END.search(lines[i]):
                break
            body = _comment_value(lines[i]) or ""
            chunks.append(body.replace(" ", ""))
            i += 1
        b64 = "".join(chunks)
        try:
            raw = base64.b64decode(b64, validate=False)
        except Exception:
            i += 1
            continue
        if not raw.startswith(b"\x89PNG"):
            i += 1
            continue
        area = w * h
        if best is None or area > best[0]:
            best = (area, raw)
        # Prefer declared size when decode length is wildly off, but still keep PNG.
        _ = declared
        i += 1
    return best[1] if best else None


def _apply_prusa_footer(meta: dict[str, Any], kv: dict[str, str]) -> None:
    if "estimated printing time (normal mode)" in kv:
        meta["print_time"] = kv["estimated printing time (normal mode)"]
    elif "estimated printing time" in kv:
        meta["print_time"] = kv["estimated printing time"]
    if "filament used [g]" in kv:
        meta["filament_used_g"] = kv["filament used [g]"]
    if "filament used [mm]" in kv:
        meta["filament_used_mm"] = kv["filament used [mm]"]
    if "filament used [cm3]" in kv:
        meta["filament_used_cm3"] = kv["filament used [cm3]"]
    if "total filament used [g]" in kv:
        meta["filament_used_g"] = kv["total filament used [g]"]
    if "printer_model" in kv:
        meta["printer_model"] = kv["printer_model"]
    if "layer_height" in kv:
        meta["layer_height"] = kv["layer_height"]
    if "generated by" in kv:
        meta["generator"] = kv["generated by"]
    # First comment line often: "generated by PrusaSlicer …"
    for k, v in kv.items():
        if k.startswith("generated by"):
            meta["generator"] = f"{k} = {v}" if v else k
            break


def parse_gcode(path: Path) -> dict[str, Any]:
    size = path.stat().st_size
    with path.open("rb") as f:
        head = f.read(_HEAD_BYTES)
        tail = b""
        if size > _HEAD_BYTES:
            f.seek(max(0, size - _TAIL_BYTES))
            tail = f.read(_TAIL_BYTES)

    head_text = head.decode("utf-8", errors="ignore")
    tail_text = tail.decode("utf-8", errors="ignore") if tail else ""

    meta: dict[str, Any] = {"extension": path.suffix.lower()}
    # Generator sniff from first lines
    for raw in head_text.splitlines()[:40]:
        body = _comment_value(raw) or ""
        low = body.lower()
        if "prusaslicer" in low or "prusa slicer" in low:
            meta["generator"] = body if body.lower().startswith("generated") else "PrusaSlicer"
            break
        if "cura" in low and "generated" in low:
            meta["generator"] = body
            break
        if low.startswith("generated with cura"):
            meta["generator"] = body
            break

    meta.update(_extract_cura_headers(head_text))
    kv = _parse_kv_comments(head_text + "\n" + tail_text)
    _apply_prusa_footer(meta, kv)

    # First-line style: "; generated by PrusaSlicer …"
    for raw in head_text.splitlines()[:8]:
        body = _comment_value(raw) or ""
        if body.lower().startswith("generated by"):
            meta.setdefault("generator", body)
            break

    thumb = _extract_prusa_thumb(head_text)
    bbox = None
    bounds = meta.get("bounds")
    if isinstance(bounds, dict) and {"minx", "maxx", "miny", "maxy"}.issubset(bounds):
        bbox = {
            "min": [bounds.get("minx"), bounds.get("miny"), bounds.get("minz", 0)],
            "max": [bounds.get("maxx"), bounds.get("maxy"), bounds.get("maxz", 0)],
        }

    return {
        "kind": "gcode",
        "meta": meta,
        "bbox": bbox,
        "sidecars": [],
        "is_sliced": True,
        "thumb_bytes": thumb,
        "triangle_count": None,
        "has_textures": False,
    }
