# Amy (workshop)

## Notebook: timers, project memory and printer announcements

Open **NOTEBOOK** beside Amy's face. All three features work without a language-model call.

- “Amy, remind me to check the first layer in five minutes.”
- “Set a ten minute timer called glue.” / “List my timers.” / “Cancel timer 2.”
- “Work on the windmill project.”
- “Remember that the axle is 6 mm.” (saved to the current project)
- “Remember this for the windmill project: try PETG next.”
- “Where did we get to?” / “Where did we get to with the windmill project?”
- “List my projects.” / “Close current project.” (keeps its notes)
- “Printer announcements off.” / “Printer announcements on.”
- “I'm away.” / “I'm back.”
- “Link the repository to C:\\Users\\Kidabah\\flightdeck.” (saved to the current project)
- “Plan code add a camera status badge.” (read-only coding plan)
- “Implement add a camera status badge.” (edits the configured repository, runs focused checks, and saves the summary)
- “Review the code for the camera panel.” (read-only repository review)
- “Move the Notebook underneath Folders.” (places the Notebook control in the left notes rail)
- “Collapse the Folders panel” / “expand the Folders panel” (changes Amy's notes rail only when explicitly asked)
- “Alphabetize the folders” (sorts folder names and their note text A–Z)
- “Alphabetise the file names within the desktop folders” (sorts visible Amy sidebar entries such as Amy Desktop and Amy Files)
- “Move the ticker underneath the notes” (moves the live API usage ticker into the left notes rail)

Timers, notes and alerts are saved in `companion.sqlite3` beside Amy's config
(`%APPDATA%/Amy/` on the desktop, `amy/` on the Pi). `AMY_COMPANION_DB` can override
the file. Desktop and Pi notebooks are independent; they do not sync yet.
Existing general notes remain available when no project is selected.

Timers run while the brain runs. After a shutdown, overdue reminders appear once
when Amy next starts. Spoken alerts need an open, awake viewer with audio enabled;
away mode and quiet hours silence them while keeping the visible alerts. Closing
the desktop app stops its brain, so it cannot ring while closed. Dismiss an alert
to clear it. Spoken delivery is claimed across tabs to avoid duplicate speech;
the visible alert remains if playback is blocked or interrupted.

Printer status is read from Flightdeck every 15 seconds. Initial status establishes
a quiet baseline. Changes announce pauses, errors, disconnects, reconnections,
resumes and finishes reported by Flightdeck. An idle transition alone is only
announced as idle. A failed Flightdeck request is shown as unconfirmed status,
never as every printer going offline. No printer commands are issued by this monitor.
Old printer alerts stay visible but are not spoken more than five minutes later.
Quiet hours use the configured `timezone` (default `Australia/Sydney`); on systems
without IANA timezone data they use and report system local time.

Run the behavioral and HTTP routing checks with `python -m unittest test_companion -v`
from the `amy` directory. The tests use temporary storage and simulated printer
transitions; they never start, pause, move or calibrate physical printers.

Voice + notes galaxy for Chris's Flightdeck bench. Brain: **GPT-5.6 Luna**.

## Desktop app (Windows)

Local-brain wrap (same UI + Hands). Pi browser Amy stays available.

```powershell
cd amy\desktop
.\start-amy-desktop.ps1
```

Config lands in `%APPDATA%\Amy\config.json`. Build a portable folder with `.\build-windows.ps1` → `dist\Amy\Amy.exe`.

See [desktop/README.md](desktop/README.md).

## Hosting

Runs on the Flightdeck Pi (`amy/` folder in repo, user systemd unit `amy.service`). Port **4700**.

**Use HTTPS for the mic:**

https://flightdeck.tail7de73e.ts.net:4700

## Voice: ElevenLabs Laura

Amy speaks as **Laura** (`FGY2WhTYpPnrIDTdsKH5`) when an ElevenLabs key is set.

1. Create a key: https://elevenlabs.io/app/settings/api-keys
2. On the Pi: `ELEVENLABS_API_KEY='…' python3 amy/deploy/set-elevenlabs-key.py`
3. `systemctl --user restart amy`

Without that key she falls back to browser TTS.

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
4. `systemctl --user restart amy`
5. Open the HTTPS URL — click once to unlock speech, then talk or type

## Files + internet

- Drag files onto the dock (or **FILE** / 📎) — text, code, logs, gcode, images
- Ask her to look something up online — she can search the web and open URLs
- Explicit coding requests use the local Codex CLI in the configured `coding_root`. Amy preserves unrelated changes, never commits or pushes, and records the final summary in the selected project notes. The Windows desktop has the coding worker; the Pi reports clearly if Codex CLI is not installed. Desktop and Pi project notebooks remain separate.

- "Run a calibration on BigBoy"
- "What's BigBoy doing?"
- "Pause X1C" / "Resume Big Girl"

Printer aliases: BigBoy→`h2d`, Big Girl→`o1c2`, X1C→`x1c`, Greyhound/Voron→`greyhound`.

## Preflight

```bash
python3 preflight.py
```
