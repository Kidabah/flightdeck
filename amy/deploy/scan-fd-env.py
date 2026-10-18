#!/usr/bin/env python3
from pathlib import Path

p = Path("/home/flightdeck/flightdeck/.env")
text = p.read_text(encoding="utf-8", errors="replace")
found = []
for line in text.splitlines():
    s = line.strip()
    if not s or s.startswith("#") or "=" not in s:
        continue
    k, v = s.split("=", 1)
    k = k.strip()
    v = v.strip().strip('"').strip("'")
    if "OPENAI" in k.upper() or k.upper().endswith("API_KEY"):
        ready = bool(v) and not v.startswith("PUT") and len(v) > 10
        kind = "sk" if v.startswith("sk") else f"len={len(v)}"
        found.append(f"{k} ready={ready} {kind}")
print("\n".join(found) if found else "none")
