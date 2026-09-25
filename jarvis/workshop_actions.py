"""Exact workshop commands. They never start or send a print."""
from __future__ import annotations

import re
from typing import Any

_PREFIX = re.compile(
    r"^(?:hey|hi|ok|yo|amy|please|just|can you|could you|would you|will you)\s+"
)
_TAIL = re.compile(r"\s+(?:please|now|thanks|thank you)$")

# AMS HT's first bay is Bambu tray 128. A spoken "slot 2" on the HT is 129.
AMS_HT_BASE = 128


def _clean(question: str) -> str:
    q = (question or "").lower().replace("\u2019", "'")
    q = q.replace("number", " ").replace("#", " ")
    q = re.sub(r"[^a-z0-9.'\" _+-]+", " ", q)
    q = re.sub(r"\s+", " ", q).strip()
    for _ in range(6):
        nxt = _PREFIX.sub("", q)
        if nxt == q:
            break
        q = nxt
    for _ in range(3):
        nxt = _TAIL.sub("", q)
        if nxt == q:
            break
        q = nxt.strip()
    return q


# Spoken page, hash, label. Longest names first so "print bay" beats "files".
FLIGHTDECK_PAGES: tuple[tuple[str, str, str], ...] = (
    ("global print bay", "#/files", "Global Print Bay"),
    ("print vault", "#/files", "Global Print Bay"),
    ("print bay", "#/files", "Global Print Bay"),
    ("flight tower", "#/mission", "Flight Tower"),
    ("fleet wall", "#/fleet", "Fleet Wall"),
    ("fleet filament", "#/filament", "Fleet Filament"),
    ("print memory", "#/memory", "Print Memory"),
    ("stl painter", "#/painter", "STL Painter"),
    ("mesh prep", "#/meshprep", "Mesh Prep"),
    ("flight manual", "#/manual", "Flight Manual"),
    ("makerworld", "#/makerworld", "MakerWorld"),
    ("makerdeck", "#/makerdeck", "MakerDeck"),
    ("walkthrough", "#/walkthrough", "Walkthrough"),
    ("telemetry", "#/stats", "Telemetry"),
    ("dashboard", "#/", "Dashboard"),
    ("queue", "#/queue", "Queue"),
    ("spools", "#/spools", "Spools"),
    ("projects", "#/projects", "Projects"),
    ("settings", "#/settings", "Settings"),
    ("filament", "#/filament", "Fleet Filament"),
    ("painter", "#/painter", "STL Painter"),
    ("cameras", "#/fleet", "Fleet Wall"),
    ("chop", "#/chop", "Chop"),
    ("about", "#/about", "About"),
    ("manual", "#/manual", "Flight Manual"),
    ("stats", "#/stats", "Telemetry"),
    ("files", "#/files", "Global Print Bay"),
    ("mission", "#/mission", "Flight Tower"),
    ("memory", "#/memory", "Print Memory"),
)

FLIGHTDECK_PRINTERS: tuple[tuple[str, str, str], ...] = (
    ("big girl", "o1c2", "Big Girl"),
    ("biggirl", "o1c2", "Big Girl"),
    ("big boy", "h2d", "BigBoy"),
    ("bigboy", "h2d", "BigBoy"),
    ("greyhound", "greyhound", "Greyhound"),
    ("voron", "greyhound", "Greyhound"),
    ("little boy", "x1c", "Little Boy"),
    ("o1c2", "o1c2", "Big Girl"),
    ("h2d", "h2d", "BigBoy"),
    ("x1c", "x1c", "X1C"),
)


def parse_flightdeck_page(question: str) -> dict[str, str] | None:
    """Open a page inside the Flightdeck window. Never a print start."""
    q = _clean(question)
    if not q:
        return None
    if re.search(r"\b(pause|resume|stop|cancel|abort)\b", q):
        return None
    if re.search(r"\bgo\s+(small|big|large|away)\b", q):
        return None
    if not re.search(r"\b(open|show|switch|go|pull|bring)\b", q):
        return None
    for key, href, label in FLIGHTDECK_PAGES:
        if re.search(rf"\b{re.escape(key)}\b", q):
            return {"hash": href, "label": label}
    for alias, pid, label in FLIGHTDECK_PRINTERS:
        if re.search(rf"\b{re.escape(alias)}\b", q):
            return {"hash": f"#/printer/{pid}", "label": label}
    return None


