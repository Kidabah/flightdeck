# PrintShelf

Private, self-hosted printable-file inventory. **Index in place** — files stay on local disks / NAS. No cloud upload, no marketplace.

## What it does (v1)

- Watch local + NAS folders
- Index `.stl`, `.3mf`, `.gcode.3mf`, `.obj`
- Extract print details from 3MF (plates, filaments, thumbs)
- Associate OBJ `.mtl` + texture maps
- Browse / filter / detail UI

## Run (dev)

```bash
cd printshelf
python -m venv .venv   # or use the Flightdeck venv
pip install -r requirements.txt
cp config.example.json config.json   # edit watched_folders paths
python -m uvicorn app.main:app --host 127.0.0.1 --port 8100
```

Open http://127.0.0.1:8100 → **Folders** → add paths → **Rescan**.

## Pi service

```bash
cd /home/flightdeck/flightdeck
git pull
.venv/bin/pip install -r printshelf/requirements.txt
sudo cp printshelf/printshelf.service /etc/systemd/system/printshelf.service
sudo systemctl daemon-reload
sudo systemctl enable --now printshelf.service
```

Browse: `http://<pi-tailscale-ip>:8100`

Config: `printshelf/config.json` (not committed). Data/DB/thumbs: `printshelf/data/`.

## Phase 2 (later)

Printables / Tripo / other online libraries as read-only indexes.
