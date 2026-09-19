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

## Desktop actions (allowlisted)

Hands can also (no arbitrary shell):

| Say… | Tool |
|------|------|
| Open C: / Downloads | `open_file_explorer` |
| Open this file | `open_file` |
| Open it in Notepad | `open_file_with` |
| Open Spotify and play | `launch_app` + `play` |
| Pause / next / previous / volume | `media_control` |
| Close the Spotify window | `close_window` |
| Minimise Spotify | `minimize_window` |
| Minimise everything | `minimize_all_windows` |
| Bring Spotify back | `restore_window` |

**Random album** → Cindy Vinyl (`/api/random-album`), not Spotify Hands.

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
