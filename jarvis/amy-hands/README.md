# Amy Hands (Windows PC companion)

Gives Amy access to **your folders** and **Chrome tabs** on this PC.

## Run Hands

```powershell
cd C:\Users\Kidabah\flightdeck\jarvis\amy-hands
copy config.example.json config.json
python amy_hands.py
```

Listens on **:4701**. Edit `config.json` `roots` to the folders she’s allowed to search.

## Chrome extension (tabs)

1. Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `jarvis/amy-hands/chrome-extension`
4. Keep Hands running; the extension polls every 0.8s

## Point Amy (Pi) at Hands

In `jarvis/config.json` on the Pi:

```json
"hands_base_url": "http://YOUR-PC-TAILSCALE-IP:4701"
```

Then restart Amy (`systemctl --user restart jarvis`).

Try:
- “Search my downloads for invoice”
- “Switch to the Flightdeck tab”
- “Open https://… in Chrome”
