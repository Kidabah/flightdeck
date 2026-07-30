# Cindy Vinyl

Vinyl hi-fi web player for the Cindy NAS music library (CHECKED + MUSIC + JAMAL).

## Stack
- CIFS mounts: `/mnt/cindy/{MUSIC,CHECKED,JAMAL}` via `mount-cindy.sh` (**read-only**)
- **Navidrome** indexes & streams (`:4533`) — local DB only; never writes tags/files on Cindy
- **cindy-vinyl** FastAPI UI + Subsonic proxy (`:4540` localhost / `:4541` LAN)
- Pi-local symlink view (`cindy-library-view`) skips Synology `#recycle` — Cindy NAS stays untouched
- Folder-pack merge in the vinyl proxy: VA weekly drops with per-track tags become one sleeve

## Pi setup
```bash
# creds (already on Pi ideally)
# ~/.smbcredentials-cindy  chmod 600

bash /home/flightdeck/bin/mount-cindy.sh
bash /home/flightdeck/flightdeck/jukebox/scripts/build-cindy-library-view.sh
cd /home/flightdeck/flightdeck/jukebox
# create .env with JUKEBOX_USER / JUKEBOX_PASSWORD matching a Navidrome user
docker compose up -d --build
```

### Open the app
- **Home LAN (no Tailscale):** `http://192.168.4.239:4541`
- **Tailscale HTTPS:** `https://flightdeck.tail7de73e.ts.net:4540`

First Navidrome scan of ~5.4TB takes hours; the UI fills as albums appear.

## Windows install (wife / home PCs)

On the PC (same Wi‑Fi/LAN as the Pi), double‑click:

`jukebox/scripts/Install-CindyVinyl.bat`

That puts **Cindy Vinyl** on the Desktop and Start Menu (Edge/Chrome app window → LAN URL).

Or from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File jukebox\scripts\Install-CindyVinyl.ps1
```

Away from home (Tailscale on that PC):

```powershell
powershell -ExecutionPolicy Bypass -File jukebox\scripts\Install-CindyVinyl.ps1 -Url "https://flightdeck.tail7de73e.ts.net:4540"
```

## Install as a PWA (Tailscale HTTPS only)

Chrome/Edge need **HTTPS** to use Install app. On the Pi (once):

```bash
sudo tailscale serve --bg --https=4540 http://127.0.0.1:4540
```

Then open `https://flightdeck.tail7de73e.ts.net:4540` → menu → **Install Cindy Vinyl**.
