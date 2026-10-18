#!/usr/bin/env python3
"""Probe OpenAI with Amy's config — prints status/body, never the key."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

CFG = Path("/home/flightdeck/flightdeck/amy/config.json")


def main() -> None:
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    key = str(cfg.get("openai_api_key") or "")
    base = str(cfg.get("openai_base_url") or "https://api.openai.com/v1").rstrip("/")
    model = str(cfg.get("model") or "gpt-4o-mini")
    print("model", model)
    print("base", base)
    print("key_ready", bool(key) and key.startswith("sk-"))
    print("key_prefix", key[:10] + "..." if len(key) > 10 else "short")

    body = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with exactly: pong"}],
        "max_tokens": 8,
        "temperature": 0,
    }
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "amy-probe/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            print("http", resp.status)
            data = json.loads(raw)
            print("ok", True)
            print("reply", data["choices"][0]["message"]["content"][:80])
            usage = data.get("usage") or {}
            print("usage", usage)
            # headers that matter
            for h in (
                "x-ratelimit-limit-requests",
                "x-ratelimit-remaining-requests",
                "x-ratelimit-reset-requests",
                "x-ratelimit-limit-tokens",
                "x-ratelimit-remaining-tokens",
            ):
                if resp.headers.get(h):
                    print(h, resp.headers.get(h))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        print("http", exc.code)
        print("headers_retry_after", exc.headers.get("retry-after"))
        for h in (
            "x-ratelimit-limit-requests",
            "x-ratelimit-remaining-requests",
            "x-ratelimit-reset-requests",
        ):
            if exc.headers.get(h):
                print(h, exc.headers.get(h))
        try:
            err = json.loads(raw)
        except json.JSONDecodeError:
            print("body", raw[:500])
            return
        e = (err.get("error") or err)
        print("type", e.get("type") if isinstance(e, dict) else None)
        print("code", e.get("code") if isinstance(e, dict) else None)
        print("message", (e.get("message") if isinstance(e, dict) else str(e))[:400])
    except Exception as exc:
        print("ERR", type(exc).__name__, str(exc)[:300])


if __name__ == "__main__":
    main()
