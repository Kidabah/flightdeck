from app.queue_load import decide_queue_load, match_queued_file


JOBS = [
    {"id": 11, "filename": "dragon.3mf", "file_path": "/queue/dragon.3mf", "printer_id": "x1c"},
    {"id": 12, "filename": "parts/dragon.3mf", "file_path": "/queue/other.3mf", "printer_id": "h2d"},
    {"id": 13, "filename": "basket.3mf", "file_path": "/queue/basket.3mf", "printer_id": "o1c2"},
]


def test_queue_load_prefers_stable_id_and_never_starts_print():
    result = decide_queue_load(
        JOBS,
        "13",
        file_exists=lambda path: path == "/queue/basket.3mf",
        printer_state=lambda _printer_id: "idle",
    )
    assert result["ok"] is True
    assert result["job"]["id"] == 13
    assert result["matched"] == "id"
    assert result["start_print"] is False


def test_queue_load_rejects_ambiguous_filename():
    result = match_queued_file(JOBS, "dragon.3mf")
    assert result["ok"] is False
    assert result["error"] == "multiple"
    assert {row["id"] for row in result["matches"]} == {11, 12}


def test_queue_load_rejects_missing_file_and_offline_printer():
    missing = decide_queue_load(
        JOBS,
        "13",
        file_exists=lambda _path: False,
        printer_state=lambda _printer_id: "idle",
    )
    assert missing["error"] == "missing_file"

    offline = decide_queue_load(
        JOBS,
        "13",
        file_exists=lambda _path: True,
        printer_state=lambda _printer_id: "offline",
    )
    assert offline["error"] == "printer_offline"
