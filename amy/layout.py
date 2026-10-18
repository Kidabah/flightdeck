"""Deterministic UI layout commands for Amy's viewer."""
from __future__ import annotations

import re


_NOTEBOOK_UNDER_FOLDERS = re.compile(
    r"\b(?:move|put|place|position|rearrange|reorder|set)\b.*\bnotebook\b.*"
    r"\b(?:under|underneath|below|beneath)\b.*\bfolders?\b",
    re.IGNORECASE | re.DOTALL,
)
_FOLDERS_COLLAPSE = re.compile(
    r"\b(?:collapse|hide|minimi[sz]e|close)\b.*\bfolders?\b(?:\s+panel|\s+shelf|\s+section)?\b",
    re.IGNORECASE,
)
_FOLDERS_EXPAND = re.compile(
    r"\b(?:expand|show|open|restore)\b.*\bfolders?\b(?:\s+panel|\s+shelf|\s+section)?\b",
    re.IGNORECASE,
)
_FOLDERS_ALPHABETIZE = re.compile(
    r"\b(?:alphabeti[sz]e|sort)\b.*\bfolders?\b|\bfolders?\b.*\b(?:alphabeti[sz]e|sort)\b",
    re.IGNORECASE,
)
_SIDEBAR_ENTRIES_ALPHABETIZE = re.compile(
    r"\b(?:alphabeti[sz]e|sort)\b.*\b(?:file names?|entries|items)\b.*\b(?:desktop|sidebar|amy)\b"
    r"|\b(?:desktop|sidebar|amy)\b.*\b(?:file names?|entries|items)\b.*\b(?:alphabeti[sz]e|sort)\b",
    re.IGNORECASE,
)
_SIDEBAR_ENTRIES_CAPITALIZE = re.compile(
    r"\b(?:capitali[sz]e|uppercase|title[- ]case)\b.*\b(?:file names?|entries|items|words?)\b"
    r"|\b(?:file names?|entries|items|words?)\b.*\b(?:capitali[sz]e|uppercase|title[- ]case)\b",
    re.IGNORECASE,
)
_TICKER_UNDER_NOTES = re.compile(
    r"\b(?:move|put|place|position|reposition)\b.*\b(?:ticker|usage ticker|api usage)\b.*"
    r"\b(?:under|underneath|below|beneath|bottom of)\b.*\b(?:notes?|folders?|notebook|sidebar|left(?:-hand)? panel|left rail)\b"
    r"|\b(?:ticker|usage ticker|api usage)\b.*\b(?:under|underneath|below|beneath|bottom of)\b.*\b(?:notes?|folders?|notebook|sidebar|left(?:-hand)? panel|left rail)\b",
    re.IGNORECASE,
)
_PANEL_NAMES = r"usage ticker|api usage|ticker|notebook|folders? panel|folders?|notes? panel|notes?|chat|conversation|search|camera(?: panel)?|amy|face"
_TARGET_NAMES = r"notes?|folders?|notebook|ticker|left(?: notes)? rail|right(?: rail)?|center|centre|hud|amy|chat|top|bottom"
_UI_MOVE = re.compile(
    rf"\b(?:move|put|place|position|reposition|rearrange)\s+(?:the\s+)?(?P<panel>{_PANEL_NAMES})\b"
    rf"\s+(?P<relation>underneath|under|below|beneath|above|over|before|after|inside|into|to)\s+(?:the\s+)?(?P<target>{_TARGET_NAMES})\b",
    re.IGNORECASE,
)
_UI_VISIBILITY = re.compile(
    rf"\b(?P<operation>show|open|restore|hide|close|remove)\s+(?:the\s+)?(?P<panel>{_PANEL_NAMES})\b",
    re.IGNORECASE,
)
_UI_RESIZE = re.compile(
    rf"\b(?:make|set|resize)\s+(?:the\s+)?(?P<panel>{_PANEL_NAMES})\b\s*(?P<size>bigger|larger|smaller|compact|small|large)\b"
    rf"|\b(?P<size2>bigger|larger|smaller|compact|small|large)\s+(?:the\s+)?(?P<panel2>{_PANEL_NAMES})\b",
    re.IGNORECASE,
)
_UI_RESET = re.compile(r"\b(?:reset|restore)\s+(?:the\s+)?(?:default\s+)?(?:window|ui|interface|layout)\b", re.IGNORECASE)


def _panel_key(raw: str) -> str:
    value = re.sub(r"\s+", " ", str(raw or "").strip().lower())
    if value in {"ticker", "usage ticker", "api usage"}:
        return "ticker"
    if value in {"folder", "folders", "folders panel"}:
        return "folders"
    if value in {"note", "notes", "notes panel"}:
        return "notes"
    if value in {"chat", "conversation"}:
        return "chat"
    if value in {"camera", "camera panel"}:
        return "camera"
    if value in {"amy", "face"}:
        return "hud"
    return value


