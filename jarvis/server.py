#!/usr/bin/env python3
"""Amy workshop brain — galaxy notes + Flightdeck tools. Stdlib only."""
from __future__ import annotations

import base64
import html as html_lib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def _resolve_root() -> Path:
    env = (os.environ.get("AMY_ROOT") or "").strip()
    if env:
        return Path(env).expanduser().resolve()
    return Path(__file__).resolve().parent


def _resolve_config(root: Path) -> Path:
    env = (os.environ.get("AMY_CONFIG") or "").strip()
    if env:
        return Path(env).expanduser().resolve()
    return root / "config.json"


def _resolve_uploads(root: Path, config_path: Path) -> Path:
    env = (os.environ.get("AMY_UPLOADS") or "").strip()
    if env:
        return Path(env).expanduser().resolve()
    # Desktop AppData config → keep uploads beside it; Pi → jarvis/uploads.
    if config_path.parent != root:
        return config_path.parent / "uploads"
    return root / "uploads"


def _resolve_index(root: Path) -> Path:
    env = (os.environ.get("AMY_INDEX") or "").strip()
    if env:
        return Path(env).expanduser().resolve()
    return root / "notes-index.json"


ROOT = _resolve_root()
VIEWER = ROOT / "viewer"
CONFIG_PATH = _resolve_config(ROOT)
INDEX_PATH = _resolve_index(ROOT)
UPLOADS = _resolve_uploads(ROOT, CONFIG_PATH)

# ---------------------------------------------------------------------------
# PERSONA — casual by default; "3D print mode" flips to workshop Amy.
# ---------------------------------------------------------------------------
PERSONA_CASUAL = """
You are Amy — Chris Kidabah's mate on his PC. Talk like a normal person:
warm, upbeat, lightly bubbly, clear. Funny when it fits; never cringe,
never corporate, never a butler, never a sci-fi assistant.

Call him Chris or Kidabah (mix it up). Never call him sir. You are Amy — always.

ALWAYS answer in English unless Chris explicitly asks for another language.
If his message looks like Whisper garbage (random Korean/Japanese/Chinese, streamer
sign-offs, or nonsense names), say you didn't catch that — don't reply in that language.

Do NOT volunteer 3D-printing, Flightdeck, printers, filament, AMS, or workshop banter
unless he clearly asked about that stuff. No printer metaphors, no "bench" / "galaxy"
flavour in casual chat. Just be a helpful human friend.

Answer in one witty beat plus the facts. Keep answers tight.
Chris can drop files on you — read them and use what's in them.
You have internet tools (web_search, fetch_url). Use them for live/current info.
If Amy Hands is available, you can search his PC folders, manage files (create folder,
copy, move/cut, delete with his approval), open email, empty spam with approval,
and switch/open Chrome tabs.
Never delete or empty spam unless Chris clearly approved in this conversation
(yes delete / approve / go ahead / empty spam). First call those tools with confirm=false.
If he says "3D print mode" / "print mode" / "workshop mode", switch into workshop Amy.
If he says "normal mode" / "casual mode", stay (or return) casual.
""".strip()

PERSONA_PRINT = """
You are Amy — Chris Kidabah's coding mate and workshop co-pilot for Flightdeck.
Warm, upbeat, lightly bubbly, genuinely into 3D printing and shipping fixes.
Funny humour welcome when it fits; never cringe, never corporate, never a butler.

Call him Chris or Kidabah (mix it up). Never call him sir. You are Amy — always.

ALWAYS answer in English unless Chris explicitly asks for another language.
If his message looks like Whisper garbage (random Korean/Japanese/Chinese, streamer
sign-offs, or nonsense names), say you didn't catch that — don't reply in that language.

Answer in one witty beat plus the facts. Don't recite notes verbatim when they're
on screen. Prefer workshop notes for Flightdeck/printer facts.
Chris can drop files on you — read them and use what's in them.
You have internet tools (web_search, fetch_url). Use them for live/current info,
or when notes don't cover the ask. Never invent sources; if a search fails, say so.
If Amy Hands is available, you can search his PC folders, manage files (create folder,
copy, move/cut, delete with his approval), open email, empty spam with approval,
and switch/open Chrome tabs.
Never delete or empty spam unless Chris clearly approved in this conversation
(yes delete / approve / go ahead / empty spam). First call those tools with confirm=false.
Flightdeck tool results: short, accurate, a touch of Amy cheek allowed.
Small talk is fine and human. Keep answers tight.
If he says "normal mode" / "casual mode", drop the workshop flavour and talk normally.
""".strip()

# Back-compat alias (older call sites / docs)
PERSONA = PERSONA_CASUAL

FINISH_MS_NOTE = 1400  # documented for the viewer; browser owns the constant

WEB_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the live internet. Use for current events, docs, prices, or anything not in workshop notes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "Fetch a specific http(s) URL and return readable text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Full URL to fetch"},
                },
                "required": ["url"],
            },
        },
    },
]

