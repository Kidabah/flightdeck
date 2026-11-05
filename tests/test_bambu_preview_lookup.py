"""Bambu job-file lookup for skip objects: H2D NLST fallback, safe matching, retry."""
from __future__ import annotations

import ftplib
import time
from types import SimpleNamespace

import pytest

from app.printers import bambu, bambu_ftp
from app.printers.bambu_ftp import _best_storage_match, _root_entries


class _NoMlsdFtp:
    """Mimics the H2D: MLSD rejected, NLST works."""

    def __init__(self, names):
        self.names = names

    def mlsd(self, path):
        raise ftplib.error_perm("500 Unknown command.")

    def nlst(self, path):
        return list(self.names)


def test_root_entries_falls_back_to_nlst_when_mlsd_is_rejected():
    ftp = _NoMlsdFtp(["/a.gcode.3mf", "b.3mf", "timelapse"])
    assert _root_entries(ftp) == [("a.gcode.3mf", {}), ("b.3mf", {}), ("timelapse", {})]


def test_undated_listing_matches_unique_name_variant():
    entries = [("Shelf_PLA_3h52m.gcode.3mf", {}), ("Other.gcode.3mf", {})]
    assert _best_storage_match(entries, "Shelf") == "Shelf_PLA_3h52m.gcode.3mf"


def test_undated_listing_refuses_ties_and_blind_guesses():
    tie = [("Shelf_PLA_3h52m.gcode.3mf", {}), ("Shelf_PLA_40m3s.gcode.3mf", {})]
    assert _best_storage_match(tie, "Shelf") is None
    unrelated = [("Other.gcode.3mf", {}), ("Else.gcode.3mf", {})]
    assert _best_storage_match(unrelated, "Trapezoidal_blade_scraper") is None


def test_dated_listing_keeps_newest_guess():
    entries = [("Old.gcode.3mf", {"modify": "20260101"}), ("New.gcode.3mf", {"modify": "20261104"})]
    assert _best_storage_match(entries, "Missing") == "New.gcode.3mf"


def _printer(monkeypatch, fetch):
    p = bambu.BambuPrinter.__new__(bambu.BambuPrinter)
    p.id, p.model_name, p._ip, p._access_code = "h2d", "H2D", "x", "x"
    p._connected = True
    p._preview_cache = None
    p._preview_miss_at = 0.0
    p._preview_missing = False
    p._printer = SimpleNamespace(
        subtask_name=lambda: "Trapezoidal_blade_scraper",
        get_file_name=lambda: "/data/Metadata/plate_1.gcode",
        mqtt_client=SimpleNamespace(get_skipped_objects=lambda: []),
    )
    monkeypatch.setattr(bambu_ftp, "fetch_bambu_preview", fetch)
    return p


def test_missing_file_is_explained_and_retried(monkeypatch):
    calls = []
    p = _printer(monkeypatch, lambda *a, **k: calls.append(1))
    out = p.get_objects()
    assert out["file_missing"] is True and "SD card" in out["detail"]
    p.get_objects()
    assert len(calls) == 1, "should not hit FTP again inside the retry window"
    p._preview_miss_at = time.monotonic() - bambu._BAMBU_PREVIEW_RETRY_SECONDS - 1
    p.get_objects()
    assert len(calls) == 2


def test_seeded_preview_is_used_without_ftp(monkeypatch):
    p = _printer(monkeypatch, lambda *a, **k: pytest.fail("FTP fetch not expected"))
    seeded = SimpleNamespace(filament_weight_g=10, objects=[{"id": 1}, {"id": 2}],
                             plate_bounds=None, bed_bounds=None, bbox_all=None)
    p.seed_preview("Trapezoidal_blade_scraper", seeded)
    out = p.get_objects()
    assert out["supported"] is True and [o["id"] for o in out["objects"]] == [1, 2]
