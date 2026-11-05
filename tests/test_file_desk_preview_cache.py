"""Print Bay thumbnails from a printer: one download per file, one at a time per printer."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app import main


def test_printer_thumbnails_are_downloaded_once(monkeypatch):
    calls = []
    running = [0]
    peak = [0]

    async def fake_render(source_id, path, prefer_top):
        calls.append(path)
        running[0] += 1
        peak[0] = max(peak[0], running[0])
        await asyncio.sleep(0.02)
        running[0] -= 1
        return b"png-" + path.encode()

    monkeypatch.setattr(main, "_render_source_preview", fake_render)
    monkeypatch.setattr(main, "_find_bambu", lambda pid: SimpleNamespace(id=pid))
    main._source_preview_cache.clear()
    main._source_preview_locks.clear()

    async def go():
        paths = [f"job{i}.gcode.3mf" for i in range(6)]
        # The page asks for every thumbnail at once, then again on the next poll.
        for _ in range(3):
            await asyncio.gather(*(main.preview_file_desk_source("h2d", p, "top") for p in paths))

    asyncio.run(go())
    assert len(calls) == 6, f"expected one download per file, got {len(calls)}"
    assert peak[0] == 1, "downloads from one printer must not overlap"
    main._forget_bambu_file_list("h2d")
    assert not main._source_preview_cache
