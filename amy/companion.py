"""Persistent Amy timers, project notebook and read-only printer announcements.

No model calls and no printer control commands. Each write is a SQLite transaction.
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


WORDS = dict(zip(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(),
    range(20),
))
WORDS.update(dict(zip("twenty thirty forty fifty sixty seventy eighty ninety".split(), range(20, 100, 10))))


def duration_seconds(text: str) -> int:
    value = re.sub(r"(?<=\w)-(?=[a-z])", " ", text.lower().strip())
    value = re.sub(r"\bhalf an? (hour|minute)\b", r"0.5 \1", value)
    value = re.sub(r"\ba quarter of an? hour\b", "15 minutes", value)
    total = 0.0
    for chunk in re.split(r"\s+and\s+(?=\d|[a-z])", value):
        # Also accepts 'one hour thirty minutes'. All input must be consumed.
        pos = 0
        for match in re.finditer(r"(.+?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\b", chunk):
            if match.start() != pos:
                raise ValueError("Use a duration such as five minutes or one hour thirty minutes.")
            raw = match[1].strip()
            if raw in ("a", "an"):
                amount = 1.0
            elif re.fullmatch(r"\d+(?:\.\d+)?", raw):
                amount = float(raw)
            elif raw and all(word in WORDS for word in raw.split()):
                parts = raw.split()
                if len(parts) > 2 or (len(parts) == 2 and (WORDS[parts[0]] < 20 or not 0 < WORDS[parts[1]] < 10)):
                    raise ValueError("I couldn't read that duration. Try five minutes.")
                amount = sum(WORDS[word] for word in parts)
            else:
                raise ValueError("I couldn't read that duration. Try five minutes.")
            unit = match[2]
            total += amount * (86400 if unit.startswith("day") else 3600 if unit.startswith(("hour", "hr")) else 60 if unit.startswith(("min",)) else 1)
            pos = match.end()
        if pos == 0 or chunk[pos:].strip():
            raise ValueError("Use a duration such as five minutes or one hour thirty minutes.")
    if not 1 <= total <= 30 * 86400:
        raise ValueError("Choose a duration from one second to thirty days.")
    return round(total)


def clean_command(text: str) -> str:
    text = re.sub(r"\s+", " ", text.replace("’", "'")).strip()
    for _ in range(5):
        text = re.sub(r"^(?:hey amy|amy|hey|please|can you|could you|would you)\b[ ,:]*", "", text, flags=re.I)
    return re.sub(r"(?:[, ]+(?:please|thanks|thank you))?[.!?]*$", "", text, flags=re.I).strip()


def result(answer: str, ok: bool = True) -> dict:
    return {"answer": answer, "ok": ok, "nodes": [], "move_camera": False, "tool": "companion"}


class Companion:
    def __init__(self, path: Path, *, clock=time.time, printers=None, timezone="Australia/Sydney"):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        self.printers = printers
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.threads = []
        self.monitor_error = ""
        self.monitor_checked = None
        try:
            self.timezone = ZoneInfo(timezone)
        except ZoneInfoNotFoundError:
            self.timezone = None  # System timezone fallback, reported in the UI.
        with self.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS timers (id INTEGER PRIMARY KEY, label TEXT NOT NULL,
                    due REAL NOT NULL, created REAL NOT NULL, state TEXT NOT NULL DEFAULT 'pending');
                CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
                    name_key TEXT NOT NULL UNIQUE, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL,
                    body TEXT NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, kind TEXT NOT NULL,
                    message TEXT NOT NULL, created REAL NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0,
                    spoken INTEGER NOT NULL DEFAULT 0, owner TEXT, lease REAL NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS printer_states (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS chat_history (
                    id INTEGER PRIMARY KEY,
                    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
                    content TEXT NOT NULL,
                    created REAL NOT NULL,
                    talk_mode TEXT NOT NULL DEFAULT 'casual',
                    tool TEXT NOT NULL DEFAULT '',
                    project_id INTEGER
                );
                CREATE INDEX IF NOT EXISTS chat_history_created ON chat_history(created DESC, id DESC);
            """)

    @contextmanager
    def db(self):
        with self.lock:
            db = sqlite3.connect(self.path, timeout=10)
            db.row_factory = sqlite3.Row
            try:
                with db:
                    yield db
            finally:
                db.close()

    @staticmethod
    def settings(db):
        values = {r["key"]: json.loads(r["value"]) for r in db.execute("SELECT * FROM settings")}
        return {"announcements": True, "away": False, "quiet_start": "", "quiet_end": "", "project_id": None, **values}

    def configure(self, changes: dict) -> dict:
        allowed = {"announcements", "away", "quiet_start", "quiet_end"}
        if set(changes) - allowed:
            raise ValueError("Unknown setting.")
        for key, value in changes.items():
            if key in ("announcements", "away") and not isinstance(value, bool):
                raise ValueError("On/off settings must be true or false.")
            if key.startswith("quiet_") and (not isinstance(value, str) or (value and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value))):
                raise ValueError("Quiet hours use 24-hour times, such as 22:00.")
        with self.db() as db:
            merged = {**self.settings(db), **changes}
            if bool(merged["quiet_start"]) != bool(merged["quiet_end"]):
                raise ValueError("Set both quiet-hour times, or clear both.")
            for key, value in changes.items():
                db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (key, json.dumps(value)))
        return merged

    def quiet(self, settings: dict) -> bool:
        start, end = settings["quiet_start"], settings["quiet_end"]
        if not start or not end or start == end:
            return False
        now = datetime.fromtimestamp(self.clock(), self.timezone).strftime("%H:%M")
        return start <= now < end if start < end else now >= start or now < end

    def add_timer(self, label: str, seconds: int) -> dict:
        label = label.strip()
        if not label or len(label) > 160 or not 1 <= seconds <= 30 * 86400:
            raise ValueError("Use a short timer name and a duration up to thirty days.")
        with self.db() as db:
            if db.execute("SELECT count(*) FROM timers WHERE state='pending'").fetchone()[0] >= 100:
                raise ValueError("You already have 100 timers. Cancel one first.")
            due = self.clock() + seconds
            row = db.execute("INSERT INTO timers(label,due,created) VALUES (?,?,?)", (label, due, self.clock()))
            return {"id": row.lastrowid, "label": label, "due": due}

    def cancel_timer(self, target: str) -> int:
        with self.db() as db:
            rows = list(db.execute("SELECT * FROM timers WHERE state='pending'"))
            if target.lower() != "all":
                rows = [r for r in rows if str(r["id"]) == target.lstrip("#") or r["label"].casefold() == target.casefold()]
            if len(rows) > 1 and target.lower() != "all":
                raise ValueError("There is more than one timer with that name. Use its timer number.")
            for row in rows:
                db.execute("UPDATE timers SET state='cancelled' WHERE id=?", (row["id"],))
            return len(rows)

    def select_project(self, name: str) -> dict:
        name = re.sub(r"\s+", " ", name).strip(" .,:\"'")
        if not name or len(name) > 80:
            raise ValueError("Give the project a name of one to eighty characters.")
        with self.db() as db:
            db.execute("INSERT OR IGNORE INTO projects(name,name_key,created) VALUES (?,?,?)", (name, name.casefold(), self.clock()))
            project = dict(db.execute("SELECT * FROM projects WHERE name_key=?", (name.casefold(),)).fetchone())
            db.execute("INSERT OR REPLACE INTO settings VALUES ('project_id',?)", (json.dumps(project["id"]),))
            return project

    def add_note(self, body: str, project_name: str | None = None) -> str:
        body = body.strip()
        if not body or len(body) > 4000:
            raise ValueError("Use a note between one and four thousand characters.")
        with self.db() as db:
            if project_name:
                # Explicitly naming a project selects it for follow-up notes too.
                project = self.select_project(project_name)
            else:
                project = db.execute("SELECT * FROM projects WHERE id=?", (self.settings(db)["project_id"],)).fetchone()
            if not project:
                raise ValueError("Choose a project first: work on the windmill project.")
            db.execute("INSERT INTO notes(project_id,body,created) VALUES (?,?,?)", (project["id"], body, self.clock()))
            return project["name"]

    def project_notes(self, name: str | None = None) -> dict | None:
        with self.db() as db:
            if name:
                row = db.execute("SELECT * FROM projects WHERE name_key=?", (name.strip().casefold(),)).fetchone()
            else:
                row = db.execute("SELECT * FROM projects WHERE id=?", (self.settings(db)["project_id"],)).fetchone()
            if not row:
                return None
            project = dict(row)
            project["notes"] = [dict(r) for r in db.execute("SELECT * FROM notes WHERE project_id=? ORDER BY id DESC LIMIT 100", (row["id"],))]
            return project

    def add_chat_turn(self, role: str, content: str, *, talk_mode: str = "casual", tool: str = "") -> int:
        """Persist a bounded transcript entry; binary attachments are never stored."""
        role = str(role or "").strip().lower()
        content = str(content or "").strip()
        if role not in {"user", "assistant"} or not content:
            raise ValueError("Chat history entries need a user or assistant role and text.")
        content = content[:12000]
        with self.db() as db:
            project = self.settings(db).get("project_id")
            row = db.execute(
                "INSERT INTO chat_history(role,content,created,talk_mode,tool,project_id) VALUES (?,?,?,?,?,?)",
                (role, content, self.clock(), str(talk_mode or "casual")[:20], str(tool or "")[:80], project),
            )
            # Retain a useful long-term transcript without allowing the notebook to grow forever.
            db.execute("DELETE FROM chat_history WHERE id NOT IN (SELECT id FROM chat_history ORDER BY id DESC LIMIT 2000)")
            return int(row.lastrowid)

    def history_messages(self, limit: int = 24) -> list[dict[str, str]]:
        limit = max(1, min(int(limit), 100))
        with self.db() as db:
            rows = list(db.execute(
                "SELECT role,content FROM chat_history ORDER BY id DESC LIMIT ?", (limit,)
            ))
        return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]

    def chat_history(self, query: str = "", limit: int = 100) -> list[dict]:
        query = " ".join(str(query or "").split())[:200]
        limit = max(1, min(int(limit), 200))
        with self.db() as db:
            if query:
                rows = db.execute(
                    "SELECT id,role,content,created,talk_mode,tool FROM chat_history WHERE content LIKE ? ORDER BY id DESC LIMIT ?",
                    (f"%{query}%", limit),
                )
            else:
                rows = db.execute(
                    "SELECT id,role,content,created,talk_mode,tool FROM chat_history ORDER BY id DESC LIMIT ?", (limit,)
                )
            return [dict(r) for r in rows]

    def history_count(self) -> int:
        with self.db() as db:
            return int(db.execute("SELECT count(*) FROM chat_history").fetchone()[0])

    def clear_history(self, query: str = "") -> int:
        query = " ".join(str(query or "").split())[:200]
        with self.db() as db:
            if query:
                result = db.execute("DELETE FROM chat_history WHERE content LIKE ?", (f"%{query}%",))
            else:
                result = db.execute("DELETE FROM chat_history")
            return int(result.rowcount)

    def _event(self, db, kind: str, message: str):
        db.execute("INSERT INTO events(kind,message,created) VALUES (?,?,?)", (kind, message, self.clock()))

    def tick(self):
        with self.db() as db:
            due = list(db.execute("SELECT * FROM timers WHERE state='pending' AND due<=?", (self.clock(),)))
            for timer in due:
                db.execute("UPDATE timers SET state='done' WHERE id=? AND state='pending'", (timer["id"],))
                self._event(db, "timer", f"Chris, your reminder is due: {timer['label']}.")
            # Keep pending reminders until acknowledged; bound old acknowledged history.
            db.execute("DELETE FROM events WHERE acknowledged=1 AND created<?", (self.clock() - 30 * 86400,))
            db.execute("DELETE FROM timers WHERE state!='pending' AND due<?", (self.clock() - 30 * 86400,))

    def observe_printers(self, printers: list[dict]):
        if not isinstance(printers, list) or not printers:
            raise ValueError("Flightdeck returned no printer statuses.")
        with self.db() as db:
            enabled = self.settings(db)["announcements"]
            for printer in printers:
                if not isinstance(printer, dict) or not printer.get("id"):
                    continue
                pid = str(printer["id"])
                state = str(printer.get("state") or "unknown").lower()
                current = {"state": state, "error": str(printer.get("error") or ""),
                           "finished": printer.get("_last_finished_print_id"), "job": printer.get("_current_print_id")}
                previous = db.execute("SELECT snapshot FROM printer_states WHERE id=?", (pid,)).fetchone()
                old = json.loads(previous[0]) if previous else None
                name = str(printer.get("custom_name") or {"h2d": "BigBoy", "o1c2": "Big Girl", "x1c": "Little Boy"}.get(pid, pid))
                message = None
                if old and enabled:
                    if state in ("offline", "disconnected") and old["state"] not in ("offline", "disconnected"):
                        message = f"{name} has gone offline."
                    elif state not in ("offline", "disconnected", "unknown") and old["state"] in ("offline", "disconnected"):
                        message = f"{name} is back online; status is {state}."
                    elif current["error"] and current["error"] != old["error"]:
                        message = f"{name} reports an error: {current['error'][:240]}"
                    elif state in ("error", "failed") and state != old["state"]:
                        message = f"{name} reports {state}. Please check the printer."
                    elif state == "paused" and old["state"] != "paused":
                        message = f"{name} has paused."
                    elif (current["finished"] is not None and current["finished"] != old.get("finished")) or (state in ("finished", "complete", "completed") and state != old["state"]):
                        message = f"{name} has finished a print."
                    elif state == "idle" and old["state"] in ("printing", "paused"):
                        # Idle can also mean cancellation: never claim success from it alone.
                        message = f"{name} is now idle."
                    elif state == "printing" and old["state"] == "paused":
                        message = f"{name} has resumed printing."
                db.execute("INSERT OR REPLACE INTO printer_states VALUES (?,?)", (pid, json.dumps(current)))
                if message:
                    self._event(db, "printer", message)
        self.monitor_error = ""
        self.monitor_checked = self.clock()

    def snapshot(self) -> dict:
        self.tick()
        with self.db() as db:
            settings = self.settings(db)
            return {"ok": True, "now": self.clock(), "settings": settings, "quiet": self.quiet(settings),
                    "timezone": str(self.timezone) if self.timezone else "system local time",
                    "timers": [dict(r) for r in db.execute("SELECT * FROM timers WHERE state='pending' ORDER BY due")],
                    "projects": [dict(r) for r in db.execute("SELECT id,name FROM projects ORDER BY name_key")],
                    "project": self.project_notes(),
                    "history_count": self.history_count(),
                    "events": [dict(r) for r in db.execute("SELECT id,kind,message,created,acknowledged,spoken FROM events ORDER BY id DESC LIMIT 100")],
                    "monitor": {"error": self.monitor_error, "checked": self.monitor_checked}}

    def event_action(self, event_id: int, action: str, owner: str = "") -> dict:
        if action not in ("ack", "claim", "spoken", "release"):
            raise ValueError("Unknown alert action.")
        if action != "ack" and (not owner or len(owner) > 100):
            raise ValueError("A valid listener ID is required.")
        with self.db() as db:
            event = db.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
            if not event:
                raise ValueError("That alert no longer exists.")
            if action == "ack":
                db.execute("UPDATE events SET acknowledged=1,spoken=1 WHERE id=?", (event_id,))
                return {"ok": True}
            settings = self.settings(db)
            if action == "claim":
                blocked = settings["away"] or self.quiet(settings) or (event["kind"] == "printer" and not settings["announcements"])
                # Old printer alerts stay visible, but are not read out hours later.
                expired = event["kind"] == "printer" and event["created"] < self.clock() - 300
                if blocked or expired or event["spoken"] or event["acknowledged"] or event["lease"] > self.clock():
                    return {"ok": True, "claimed": False}
                db.execute("UPDATE events SET owner=?,lease=? WHERE id=?", (owner, self.clock() + 90, event_id))
                return {"ok": True, "claimed": True}
            if event["owner"] == owner:
                db.execute("UPDATE events SET spoken=?,owner=NULL,lease=0 WHERE id=?", (1 if action == "spoken" else 0, event_id))
            return {"ok": True}

    def command(self, raw: str) -> dict | None:
        q = clean_command(raw)
        if not q:
            return None
        try:
            if re.fullmatch(r"(?:show|list|open)(?: my| the)? (?:chat|conversation) history|what did we talk about", q, re.I):
                count = self.history_count()
                return result(f"I have {count} saved chat entr{'y' if count == 1 else 'ies'} in my history. Open the notebook to search them.")
            match = re.fullmatch(r"(?:search|find) (?:my )?(?:chat|conversation) history(?: for)? (.+)", q, re.I)
            if match:
                rows = self.chat_history(match[1], limit=3)
                if not rows:
                    return result(f"I couldn't find that in saved chat history, Chris.")
                snippets = "; ".join(f"{row['role']}: {row['content'][:180]}" for row in reversed(rows))
                return result(f"I found {len(rows)} matching entr{'y' if len(rows) == 1 else 'ies'}: {snippets}")
            if re.fullmatch(r"(?:clear|delete|forget|erase)(?: all)? (?:my )?(?:chat|conversation) history", q, re.I):
                count = self.clear_history()
                return result(f"Cleared {count} saved chat entr{'y' if count == 1 else 'ies'}.")
            if re.fullmatch(r"(?:what(?:'s| are)|show|list)(?: my| the| active)? (?:timers|reminders)", q, re.I):
                timers = self.snapshot()["timers"]
                text = "; ".join(f"timer {t['id']}, {t['label']}, {max(1, round(t['due'] - self.clock()))} seconds left" for t in timers)
                return result(text or "You have no active timers or reminders.")
            match = re.fullmatch(r"cancel (?:the |my )?(?:timer|reminder) (.+)|cancel (.+?) (?:timer|reminder)|cancel (all) (?:timers|reminders)", q, re.I)
            if match:
                count = self.cancel_timer(next(g for g in match.groups() if g is not None))
                return result(f"Cancelled {count} timer{'s' if count != 1 else ''}." if count else "I couldn't find that active timer. Say list my timers.")
            if re.match(r"^(?:remind me|don't let me forget|dont let me forget)\b", q, re.I):
                if re.match(r"^(?:don't|dont) let me forget\b", q, re.I) and not re.search(r"\bin\b", q, re.I):
                    return None  # Preserve the existing untimed note-capture phrase.
                match = re.fullmatch(r"(?:remind me|don't let me forget|dont let me forget) to (.+) in (.+)", q, re.I)
                if match:
                    label, duration = match.groups()
                else:
                    match = re.fullmatch(r"remind me in (.+?) to (.+)", q, re.I)
                    if not match:
                        return result("Give me a duration too: remind me to check the first layer in five minutes.", False)
                    duration, label = match.groups()
                timer = self.add_timer(label, duration_seconds(duration))
                return result(f"Reminder {timer['id']} set: {label}, in {duration}. It will stay on my list if Amy closes.")
            if re.match(r"^(?:set|start)\b.*\btimer\b", q, re.I):
                body = re.sub(r"^(?:set|start) (?:an? |the )?", "", q, flags=re.I)
                match = re.fullmatch(r"(?:(.+?) )?timer for (.+)", body, re.I)
                if match:
                    label, duration = match.groups()
                    label = label or "Timer"
                    named = re.fullmatch(r"(.+?) (?:called|named) (.+)", duration, re.I)
                    if named:
                        duration, label = named.groups()
                else:
                    match = re.fullmatch(r"(.+?) timer(?: (?:called|named|for) (.+))?", body, re.I)
                    if not match:
                        return result("Try: set a five minute timer called first layer.", False)
                    duration, label = match.groups()
                    label = label or "Timer"
                timer = self.add_timer(label, duration_seconds(duration))
                return result(f"Timer {timer['id']} set: {label}, for {duration}.")
            match = re.fullmatch(r"(?:turn |switch )?(?:printer )?(?:announcements|printer alerts) (on|off)|(?:(enable|disable) (?:printer )?(?:announcements|alerts))", q, re.I)
            if match:
                enabled = (match[1] or match[2]).lower() in ("on", "enable")
                self.configure({"announcements": enabled})
                return result(f"Printer announcements {'on' if enabled else 'off'}.")
            if re.fullmatch(r"i'm away|i am away|away mode", q, re.I):
                self.configure({"away": True})
                return result("Away mode on. I'll keep reminders and alerts here, quietly.")
            if re.fullmatch(r"i'm back|i am back|away mode off", q, re.I):
                self.configure({"away": False})
                return result("Welcome back, Chris. Your reminders and recent alerts are in the notebook.")
            match = re.fullmatch(r"(?:work on|switch to|open) (?:the )?(.+?) project|(?:create|select|open) (?:a )?project (?:called )?(.+)", q, re.I)
            if match:
                project = self.select_project(match[1] or match[2])
                return result(f"Current project: {project['name']}. Say remember that, followed by your note.")
            if re.fullmatch(r"(?:show|list)(?: my| the)? projects", q, re.I):
                names = [p["name"] for p in self.snapshot()["projects"]]
                return result("Your projects: " + ", ".join(names) + "." if names else "No projects yet. Say work on the windmill project.")
            if re.fullmatch(r"(?:leave|clear|close)(?: the| my)? (?:current )?project", q, re.I):
                with self.db() as db:
                    db.execute("INSERT OR REPLACE INTO settings VALUES ('project_id','null')")
                return result("Project closed. Its notes are still saved.")
            match = re.fullmatch(r"remember(?: this| that)? for (?:the )?(.+?) project\s*[:,]\s*(.+)", q, re.I)
            if match:
                name = self.add_note(match[2], match[1])
                return result(f"Saved to {name}: {match[2]}")
            match = re.fullmatch(r"(?:where did we get to|project recap|what(?:'s| is) my current project)(?: (?:with|on) (?:the )?(.+?) project)?", q, re.I)
            if match:
                project = self.project_notes(match[1])
                if not project:
                    return result("Choose a saved project, or say work on the windmill project.")
                notes = project["notes"][:5]
                return result(f"{project['name']}: " + ("; ".join(n["body"] for n in reversed(notes)) if notes else "No notes yet.") + (" More notes are in the notebook." if len(project["notes"]) > 5 else ""))
            match = re.fullmatch(r"(?:remember that|remember this|note to self|log this)\s*[:,]?\s+(.+)", q, re.I)
            if match and self.project_notes():
                name = self.add_note(match[1])
                return result(f"Saved to {name}: {match[1]}")
            return None
        except ValueError as exc:
            return result(str(exc), False)

    def start(self):
        def timers():
            while not self.stop_event.is_set():
                try:
                    self.tick()
                except Exception as exc:
                    print(f"[amy-companion] timer check failed: {exc}")
                self.stop_event.wait(1)

        def monitor():
            while not self.stop_event.is_set():
                try:
                    self.observe_printers(self.printers())
                except Exception:
                    self.monitor_error = "Flightdeck is unreachable; printer status is unconfirmed."
                self.stop_event.wait(15)

        for target in ([timers, monitor] if self.printers else [timers]):
            thread = threading.Thread(target=target, daemon=True, name="amy-" + target.__name__)
            self.threads.append(thread)
            thread.start()

    def stop(self):
        self.stop_event.set()
        for thread in self.threads:
            thread.join(timeout=2)
