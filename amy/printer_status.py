"""Recognise read-only printer questions and format Flightdeck's live job schema."""
import math
import re

from companion import clean_command

# Also used to generate the browser matcher, so screen sharing cannot steal these questions.
PREFIX = r"^(?:tell me|show me|let me know|find out|check(?: on)?|give me)\b[ ,:]*"
PRINTER = r"\b(?:big ?boy|big ?girl|little ?boy|h2[dc]|x1c?|o1c2|greyhound|voron|printers?|fleet|bench|bambu)\b"
VISUAL = r"\b(?:first layer|camera|appearance|quality|surface|defect|look|looks|looking)\b"
PATTERNS = [
    r"^(?:what(?:'s| is| are)|which)\b.*\b(?:printing|running|doing|status|state|current (?:job|print))\b",
    r"^what(?:'s| is| are)(?: currently)? on\b",
    r"^(?:what|which) (?:print|job|file|model)\b.*\b(?:on|printing|running|current|now)\b",
    r"^how(?:'s| is| are| far| long| much time)\b",
    r"^when\b.*\b(?:finish|finished|done|complete|ready)\b",
    r"^(?:is|are|has|have|did|does)\b.*\b(?:printing|running|paused|finished|done|complete|idle|ready|online|offline|stopped|busy|working|connected|cancelled|failed)\b",
    r"^(?:the |current |live )?(?:printer |fleet |bench )?(?:status|state|progress|time left|time remaining|current job|current print)\b",
    r"^.+?\b(?:status|state|progress|time left|time remaining|current job|current print)$",
]


def status_text(question):
    q = clean_command(question).casefold()
    for _ in range(3):
        q = re.sub(PREFIX, "", q)
    return q


def is_status_question(question):
    q = status_text(question)
    if re.search(VISUAL, q):
        return False
    # Generic printing questions can request the fleet; other asks need a printer reference.
    reference = re.search(PRINTER, q) or re.search(r"\b(?:printing|printers)\b", q)
    return bool(reference and any(re.search(pattern, q) for pattern in PATTERNS))


def _number(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None


def format_printer(printer, display=None):
    name = str(printer.get("custom_name") or display or printer.get("model_name") or printer.get("id") or "Printer")
    state = str(printer.get("state") or "unknown").lower()
    if state in {"offline", "disconnected", "unknown"}:
        return f"{name} is {state} in Flightdeck; I can't confirm what's currently printing."
    if state in {"idle", "ready", "standby"}:
        return f"{name} is {state}, with no active print reported."
    job = printer.get("job") if isinstance(printer.get("job"), dict) else {}
    title = next((str(job[k]).strip() for k in ("subtask_name", "name", "filename", "gcode_file") if str(job.get(k) or "").strip()), "")
    title = title.replace("\\", "/").rsplit("/", 1)[-1][:240]
    if state == "printing":
        answer = f"{name} is printing {title}" if title else f"{name} is printing, but Flightdeck hasn't supplied the job name"
    elif state == "paused":
        answer = f"{name} is paused" + (f" on {title}" if title else "")
    elif state in {"finished", "complete", "completed"}:
        return f"{name} reports the print finished" + (f": {title}." if title else ".")
    else:
        return f"{name} reports {state}" + (f"; reported job: {title}." if title else ".")
    parts = []
    progress = _number(job.get("progress"))
    if progress is not None and 0 <= progress <= 1:
        parts.append(f"{progress * 100:.0f} percent complete")
    elif job.get("progress") is None:
        percent = _number(job.get("percent"))
        if percent is not None and 0 <= percent <= 100:
            parts.append(f"{percent:.0f} percent complete")
    current, total = _number(job.get("layer_current")), _number(job.get("layer_total"))
    if current is not None and total is not None and 0 <= current <= total and total > 0:
        parts.append(f"layer {int(current)} of {int(total)}")
    eta = _number(job.get("eta_seconds"))
    if state == "printing" and eta is not None and eta > 0:
        minutes = math.ceil(eta / 60)
        hours, minutes = divmod(minutes, 60)
        duration = (f"{hours} hour{'s' if hours != 1 else ''}" if hours else "")
        if minutes:
            duration += (" " if hours else "") + f"{minutes} minute{'s' if minutes != 1 else ''}"
        parts.append(f"about {duration} remaining")
    return answer + (" — " + ", ".join(parts) if parts else "") + "."
