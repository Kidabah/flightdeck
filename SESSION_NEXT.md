# SESSION_NEXT (active)

Recent Flightdeck / MakerDeck session notes (last ~4 weeks). Older history: [docs/archive/SESSION_NEXT_before_2026-06-28.md](docs/archive/SESSION_NEXT_before_2026-06-28.md).

MakerDeck detailed notes: [makerforge/SESSION_NEXT.md](makerforge/SESSION_NEXT.md).

---

## 2026-07-29 Session update (Cindy Vinyl — sleeve on Technics prism)

Latest commit: *(pending)* — Album cover leans against Technics prism

Latest local/Pi change:
- Now-playing cover moved off the wall frame; sits in front of the glass Technics prism like a sleeve leaning on the table.
- Hard refresh `?v=28`. Rebuild `cindy-vinyl` (static only).

Previous:
- Square wall sleeve (`603e358` / `eb86c66`).

---

## 2026-07-29 Session update (Cindy Vinyl — wall album art)

Latest commit: `eb86c66` — Album cover on framed gold Technics disc

Latest local/Pi change:
- Now-playing cover sits on the wall gold record behind the deck (circular overlay).
- Platter label still spins. Hard refresh `?v=26`. Rebuild `cindy-vinyl`.

Previous:
- PWA packaging (`753d6ba`).

---

## 2026-07-29 Session update (Cindy Vinyl — PWA app)

Latest commit: `753d6ba` — PWA manifest + icons; Install like PrintShelf

Latest local/Pi change:
- Cindy Vinyl is installable: `manifest.json`, `sw.js`, icons, root routes.
- Hard refresh `?v=25`. Rebuild `cindy-vinyl`.
- For Chrome **Install**: `sudo tailscale serve --bg --https=4540 http://127.0.0.1:4540` then open HTTPS `:4540`.
- Optional desktop shortcut: `jukebox/scripts/create-desktop-shortcut.ps1`.

Previous:
- Transport polish (`5a02518`).

---

## 2026-07-29 Session update (Cindy Vinyl — transport polish)

Latest commit: `5a02518` — Volume, time readout, keyboard shortcuts

Latest local/Pi change:
- Transport: `0:00 / 3:55` beside seek; volume slider + mute (persisted).
- Keys: Space play/pause, ←/→ skip, ↑/↓ volume, M mute (ignored while typing in search).
- Hard refresh Vinyl `?v=24`. Rebuild `cindy-vinyl`.

Previous:
- Spinning platter restored (`3915b28`).

---

## 2026-07-29 Session update (Cindy Vinyl — spinning platter restored)

Latest commit: `3915b28` — Restore spinning label; park tonearm video for split clips

Latest local/Pi change:
- Back to `deck.png` + spinning platter label (`?v=23`).
- Tonearm MP4 kept in `jukebox/static/` for later once Chris supplies cue-in / cue-out splits.
- Rebuild `cindy-vinyl`.

Previous:
- Silent SL1200 tonearm attempt (`7232c69`).

---

## 2026-07-29 Session update (Cindy Vinyl — silent SL1200 tonearm)

Latest commit: `7232c69` — Silent deck-arm.mp4 cue-in/out on play/end

Latest local/Pi change:
- Your `SL1200.mp4` → `jukebox/static/deck-arm.mp4` (**audio stripped**, ~272KB).
- Hero deck is a muted `<video>`: cue-in on track start, hold needle-down, cue-out when queue ends.
- Pause mid-track keeps needle down. Hard refresh Vinyl `?v=22`.
- Rebuild `cindy-vinyl` on Pi.

Previous:
- Folder-pack merge + Cindy symlink view (`19555f3` / `303151a`).

---

## 2026-07-29 Session update (Cindy Vinyl — pack merge + no-touch Cindy)