def parse_open_folder(question: str) -> str | None:
    """Any folder they name. Not a Flightdeck page, and not a print start."""
    raw = question or ""
    path_match = re.search(
        r"(?i)\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?(?:folder\s+)?([a-z]:\\[^\n]+|\\\\[^\n]+)",
        raw,
    )
    if path_match:
        folder = path_match.group(1).strip().strip("\"'").rstrip(" .,")
        folder = re.split(r"(?i)\s+\band\b\s+", folder, maxsplit=1)[0].strip()
        return folder or None
    q = _clean(question)
    if not q or not re.search(r"\b(open|show)\b", q):
        return None
    if re.search(r"\b(pause|resume|stop|cancel|abort)\b", q):
        return None
    head = re.split(r"\s+\band\b\s+", q, maxsplit=1)[0].strip()
    named = re.search(r"\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?folder\s+(.+)$", head)
    if named:
        folder = named.group(1).strip(" \"'")
        if folder and folder not in {"a", "an", "some", "any", "it", "that", "this"}:
            return folder
    trailing = re.search(r"\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?(.+?)\s+(?:folder|directory)$", head)
    if trailing:
        folder = trailing.group(1).strip(" \"'")
        folder = re.sub(r"^(?:my|the)\s+", "", folder)
        if folder and folder not in {"a", "an", "some", "any"}:
            return folder
    if re.search(r"\b(queue|flightdeck|printer)\b", head):
        return None
    place = re.search(
        r"\b(?:open|show)\s+(?:me\s+)?(?:my\s+|the\s+)?(desktop|documents|docs|downloads|download|pictures|videos|music|onedrive)$",
        head,
    )
    if place:
        return place.group(1)
    drive = re.search(r"\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?([a-z])\s+drive$", head)
    if drive:
        return f"{drive.group(1).upper()}:\\"
    return None


def parse_queue_local_file(question: str) -> dict[str, Any] | None:
    """Queue a named file on a printer. Does not start a print.

    'queue pla box on BigBoy' or
    'open desktop 3mf bedscraper_pla and queue it on BigBoy'.
    """
    q = _clean(question)
    if not q or not re.search(r"\b(queue|que|cue)\b", q):
        return None
    if re.search(r"\b(send|start)\s+(?:the\s+)?print\b", q):
        return None
    if re.fullmatch(r"(?:open|show|go to|switch to)\s+(?:the\s+)?(?:flightdeck\s+)?queue", q):
        return None
    printer_id = ""
    printer_label = ""
    printer_alias = ""
    for alias, pid, label in FLIGHTDECK_PRINTERS:
        if re.search(rf"\b{re.escape(alias)}\b", q):
            printer_id = pid
            printer_label = label
            printer_alias = alias
            break
    if not printer_id:
        return None
    rest = re.sub(rf"\b{re.escape(printer_alias)}\b", " ", q)
    rest = re.sub(r"\s+", " ", rest).strip()
    opened = re.search(
        r"\b(?:open|grab|get|use)\s+(.+?)\s+and\s+(?:queue|que|cue)\b",
        rest,
    )
    if opened:
        phrase = opened.group(1)
    else:
        queued = re.search(r"\b(?:queue|que|cue|put|add)\s+(.+)$", rest)
        if not queued:
            return None
        phrase = re.sub(r"\b(?:in|on|to|for)\b.*$", "", queued.group(1)).strip()
    skip = {"the", "my", "a", "it", "that", "this", "file", "please", "printer", "flightdeck"}
    tokens = [part for part in phrase.split() if part not in skip]
    if not tokens or tokens == ["print"]:
        return None
    places = {"desktop", "documents", "docs", "downloads", "download", "pictures", "videos", "music", "onedrive"}
    if tokens[0] in places and len(tokens) >= 2:
        folders, filename = tokens[:-1], tokens[-1]
    else:
        folders, filename = [], " ".join(tokens)
    return {
        "folders": folders,
        "file": filename,
        "printer_id": printer_id,
        "printer_label": printer_label,
    }


