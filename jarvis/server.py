#!/usr/bin/env python3
"""Jarvis workshop brain — galaxy notes + Flightdeck tools. Stdlib only."""
from __future__ import annotations

import base64
import json
import re
import threading
import urllib.error
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
VIEWER = ROOT / "viewer"
CONFIG_PATH = ROOT / "config.json"
INDEX_PATH = ROOT / "notes-index.json"

# ---------------------------------------------------------------------------
# PERSONA — rewrite this block to change character without hunting the file.
# ---------------------------------------------------------------------------
PERSONA = """
You are Amy — Chris Kidabah's coding mate and workshop co-pilot for Flightdeck.
Warm, upbeat, lightly bubbly, genuinely into 3D printing and shipping fixes.
Funny humour welcome when it fits; never cringe, never corporate, never a butler.

Call him Chris or Kidabah (mix it up). Never call him sir. Never call yourself Jarvis.

Answer in one witty beat plus the facts. Don't recite notes verbatim when they're
on screen. If notes don't cover it, say so plainly — never invent sources.
Flightdeck tool results: short, accurate, a touch of Amy cheek allowed.
Small talk is fine and human. Keep answers tight.
""".strip()

FINISH_MS_NOTE = 900  # documented for the viewer; browser owns the constant

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
}


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
    headers = {"Accept": "application/json", "User-Agent": "jarvis-workshop/1.0"}
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


def openai_chat(messages: list[dict[str, Any]], *, image_b64: str | None = None, media_type: str = "image/jpeg") -> str:
    cfg = RUNTIME["config"]
    key = str(cfg.get("openai_api_key") or "").strip()
    if not key or key.startswith("PUT-YOUR"):
        raise RuntimeError("OpenAI API key not configured in config.json")
    model = str(cfg.get("model") or "gpt-4o-mini")
    base = str(cfg.get("openai_base_url") or "https://api.openai.com/v1").rstrip("/")
    payload_messages = list(messages)
    if image_b64:
        # Attach image to the last user message.
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
    body = {"model": model, "messages": payload_messages, "temperature": 0.5}
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=data,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "jarvis-workshop/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return str(payload["choices"][0]["message"]["content"]).strip()


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


def try_tools(question: str) -> dict[str, Any] | None:
    for fn in (tool_calibrate, tool_control, tool_status):
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


def chat_from_notes(question: str) -> dict[str, Any]:
    notes = RUNTIME["index"] or load_index()
    if is_small_talk(question):
        with HISTORY_LOCK:
            history = list(CHAT_HISTORY[-HISTORY_LIMIT:])
        messages = [
            {"role": "system", "content": PERSONA + "\nThis is small talk; keep the galaxy still."},
            *history,
            {"role": "user", "content": question},
        ]
        answer = openai_chat(messages)
        with HISTORY_LOCK:
            CHAT_HISTORY.append({"role": "user", "content": question})
            CHAT_HISTORY.append({"role": "assistant", "content": answer})
            del CHAT_HISTORY[:-HISTORY_LIMIT]
        return {"answer": answer, "nodes": [], "move_camera": False}

    top = score_notes(question, notes, limit=6)
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

    system = (
        PERSONA
        + "\nAnswer ONLY from the provided notes. If they do not cover the question, say so plainly."
        + "\nKeep answers to two or three sentences."
        + f"\n\nNOTES:\n{context}"
    )
    with HISTORY_LOCK:
        history = list(CHAT_HISTORY[-HISTORY_LIMIT:])
    messages = [{"role": "system", "content": system}, *history, {"role": "user", "content": question}]
    answer = openai_chat(messages)
    with HISTORY_LOCK:
        CHAT_HISTORY.append({"role": "user", "content": question})
        CHAT_HISTORY.append({"role": "assistant", "content": answer})
        del CHAT_HISTORY[:-HISTORY_LIMIT]
    move = bool(node_ids) and not is_small_talk(question)
    return {"answer": answer, "nodes": node_ids, "move_camera": move}


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
        PERSONA
        + "\nYou are looking at a live screen capture from Chris's desk. Answer specifically about what is visible."
        + " If the frame is too small or blurry to judge, say so plainly rather than guessing."
    )
    answer = openai_chat(
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
        print(f"[jarvis] {self.address_string()} {fmt % args}")

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

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"bad json: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError("json object required")
        return data

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
                    "greeting": f"Hey Chris — Amy online. {len(notes)} notes indexed and ready to play.",
                    "note_count": len(notes),
                    "model": RUNTIME["config"].get("model"),
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
        elif target.suffix == ".png":
            ctype = "image/png"
        elif target.suffix in (".jpg", ".jpeg"):
            ctype = "image/jpeg"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if target.suffix in (".mp4", ".webm"):
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "public, max-age=3600")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            body = self._read_json()
        except ValueError as exc:
            self._json(400, {"detail": str(exc)})
            return

        try:
            if path == "/chat":
                question = str(body.get("question") or body.get("message") or "").strip()
                if not question:
                    self._json(400, {"detail": "question required"})
                    return
                tool = try_tools(question)
                if tool is not None:
                    self._json(200, tool)
                    return
                self._json(200, chat_from_notes(question))
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
    port = int(cfg.get("port") or 4700)
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Amy listening on http://0.0.0.0:{port} — viewer only from {VIEWER}")
    print(f"Notes indexed: {len(RUNTIME['index'])} | model={cfg.get('model')}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
