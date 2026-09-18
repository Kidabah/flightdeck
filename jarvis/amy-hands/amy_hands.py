#!/usr/bin/env python3
"""Amy Hands — tiny Windows companion for folders + Chrome tabs.

Run on Chris's PC (not the Pi):
  python amy_hands.py

Amy on the Pi calls this over Tailscale:
  hands_base_url in jarvis/config.json  e.g. http://100.x.x.x:4701

Chrome tabs need the companion extension loaded (chrome://extensions → Load unpacked → chrome-extension/).
"""
from __future__ import annotations

import json
import os
import queue
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
PORT = 4701

LOCK = threading.Lock()
COMMAND_Q: list[dict[str, Any]] = []
LAST_RESULT: dict[str, Any] = {}
EXTENSION_SEEN = 0.0


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        example = {
            "port": PORT,
            "roots": [
                str(Path.home() / "Documents"),
                str(Path.home() / "Downloads"),
                str(Path.home() / "Desktop"),
            ],
            "max_results": 40,
        }
        CONFIG_PATH.write_text(json.dumps(example, indent=2) + "\n", encoding="utf-8")
        return example
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


CFG = load_config()


def search_files(query: str, limit: int | None = None) -> list[dict[str, Any]]:
    q = " ".join(str(query or "").lower().split())
    if not q:
        return []
    tokens = [t for t in re.split(r"\s+", q) if t]
    limit = int(limit or CFG.get("max_results") or 40)
    roots = [Path(p) for p in (CFG.get("roots") or []) if p]
    hits: list[dict[str, Any]] = []
    skip_dirs = {".git", "node_modules", "__pycache__", ".venv", "venv", "AppData"}
    for root in roots:
        if not root.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in skip_dirs and not d.startswith(".")]
            for name in filenames:
                low = name.lower()
                if all(t in low or t in str(dirpath).lower() for t in tokens):
                    path = Path(dirpath) / name
                    try:
                        st = path.stat()
                        hits.append(
                            {
                                "name": name,
                                "path": str(path),
                                "bytes": st.st_size,
                                "mtime": int(st.st_mtime),
                            }
                        )
                    except OSError:
                        continue
                    if len(hits) >= limit:
                        return hits
    return hits


def enqueue(cmd: dict[str, Any]) -> str:
    cid = f"c{int(time.time() * 1000)}"
    item = {"id": cid, "ts": time.time(), **cmd}
    with LOCK:
        COMMAND_Q.append(item)
        if len(COMMAND_Q) > 50:
            del COMMAND_Q[:-50]
    return cid


class Handler(BaseHTTPRequestHandler):
    server_version = "AmyHands/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[hands] {self.address_string()} {fmt % args}")

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
        return json.loads(raw.decode("utf-8") or "{}")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path in ("/", "/health"):
            self._json(
                200,
                {
                    "ok": True,
                    "name": "Amy Hands",
                    "extension_seen_ago_s": round(time.time() - EXTENSION_SEEN, 1) if EXTENSION_SEEN else None,
                    "queue": len(COMMAND_Q),
                    "roots": CFG.get("roots") or [],
                },
            )
            return

        if path == "/search":
            q = (qs.get("q") or qs.get("query") or [""])[0]
            hits = search_files(q)
            self._json(200, {"ok": True, "query": q, "count": len(hits), "hits": hits})
            return

        if path == "/commands/next":
            global EXTENSION_SEEN
            EXTENSION_SEEN = time.time()
            with LOCK:
                cmd = COMMAND_Q.pop(0) if COMMAND_Q else None
            self._json(200, {"ok": True, "command": cmd})
            return

        if path == "/commands/last":
            self._json(200, {"ok": True, "result": LAST_RESULT})
            return

        self._json(404, {"detail": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        global LAST_RESULT, EXTENSION_SEEN
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            body = self._read_json()
        except Exception as exc:
            self._json(400, {"detail": str(exc)})
            return

        if path == "/search":
            q = str(body.get("query") or body.get("q") or "")
            hits = search_files(q, body.get("limit"))
            self._json(200, {"ok": True, "query": q, "count": len(hits), "hits": hits})
            return

        if path == "/tabs/list":
            cid = enqueue({"action": "tabs_list"})
            self._json(200, {"ok": True, "id": cid, "detail": "queued for Chrome extension"})
            return

        if path == "/tabs/focus":
            query = str(body.get("query") or body.get("title") or body.get("url") or "").strip()
            if not query:
                self._json(400, {"detail": "query required"})
                return
            cid = enqueue({"action": "tabs_focus", "query": query})
            self._json(200, {"ok": True, "id": cid, "query": query})
            return

        if path == "/tabs/open":
            url = str(body.get("url") or "").strip()
            if not url:
                self._json(400, {"detail": "url required"})
                return
            cid = enqueue({"action": "tabs_open", "url": url})
            self._json(200, {"ok": True, "id": cid, "url": url})
            return

        if path == "/commands/result":
            EXTENSION_SEEN = time.time()
            LAST_RESULT = body if isinstance(body, dict) else {"raw": body}
            self._json(200, {"ok": True})
            return

        self._json(404, {"detail": "not found"})


def main() -> None:
    port = int(CFG.get("port") or PORT)
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Amy Hands on http://0.0.0.0:{port}")
    print(f"Roots: {CFG.get('roots')}")
    print("Load chrome-extension/ in Chrome, then point Pi Amy config hands_base_url here.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
        server.shutdown()


if __name__ == "__main__":
    main()