def _target_key(raw: str) -> str:
    value = re.sub(r"\s+", " ", str(raw or "").strip().lower())
    if value in {"left rail", "left notes rail", "notes", "note"}:
        return "notes"
    if value in {"folder", "folders"}:
        return "folders"
    if value in {"centre", "center", "hud", "amy"}:
        return "hud"
    return _panel_key(value)


def _generic_ui_request(question: str) -> dict | None:
    q = " ".join(str(question or "").strip().split())
    if _UI_RESET.search(q):
        return {"ui_action": "reset"}
    moved = _UI_MOVE.search(q)
    if moved:
        panel = _panel_key(moved.group("panel"))
        target = _target_key(moved.group("target"))
        if panel == "folders" and target == "notebook":
            return None
        return {
            "ui_action": "move",
            "panel": panel,
            "target": target,
            "relation": moved.group("relation").lower(),
        }
    visibility = _UI_VISIBILITY.search(q)
    if visibility:
        operation = visibility.group("operation").lower()
        return {"ui_action": "show" if operation in {"show", "open", "restore"} else "hide", "panel": _panel_key(visibility.group("panel"))}
    resized = _UI_RESIZE.search(q)
    if resized:
        panel = resized.group("panel") or resized.group("panel2")
        size = resized.group("size") or resized.group("size2")
        normalized = {"bigger": "large", "larger": "large", "smaller": "small", "compact": "small"}.get(size.lower(), size.lower())
        return {"ui_action": "resize", "panel": _panel_key(panel), "size": normalized}
    return None


def layout_kind(question: str) -> str | None:
    """Return a stable UI action name for explicit layout requests."""
    q = " ".join(str(question or "").strip().split())
    if _NOTEBOOK_UNDER_FOLDERS.search(q):
        return "notebook_under_folders"
    if _FOLDERS_COLLAPSE.search(q):
        return "folders_collapsed"
    if _FOLDERS_EXPAND.search(q):
        return "folders_expanded"
    if _SIDEBAR_ENTRIES_ALPHABETIZE.search(q):
        return "sidebar_entries_alphabetized"
    if _SIDEBAR_ENTRIES_CAPITALIZE.search(q):
        return "sidebar_entries_capitalized"
    if _TICKER_UNDER_NOTES.search(q):
        return "ticker_under_notes"
    generic = _generic_ui_request(q)
    if generic:
        return "ui_control"
    if _FOLDERS_ALPHABETIZE.search(q):
        return "folders_alphabetized"
    return None


def layout_response(question: str) -> dict:
    kind = layout_kind(question)
    generic = _generic_ui_request(question) if kind == "ui_control" else None
    answers = {
        "notebook_under_folders": "Done — I moved the Notebook underneath Folders, Chris.",
        "folders_collapsed": "Done — I collapsed the Folders panel, Chris.",
        "folders_expanded": "Done — I expanded the Folders panel, Chris.",
        "folders_alphabetized": "Done — I alphabetized the folder names and notes, Chris.",
        "sidebar_entries_alphabetized": "Done — I alphabetized the entries in Amy's sidebar, including Amy Desktop and Amy Files, Chris.",
        "sidebar_entries_capitalized": "Done — I capitalized the sidebar entries for you, Chris. The saved notes remain unchanged.",
        "ticker_under_notes": "Done — I moved the usage ticker underneath the notes, Chris.",
    }
    if kind not in answers:
        if not generic:
            raise ValueError("Unsupported layout request")
        panel = generic.get("panel", "the panel")
        labels = {"folders": "Folders", "notes": "Notes", "notebook": "Notebook", "ticker": "usage ticker", "hud": "Amy", "chat": "chat", "camera": "camera panel"}
        label = labels.get(panel, panel)
        if generic["ui_action"] == "move":
            target = labels.get(generic.get("target"), generic.get("target", "the requested area"))
            answer = f"Done — I moved the {label} {generic.get('relation', 'under')} {target}, Chris."
        elif generic["ui_action"] == "show":
            answer = f"Done — I showed the {label}, Chris."
        elif generic["ui_action"] == "hide":
            answer = f"Done — I hid the {label}, Chris."
        elif generic["ui_action"] == "resize":
            answer = f"Done — I set the {label} to {generic.get('size')}, Chris."
        else:
            answer = "Done — I restored Amy's default window layout, Chris."
        return {
            "answer": answer, "nodes": [], "move_camera": False, "tool": "layout", "layout": kind, "ok": True, **generic,
        }
    return {
        "answer": answers[kind],
        "nodes": [],
        "move_camera": False,
        "tool": "layout",
        "layout": kind,
        "ok": True,
    }
