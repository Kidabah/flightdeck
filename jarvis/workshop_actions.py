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
