# Amy task map

Read by `task_map_notes` in `amy/server.py`. A question that matches a task
type's trigger words (whole words, case-insensitive) loads the notes listed
under "Read first" before keyword scoring. If nothing matches, Amy falls back
to `score_notes` as before.

Note names below are the file names in `amy/notes/workshop/`, without `.md`.

| Task type | Trigger words (examples) | Read first |
|---|---|---|
| printer status | printing, progress, idle, nozzle, bed, temp | printers-and-nicknames, big-girl-h2c, bigboy-h2d, x1c, flightdeck-overview |
| filament and AMS | spool, filament, ams, tray, colour, low spool | ams-filament, spool-drawers, flightdeck-overview |
| print queue | queue, pending, blocked, send, reprint | flightdeck-overview, ams-filament, bigboy-h2d |
| Flightdeck changes | flightdeck, page, card, layout, button | flightdeck-overview, amy-desktop |
| remote access | tailscale, pi, away, phone, ssh | tailscale-access, flightdeck-overview |
| labels | label, ql700, brother, print label | ql700-labels |
| 3D files and models | stl, 3mf, gcode, slice, makerdeck, printshelf | makerdeck-printshelf, amy-files |
| voron build | voron, greyhound, klipper | greyhound-voron |
| Amy itself | amy, voice, talk, sleep, prompt, internet, desktop | amy-voice, amy-prompts, amy-sleep, amy-internet, amy-desktop |
| Code and repo | github, repo, repository, code, source, reverse engineer, jarvis, my-amy | my-amy-repo, amy-desktop |

## How it would apply

- Match the task type from the trigger words. If two types match, load both lists and keep the first five notes.
- Read the "Read first" notes before answering. Then use `score_notes` on the rest of the notes for extra context.
- Keep the list short. Each task type should name at most five notes.
- If a note is missing, skip it and log it; do not fail the answer.

## Open questions

- Should the map live in a file (as here) or in `config.json`?
- Does "Amy itself" need the sleep and voice notes on every answer, or only when those words appear?
- Are there tasks that should always read a note first, such as safety notes before any print start?
