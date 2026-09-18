# Amy Hands (Windows PC companion)

Gives Amy access to **your folders** and **Chrome tabs** on this PC.

## Quick start

```powershell
cd C:\Users\Kidabah\flightdeck\jarvis\amy-hands
.\start-amy-hands.ps1
```

That starts Hands on **:4701** and opens the extension folder + `chrome://extensions`.

## Chrome extension (needed for tabs)

1. Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `jarvis/amy-hands/chrome-extension`
4. Keep Hands running; health should show `extension_seen_ago_s` updating

Folder search works **without** the extension. Tab list/focus/open need it.

## Point Amy (Pi) at Hands

In `jarvis/config.json` on the Pi:

```json
"hands_base_url": "http://YOUR-PC-TAILSCALE-IP:4701"
```

Then restart Amy.

Try:
- “Search my downloads for invoice”
- “Switch to the Flightdeck tab”
- “Open https://… in Chrome”