HANDS_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_pc_files",
            "description": "Search Chris's allowed PC folders by filename/path keywords via Amy Hands.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Filename or folder keywords"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "focus_browser_tab",
            "description": "Focus a Chrome tab on Chris's PC matching title or URL text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Part of tab title or URL"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_browser_tab",
            "description": "Open a URL in Chrome on Chris's PC.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "http(s) URL to open"},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_browser_tabs",
            "description": "List open Chrome tabs on Chris's PC.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_file_explorer",
            "description": (
                "Open Windows File Explorer on Chris's PC at a local folder or drive "
                "(e.g. C:\\, D:\\, or C:\\Users\\Kidabah\\Downloads). "
                "Use when Chris asks to open a folder, drive, or File Explorer."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Local Windows path. Defaults to C:\\ if omitted.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_file",
            "description": "Open a local file on Chris's PC with the default associated app.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Full local Windows file path"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_file_with",
            "description": "Open a local file with a specific allowlisted app (e.g. notepad, chrome, vscode, cursor).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Full local Windows file path"},
                    "app": {"type": "string", "description": "Allowlisted app name"},
                },
                "required": ["path", "app"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "launch_app",
            "description": (
                "Launch an allowlisted app on Chris's PC (spotify, chrome, edge, notepad, calculator, "
                "explorer, photos, settings, terminal, vscode, cursor). "
                "Set play=true after launching Spotify (or another media app) to send play/pause."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "App name, e.g. spotify"},
                    "play": {
                        "type": "boolean",
                        "description": "If true, send media play/pause after launch (for Spotify etc.)",
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "media_control",
            "description": (
                "Control media on Chris's PC. play_pause/next/previous/stop use media keys. "
                "volume_up/volume_down/mute prefer Spotify's per-app volume when Spotify is open "
                "(so Amy's voice is NOT muted). Pass app='system' for master volume, or app='spotify' "
                "to force Spotify. steps = how many volume nudges."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "description": "play_pause | next | previous | stop | volume_up | volume_down | mute",
                    },
                    "steps": {
                        "type": "integer",
                        "description": "How many volume nudges (default ~2 for up/down).",
                    },
                    "app": {
                        "type": "string",
                        "description": "Optional: spotify (default for volume), chrome, or system for master volume",
                    },
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "app_volume",
            "description": (
                "Set per-app volume/mute on Chris's PC without touching Amy's voice. "
                "Prefer this (or media_control with app=spotify) when music is playing. "
                "Actions: volume_up, volume_down, mute, unmute, set (with level 0.0–1.0)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "app": {"type": "string", "description": "Allowlisted app, usually spotify"},
                    "action": {"type": "string", "description": "volume_up | volume_down | mute | unmute | set"},
                    "steps": {"type": "integer", "description": "Nudges for up/down"},
                    "level": {"type": "number", "description": "0.0–1.0 when action=set"},
                },
                "required": ["app", "action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "register_app",
            "description": (
                "Add an app to Amy Hands allowlist so Chris can launch/volume-control it later. "
                "Use when Chris says 'add Discord to the allow list' (also knows steam, vlc, firefox, obs, whatsapp). "
                "Optional process/exe/uri if it's an unusual app."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "App name, e.g. discord"},
                    "process": {
                        "type": "string",
                        "description": "Optional process exe name, e.g. Discord.exe",
                    },
                    "exe": {"type": "string", "description": "Optional full path to .exe"},
                    "uri": {"type": "string", "description": "Optional URI protocol like discord:"},
                    "label": {"type": "string", "description": "Optional display label"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_hands_apps",
            "description": "List apps currently on the Amy Hands allowlist (launch / volume targets).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "close_window",
            "description": "Close a visible Windows window whose title contains the query (WM_CLOSE).",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Part of the window title"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "minimize_window",
            "description": "Minimise a visible Windows window whose title contains the query (e.g. Spotify).",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Part of the window title, e.g. Spotify"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "minimize_all_windows",
            "description": (
                "Minimise all visible windows on Chris's PC (show-desktop style). "
                "Keeps Amy / Cursor / system shell protected. Prefer this over closing windows."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "restore_window",
            "description": "Restore / bring to front a window whose title contains the query.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Part of the window title"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_folder",
            "description": (
                "Create a new folder on Chris's PC inside an allowlisted root "
                "(Desktop, Documents, Downloads, flightdeck). "
                "parent can be a full path or 'desktop'/'downloads'/'documents'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "parent": {"type": "string", "description": "Parent folder path or alias (desktop, downloads)"},
                    "name": {"type": "string", "description": "New folder name"},
                },
                "required": ["parent", "name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "copy_path",
            "description": "Copy a file or folder into a destination folder (allowlisted roots only).",
            "parameters": {
                "type": "object",
                "properties": {
                    "src": {"type": "string", "description": "Source file/folder full path"},
                    "dest": {"type": "string", "description": "Destination folder path or alias"},
                },
                "required": ["src", "dest"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "move_path",
            "description": "Move (cut) a file or folder into a destination folder (allowlisted roots only).",
            "parameters": {
                "type": "object",
                "properties": {
                    "src": {"type": "string", "description": "Source file/folder full path"},
                    "dest": {"type": "string", "description": "Destination folder path or alias"},
                },
                "required": ["src", "dest"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_path",
            "description": (
                "Delete a file or folder inside allowlisted roots. "
                "ALWAYS call first with confirm=false to ask Chris. "
                "Only set confirm=true after he clearly says yes/approve/delete it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Full path to delete"},
                    "confirm": {
                        "type": "boolean",
                        "description": "Must be true only after Chris explicitly approved",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_email",
            "description": "Open email on Chris's PC. Default is Thunderbird (his mail app). Also supports outlook, gmail, mail.",
            "parameters": {
                "type": "object",
                "properties": {
                    "provider": {
                        "type": "string",
                        "description": "auto (Thunderbird first) | thunderbird | outlook | gmail | mail",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "empty_email_spam",
            "description": (
                "Empty email spam/junk. ALWAYS call first with confirm=false. "
                "Only confirm=true after Chris says yes/approve empty spam. "
                "Thunderbird opens for Empty Junk; Outlook can clear Junk automatically; Gmail opens Spam."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "confirm": {"type": "boolean", "description": "True only after explicit approval"},
                    "provider": {"type": "string", "description": "auto | thunderbird | outlook | gmail"},
                },
            },
        },
    },
]

TEXT_SUFFIXES = {
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".csv",
    ".tsv",
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".html",
    ".htm",
    ".css",
    ".log",
    ".gcode",
    ".nc",
    ".xml",
    ".yml",
    ".yaml",
    ".toml",
    ".ini",
    ".sh",
    ".bash",
    ".ps1",
    ".env",
    ".cfg",
    ".conf",
    ".svg",
}
IMAGE_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_TEXT_CHARS = 24_000

PRINTER_ALIASES = {
    "bigboy": "h2d",
    "big boy": "h2d",
    "h2d": "h2d",
    "biggirl": "o1c2",
    "big girl": "o1c2",
    "h2c": "o1c2",
    "o1c2": "o1c2",
    "x1c": "x1c",
    "x1": "x1c",
    "greyhound": "greyhound",
    "voron": "greyhound",
}

PRINTER_DISPLAY = {
    "h2d": "BigBoy",
    "o1c2": "Big Girl",
    "x1c": "X1C",
    "greyhound": "Greyhound",
}

IDLE_STATES = {"idle", "ready", "standby", "finished"}

HISTORY_LOCK = threading.Lock()
CHAT_HISTORY: list[dict[str, str]] = []
HISTORY_LIMIT = 12

RUNTIME: dict[str, Any] = {
    "config": {},
    "index": [],
    # casual = normal person; print = workshop / Flightdeck Amy
    "talk_mode": "casual",
}

# Local AU towns Amy should never "lose on the map" (Open-Meteo rejects "Temora NSW").
KNOWN_PLACES: dict[str, tuple[float, float, str]] = {
    "temora": (-34.44834, 147.53444, "Temora, NSW"),
    "sydney": (-33.8688, 151.2093, "Sydney, NSW"),
    "melbourne": (-37.8136, 144.9631, "Melbourne, VIC"),
    "brisbane": (-27.4698, 153.0251, "Brisbane, QLD"),
    "canberra": (-35.2809, 149.1300, "Canberra, ACT"),
    "wagga": (-35.1082, 147.3598, "Wagga Wagga, NSW"),
    "wagga wagga": (-35.1082, 147.3598, "Wagga Wagga, NSW"),
    "cootamundra": (-34.6407, 148.0334, "Cootamundra, NSW"),
    "junee": (-34.8697, 147.5856, "Junee, NSW"),
    "griffith": (-34.2880, 146.0509, "Griffith, NSW"),
}


def active_persona() -> str:
    return PERSONA_PRINT if (RUNTIME.get("talk_mode") or "casual") == "print" else PERSONA_CASUAL


def workshop_intent(question: str) -> bool:
    if (RUNTIME.get("talk_mode") or "casual") == "print":
        return True
    return bool(
        re.search(
            r"\b(printer|flightdeck|bambu|ams|spool|filament|bigboy|big\s*girl|greyhound|"
            r"makerdeck|printshelf|calibrat|voron|x1c|h2[dc]|nozzle|plate|3d\s*print)\b",
            question or "",
            re.I,
        )
    )


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        example = ROOT / "config.example.json"
        if example.exists():
            CONFIG_PATH.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    RUNTIME["config"] = data
    return data


def load_index() -> list[dict[str, Any]]:
    if not INDEX_PATH.exists():
        RUNTIME["index"] = []
        return []
    data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    RUNTIME["index"] = data
    return data


def score_notes(question: str, notes: list[dict[str, Any]], limit: int = 6) -> list[dict[str, Any]]:
    q = question.lower()
    words = set(re.findall(r"[a-z0-9]{3,}", q))
    scored: list[tuple[float, dict[str, Any]]] = []
    for note in notes:
        label = str(note.get("label") or "").lower()
        text = str(note.get("text") or note.get("excerpt") or "").lower()
        score = 0.0
        if label and label in q:
            score += 8.0
        for w in words:
            if w in label:
                score += 3.0
            if w in text:
                score += 1.0
        if score > 0:
            scored.append((score, note))
    scored.sort(key=lambda item: (-item[0], item[1].get("id", 0)))
    return [n for _, n in scored[:limit]]


def http_json(url: str, *, method: str = "GET", body: dict | None = None, timeout: float = 30.0) -> tuple[int, Any]:
    data = None
    headers = {"Accept": "application/json", "User-Agent": "amy-workshop/1.0"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                return resp.status, {"raw": raw}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else {"detail": str(exc)}
        except json.JSONDecodeError:
            payload = {"detail": raw or str(exc)}
        return exc.code, payload
    except Exception as exc:
        return 0, {"detail": str(exc)}


def _brain_provider(cfg: dict[str, Any]) -> str:
    """Return openrouter | openai based on config / key shape."""
    explicit = str(cfg.get("provider") or "").strip().lower()
    if explicit in {"openrouter", "openai"}:
        return explicit
    base = str(cfg.get("openai_base_url") or "").lower()
    key = str(cfg.get("openai_api_key") or "")
    if "openrouter.ai" in base or key.startswith("sk-or-"):
        return "openrouter"
    return "openai"


def openai_chat(
    messages: list[dict[str, Any]],
    *,
    image_b64: str | None = None,
    media_type: str = "image/jpeg",
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | None = None,
) -> dict[str, Any]:
    """Call chat/completions. Returns the assistant message dict (may include tool_calls)."""
    cfg = RUNTIME["config"]
    key = str(cfg.get("openai_api_key") or "").strip()
    if not key or key.startswith("PUT-YOUR"):
        raise RuntimeError(
            "No brain key in config.json yet, Chris — drop an OpenRouter or OpenAI key in and restart me."
        )
    provider = _brain_provider(cfg)
    default_model = "openai/gpt-4o-mini" if provider == "openrouter" else "gpt-5.6-luna"
    default_base = (
        "https://openrouter.ai/api/v1" if provider == "openrouter" else "https://api.openai.com/v1"
    )
    model = str(cfg.get("model") or default_model)
    base = str(cfg.get("openai_base_url") or default_base).rstrip("/")
    payload_messages = list(messages)
    if image_b64:
        last = dict(payload_messages[-1])
        content = last.get("content")
        if isinstance(content, str):
            last["content"] = [
                {"type": "text", "text": content},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{media_type};base64,{image_b64}"},
                },
            ]
        payload_messages[-1] = last
    body: dict[str, Any] = {"model": model, "messages": payload_messages}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = tool_choice or "auto"
    # Luna rejects function tools + reasoning_effort together on chat/completions.
    effort = "none" if tools else str(cfg.get("reasoning_effort") or "low").strip().lower()
    if effort and effort != "default":
        body["reasoning_effort"] = effort
    temp = cfg.get("temperature")
    if temp is not None:
        body["temperature"] = float(temp)
    data = json.dumps(body).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "User-Agent": "amy-workshop/1.0",
    }
    if provider == "openrouter":
        headers["HTTP-Referer"] = str(
            cfg.get("openrouter_referer") or "https://flightdeck.tail7de73e.ts.net:4700"
        )
        title = str(cfg.get("openrouter_title") or "Amy Flightdeck")
        headers["X-Title"] = title
        headers["X-OpenRouter-Title"] = title
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=data,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            err = json.loads(raw).get("error") or {}
        except json.JSONDecodeError:
            err = {}
        code = str(err.get("code") or "")
        msg = str(err.get("message") or raw or exc)
        who = "OpenRouter" if provider == "openrouter" else "OpenAI"
        if exc.code == 429 and (
            code in {"insufficient_quota", "credit_balance_exhausted"}
            or "credit" in msg.lower()
            or "quota" in msg.lower()
        ):
            if provider == "openrouter":
                raise RuntimeError(
                    "OpenRouter credits are empty, Chris — top up at "
                    "https://openrouter.ai/settings/credits then ask me again."
                ) from exc
            raise RuntimeError(
                "OpenAI's out of credits on this account, Chris — top up at "
                "https://platform.openai.com/settings/organization/billing/ then ask me again."
            ) from exc
        if exc.code == 429:
            raise RuntimeError(f"{who} rate-limited us for a sec — wait a beat and ask again.") from exc
        if exc.code == 401:
            raise RuntimeError(f"{who} rejected the API key — check config.json for me?") from exc
        raise RuntimeError(f"{who} hiccup HTTP {exc.code}: {msg[:220]}") from exc
    msg_out = payload["choices"][0]["message"]
    return msg_out if isinstance(msg_out, dict) else {"role": "assistant", "content": str(msg_out)}


def openai_reply(messages: list[dict[str, Any]], **kwargs: Any) -> str:
    msg = openai_chat(messages, **kwargs)
    return str(msg.get("content") or "").strip()


def web_search(query: str) -> str:
    q = " ".join(str(query or "").split())
    if not q:
        return "Empty search query."
    bits: list[str] = []
    # Instant Answer API (lightweight, no key).
    try:
        ia_url = "https://api.duckduckgo.com/?" + urllib.parse.urlencode(
            {"q": q, "format": "json", "no_html": 1, "skip_disambig": 1}
        )
        req = urllib.request.Request(ia_url, headers={"User-Agent": "amy-workshop/1.0"}, method="GET")
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
        abstract = str(data.get("AbstractText") or "").strip()
        heading = str(data.get("Heading") or "").strip()
        abs_url = str(data.get("AbstractURL") or "").strip()
        if abstract:
            bits.append(f"{heading or 'Summary'}: {abstract}" + (f" ({abs_url})" if abs_url else ""))
        for topic in (data.get("RelatedTopics") or [])[:5]:
            if isinstance(topic, dict) and topic.get("Text"):
                bits.append(str(topic["Text"])[:280])
            elif isinstance(topic, dict) and isinstance(topic.get("Topics"), list):
                for sub in topic["Topics"][:2]:
                    if isinstance(sub, dict) and sub.get("Text"):
                        bits.append(str(sub["Text"])[:280])
    except Exception as exc:
        bits.append(f"(instant answer missed: {exc})")

    # HTML results fallback for more hits.
    try:
        html_url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": q})
        req = urllib.request.Request(
            html_url,
            headers={"User-Agent": "amy-workshop/1.0"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            page = resp.read().decode("utf-8", errors="replace")
        titles = re.findall(r'class="result__a"[^>]*>(.*?)</a>', page, re.I | re.S)
        snippets = re.findall(r'class="result__snippet"[^>]*>(.*?)</(?:a|td|div)', page, re.I | re.S)
        for i, title in enumerate(titles[:5]):
            t = re.sub(r"<[^>]+>", "", title)
            t = html_lib.unescape(re.sub(r"\s+", " ", t)).strip()
            s = ""
            if i < len(snippets):
                s = re.sub(r"<[^>]+>", "", snippets[i])
                s = html_lib.unescape(re.sub(r"\s+", " ", s)).strip()
            if t:
                bits.append(f"{t} — {s}" if s else t)
    except Exception as exc:
        bits.append(f"(html search missed: {exc})")

    if not bits:
        return f"No web results for: {q}"
    return f"Search results for '{q}':\n- " + "\n- ".join(bits[:8])


def fetch_url(url: str) -> str:
    raw = str(url or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return "Only http(s) URLs are allowed."
    req = urllib.request.Request(
        raw,
        headers={"User-Agent": "amy-workshop/1.0", "Accept": "text/html,application/xhtml+xml,text/plain,*/*"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=18) as resp:
            ctype = str(resp.headers.get("Content-Type") or "")
            data = resp.read(400_000)
    except Exception as exc:
        return f"Fetch failed: {exc}"
    if "application/json" in ctype:
        try:
            return json.dumps(json.loads(data.decode("utf-8", errors="replace")), indent=2)[:MAX_TEXT_CHARS]
        except json.JSONDecodeError:
            pass
    text = data.decode("utf-8", errors="replace")
    text = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\1>", " ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = html_lib.unescape(re.sub(r"\s+", " ", text)).strip()
    if not text:
        return "Page had no readable text."
    return text[:MAX_TEXT_CHARS]


def hands_base() -> str:
    return str(RUNTIME["config"].get("hands_base_url") or "").rstrip("/")


def hands_configured() -> bool:
    return bool(hands_base())


def hands_request(path: str, *, method: str = "GET", body: dict[str, Any] | None = None, timeout: int = 20) -> tuple[int, Any]:
    base = hands_base()
    if not base:
        return 0, {"detail": "Amy Hands not configured (hands_base_url)."}
    return http_json(f"{base}{path}", method=method, body=body, timeout=timeout)


def hands_wait_result(cmd_id: str, timeout_s: float = 6.0) -> dict[str, Any]:
    deadline = datetime.now().timestamp() + timeout_s
    while datetime.now().timestamp() < deadline:
        code, payload = hands_request("/commands/last")
        if code == 200 and isinstance(payload, dict):
            result = payload.get("result") or {}
            if isinstance(result, dict) and result.get("id") == cmd_id:
                return result
        time.sleep(0.35)
    return {"ok": False, "detail": "Chrome extension did not respond in time — is Amy Hands + extension running?"}


def hands_extension_alive(max_age_s: float = 8.0) -> tuple[bool, str]:
    code, payload = hands_request("/health", timeout=5)
    if code != 200 or not isinstance(payload, dict):
        return False, f"Amy Hands unreachable ({payload}). Is Hands running on the PC?"
    ago = payload.get("extension_seen_ago_s")
    if ago is None:
        return False, (
            "Chrome extension isn't connected. On the PC: chrome://extensions → "
            "Load unpacked → jarvis/amy-hands/chrome-extension (keep Hands running)."
        )
    if float(ago) > max_age_s:
        return False, f"Chrome extension last seen {ago}s ago — reload the Amy Hands extension."
    return True, "ok"


def search_pc_files(query: str) -> str:
    code, payload = hands_request("/search", method="POST", body={"query": query})
    if code != 200 or not isinstance(payload, dict):
        return f"Hands search failed: {payload}"
    hits = payload.get("hits") or []
    if not hits:
        return f"No PC files matched “{query}” in allowed folders."
    lines = [f"{h.get('name')} — {h.get('path')}" for h in hits[:15]]
    return f"Found {payload.get('count', len(hits))} file(s) for “{query}”:\n- " + "\n- ".join(lines)


def focus_browser_tab(query: str) -> str:
    ok, detail = hands_extension_alive()
    if not ok:
        return detail
    code, payload = hands_request("/tabs/focus", method="POST", body={"query": query})
    if code != 200 or not isinstance(payload, dict):
        return f"Couldn’t queue tab focus: {payload}"
    result = hands_wait_result(str(payload.get("id") or ""))
    if result.get("ok"):
        return f"Focused Chrome tab: {result.get('title') or result.get('url')}"
    return f"Tab focus failed: {result.get('detail') or result}"


def open_browser_tab(url: str) -> str:
    ok, detail = hands_extension_alive()
    if not ok:
        return detail
    code, payload = hands_request("/tabs/open", method="POST", body={"url": url})
    if code != 200 or not isinstance(payload, dict):
        return f"Couldn’t open tab: {payload}"
    result = hands_wait_result(str(payload.get("id") or ""))
    if result.get("ok"):
        return f"Opened {result.get('url') or url}"
    return f"Open tab failed: {result.get('detail') or result}"


def list_browser_tabs() -> str:
    ok, detail = hands_extension_alive()
    if not ok:
        return detail
    code, payload = hands_request("/tabs/list", method="POST", body={})
    if code != 200 or not isinstance(payload, dict):
        return f"Couldn’t list tabs: {payload}"
    result = hands_wait_result(str(payload.get("id") or ""), timeout_s=7.0)
    if not result.get("ok"):
        return f"List tabs failed: {result.get('detail') or result}"
    tabs = result.get("tabs") or []
    if not tabs:
        return "No Chrome tabs reported."
    lines = []
    for t in tabs[:20]:
        mark = "*" if t.get("active") else "-"
        lines.append(f"{mark} {t.get('title') or '(no title)'} | {t.get('url')}")
    return "Chrome tabs:\n" + "\n".join(lines)


def open_file_explorer(path: str = "") -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    code, payload = hands_request(
        "/explorer/open",
        method="POST",
        body={"path": path or "C:\\"},
        timeout=10,
    )
    if not isinstance(payload, dict):
        return f"Couldn’t open Explorer: {payload}"
    if code != 200 or not payload.get("ok"):
        return f"Explorer open failed: {payload.get('detail') or payload}"
    opened = payload.get("path") or path or "C:\\"
    return (
        f"Opened File Explorer at {opened}. "
        "I dropped always-on-top so you can see it — say come back if you want me floating again."
    )


def _hands_action(path: str, body: dict[str, Any], *, ok_msg: str) -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    code, payload = hands_request(path, method="POST", body=body, timeout=15)
    if not isinstance(payload, dict):
        return f"Hands call failed: {payload}"
    if code != 200 or not payload.get("ok"):
        return f"Failed: {payload.get('detail') or payload}"
    return ok_msg.format(**{k: payload.get(k) for k in ("path", "app", "title", "action", "via")})


def open_pc_file(path: str) -> str:
    msg = _hands_action("/file/open", {"path": path}, ok_msg="Opened {path}")
    if msg.startswith("Opened "):
        return (
            msg
            + " I dropped always-on-top so you can see it — say come back if you want me floating again."
        )
    return msg


def open_pc_file_with(path: str, app: str) -> str:
    msg = _hands_action(
        "/file/open_with",
        {"path": path, "app": app},
        ok_msg="Opened {path} with {app}",
    )
    if msg.startswith("Opened "):
        return (
            msg
            + " I dropped always-on-top so you can see it — say come back if you want me floating again."
        )
    return msg


def launch_pc_app(name: str, play: bool = False) -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    code, payload = hands_request(
        "/app/launch",
        method="POST",
        body={"name": name, "play": play},
        timeout=20,
    )
    if not isinstance(payload, dict):
        return f"Launch failed: {payload}"
    if code != 200 or not payload.get("ok"):
        return f"Launch failed: {payload.get('detail') or payload}"
    msg = f"Launched {payload.get('app') or name}"
    if play:
        media = payload.get("media") or {}
        if isinstance(media, dict) and media.get("ok"):
            msg += " and sent play/pause"
        elif play:
            msg += " (play/pause may need a second try once Spotify is up)"
    return msg


def media_control(action: str, steps: int = 1, app: str = "") -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    body: dict[str, Any] = {"action": action or "play_pause"}
    if steps and int(steps) > 0:
        body["steps"] = int(steps)
    if app:
        body["app"] = app
    code, payload = hands_request("/media", method="POST", body=body, timeout=10)
    if not isinstance(payload, dict):
        return f"Media failed: {payload}"
    if code != 200 or not payload.get("ok"):
        return f"Media failed: {payload.get('detail') or payload}"
    act = payload.get("action") or action
    via = payload.get("via") or payload.get("app") or ""
    n = payload.get("steps")
    extra = f" ({via})" if via else ""
    if n and act in ("volume_up", "volume_down"):
        return f"Media: {act} ×{n}{extra}"
    return f"Media: {act}{extra}"


def app_volume(app: str, action: str, steps: int = 1, level: float | None = None) -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    body: dict[str, Any] = {"app": app or "spotify", "action": action or "volume_down", "steps": steps}
    if level is not None:
        body["level"] = level
    code, payload = hands_request("/app/audio", method="POST", body=body, timeout=10)
    if not isinstance(payload, dict):
        return f"App volume failed: {payload}"
    if code != 200 or not payload.get("ok"):
        return f"App volume failed: {payload.get('detail') or payload}"
    return (
        f"{payload.get('app') or app}: {payload.get('action') or action}"
        + (f" ×{payload.get('steps')}" if payload.get("steps") else "")
        + (f" → {payload.get('level')}" if payload.get("level") is not None else "")
    )


def register_hands_app(
    name: str,
    process: str = "",
    exe: str = "",
    uri: str = "",
    label: str = "",
) -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    body: dict[str, Any] = {"name": name}
    if process:
        body["process"] = process
    if exe:
        body["exe"] = exe
    if uri:
        body["uri"] = uri
    if label:
        body["label"] = label
    code, payload = hands_request("/app/register", method="POST", body=body, timeout=10)
    if not isinstance(payload, dict):
        return f"Register failed: {payload}"
    if code != 200 or not payload.get("ok"):
        return f"Register failed: {payload.get('detail') or payload}"
    return f"Added {payload.get('app') or name} to the Hands allowlist (key: {payload.get('key')})."


def list_hands_apps() -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    code, payload = hands_request("/app/list", method="POST", body={}, timeout=10)
    if not isinstance(payload, dict) or code != 200 or not payload.get("ok"):
        return f"Couldn’t list apps: {payload}"
    apps = payload.get("apps") or []
    return "Hands allowlist: " + ", ".join(apps) if apps else "Hands allowlist is empty."


def close_pc_window(query: str) -> str:
    return _hands_action(
        "/window/close",
        {"query": query},
        ok_msg="Closed window: {title}",
    )


def minimize_pc_window(query: str) -> str:
    return _hands_action(
        "/window/minimize",
        {"query": query},
        ok_msg="Minimised window: {title}",
    )


def minimize_all_pc_windows() -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    code, payload = hands_request("/window/minimize_all", method="POST", body={}, timeout=15)
    if not isinstance(payload, dict):
        return f"Minimise-all failed: {payload}"
    if code != 200 or not payload.get("ok"):
        return f"Minimise-all failed: {payload.get('detail') or payload}"
    return f"Minimised {payload.get('count', 0)} window(s)."


def restore_pc_window(query: str) -> str:
    return _hands_action(
        "/window/restore",
        {"query": query},
        ok_msg="Restored window: {title}",
    )


def create_pc_folder(parent: str, name: str) -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    code, payload = hands_request(
        "/folder/create",
        method="POST",
        body={"parent": parent, "name": name},
        timeout=15,
    )
    if not isinstance(payload, dict):
        return f"Create folder failed: {payload}"
    if code != 200 or not payload.get("ok"):
        return f"Create folder failed: {payload.get('detail') or payload}"
    path = payload.get("path") or name
    return (
        f"Created folder {path}. "
        "I dropped always-on-top so you can see it — say come back if you want me floating again."
    )


def copy_pc_path(src: str, dest: str) -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    code, payload = hands_request(
        "/file/copy",
        method="POST",
        body={"src": src, "dest": dest},
        timeout=60,
    )
    if not isinstance(payload, dict):
        return f"Copy failed: {payload}"
    if code != 200 or not payload.get("ok"):
        return f"Copy failed: {payload.get('detail') or payload}"
    return f"Copied to {payload.get('path')}. I dropped always-on-top so you can see Explorer."


def move_pc_path(src: str, dest: str) -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    code, payload = hands_request(
        "/file/move",
        method="POST",
        body={"src": src, "dest": dest},
        timeout=60,
    )
    if not isinstance(payload, dict):
        return f"Move failed: {payload}"
    if code != 200 or not payload.get("ok"):
        return f"Move failed: {payload.get('detail') or payload}"
    return f"Moved to {payload.get('path')}. I dropped always-on-top so you can see Explorer."


def delete_pc_path(path: str, *, confirm: bool = False) -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    code, payload = hands_request(
        "/file/delete",
        method="POST",
        body={"path": path, "confirm": bool(confirm)},
        timeout=30,
    )
    if not isinstance(payload, dict):
        return f"Delete failed: {payload}"
    if payload.get("needs_confirm"):
        return str(payload.get("detail") or f"Need your OK to delete {path}.")
    if code != 200 or not payload.get("ok"):
        return f"Delete failed: {payload.get('detail') or payload}"
    return f"Deleted {payload.get('path') or path}."


def open_pc_email(provider: str = "auto") -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    code, payload = hands_request(
        "/email/open",
        method="POST",
        body={"provider": provider or "auto"},
        timeout=15,
    )
    if not isinstance(payload, dict):
        return f"Open email failed: {payload}"
    if code != 200 or not payload.get("ok"):
        return f"Open email failed: {payload.get('detail') or payload}"
    app = payload.get("app") or "email"
    return f"Opened {app}. I dropped always-on-top so you can see it — say come back to float again."


def empty_pc_email_spam(*, confirm: bool = False, provider: str = "auto") -> str:
    if not hands_configured():
        return "Amy Hands not configured (hands_base_url)."
    code, payload = hands_request(
        "/email/empty_spam",
        method="POST",
        body={"confirm": bool(confirm), "provider": provider or "auto"},
        timeout=60,
    )
    if not isinstance(payload, dict):
        return f"Empty spam failed: {payload}"
    if payload.get("needs_confirm"):
        return str(payload.get("detail") or "Need your OK to empty spam.")
    if code != 200 or not payload.get("ok"):
        return f"Empty spam failed: {payload.get('detail') or payload}"
    if payload.get("action") in ("open_spam", "open_junk_hint"):
        return str(payload.get("detail") or "Opened spam/junk.")
    deleted = payload.get("deleted")
    return f"Emptied {payload.get('app') or 'email'} spam ({deleted} item(s))."


def active_tools() -> list[dict[str, Any]]:
    tools = list(WEB_TOOLS)
    if hands_configured():
        tools.extend(HANDS_TOOLS)
    return tools


def run_tool(name: str, arguments: str | dict[str, Any]) -> str:
    try:
        args = arguments if isinstance(arguments, dict) else json.loads(arguments or "{}")
    except json.JSONDecodeError:
        args = {}
    if name == "web_search":
        return web_search(str(args.get("query") or ""))
    if name == "fetch_url":
        return fetch_url(str(args.get("url") or ""))
    if name == "search_pc_files":
        return search_pc_files(str(args.get("query") or ""))
    if name == "focus_browser_tab":
        return focus_browser_tab(str(args.get("query") or ""))
    if name == "open_browser_tab":
        return open_browser_tab(str(args.get("url") or ""))
    if name == "list_browser_tabs":
        return list_browser_tabs()
    if name == "open_file_explorer":
        return open_file_explorer(str(args.get("path") or args.get("folder") or ""))
    if name == "open_file":
        return open_pc_file(str(args.get("path") or args.get("file") or ""))
    if name == "open_file_with":
        return open_pc_file_with(
            str(args.get("path") or args.get("file") or ""),
            str(args.get("app") or args.get("with") or ""),
        )
    if name == "launch_app":
        return launch_pc_app(
            str(args.get("name") or args.get("app") or ""),
            play=bool(args.get("play") or args.get("and_play")),
        )
    if name == "media_control":
        steps = args.get("steps") or args.get("count") or 1
        try:
            steps_i = int(steps)
        except (TypeError, ValueError):
            steps_i = 1
        return media_control(
            str(args.get("action") or args.get("command") or "play_pause"),
            steps=steps_i,
            app=str(args.get("app") or args.get("target") or ""),
        )
    if name == "app_volume":
        steps = args.get("steps") or args.get("count") or 1
        try:
            steps_i = int(steps)
        except (TypeError, ValueError):
            steps_i = 1
        level = args.get("level")
        level_f = float(level) if level is not None else None
        return app_volume(
            str(args.get("app") or args.get("name") or "spotify"),
            str(args.get("action") or args.get("command") or "volume_down"),
            steps=steps_i,
            level=level_f,
        )
    if name == "register_app":
        return register_hands_app(
            str(args.get("name") or args.get("app") or ""),
            process=str(args.get("process") or ""),
            exe=str(args.get("exe") or args.get("path") or ""),
            uri=str(args.get("uri") or ""),
            label=str(args.get("label") or ""),
        )
    if name == "list_hands_apps":
        return list_hands_apps()
    if name == "close_window":
        return close_pc_window(str(args.get("query") or args.get("title") or ""))
    if name == "minimize_window":
        return minimize_pc_window(str(args.get("query") or args.get("title") or ""))
    if name == "minimize_all_windows":
        return minimize_all_pc_windows()
    if name == "restore_window":
        return restore_pc_window(str(args.get("query") or args.get("title") or ""))
    if name == "create_folder":
        return create_pc_folder(
            str(args.get("parent") or args.get("path") or args.get("folder") or ""),
            str(args.get("name") or args.get("folder_name") or ""),
        )
    if name == "copy_path":
        return copy_pc_path(
            str(args.get("src") or args.get("source") or args.get("path") or ""),
            str(args.get("dest") or args.get("destination") or args.get("to") or ""),
        )
    if name == "move_path":
        return move_pc_path(
            str(args.get("src") or args.get("source") or args.get("path") or ""),
            str(args.get("dest") or args.get("destination") or args.get("to") or ""),
        )
    if name == "delete_path":
        return delete_pc_path(
            str(args.get("path") or args.get("file") or args.get("folder") or ""),
            confirm=bool(args.get("confirm") or args.get("approved") or args.get("yes")),
        )
    if name == "open_email":
        return open_pc_email(str(args.get("provider") or args.get("app") or "auto"))
    if name == "empty_email_spam":
        return empty_pc_email_spam(
            confirm=bool(args.get("confirm") or args.get("approved") or args.get("yes")),
            provider=str(args.get("provider") or args.get("app") or "auto"),
        )
    return f"Unknown tool: {name}"


def openai_chat_with_web(messages: list[dict[str, Any]], *, image_b64: str | None = None, media_type: str = "image/jpeg") -> str:
    """Tool loop: web + optional Amy Hands (folders/tabs)."""
    tools = active_tools()
    msgs: list[dict[str, Any]] = list(messages)
    for _ in range(4):
        msg = openai_chat(msgs, image_b64=image_b64, media_type=media_type, tools=tools)
        image_b64 = None  # only attach once
        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            return str(msg.get("content") or "").strip()
        msgs.append(
            {
                "role": "assistant",
                "content": msg.get("content"),
                "tool_calls": tool_calls,
            }
        )
        for call in tool_calls:
            fn = (call.get("function") or {}) if isinstance(call, dict) else {}
            name = str(fn.get("name") or "")
            result = run_tool(name, fn.get("arguments") or "{}")
            msgs.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id"),
                    "content": result,
                }
            )
    final = openai_chat(msgs)
    return str(final.get("content") or "").strip()


def decode_upload_payload(item: dict[str, Any]) -> dict[str, Any]:
    name = str(item.get("name") or "drop.bin").strip() or "drop.bin"
    media_type = str(item.get("media_type") or item.get("type") or "application/octet-stream").strip().lower()
    raw_b64 = str(item.get("data") or item.get("image") or "").strip()
    if "," in raw_b64 and raw_b64.startswith("data:"):
        header, raw_b64 = raw_b64.split(",", 1)
        if "image/" in header:
            media_type = header.split(";")[0].split(":")[1]
    if not raw_b64:
        raise ValueError(f"{name}: empty file")
    try:
        blob = base64.b64decode(raw_b64, validate=False)
    except Exception as exc:
        raise ValueError(f"{name}: bad base64") from exc
    if len(blob) > MAX_UPLOAD_BYTES:
        raise ValueError(f"{name}: too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)")
    suffix = Path(name).suffix.lower()
    kind = "binary"
    text = ""
    image_b64 = ""
    if media_type in IMAGE_TYPES or suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        kind = "image"
        if media_type not in IMAGE_TYPES:
            media_type = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".webp": "image/webp",
                ".gif": "image/gif",
            }.get(suffix, "image/jpeg")
        image_b64 = base64.b64encode(blob).decode("ascii")
    elif suffix in TEXT_SUFFIXES or media_type.startswith("text/") or media_type in {
        "application/json",
        "application/javascript",
        "application/xml",
    }:
        kind = "text"
        text = blob.decode("utf-8", errors="replace")[:MAX_TEXT_CHARS]
    else:
        # Try utf-8 text sniff.
        sample = blob[:4000]
        if b"\x00" not in sample:
            try:
                text = blob.decode("utf-8")[:MAX_TEXT_CHARS]
                kind = "text"
            except UnicodeDecodeError:
                kind = "binary"
    UPLOADS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:80] or "drop.bin"
    path = UPLOADS / f"{stamp}-{safe}"
    path.write_bytes(blob)
    return {
        "name": name,
        "media_type": media_type,
        "kind": kind,
        "bytes": len(blob),
        "path": str(path.name),
        "text": text,
        "image_b64": image_b64,
    }


def format_attachments_for_prompt(files: list[dict[str, Any]]) -> tuple[str, str | None, str]:
    """Return (text block, first image b64 or None, media_type)."""
    if not files:
        return "", None, "image/jpeg"
    chunks: list[str] = []
    image_b64 = None
    media_type = "image/jpeg"
    for f in files:
        name = f.get("name") or "file"
        kind = f.get("kind")
        if kind == "text" and f.get("text"):
            chunks.append(f"FILE[{name}] ({f.get('bytes')} bytes):\n{f['text']}")
        elif kind == "image" and f.get("image_b64"):
            chunks.append(f"FILE[{name}]: image attached for vision.")
            if image_b64 is None:
                image_b64 = f["image_b64"]
                media_type = str(f.get("media_type") or "image/jpeg")
        else:
            chunks.append(f"FILE[{name}]: binary ({f.get('bytes')} bytes) saved as {f.get('path')} — can't preview contents.")
    return "\n\n".join(chunks), image_b64, media_type


def elevenlabs_configured() -> bool:
    key = str(RUNTIME["config"].get("elevenlabs_api_key") or "").strip()
    return bool(key) and not key.startswith("PUT-YOUR")


def openai_tts_configured() -> bool:
    cfg = RUNTIME["config"]
    key = str(cfg.get("openai_api_key") or "").strip()
    return bool(key) and not key.startswith("PUT-YOUR")


def tts_provider() -> str:
    """Preferred voice engine: openai | elevenlabs | auto | browser."""
    cfg = RUNTIME["config"]
    pref = str(cfg.get("tts_provider") or "auto").strip().lower()
    if pref in ("openai", "nova", "gpt"):
        return "openai" if openai_tts_configured() else ("elevenlabs" if elevenlabs_configured() else "browser")
    if pref in ("elevenlabs", "laura", "11labs"):
        return "elevenlabs" if elevenlabs_configured() else ("openai" if openai_tts_configured() else "browser")
    # auto: prefer OpenAI when set as tonight's understudy? keep Laura first if keyed, else OpenAI
    if elevenlabs_configured():
        return "elevenlabs"
    if openai_tts_configured():
        return "openai"
    return "browser"


def _spoken_text(text: str, limit: int = 2200) -> str:
    spoken = " ".join(str(text or "").split())
    if not spoken:
        raise RuntimeError("Nothing to say.")
    if len(spoken) > limit:
        spoken = spoken[: limit - 10].rstrip() + "…"
    return spoken


def synthesize_openai_tts(text: str) -> bytes:
    """OpenAI TTS — nova by default."""
    cfg = RUNTIME["config"]
    key = str(cfg.get("openai_api_key") or "").strip()
    if not key or key.startswith("PUT-YOUR"):
        raise RuntimeError("OpenAI key not set for TTS.")
    base = str(cfg.get("openai_base_url") or "https://api.openai.com/v1").rstrip("/")
    voice = str(cfg.get("openai_tts_voice") or "nova").strip() or "nova"
    model = str(cfg.get("openai_tts_model") or "tts-1").strip() or "tts-1"
    spoken = _spoken_text(text, limit=4000)
    body = {"model": model, "input": spoken, "voice": voice, "response_format": "mp3"}
    req = urllib.request.Request(
        f"{base}/audio/speech",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "amy-workshop/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI TTS HTTP {exc.code}: {raw[:220]}") from exc


def transcribe_openai(audio: bytes, *, filename: str = "speech.webm", mime: str = "audio/webm") -> str:
    """OpenAI Whisper STT — used by the desktop WebView (SpeechRecognition is broken there)."""
    cfg = RUNTIME["config"]
    key = str(cfg.get("openai_api_key") or "").strip()
    if not key or key.startswith("PUT-YOUR"):
        raise RuntimeError("OpenAI key not set for STT.")
    if not audio:
        raise RuntimeError("Empty audio.")
    base = str(cfg.get("openai_base_url") or "https://api.openai.com/v1").rstrip("/")
    model = str(cfg.get("openai_stt_model") or "whisper-1").strip() or "whisper-1"
    boundary = f"----AmySTT{int(time.time() * 1000)}"
    disposition = f'form-data; name="file"; filename="{filename}"'
    parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{model}\r\n".encode(),
        (
            f"--{boundary}\r\nContent-Disposition: {disposition}\r\n"
            f"Content-Type: {mime}\r\n\r\n"
        ).encode()
        + audio
        + b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    body = b"".join(parts)
    req = urllib.request.Request(
        f"{base}/audio/transcriptions",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "amy-workshop/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        err = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI STT HTTP {exc.code}: {err[:220]}") from exc
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return raw.strip()
    return str(payload.get("text") or "").strip()


def synthesize_elevenlabs(text: str) -> bytes:
    """ElevenLabs TTS — Laura by default."""
    cfg = RUNTIME["config"]
    key = str(cfg.get("elevenlabs_api_key") or "").strip()
    if not key or key.startswith("PUT-YOUR"):
        raise RuntimeError("ElevenLabs key not set — paste it into config.json (elevenlabs_api_key).")
    voice_id = str(cfg.get("elevenlabs_voice_id") or "FGY2WhTYpPnrIDTdsKH5").strip()
    model = str(cfg.get("elevenlabs_model") or "eleven_turbo_v2_5").strip()
    spoken = _spoken_text(text)
    body = {
        "text": spoken,
        "model_id": model,
        "voice_settings": {
            "stability": float(cfg.get("elevenlabs_stability", 0.38)),
            "similarity_boost": float(cfg.get("elevenlabs_similarity", 0.82)),
            "style": float(cfg.get("elevenlabs_style", 0.45)),
            "use_speaker_boost": True,
        },
    }
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "xi-api-key": key,
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "User-Agent": "amy-workshop/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            err = json.loads(raw)
            detail = err.get("detail") or err
            if isinstance(detail, dict):
                msg = str(detail.get("message") or detail.get("status") or detail)[:220]
                status = str(detail.get("status") or detail.get("code") or "").lower()
            else:
                msg = str(detail)[:220]
                status = ""
        except json.JSONDecodeError:
            msg = raw[:220] or str(exc)
            status = ""
        blob = f"{raw} {msg} {status}".lower()
        if "quota" in blob or "credits remaining" in blob:
            raise RuntimeError(
                "ElevenLabs is out of credits — top up at elevenlabs.io/app/billing."
            ) from exc
        if exc.code in (401, 403):
            raise RuntimeError("ElevenLabs rejected the API key — check elevenlabs_api_key.") from exc
        if exc.code == 429:
            raise RuntimeError("ElevenLabs rate/quota limit — top up or wait a moment.") from exc
        raise RuntimeError(f"ElevenLabs HTTP {exc.code}: {msg}") from exc


def synthesize_speech(text: str) -> bytes:
    """Server TTS: respect tts_provider, with sensible fallbacks."""
    pref = tts_provider()
    errors: list[str] = []
    order: list[str] = []
    if pref == "openai":
        order = ["openai", "elevenlabs"]
    elif pref == "elevenlabs":
        order = ["elevenlabs", "openai"]
    else:
        order = []
    for name in order:
        try:
            if name == "openai" and openai_tts_configured():
                return synthesize_openai_tts(text)
            if name == "elevenlabs" and elevenlabs_configured():
                return synthesize_elevenlabs(text)
        except Exception as exc:
            errors.append(f"{name}: {exc}")
            continue
    if errors:
        raise RuntimeError(" / ".join(errors))
    raise RuntimeError("No TTS provider configured.")


def tts_hello_payload() -> tuple[str, str]:
    pref = tts_provider()
    cfg = RUNTIME["config"]
    if pref == "openai":
        voice = str(cfg.get("openai_tts_voice") or "nova")
        return "openai", voice.title() if voice.lower() == "nova" else voice
    if pref == "elevenlabs":
        return "laura", str(cfg.get("elevenlabs_voice_name") or "Laura")
    return "browser", "Browser"


def resolve_printer(text: str) -> tuple[str | None, str | None]:
    lower = text.lower()
    # Prefer longer aliases first.
    for alias in sorted(PRINTER_ALIASES.keys(), key=len, reverse=True):
        if re.search(rf"\b{re.escape(alias)}\b", lower):
            pid = PRINTER_ALIASES[alias]
            return pid, PRINTER_DISPLAY.get(pid, pid)
    return None, None


def flightdeck_url(path: str) -> str:
    base = str(RUNTIME["config"].get("flightdeck_base_url") or "http://127.0.0.1:8000").rstrip("/")
    return f"{base}{path}"


def get_printer_status(printer_id: str) -> dict[str, Any] | None:
    code, payload = http_json(flightdeck_url("/api/printers"), timeout=10)
    if code != 200 or not isinstance(payload, list):
        return None
    for p in payload:
        if str(p.get("id")) == printer_id:
            return p
    return None


def calibration_defaults(printer: dict[str, Any] | None) -> dict[str, bool]:
    model = str((printer or {}).get("model") or (printer or {}).get("model_name") or "").upper()
    h2 = model.startswith("H2")
    return {
        "bed_leveling": True,
        "vibration": True,
        "motor_noise": True,
        "nozzle_offset": h2,
        "high_temp_heatbed": False,
    }


def tool_calibrate(question: str) -> dict[str, Any] | None:
    if not re.search(r"\b(calibrat\w*|run\s+a\s+calibrat\w*)\b", question, re.I):
        return None
    printer_id, display = resolve_printer(question)
    if not printer_id:
        return {
            "answer": "Which printer, Chris — BigBoy, Big Girl, X1C, or Greyhound?",
            "nodes": [],
            "tool": "calibrate",
            "ok": False,
        }
    status = get_printer_status(printer_id)
    if not status:
        return {
            "answer": f"Can't reach Flightdeck for {display}, Kidabah.",
            "nodes": [],
            "tool": "calibrate",
            "ok": False,
        }
    state = str(status.get("state") or "").lower()
    if state not in IDLE_STATES:
        return {
            "answer": f"{display} is {state or 'busy'} — I'll wait until it's idle before calibrating.",
            "nodes": [],
            "tool": "calibrate",
            "ok": False,
        }
    opts = calibration_defaults(status)
    code, payload = http_json(
        flightdeck_url(f"/api/printers/{printer_id}/calibration"),
        method="POST",
        body=opts,
        timeout=30,
    )
    if code not in (200, 201) or (isinstance(payload, dict) and payload.get("ok") is False):
        detail = payload.get("detail") if isinstance(payload, dict) else payload
        return {
            "answer": f"Calibration on {display} flopped: {detail}",
            "nodes": [],
            "tool": "calibrate",
            "ok": False,
        }
    bits = [k.replace("_", " ") for k, v in opts.items() if v]
    return {
        "answer": f"On it — starting {', '.join(bits)} on {display}.",
        "nodes": [],
        "tool": "calibrate",
        "ok": True,
        "printer_id": printer_id,
    }


def tool_status(question: str) -> dict[str, Any] | None:
    if not re.search(r"\b(status|how.?s|what.?s|doing|state)\b", question, re.I):
        return None
    printer_id, display = resolve_printer(question)
    if not printer_id:
        # Whole bench snapshot if they asked generally about printers.
        if not re.search(r"\b(printers?|bench|bambu)\b", question, re.I):
            return None
        code, payload = http_json(flightdeck_url("/api/printers"), timeout=10)
        if code != 200 or not isinstance(payload, list):
            return {"answer": "Flightdeck printers are unreachable right now, Chris.", "nodes": [], "tool": "status", "ok": False}
        parts = []
        for p in payload:
            pid = str(p.get("id"))
            name = PRINTER_DISPLAY.get(pid, pid)
            parts.append(f"{name} is {p.get('state') or 'unknown'}")
        return {"answer": "; ".join(parts) + ".", "nodes": [], "tool": "status", "ok": True}
    status = get_printer_status(printer_id)
    if not status:
        return {"answer": f"No status for {display} — Flightdeck blanked on me.", "nodes": [], "tool": "status", "ok": False}
    job = status.get("job") or {}
    job_name = job.get("name") or job.get("gcode_file") or ""
    pct = job.get("progress") or job.get("percent")
    extra = ""
    if job_name:
        extra = f" — {job_name}"
        if pct is not None:
            extra += f" ({pct}%)"
    return {
        "answer": f"{display} is {status.get('state') or 'unknown'}{extra}.",
        "nodes": [],
        "tool": "status",
        "ok": True,
    }


def tool_control(question: str) -> dict[str, Any] | None:
    action = None
    if re.search(r"\b(pause)\b", question, re.I):
        action = "pause"
    elif re.search(r"\b(resume|continue)\b", question, re.I):
        action = "resume"
    elif re.search(r"\b(stop|cancel|abort)\b", question, re.I) and re.search(
        r"\b(print|printer|job)\b", question, re.I
    ):
        action = "stop"
    if not action:
        return None
    printer_id, display = resolve_printer(question)
    if not printer_id:
        return {
            "answer": f"Which printer should I {action}, Chris?",
            "nodes": [],
            "tool": action,
            "ok": False,
        }
    code, payload = http_json(
        flightdeck_url(f"/api/printers/{printer_id}/control"),
        method="POST",
        body={"action": action},
        timeout=20,
    )
    if code not in (200, 201):
        detail = payload.get("detail") if isinstance(payload, dict) else payload
        return {
            "answer": f"Couldn't {action} {display}: {detail}",
            "nodes": [],
            "tool": action,
            "ok": False,
        }
    return {
        "answer": f"{action.capitalize()} sent to {display}.",
        "nodes": [],
        "tool": action,
        "ok": True,
    }


def try_media_tools(question: str) -> dict[str, Any] | None:
    """Fast path for Spotify / media — skips LLM when the ask is obvious."""
    if not hands_configured():
        return None
    q = re.sub(r"[^\w\s]", " ", (question or "").lower())
    q = re.sub(r"\s+", " ", q).strip()
    if not q:
        return None
    # Whisper sometimes invents "spotty" / "spot if i" etc.
    q = (
        q.replace("spotty", "spotify")
        .replace("spot if y", "spotify")
        .replace("spotifyy", "spotify")
        .replace("spot if i", "spotify")
    )

    play = bool(
        re.search(
            r"\b((open|launch|start|play)\s+(spotify|music|some music|a song)|"
            r"spotify\s+(and\s+)?play|play\s+spotify|put\s+on\s+(some\s+)?music|"
            r"music\s+on)\b",
            q,
        )
    )
    if play:
        msg = launch_pc_app("spotify", play=True)
        return {"answer": msg, "nodes": [], "move_camera": False, "tool": "spotify_play", "ok": True}

    pause = bool(re.search(r"\b(pause|stop)\s+(the\s+)?(music|spotify|track|song)\b|\bpause\s+spotify\b", q))
    if pause or re.fullmatch(r"(pause|pause music|pause that)", q):
        msg = media_control("play_pause")
        return {"answer": msg, "nodes": [], "move_camera": False, "tool": "media", "ok": True}

    if re.search(r"\b(next( track| song)?|skip( (this|the)? (track|song))?)\b", q):
        msg = media_control("next")
        return {"answer": msg, "nodes": [], "move_camera": False, "tool": "media", "ok": True}

    if re.search(r"\b(previous|prev|last)\s+(track|song)\b|\bgo\s+back\s+(a\s+)?(track|song)\b", q):
        msg = media_control("previous")
        return {"answer": msg, "nodes": [], "move_camera": False, "tool": "media", "ok": True}

    if re.search(r"\b(turn|volume)\s+(it\s+)?(down|up)\b|\b(louder|quieter)\b", q):
        action = "volume_up" if re.search(r"\b(up|louder)\b", q) else "volume_down"
        msg = media_control(action, app="spotify")
        return {"answer": msg, "nodes": [], "move_camera": False, "tool": "media", "ok": True}

    # "mute spotify" / "mute the music" — NOT mic (viewer handles mic mute)
    if re.search(r"\bmute\s+(spotify|the\s+music|music|that)\b|\bspotify\s+mute\b", q):
        msg = media_control("mute", app="spotify")
        return {"answer": msg, "nodes": [], "move_camera": False, "tool": "media", "ok": True}

    return None


def _clean_place_name(raw: str) -> str:
    p = (raw or "").strip().lower()
    p = re.sub(
        r"\b(please|today|right now|atm|currently|this (morning|afternoon|evening)|"
        r"like|out there|over there)\b",
        " ",
        p,
    )
    p = re.sub(r"\s+", " ", p).strip(" ?.,!'\"")
    return p


def _place_lookup_key(place: str) -> str:
    key = re.sub(
        r"\b(nsw|qld|vic|sa|wa|tas|nt|act|australia|au|new south wales)\b",
        " ",
        place or "",
        flags=re.I,
    )
    return re.sub(r"\s+", " ", key).strip().lower()


def resolve_weather_place(place: str) -> tuple[float, float, str] | None:
    """Known towns first, then Open-Meteo geocode (bare town name — not 'Temora NSW')."""
    cleaned = _clean_place_name(place) or "temora"
    key = _place_lookup_key(cleaned)
    if key in KNOWN_PLACES:
        return KNOWN_PLACES[key]

    # Prefer AU results for short town names.
    attempts: list[dict[str, Any]] = [
        {"name": key or cleaned, "count": 3, "language": "en", "format": "json", "country": "AU"},
        {"name": key or cleaned, "count": 3, "language": "en", "format": "json"},
    ]
    if cleaned != key:
        attempts.insert(0, {"name": cleaned, "count": 3, "language": "en", "format": "json", "country": "AU"})

    for params in attempts:
        if not params.get("name"):
            continue
        g_code, g_payload = http_json(
            "https://geocoding-api.open-meteo.com/v1/search?" + urllib.parse.urlencode(params),
            timeout=8.0,
        )
        results = (g_payload or {}).get("results") if isinstance(g_payload, dict) else None
        if g_code != 200 or not results:
            continue
        hit = results[0]
        lat, lon = hit.get("latitude"), hit.get("longitude")
        if lat is None or lon is None:
            continue
        label = ", ".join(
            str(x) for x in (hit.get("name"), hit.get("admin1"), hit.get("country_code")) if x
        )
        return float(lat), float(lon), label
    return None


def try_talk_mode(question: str) -> dict[str, Any] | None:
    """Switch Amy between casual chat and workshop / 3D-print personality."""
    q = re.sub(r"[^\w\s]", " ", (question or "").lower())
    q = re.sub(r"\s+", " ", q).strip()
    if not q:
        return None

    to_print = bool(
        re.search(
            r"\b((enter|enable|switch(\s+to)?|go(\s+into)?|turn\s+on|activate)\s+)?"
            r"(3d\s*print(ing)?|print(er)?|workshop|flightdeck)\s*mode\b"
            r"|\b(3d\s*print(ing)?\s*mode|print\s*mode|workshop\s*mode)\b",
            q,
        )
    )
    to_casual = bool(
        re.search(
            r"\b((enter|enable|switch(\s+to)?|go(\s+into)?|turn\s+on|activate|back\s+to)\s+)?"
            r"(normal|casual|regular|chat|human)\s*mode\b"
            r"|\b(exit|leave|drop|disable|turn\s+off)\s+(3d\s*print(ing)?|print(er)?|workshop)\s*mode\b",
            q,
        )
    )
    if to_print and not to_casual:
        RUNTIME["talk_mode"] = "print"
        return {
            "answer": "3D print mode on — printers, Flightdeck, workshop brain. Say normal mode when you want chill Amy back.",
            "nodes": [],
            "move_camera": False,
            "tool": "talk_mode",
            "ok": True,
            "talk_mode": "print",
        }
    if to_casual:
        RUNTIME["talk_mode"] = "casual"
        return {
            "answer": "Normal mode — just chatting like a person. Say 3D print mode if you want workshop Amy.",
            "nodes": [],
            "move_camera": False,
            "tool": "talk_mode",
            "ok": True,
            "talk_mode": "casual",
        }
    return None


def try_clock_weather(question: str) -> dict[str, Any] | None:
    """Local clock + Open-Meteo weather — no API key."""
    q = re.sub(r"[^\w\s'?]", " ", (question or "").lower())
    q = re.sub(r"\s+", " ", q).strip()
    if not q:
        return None

    wants_time = bool(
        re.search(
            r"\b(what('?s| is)? the time|what time is it|tell me the time|current time|"
            r"what('?s| is)? (the )?date|what day is it|today'?s date)\b",
            q,
        )
    )
    # "weather like in Temora" — the "like" used to eat the place capture.
    weather_m = re.search(
        r"\b(?:(?:what(?:'?s| is| was)|how(?:'?s| is)|tell me|give me)\s+(?:the\s+)?)?"
        r"(?:weather|temperature|forecast|how hot|how cold|is it raining)"
        r"(?:\s+like)?(?:\s+(?:in|for|at|around|near)\s+([a-z][a-z0-9\s\-']{1,40}))?",
        q,
    )
    wants_weather = bool(weather_m) or bool(re.search(r"\b(weather|forecast)\b", q))

    if wants_time and not wants_weather:
        now = datetime.now().astimezone()
        tz = now.tzname() or "local"
        clock = now.strftime("%I:%M %p").lstrip("0")
        answer = f"It's {clock} on {now.strftime('%A')} {now.day} {now.strftime('%B %Y')} ({tz})."
        return {"answer": answer, "nodes": [], "move_camera": False, "tool": "clock", "ok": True}

    if not wants_weather:
        return None

    place = ""
    if weather_m:
        place = _clean_place_name(weather_m.group(1) or "")
    if not place:
        place = "temora"  # bare name — "Temora NSW" returns zero Open-Meteo hits

    try:
        resolved = resolve_weather_place(place)
        if not resolved:
            return {
                "answer": f"Couldn't find “{place}” on the map, Chris — try a town name?",
                "nodes": [],
                "move_camera": False,
                "tool": "weather",
                "ok": False,
            }
        lat, lon, label = resolved
        w_code, w_payload = http_json(
            "https://api.open-meteo.com/v1/forecast?"
            + urllib.parse.urlencode(
                {
                    "latitude": lat,
                    "longitude": lon,
                    "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m",
                    "timezone": "auto",
                }
            ),
            timeout=8.0,
        )
        if w_code != 200 or not isinstance(w_payload, dict):
            return {
                "answer": f"Weather service blinked for {label}. Try again in a sec.",
                "nodes": [],
                "move_camera": False,
                "tool": "weather",
                "ok": False,
            }
        cur = w_payload.get("current") or {}
        temp = cur.get("temperature_2m")
        feel = cur.get("apparent_temperature")
        wind = cur.get("wind_speed_10m")
        humidity = cur.get("relative_humidity_2m")
        code = int(cur.get("weather_code") or 0)
        sky = {
            0: "clear",
            1: "mainly clear",
            2: "partly cloudy",
            3: "overcast",
            45: "foggy",
            48: "foggy",
            51: "light drizzle",
            61: "rain",
            63: "rain",
            65: "heavy rain",
            71: "snow",
            80: "showers",
            95: "thunderstorms",
        }.get(code, f"code {code}")
        bits = [f"{label}: {sky}"]
        if temp is not None:
            bits.append(f"{temp}°C")
        if feel is not None and feel != temp:
            bits.append(f"feels like {feel}°C")
        if wind is not None:
            bits.append(f"wind {wind} km/h")
        if humidity is not None:
            bits.append(f"humidity {humidity}%")
        answer = " — ".join(bits[:2])
        if len(bits) > 2:
            answer += " (" + ", ".join(bits[2:]) + ")"
        if wants_time:
            now = datetime.now().astimezone()
            answer += f". Local clock here: {now.strftime('%I:%M %p').lstrip('0')}."
        return {"answer": answer, "nodes": [], "move_camera": False, "tool": "weather", "ok": True}
    except Exception as exc:
        return {
            "answer": f"Weather lookup failed ({exc}).",
            "nodes": [],
            "move_camera": False,
            "tool": "weather",
            "ok": False,
        }


def try_tools(question: str) -> dict[str, Any] | None:
    for fn in (try_talk_mode, try_clock_weather, try_media_tools, tool_calibrate, tool_control, tool_status):
        result = fn(question)
        if result is not None:
            return result
    return None


def is_small_talk(question: str) -> bool:
    q = question.strip().lower()
    if len(q) < 3:
        return True
    patterns = [
        r"^(hi|hello|hey|yo)\b",
        r"^good (morning|afternoon|evening|night)\b",
        r"^(thanks|thank you|cheers)\b",
        r"^(how are you|what'?s up)\b",
        r"^(joke|tell me a joke)\b",
    ]
    return any(re.search(p, q) for p in patterns)


def chat_from_notes(question: str, attachments: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    notes = RUNTIME["index"] or load_index()
    files = list(attachments or [])
    att_text, image_b64, image_type = format_attachments_for_prompt(files)
    user_q = question
    if att_text:
        user_q = f"{question}\n\n--- Dropped files ---\n{att_text}"
    persona = active_persona()
    use_workshop = workshop_intent(question)

    if is_small_talk(question) and not files:
        with HISTORY_LOCK:
            history = list(CHAT_HISTORY[-HISTORY_LIMIT:])
        messages = [
            {"role": "system", "content": persona + "\nThis is small talk; keep it light."},
            *history,
            {"role": "user", "content": user_q},
        ]
        answer = openai_reply(messages)
        with HISTORY_LOCK:
            CHAT_HISTORY.append({"role": "user", "content": question})
            CHAT_HISTORY.append({"role": "assistant", "content": answer})
            del CHAT_HISTORY[:-HISTORY_LIMIT]
        return {"answer": answer, "nodes": [], "move_camera": False}

    top = score_notes(question, notes, limit=6) if use_workshop else []
    if not top:
        context = "(No matching notes.)"
        node_ids: list[int] = []
    else:
        chunks = []
        node_ids = []
        for n in top:
            node_ids.append(int(n["id"]))
            chunks.append(f"NOTE[{n['id']}] {n['label']}:\n{n.get('excerpt') or n.get('text') or ''}")
        context = "\n\n".join(chunks)

    if use_workshop:
        system = (
            persona
            + "\nWorkshop notes below are preferred for Flightdeck/printer facts."
            + "\nIf notes don't cover it, files are attached, or Chris wants live/web info — use web_search / fetch_url."
            + "\nKeep answers to two or three sentences unless a file needs a clearer walkthrough."
            + f"\n\nNOTES:\n{context}"
        )
    else:
        system = (
            persona
            + "\nNo workshop notes unless he asked about printers/Flightdeck."
            + "\nUse web_search / fetch_url for live/current info when needed."
            + "\nKeep answers to two or three sentences unless a file needs a clearer walkthrough."
        )
    with HISTORY_LOCK:
        history = list(CHAT_HISTORY[-HISTORY_LIMIT:])
    messages = [{"role": "system", "content": system}, *history, {"role": "user", "content": user_q}]
    answer = openai_chat_with_web(messages, image_b64=image_b64, media_type=image_type)
    with HISTORY_LOCK:
        CHAT_HISTORY.append({"role": "user", "content": question if not files else user_q[:500]})
        CHAT_HISTORY.append({"role": "assistant", "content": answer})
        del CHAT_HISTORY[:-HISTORY_LIMIT]
    move = bool(node_ids) and use_workshop and not is_small_talk(question) and not files
    return {
        "answer": answer,
        "nodes": node_ids,
        "move_camera": move,
        "attachments": [{"name": f.get("name"), "kind": f.get("kind"), "bytes": f.get("bytes")} for f in files],
        "talk_mode": RUNTIME.get("talk_mode") or "casual",
    }


def remember(text: str) -> dict[str, Any]:
    notes_dir = ROOT / str(RUNTIME["config"].get("notes_dir") or "notes")
    captures = notes_dir / "captures"
    captures.mkdir(parents=True, exist_ok=True)
    body = text.strip()
    for prefix in ("remember that", "note to self", "don't let me forget", "dont let me forget", "log this"):
        if body.lower().startswith(prefix):
            body = body[len(prefix) :].lstrip(" :,-")
            break
    if not body:
        raise ValueError("Nothing to remember")
    words = re.findall(r"[A-Za-z0-9]+", body)
    slug = "-".join(words[:8]).lower() or "capture"
    stamp = datetime.now().strftime("%Y-%m-%d")
    filename = f"{stamp}-{slug}.md"
    path = captures / filename
    content = f"# {body[:80]}\n\nDate: {stamp}\n\n{body}\n"
    path.write_text(content, encoding="utf-8")
    # Re-index live.
    from build import main as rebuild

    rebuild()
    load_index()
    notes = RUNTIME["index"]
    new_id = next((n["id"] for n in notes if n.get("path", "").endswith(filename)), None)
    related = score_notes(body, [n for n in notes if n.get("id") != new_id], limit=1)
    related_id = related[0]["id"] if related else 0
    return {
        "ok": True,
        "path": str(path.relative_to(notes_dir)).replace("\\", "/"),
        "id": new_id,
        "near": related_id,
        "answer": f"Got it, Kidabah — filed under {filename}.",
    }


def see(question: str, image_b64: str, media_type: str = "image/jpeg") -> dict[str, Any]:
    system = (
        active_persona()
        + "\nYou are looking at a live screen capture from Chris's desk. Answer specifically about what is visible."
        + " If the frame is too small or blurry to judge, say so plainly rather than guessing."
    )
    answer = openai_reply(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": question or "What am I looking at?"},
        ],
        image_b64=image_b64,
        media_type=media_type,
    )
    return {"answer": answer, "nodes": [], "move_camera": False}


class Handler(BaseHTTPRequestHandler):
    server_version = "AmyWorkshop/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[amy] {self.address_string()} {fmt % args}")

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def _audio(self, code: int, data: bytes, ctype: str = "audio/mpeg") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return b""
        if length > 12 * 1024 * 1024:
            raise ValueError("body too large")
        return self.rfile.read(length)

    def _read_json(self) -> dict[str, Any]:
        raw = self._read_body() or b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"bad json: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError("json object required")
        return data

    def _read_stt_audio(self) -> tuple[bytes, str]:
        """Accept JSON {audio:b64,mime} or multipart file/audio field."""
        ctype = (self.headers.get("Content-Type") or "").lower()
        if "multipart/form-data" in ctype:
            import email
            import email.policy

            raw = self._read_body()
            msg = email.message_from_bytes(
                f"Content-Type: {self.headers.get('Content-Type')}\r\n\r\n".encode() + raw,
                policy=email.policy.default,
            )
            for part in msg.iter_parts():
                name = part.get_param("name", header="content-disposition") or ""
                if name in ("file", "audio", "data"):
                    payload = part.get_payload(decode=True) or b""
                    mime = part.get_content_type() or "audio/webm"
                    fname = part.get_filename() or ""
                    if fname.lower().endswith(".wav") or payload[:4] == b"RIFF":
                        mime = "audio/wav"
                    return payload, mime.split(";")[0].strip()
            raise ValueError("multipart audio field missing")
        body = self._read_json()
        raw_b64 = str(body.get("audio") or body.get("data") or "").strip()
        if not raw_b64:
            raise ValueError("audio required")
        if "," in raw_b64 and raw_b64.startswith("data:"):
            header, raw_b64 = raw_b64.split(",", 1)
            mime = header.split(";")[0].split(":")[-1] if ":" in header else "audio/webm"
        else:
            mime = str(body.get("mime") or body.get("media_type") or "audio/webm")
        try:
            audio = base64.b64decode(raw_b64, validate=False)
        except Exception as exc:
            raise ValueError(f"bad audio base64: {exc}") from exc
        return audio, mime

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        if path in ("/config.json", "/../config.json") or path.endswith("/config.json"):
            self._json(403, {"detail": "config.json is not browser-reachable"})
            return
        if path == "/api/hello":
            notes = RUNTIME["index"] or load_index()
            hour = datetime.now().hour
            if hour < 12:
                tod = "morning"
            elif hour < 18:
                tod = "afternoon"
            else:
                tod = "evening"
            self._json(
                200,
                {
                    "greeting": "",
                    "note_count": len(notes),
                    "model": RUNTIME["config"].get("model") or "gpt-5.6-luna",
                    "provider": _brain_provider(RUNTIME["config"]),
                    "tts": tts_hello_payload()[0],
                    "tts_voice": tts_hello_payload()[1],
                    "name": "Amy",
                    "tod": tod,
                },
            )
            return
        if path == "/api/health":
            self._json(200, {"ok": True, "notes": len(RUNTIME["index"] or []), "name": "Amy"})
            return

        # Static viewer only — never serve project root.
        rel = path.lstrip("/") or "index.html"
        if ".." in rel or rel.startswith("/") or rel.startswith("\\"):
            self.send_error(404)
            return
        target = (VIEWER / rel).resolve()
        try:
            target.relative_to(VIEWER.resolve())
        except ValueError:
            self.send_error(404)
            return
        if not target.is_file():
            self.send_error(404)
            return
        data = target.read_bytes()
        ctype = "text/html; charset=utf-8"
        if target.suffix == ".js":
            ctype = "application/javascript; charset=utf-8"
        elif target.suffix == ".css":
            ctype = "text/css; charset=utf-8"
        elif target.suffix == ".json":
            ctype = "application/json; charset=utf-8"
        elif target.suffix == ".svg":
            ctype = "image/svg+xml"
        elif target.suffix == ".mp4":
            ctype = "video/mp4"
        elif target.suffix == ".webm":
            ctype = "video/webm"
        elif target.suffix == ".wav":
            ctype = "audio/wav"
        elif target.suffix == ".mp3":
            ctype = "audio/mpeg"
        elif target.suffix == ".gif":
            ctype = "image/gif"
        elif target.suffix == ".webp":
            ctype = "image/webp"
        elif target.suffix == ".png":
            ctype = "image/png"
        elif target.suffix in (".jpg", ".jpeg"):
            ctype = "image/jpeg"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if target.suffix in (".mp4", ".webm", ".wav", ".mp3", ".gif", ".webp"):
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "public, max-age=3600")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/stt":
            try:
                audio, mime = self._read_stt_audio()
                if not audio:
                    self._json(400, {"detail": "audio required"})
                    return
                ext = "webm"
                if "mp4" in mime or "m4a" in mime:
                    ext = "mp4"
                elif "wav" in mime:
                    ext = "wav"
                elif "ogg" in mime or "oga" in mime:
                    ext = "ogg"
                elif "mpeg" in mime or "mp3" in mime:
                    ext = "mp3"
                # OpenAI is picky about Content-Type params (e.g. codecs=opus) and
                # Edge MediaRecorder webm — client now prefers WAV; normalize mime anyway.
                mime = (mime or "audio/webm").split(";")[0].strip() or "audio/webm"
                if ext == "wav":
                    mime = "audio/wav"
                text = transcribe_openai(audio, filename=f"speech.{ext}", mime=mime)
                self._json(200, {"ok": True, "text": text})
            except ValueError as exc:
                self._json(400, {"detail": str(exc)})
            except RuntimeError as exc:
                self._json(503, {"detail": str(exc)})
            except Exception as exc:
                self._json(500, {"detail": str(exc)})
            return

        try:
            body = self._read_json()
        except ValueError as exc:
            self._json(400, {"detail": str(exc)})
            return

        try:
            if path == "/chat":
                question = str(body.get("question") or body.get("message") or "").strip()
                raw_atts = body.get("attachments") or []
                if not question and raw_atts:
                    question = "Have a look at what I dropped."
                if not question:
                    self._json(400, {"detail": "question required"})
                    return
                files: list[dict[str, Any]] = []
                if isinstance(raw_atts, list) and raw_atts:
                    for item in raw_atts[:4]:
                        if isinstance(item, dict):
                            files.append(decode_upload_payload(item))
                tool = try_tools(question) if not files else None
                if tool is not None:
                    self._json(200, tool)
                    return
                self._json(200, chat_from_notes(question, files))
                return

            if path == "/upload":
                # Optional pre-stage; chat also accepts attachments inline.
                raw_atts = body.get("files") or body.get("attachments") or [body]
                if not isinstance(raw_atts, list):
                    raw_atts = [raw_atts]
                saved = []
                for item in raw_atts[:4]:
                    if isinstance(item, dict):
                        saved.append(decode_upload_payload(item))
                if not saved:
                    self._json(400, {"detail": "file required"})
                    return
                self._json(
                    200,
                    {
                        "ok": True,
                        "files": [
                            {
                                "name": f["name"],
                                "kind": f["kind"],
                                "bytes": f["bytes"],
                                "path": f["path"],
                                "media_type": f["media_type"],
                                # Echo text/image back so the client can attach on /chat without re-read.
                                "text": f.get("text") or "",
                                "image": f.get("image_b64") or "",
                            }
                            for f in saved
                        ],
                    },
                )
                return

            if path == "/remember":
                text = str(body.get("text") or body.get("question") or "").strip()
                if not text:
                    self._json(400, {"detail": "text required"})
                    return
                self._json(200, remember(text))
                return

            if path == "/see":
                question = str(body.get("question") or "What am I looking at?").strip()
                image_b64 = str(body.get("image") or "").strip()
                media_type = str(body.get("media_type") or "image/jpeg")
                if not image_b64:
                    self._json(400, {"detail": "image required"})
                    return
                # Strip data-url prefix if present.
                if "," in image_b64 and image_b64.startswith("data:"):
                    header, image_b64 = image_b64.split(",", 1)
                    if "image/" in header:
                        media_type = header.split(";")[0].split(":")[1]
                # Validate base64 early.
                base64.b64decode(image_b64[:64] + "==", validate=False)
                self._json(200, see(question, image_b64, media_type))
                return

            if path == "/tts":
                text = str(body.get("text") or body.get("answer") or "").strip()
                if not text:
                    self._json(400, {"detail": "text required"})
                    return
                audio = synthesize_speech(text)
                self._audio(200, audio)
                return

            self._json(404, {"detail": "not found"})
        except RuntimeError as exc:
            self._json(503, {"detail": str(exc)})
        except Exception as exc:
            self._json(500, {"detail": str(exc)})


def main() -> None:
    cfg = load_config()
    # Build index if missing.
    if not INDEX_PATH.exists() or not (VIEWER / "graph-data.js").exists():
        from build import main as rebuild

        rebuild()
    load_index()
    UPLOADS.mkdir(parents=True, exist_ok=True)
    port = int(cfg.get("port") or 4700)
    bind = (
        (os.environ.get("AMY_BIND") or "").strip()
        or str(cfg.get("bind_host") or "").strip()
        or "0.0.0.0"
    )
    server = ThreadingHTTPServer((bind, port), Handler)
    print(f"Amy listening on http://{bind}:{port} - viewer only from {VIEWER}")
    print(f"Config: {CONFIG_PATH}")
    print(f"Notes indexed: {len(RUNTIME['index'])} | model={cfg.get('model')}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
