# Amy desktop (Windows)

Local-brain wrap around the existing Amy stack. **Does not replace** Pi browser Amy
(`https://flightdeck.tail7de73e.ts.net:4700`).

## What it does

1. Starts **Amy Hands** on `127.0.0.1:4701` (or reuses if already up)
2. Starts **Amy** `server.py` on `127.0.0.1:4700`
3. Opens a **WebView2** window to the same UI (`viewer/index.html`)

Flightdeck / printers still talk to the Pi over Tailscale via `flightdeck_base_url`.

## Dev launch (no freeze)

```powershell
cd C:\Users\Kidabah\flightdeck\jarvis\desktop
.\start-amy-desktop.ps1
```

Opens **Chrome app mode** (mic works) + a **visible Amy Hands console**. Leave the PowerShell window open.

If mic fails in the framed WebView window, close that and use Chrome at `http://127.0.0.1:4700` instead (`--webview` is optional / flaky for speech).

- `hands_base_url`: `http://127.0.0.1:4701`
- `bind_host`: `127.0.0.1`
- `flightdeck_base_url`: Pi Tailscale (`http://100.106.112.104:8000` by default)

Paste your **OpenAI** and **ElevenLabs** keys into that AppData config (never commit them).

## Chrome tabs

Folder search works with Hands alone. Tabs still need the unpacked extension:

1. `chrome://extensions` → Developer mode
2. Load unpacked → `jarvis/amy-hands/chrome-extension`

Or run `jarvis/amy-hands/start-amy-hands.ps1` for the helper prompts.

## Build installable folder

```powershell
cd C:\Users\Kidabah\flightdeck\jarvis\desktop
.\build-windows.ps1
```

Output: `jarvis/desktop/dist/Amy/Amy.exe` (one-folder). Copy that folder anywhere;
first run still uses `%APPDATA%\Amy\config.json`.

Requires [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (already on most Win10/11 boxes).

## Env knobs (advanced)

| Env | Purpose |
|-----|---------|
| `AMY_ROOT` | jarvis tree (viewer, notes, server.py) |
| `AMY_CONFIG` | config.json path |
| `AMY_UPLOADS` | upload directory |
| `AMY_BIND` | server bind host (desktop forces `127.0.0.1`) |

Pi continues to use repo `jarvis/config.json` and bind `0.0.0.0` unless overridden.
