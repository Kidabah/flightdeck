# Cindy Vinyl

Vinyl hi-fi web player for the Cindy NAS music library (CHECKED + MUSIC + JAMAL).

## Stack
- CIFS mounts: `/mnt/cindy/{MUSIC,CHECKED,JAMAL}` via `mount-cindy.sh`
- **Navidrome** indexes & streams (`:4533`)
- **cindy-vinyl** FastAPI UI + Subsonic proxy (`:4540`)

## Pi setup
```bash
# creds (already on Pi ideally)
# ~/.smbcredentials-cindy  chmod 600

bash /home/flightdeck/bin/mount-cindy.sh
cd /home/flightdeck/flightdeck/jukebox
# create .env with JUKEBOX_USER / JUKEBOX_PASSWORD matching a Navidrome user
docker compose up -d --build
```

Open over Tailscale: `http://flightdeck.tail7de73e.ts.net:4540` (or Pi Tailscale IP `:4540`).

First Navidrome scan of ~5.4TB takes hours; the UI fills as albums appear.
