#!/usr/bin/env python3
import json
import urllib.request

req = urllib.request.Request(
    "http://127.0.0.1:4700/chat",
    data=json.dumps({"question": "Say hi to Kidabah in one short Amy line."}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode())
        print("status", r.status)
        print("answer", (data.get("answer") or "")[:240])
except Exception as e:
    body = e.read().decode() if hasattr(e, "read") else str(e)
    print("ERR", getattr(e, "code", e), body[:300])