def match_named_files(names: list[str], query: str) -> list[str]:
    """Filenames whose stem contains the spoken name. Case and punctuation ignored."""
    needle = re.sub(r"[^a-z0-9]+", "", (query or "").lower())
    if not needle:
        return []
    hits: list[str] = []
    for name in names:
        stem = name.lower()
        for ext in (".gcode.3mf", ".gcode.gz", ".3mf", ".gcode", ".stl"):
            if stem.endswith(ext):
                stem = stem[: -len(ext)]
                break
        folded = re.sub(r"[^a-z0-9]+", "", stem)
        if needle in folded:
            hits.append(name)
    return hits


def parse_queue_load(question: str) -> str | None:
    """'open the queue in Flightdeck and load file <name>'."""
    q = _clean(question)
    if "load" not in q or "file" not in q:
        return None
    if "queue" not in q and "flightdeck" not in q:
        return None
    patterns = (
        r"(?:open|show)\s+(?:the\s+)?queue(?:\s+in\s+flightdeck)?\s+and\s+load\s+file\s+(.+)$",
        r"load\s+file\s+(.+?)\s+(?:in|on|into|from)\s+(?:the\s+)?(?:flightdeck\s+)?queue$",
        r"(?:open|show)\s+flightdeck(?:\s+queue)?\s+and\s+load\s+file\s+(.+)$",
    )
    name = ""
    for pattern in patterns:
        match = re.search(pattern, q)
        if match:
            name = match.group(1).strip(" \"'")
            break
    if not name or name in {"it", "that", "this", "the file"}:
        return None
    return name


def parse_spool_change(question: str) -> dict[str, Any] | None:
    """'change filament spool 12 in BigBoy AMS HT'."""
    q = _clean(question)
    if "spool" not in q:
        return None
    if not re.search(r"\b(change|set|move|put|swap|load)\b", q):
        return None
    if "ams" not in q:
        return None
    match = re.search(r"\bspool\s+(\d+)\b", q)
    if not match:
        return None
    slot = ams_slot(q)
    if slot is None:
        return None
    return {"spool_number": int(match.group(1)), "slot": slot, "ams_ht": "ams ht" in q}


def ams_slot(text: str) -> int | None:
    """Spoken AMS slot. AMS HT with no slot number is the HT bay."""
    q = _clean(text) if "spool" in text.lower() or not text.islower() else text
    # _clean already lowercases. Callers may pass a cleaned string.
    q = text.lower().replace("\u2019", "'")
    q = re.sub(r"\s+", " ", q)
    ht = re.search(r"\bams\s*ht\b", q)
    slot_match = re.search(r"\bslot\s+(\d+)\b", q)
    if ht:
        if slot_match:
            return AMS_HT_BASE + int(slot_match.group(1)) - 1
        return AMS_HT_BASE
    if slot_match:
        number = int(slot_match.group(1))
        if number < 1:
            return None
        return number - 1
    return None


def explicit_printer_control(question: str, has_printer: bool) -> str | None:
    """Pause, resume, or stop a print. Music commands stay with Spotify."""
    q = _clean(question)
    if re.search(r"\b(music|spotify|song|track)\b", q) and not re.search(r"\b(print|printer|job)\b", q):
        return None
    if re.search(r"\bpause\b", q):
        action = "pause"
    elif re.search(r"\b(resume|continue)\b", q):
        action = "resume"
    elif re.search(r"\b(stop|cancel|abort)\b", q) and re.search(r"\b(print|printer|job)\b", q):
        action = "stop"
    else:
        return None
    if has_printer or re.search(r"\b(print|printer|job)\b", q):
        return action
    return None


def asks_to_print(question: str) -> bool:
    """A load or a spool change must not also start a print."""
    q = _clean(question)
    return bool(re.search(r"\b(print|send|start)\b", q))