Latest commit: `19555f3` — Folder-pack merge + Cindy symlink view (skip #recycle)

Latest local/Pi change:
- **Cindy stays read-only** (PrintShelf-style): no retagging / no writes on the NAS.
- Pi-local `cindy-library-view` symlinks MUSIC/JAMAL/CHECKED **minus** `#recycle` for Navidrome.
- `ND_SCANNER_PURGEMISSING=full` clears junk after a full scan.
- Vinyl proxy merges VA weekly packs (same folder, split tags) into one sleeve + full tracklist.
- Hard refresh Vinyl `?v=21` / `:4540`. Rebuild containers after `build-cindy-library-view.sh`.
- After deploy: trigger Navidrome **full scan** so MUSIC/JAMAL appear and recycle drops out.

Previous:
- Cindy Vinyl Technics deck stage.

---

## 2026-07-29 Session update (Cindy Vinyl Jukebox)

Latest commit: *(see log)* — Cindy Vinyl Technics deck stage

Latest local/Pi change:
- Mount Cindy **MUSIC + CHECKED + JAMAL** → `/mnt/cindy/*` (`mount-cindy.sh`, boot remount).
- **Navidrome** on `:4533` (indexes ~5.4TB; first scan takes hours).
- **Cindy Vinyl** UI on `:4540` — Technics SL-1200 Limited hero (black/gold lounge), spinning label, SPIN/crates.
- Hard refresh `?v=2` / `http://flightdeck.tail7de73e.ts.net:4540`
- Secrets: `jukebox/.env` on Pi only. Creds: `~/.smbcredentials-cindy`.

Previous:
- Mora Kidabah home mount (`bc1acbf`).

Latest commit: `bc1acbf` — Mount Mora User Homes/Kidabah for PrintShelf

Latest local/Pi change:
- Mount helper `mount-nas-mora.sh` → `/mnt/nas-mora` (bind of `User Homes/Kidabah`).
- Remount-on-boot includes Mora when `~/.smbcredentials-mora` exists.
- PrintShelf watched folder id `nas-mora` (windows path `\\192.168.4.77\User Homes\Kidabah`).
- Live on Pi: Mora mounted; Folders shows **Mora Kidabah home**.

Previous:
- Pi reboot library wipe guard (`c1b4bf2`).

---

## 2026-07-29 Session update (Pi reboot emptied PrintShelf library)

Latest commit: `c1b4bf2` — Guard scan against unmounted /mnt shares

Latest local/Pi change:
- Pi reboot dropped CIFS mounts; Refresh scanned empty `/mnt/*` dirs and marked **all** assets `missing=1`.
- Restored DB (`missing=0` for 4922 assets); remounted Kidabah PC.
- Scanner now **skips unmounted `/mnt`/`/media` roots** and only mark-missing for roots it actually walked.
- Mount helper scripts: `mount-koko-kidabah.sh`, `remount-printshelf-shares.sh`.
- Hard refresh PrintShelf `?v=63`. Backend restart required.

Previous:
- PrintShelf Refresh + select bar (`423db5d`).

---

## 2026-07-28 Session update (Ooshies stand v2)

Latest commit: `f9fed68` — Retune Ooshies stand to ~218×93×244 + photo look

Latest local/Pi change:
- MakerDeck **b576**: proportions from peg-scaled reference STL; deep base tongue, side pills, 7 uppers.
- Hard refresh MakerDeck `?v=576`.

Previous:
- Ooshies stand v1 (`c695f73`).

---

## 2026-07-28 Session update (Ooshies stand)

Latest commit: `c695f73` — MakerDeck Ooshies stand (tab-slot kit, 52mm figure clearance)

Latest local/Pi change:
- New MakerDeck preset **Ooshies stand** — pegs 6.5×10, gap for 40–50 mm figures, sides+shelves kit export.
- Hard refresh MakerDeck `?v=575` / **b575**.

Previous:
- Real RAR unpack + kit cards (`651cef1`).

---

## 2026-07-28 Session update (real RAR unpack + kit cards)

Latest commit: `651cef1` — Prefer 7zz for RAR; reject 0-byte stubs; one kit card under PrintShelf Extracted

Latest local/Pi change:
- Debian `7z` left empty STL shells (“Unsupported Method”). Now prefers `~/bin/7zz` (full RAR codecs).
- Empty stubs are purged / never counted as success; re-extract rewrites them.
- Multi-file kits under `PrintShelf Extracted/<kit>/…` group into **one** design card.
- Hard refresh `?v=61`. Restart required. Re-run Extract all on Art Guy zips after deploy.

Previous:
- Search clears type filter (`d1d4524`).

---

## 2026-07-28 Session update (search clears type filter)

Latest commit: `d1d4524` — Clear ZIP/type tab when searching or after extract

Latest local/Pi change:
- Searching no longer stays stuck on the ZIP tab (which hid rescued STLs).
- Extract / Extract all clears the type filter so new designs show up.
- Hard refresh `?v=60`. Try search `Champion` or `Diorama`.

Previous:
- Extract all / RAR (`fc6fc3e`).

---

## 2026-07-28 Session update (extract all / RAR)

Latest commit: `fc6fc3e` — Extract all printables (unpack nested RAR via 7z)

Latest local/Pi change:
- ZIP **Extract all** rescues every printable; if the zip only wraps a `.rar`, streams it out and unpacks with Pi `7z`, then indexes meshes.
- Test case: `3D Art Guy-…002.zip` → nested Crusader Diorama `.rar`.
- Hard refresh `?v=59`. Restart required. Big RARs can take minutes.

Previous:
- Open zip on PC (`e0f30ea`).

---

## 2026-07-28 Session update (open zip on PC)

Latest commit: `e0f30ea` — Card ⋮ menu + Open zip on PC / Reveal in Explorer

Latest local/Pi change:
- Design/asset cards: **⋮** menu — Open in PrintShelf, Open zip on PC, Reveal in Explorer.
- Detail: **Open zip on PC** + ⋮ More. Double-click still opens in shelf.
- Needs **Windows Flightdeck worker restarted** (new `/api/slicer/worker/shell-open`).
- Hard refresh PrintShelf `?v=58`. Restart Pi Flightdeck + PrintShelf.

Previous:
- RAR extract UX (`27c6b64`).

---

## 2026-07-28 Session update (extract UX)

Latest commit: `27c6b64` — Explain RAR-only / empty zips on Extract

Latest local/Pi change:
- Extract button always clickable; toast explains when zip has only a `.rar` / no printables.
- Hard refresh `?v=57`.

Previous:
- Sticky extract toast (`41aefb8`). Zip extract (`be0001b`).

---

## 2026-07-28 Session update (zip extract)

Latest commit: `be0001b` — Zip extract → PrintShelf Extracted design card

Latest local/Pi change:
- ZIP detail **Extract to shelf** rescues the selected printable into `/mnt/koko-kidabah/PrintShelf Extracted`, indexes it, opens the new design card.
- Nested `Outer.zip/inner.stl` supported. Zip stays put.
- Hard refresh `?v=55`. Restart required.

Previous:
- Design grouping / stem titles (`77d4216` / `a22b9da`).

---

## 2026-07-28 Session update (design grouping)

Latest commit: `a22b9da` — Design cards use stem names

Latest local/Pi change:
- Library **Designs** tab groups STL/3MF/gcode siblings (same folder + stem).
- Detail lists files in the design; Print/Slicer still per asset.
- Card titles use the file stem (not parent folder like `H2D`).
- Hard refresh `?v=54`. Restart required. Re-run `regroup-designs.py` to refresh names.

Previous:
- group_key migrate fix (`41da9d7`). Design grouping (`fec980d`).

---

## 2026-07-27 Session update (delete copies)

Latest commit: `213e056` — Warn / delete identical NAS copies

Latest local/Pi change:
- Delete **does** remove from NAS (verified). Files “coming back” were usually **duplicate copies** in other folders.
- Delete flow now detects identical content-hash copies and offers **Delete all copies**.
- Hard refresh `?v=46`. Restart required.

Previous today:
- Kidabah PC mount. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (Kidabah PC mount)

Latest commit: `f8f18af` — (ops) Mount Kidabah PC Desktop/Downloads/Documents

Latest local/Pi change:
- Windows share `PrintShelfRoots` → junctions to Desktop/Downloads/Documents.
- Pi mount `/mnt/kidabah-pc` (CIFS via `printshelf-pi` account); PrintShelf watched folder **Kidabah PC**.
- Remount `@reboot` via `/home/flightdeck/bin/mount-kidabah-pc.sh`. PC must be on for scan/orbit of those files.
- Hard refresh Folders; Rescan.

Previous today:
- Watched-folder path warnings (`a8c235b`). Archives in `docs/archive/`.

---

## 2026-07-27 Session update (watched folder Pi paths)

Latest commit: `a8c235b` — Warn when watched folder path missing on Pi

Latest local/Pi change:
- Downloads wasn’t scanning: Pi path was `C:\Users\…` (Windows). PrintShelf only walks Linux mounts.
- Folders UI shows **missing on Pi** + blocks adding Windows paths as Pi paths.
- Hard refresh `?v=45`. Restart required.

Previous today:
- Shared ZIP thumb (`66dcd18`). Archives in `docs/archive/`.

---

## 2026-07-27 Session update (shared ZIP thumb)

Latest commit: `66dcd18` — Don't delete shared ZIP thumb on asset delete

Latest local/Pi change:
- ZIP icons vanished because deleting any ZIP unlinked `_shared_zip2.png` (shared by all cards).
- Regenerated on Pi; delete skips shared thumbs; thumb GET auto-recreates if missing.
- Hard refresh `?v=44`. Restart required.

Previous today:
- ASCII STL orbit (`a278b81`). Archives in `docs/archive/`.

---

## 2026-07-27 Session update (ASCII STL orbit)

Latest commit: `a278b81` — PrintShelf orbit ASCII STL again

Latest local/Pi change:
- Fake-STL harden broke **ASCII** meshes (e.g. `Vase_01_SMALL.stl`): binary-only preview + viewer header check.
- Preview converts/serves ASCII; viewer skips binary count check when file looks like `solid`+`facet`.
- Hard refresh `?v=43`. Restart required.

Previous today:
- PNG-as-STL junk (`7a2caf4`); G-code indexing. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (fake STL previews)

Latest commit: `7a2caf4` — Skip Thingiverse PNG-as-STL junk

Latest local/Pi change:
- Orbit crash `Invalid typed array length` was **PNG card previews** with `.stl` names (e.g. `card_preview_*.stl`).
- Scanner skips / purges them; preview API no longer serves raw fakes; viewer guards image magic.
- Hard refresh `?v=42`. Restart + purge (scan or SQL) required.

Previous today:
- G-code indexing (`3fbf996`). Archives in `docs/archive/`.

---

## 2026-07-27 Session update (G-code indexing)

Latest commit: `3fbf996` — PrintShelf index `.gcode` / `.gco`

Latest local/Pi change:
- **Why Baby Doll G-code was missing:** scanner only knew STL/OBJ/3MF/ZIP, and live `ignore_globs` had `**/*.gcode`.
- Now indexes `.gcode` + `.gco` as kind `gcode` (Cura + PrusaSlicer headers, Prusa thumbs).
- New **G-code** type tab. Hard refresh `?v=41`. Restart + rescan required.
- Remove `**/*.gcode` from Pi `printshelf/config.json` ignore list on deploy.

Previous today:
- Manifold hole-fill (`4703ae6`); slicer handoff. Archives in `docs/archive/`.

---

## 2026-07-27 Session update

Latest commit: `4703ae6` — PrintShelf fill tiny manifold holes

Latest local/Pi change:
- Manifold sanitize now **caps small open-edge loops** after weld/peel.
- Part_37: **98 → 0 open edges** ✓
- Hard refresh `?v=40`. Restart done.

Previous today:
- Manifold check (`84d3e86`); Bambu/Orca choice. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (folder browse)

Latest commit: `0216556` — PrintShelf folder browse

Latest local/Pi change:
- Library **Folders** mode (default): watched roots → nested folders → files, with breadcrumbs.
- **All files** still available for the flat grid. Search forces flat results.
- Hard refresh `?v=17`. Restart required.

Previous today:
- ZIP orbit + thumb fix (`97fd1e5`); 3MF orbit; multi-select. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (ZIP orbit)

Latest commit: `97fd1e5` — ZIP orbit + broken thumb fix

Latest local/Pi change:
- **ZIP orbit**: click a printable inside a zip → loads in the detail viewer.
- Grid no longer shows broken black thumbs (missing files resolved / onerror fallback). Hit **Rebuild thumbs** for Dryad etc.
- Hard refresh `?v=16`. Restart required.

Previous today:
- 3MF orbit (`79e1ae5`); multi-select; ZIP index. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (3MF orbit)

Latest commit: `79e1ae5` — PrintShelf 3MF orbit + mesh thumbs

Latest local/Pi change:
- **3MF orbit** in the detail viewer (extract mesh → preview STL). Works for model 3MFs; profile-only packs still won’t orbit.
- Mesh thumbs (`3mf2`) when embedded preview missing/too dark. **Rebuild thumbs** for nicer 3MF cards.
- Hard refresh `?v=15`. Restart required.

Previous today:
- Multi-select (`8a46c8f`); ZIP; hide/delete. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (multi-select)

Latest commit: `8a46c8f` — PrintShelf multi-select bulk hide/delete

Latest local/Pi change:
- **Multi-select** cards (checkbox / Ctrl-click) + bulk bar: Select all visible, Hide, Unhide, Delete from disk.
- Hard refresh `?v=14`. Restart `printshelf.service` required.

Previous today:
- ZIP category (`49db5d7`); hide/delete; orbit. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (ZIP)

Latest commit: `49db5d7` — PrintShelf ZIP category

Latest local/Pi change:
- Index **`.zip`** archives (contents list + printable counts inside; no extract).
- New **ZIP** type tab. Hard refresh `?v=13`. Restart + **Rescan** required for thousands of zips.

Previous today:
- Hide/delete (`522ba7d` / `b558494`); orbit; type tabs; PWA. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (hide/delete)

Latest commit: `b558494` — PrintShelf hide/delete + localhost bind for Tailscale

Latest local/Pi change:
- **Hide from library** (stays on disk, survives rescan) + **Delete from disk** (confirm ×2; removes file + indexed sidecars).
- **Show hidden** filter + Unhide. DB column `assets.hidden`.
- Service binds `127.0.0.1:8100` (Tailscale HTTPS owns public `:8100`). Use `https://flightdeck.tail7de73e.ts.net:8100`.
- Hard refresh `app.js?v=12`. Restart done.

Previous today:
- Denser orbit previews (`b54b62e`); type tabs; PWA. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (orbit density)

Latest commit: `b54b62e` — denser PrintShelf orbit previews + Higher detail

Latest local/Pi change:
- Orbit preview default raised to **400k** tris (was 180k); **Higher detail** toggle → **750k**.
- Hard refresh `app.js?v=11` / `viewer.js?v=11`. Restart `printshelf.service` required.

Previous today:
- Library type tabs (`f1bb170`); PWA (`ac66be8`). Archives in `docs/archive/`.

---

## 2026-07-27 Session update (type tabs)

Latest commit: `f1bb170` — PrintShelf library type tabs

Latest local/Pi change:
- Library **type tabs** (All / STL / 3MF / Gcode 3MF / OBJ) with counts; replaced the type dropdown.
- Hard refresh PrintShelf `app.js?v=10` / `style.css?v=10`. Restart optional (static).

Previous today:
- PrintShelf **PWA** install (`ac66be8`); Tailscale HTTPS `:8100`. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (PWA)

Latest commit: `ac66be8` — PrintShelf PWA install (same as Flightdeck)

Latest local/Pi change:
- PrintShelf **PWA**: `manifest.json` + minimal `sw.js`, brand icons, Install as app.
- Tailscale Serve HTTPS on port **8100** → `https://flightdeck.tail7de73e.ts.net:8100`
- Hard refresh `app.js?v=9` / `style.css?v=9` / `viewer.js?v=9`. Restart `printshelf.service` required.
- Optional Windows shortcut: `printshelf/scripts/create-desktop-shortcut.ps1`

Previous today:
- Detail pane **3D orbit viewer** for STL/OBJ (`cc8f20b`). Archives in `docs/archive/`.

---

## 2026-07-27 Session update (orbit viewer)

Latest commit: `cc8f20b` — PrintShelf orbit viewer for STL/OBJ

Latest local/Pi change:
- Detail pane **3D orbit viewer** (Three.js) for STL/OBJ via `/api/assets/{id}/model` (decimated ~180k tris when huge).
- 3MF stays thumbnail-only for now.
- Hard refresh PrintShelf `app.js?v=8` / `style.css?v=8` / `viewer.js?v=8`. Restart `printshelf.service` required.

Previous (2026-07-26):
- Ignore / purge `*_temp.obj`; mesh-only OBJ thumbs (`obj4`). Archives in `docs/archive/`.

---

## 2026-07-26 Session update

Latest commit: `9ad2f21` — filter temp OBJ + unique mesh thumbs

Latest local/Pi change:
- Ignore / purge `*_temp.obj` junk from the library.
- OBJ thumbs are **mesh-only** (no shared folder texture) → `obj4`; hard refresh `app.js?v=7` + Rebuild thumbs.

Previous:
- Z-up orientation; STL5; thumb rebuild. Archives in `docs/archive/`.

---

## 2026-07-25 Session update

Latest local/static change:
- MakerDeck **b574** — Brush/nozzle size sliders are logarithmic (fine control at small sizes; no tiny→huge jumps).
- Hard refresh Painter build **b574**. No backend restart required.
- MakerDeck session notes → [`makerforge/SESSION_NEXT.md`](makerforge/SESSION_NEXT.md)

Previous local/static change:
- MakerDeck **b573** — Freehand brush stops on mouse-up; much less drag lag (live tint, fewer dabs/move).
- Hard refresh Painter `painter.js?v=573`. No backend restart required.

Previous local/static change:
- MakerDeck **b572** — Fixed Smart fill sprawl: classic facing-patch default (Wrap off, 40°); Wrap uses surface path so pillars don’t get air-jumped.
- Hard refresh Painter `painter.js?v=572`. No backend restart required.

Previous local/static change:
- MakerDeck **b571** — Rebuilt STL Painter paint core: hide-as-hard-mask, clean hold-to-paint strokes, Smart fill masked, Clean Edge select-then-Fill/Clear.
- Hard refresh Painter `painter.js?v=571`. No backend restart required.

Older local/static change:
- MakerDeck **b570** — Edit shelf **Slot base** from solid/no-slot down to a **0.2 mm** floor (never a through-hole).
- Hard refresh MakerDeck `app.js?v=570` / `style.css?v=570`. No backend restart required.

Previous local/static change:
- MakerDeck **b569** — Edit shelf **Shelf length** max raised from 120 mm to **200 mm** (slider + geometry clamp).
- Hard refresh MakerDeck `app.js?v=569` / `style.css?v=569`. No backend restart required.

---

## 2026-07-24 Session update

Latest local/static change:
- Print History amber **Weigh** no longer asks "Was this the only spool actually used?" for multi-spool prints; it reconciles only the selected row so the remaining spool rows can still be weighed one by one.
- Static cache bumped to `app.js?v=650`; frontend refresh required.

Previous local/static change:
- Dymo scale reads now prefer `/dev/hidraw*`, poll up to 1.5s for the next scale report instead of sampling instantly, and accept a small 2g stability band. Raw report `03 04 02 00 00 01` maps to ~256g, proving the active-report path.
- Backend restart required after pull.

Older local/static change:
- Print History **Weigh** now sends a best-effort `/api/scale/keep-awake` before `/api/scale/read`, and "No non-zero scale reading" now tells the user to put the spool on, wake/tare the scale, and retry.
- Static cache bumped to `app.js?v=649`; frontend refresh required.

Older local/static change:
- Dymo scale reads now use non-blocking HID reads instead of a blocking `read(16)`, so missing/no-report states can fail quickly instead of hanging until the 12s API timeout.
- Backend restart required after pull.

Older local/static change:
- Print History amber **Weigh** now performs an explicit `/api/scale/read` first, validates the gross grams, then posts that `reading_g` into reconcile. This avoids the Weigh button sitting at `...` while reconcile owns the scale read.
- Static cache bumped to `app.js?v=648`; frontend refresh required. Backend already supports the passed `reading_g`.

Older local/static change:
- Scale-backed weigh/reconcile reads now run off the async event loop with a 12s timeout, so a stuck scale read can fail the weigh action without freezing all Flightdeck routes.
- Backend restart required after pull.

Older local/static change:
- Print History amber **Weigh** now opens a scale-read confirmation first, skips the manual starting-weight prompt, and then preserves the existing multi-spool "only spool used?" confirm/cancel behavior.
- Static cache bumped to `app.js?v=647`; frontend refresh only.

Older local/static change:
- Print History amber **Weigh** actions now use the scale-backed reconcile path instead of asking for remaining grams manually.
- Because the backend has the spool id, it uses that spool's `empty_spool_weight_g` or matching material/brand tare fallback, reads the gross scale weight, and stores remaining filament grams after subtracting tare.
- Plain **Reconcile** still allows manual remaining-filament entry for non-suggested rows or no-scale situations.
- Static cache bumped to `app.js?v=646`; frontend refresh only.

Older local/static change:
- Print History spool usage rows now show **Expected remaining Xg** under the deducted/used grams when `remaining_after_g` is available.
- This makes low-stock weigh-in hints explain themselves without changing deduction, reconcile, or correction logic.
- Static cache bumped to `app.js?v=645`; frontend refresh only.

---
