# Amy (workshop)

Voice + notes galaxy for Chris's Flightdeck bench. She's Amy — not Jarvis.

## Hosting

Runs on the Flightdeck Pi (`jarvis/` in repo, user systemd unit still named `jarvis.service`). Port **4700**.

**Use HTTPS for the mic:**

https://flightdeck.tail7de73e.ts.net:4700

Plain `http://` only gets you speakers — Chrome blocks the microphone on insecure origins.

## Setup

1. Copy `config.example.json` → `config.json` and paste your OpenAI (or OpenRouter) key.
2. `python3 build.py`
3. `systemctl --user restart jarvis`
4. Open the HTTPS URL — click once to unlock speech, then talk or type.

## Flightdeck voice tools

- "Run a calibration on BigBoy"
- "What's BigBoy doing?"
- "Pause X1C" / "Resume Big Girl"

Printer aliases: BigBoy→`h2d`, Big Girl→`o1c2`, X1C→`x1c`, Greyhound/Voron→`greyhound`.

## Preflight

```bash
python3 preflight.py
```
