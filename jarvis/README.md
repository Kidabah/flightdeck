# Jarvis (workshop)

Voice + notes galaxy for Chris's Flightdeck bench.

## Hosting note

Planned for a dedicated 16GB Pi once a spare PSU exists. **Currently runs on the Flightdeck Pi** (`~/jarvis`, port **4700**) so it can call Flightdeck on localhost without moving the SSD.

## Setup

1. Copy `config.example.json` → `config.json` and paste your OpenAI (or OpenRouter) key.
2. `python3 build.py`
3. `python3 server.py`
4. Open `http://100.106.112.104:4700` (or the Pi Tailscale name) — click once to unlock speech, then talk or type.

Service (current Pi, no root sudo needed):

```bash
systemctl --user status jarvis
systemctl --user restart jarvis
```

## Flightdeck voice tools

- "Run a calibration on BigBoy"
- "What's BigBoy doing?"
- "Pause X1C" / "Resume Big Girl"

Printer aliases: BigBoy→`h2d`, Big Girl→`o1c2`, X1C→`x1c`, Greyhound/Voron→`greyhound`.

## Preflight

With the server running:

```bash
python3 preflight.py
```

"Done" means preflight SUMMARY has 0 fail.
