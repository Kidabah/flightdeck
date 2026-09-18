# Amy (workshop)

Voice + notes galaxy for Chris's Flightdeck bench. Brain: **GPT-5.6 Luna**.

## Hosting

Runs on the Flightdeck Pi (`jarvis/` folder in repo — systemd unit is still `jarvis.service`). Port **4700**.

**Use HTTPS for the mic:**

https://flightdeck.tail7de73e.ts.net:4700

## Drop coin in the slot (OpenAI prepaid credits)

1. Open **[Billing](https://platform.openai.com/settings/organization/billing/)**
2. Click **Add payment method** if needed, then **Add to credit balance** / **Buy credits**
3. Start with **$10–20** — plenty for Amy + light coding on Luna
4. Ignore ChatGPT Plus / team plan noise — Amy needs **API credits**, not a ChatGPT subscription

API keys: https://platform.openai.com/api-keys

## Setup

1. Copy `config.example.json` → `config.json` (model is already `gpt-5.6-luna`)
2. Paste key, or run `python3 deploy/set-openai-key.py`
3. `python3 build.py`
4. `systemctl --user restart jarvis`
5. Open the HTTPS URL — click once to unlock speech, then talk or type

## Flightdeck voice tools

- "Run a calibration on BigBoy"
- "What's BigBoy doing?"
- "Pause X1C" / "Resume Big Girl"

Printer aliases: BigBoy→`h2d`, Big Girl→`o1c2`, X1C→`x1c`, Greyhound/Voron→`greyhound`.

## Preflight

```bash
python3 preflight.py
```
