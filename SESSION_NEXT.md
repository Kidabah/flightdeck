# SESSION_NEXT (active)

Recent Flightdeck / MakerDeck session notes (last ~4 weeks). Older history: [docs/archive/SESSION_NEXT_before_2026-06-28.md](docs/archive/SESSION_NEXT_before_2026-06-28.md).

MakerDeck detailed notes: [makerforge/SESSION_NEXT.md](makerforge/SESSION_NEXT.md).

---

## 2026-08-03 Session update (H-series high-temp nozzle unload)

Latest commit: `6653256` — Auto-unload low-temp before H-series high-temp queue jobs

Latest local/Pi change:
- On **H-series** queue dispatch: if the job needs high-temp (ABS/ASA/PA/PC/…) and AMS `tray_now` still shows low-temp (PLA/PETG/TPU/…) at the nozzle, Flightdeck **auto-unloads**, waits until clear (up to 5 min), then starts the print.
- H2D path-aware: only unloads when the loaded low-temp tray feeds a nozzle this job will heat.
- Preflight shows an info line; decisions logged as `ams_unload_before_high_temp*`.
- Files: `app/main.py`, `app/printers/bambu.py` (unload-without-slot now heats to tray_now material).
- **Backend restart required** after Pi pull.

Previous:
- Loudness normaliser (`4d329fe`).

---

## 2026-08-03 Session update (Cindy Vinyl — loudness normalise)

Latest commit: `4d329fe` — Add deck loudness normaliser

Latest local/Mora change:
- Deck control **⌀** toggles Web Audio loudness normalise (levels quiet/loud tracks). Preference saved in `localStorage`.
- Live on Mora — hard refresh Vinyl (`http://192.168.4.77:4541`).

Previous:
- Vinyl on Mora (`9f3d922`).

---

## 2026-08-03 Session update (Cindy Vinyl → Mora)

Latest commit: `9f3d922` — Move Cindy Vinyl and Navidrome onto Mora volume2

Latest local/Mora change:
- Vinyl + Navidrome now run on **Mora** (`192.168.4.77`), data on SSD `/volume2/cindy-vinyl/`, music via `/share/{Cindy,Checked,Jamal}`.
- LAN URL: `http://192.168.4.77:4541` (reinstall Desktop shortcut / hard refresh bookmarks).
- Tailscale serve on Mora: `https://flightdeck-nas.tail7de73e.ts.net:4540/` (may need DSM firewall allow if it times out).
- Pi `cindy-vinyl` + `cindy-navidrome` stopped with `restart=no`.
- Files: `jukebox/docker-compose.mora.yml`, `scripts/build-mora-library-view.sh`, `scripts/migrate-vinyl-to-mora.py`.

Previous:
- Open helper fix (`5a400e7`).

---

## 2026-08-01 Session update (Cindy Vinyl — Open helper fix)

Latest commit: `5a400e7` — Fix cindyvinyl:// Explorer open (path mangling)

Latest local/Pi change:
- Open helper was killing paths with PowerShell `-replace '/' '\'`; now uses base64 UNC + `.Replace` + error popup/log.
- Re-run `install-cindy-open.ps1` once (Run with PowerShell), hard refresh `?v=94`.

Previous:
- Open in Explorer (`e97d155`).

---

## 2026-08-01 Session update (Cindy Vinyl — Open in Explorer)

Latest commit: `e97d155` — On Cindy opens Explorer (not just copy)

Latest local/Pi change:
- On Cindy **Open** launches the album folder / selects the track file in Windows Explorer.
- Needs a one-time helper: download `install-cindy-open.ps1` from the modal → Run with PowerShell (registers `cindyvinyl://`).
- Hard refresh `?v=93`. Rebuild `vinyl`.

Previous:
- On Cindy live data (`9de7fc4`).

---

## 2026-08-01 Session update (Cindy Vinyl — On Cindy live data)

Latest commit: `9de7fc4` — Sleeve ⋯ On Cindy live album/track paths

Latest local/Pi change:
- Sleeve **⋯** is a menu: **Edit names…** / **On Cindy…**.
- On Cindy pulls live Navidrome tags + library/UNC paths for the album and each track (click a track to load its path).
- Tracks panel gets a **Cindy** button per side for the same lookup.
- Hard refresh `?v=92`. Rebuild `vinyl`.

Previous:
- Smooth platter hold loop (`74b7dd5`).

---

## 2026-08-01 Session update (Cindy Vinyl — smooth platter loop)

Latest commit: `74b7dd5` — Fix record spin jump at hold seam

Latest local/Pi change:
- Amp-rack hold loop was 8→9s (wrong period); now one real revolution (31 frames @ 24fps ≈ 1.29s) with frame-accurate seek.
- CSS label no longer resets to 0° on pause (`animation-play-state` instead of tearing down the animation).
- Lounge freezes the arm-down frame (no clean seam in that footage) while the label keeps spinning.
- Hard refresh `?v=91`. Rebuild `vinyl`.

Previous:
- Center cover + A–Z by artist (`4b62eea`).

---

## 2026-07-31 Session update (Cindy Vinyl — centered sleeve + A–Z by artist)

Latest commit: `4b62eea` — Center cover; A–Z by artist (filter pack collapse)

Latest local/Pi change:
- Now-playing cover sits centered in the hero gap (not stuck on the far right); a bit larger.
- A–Z crate files by **album artist** (record-store style): Deep Purple → D, comps on **VA**.
- After folder-collapse, drop sleeves that no longer match the letter (VA chart packs leaking into A).
- Hard refresh `?v=90`. Rebuild `vinyl`.

Previous:
- A–Z more sleeves paging (`12b2b8d`).

---

## 2026-07-31 Session update (Cindy Vinyl — A–Z more sleeves)

Latest commit: `12b2b8d` — Page through all sleeves in a letter

Latest local/Pi change:
- A–Z was capped at 36 sleeves; now shows “N of total” and a **More sleeves** button to append the next page (PageDown also loads more).
- Backend caches the full collapsed letter list and serves `offset`/`hasMore`.
- Hard refresh `?v=89`. Rebuild `vinyl`.

Previous:
- Light theme `#71788A` bg (`3c80eee`).

---

## 2026-07-31 Session update (Cindy Vinyl — light/dark amp-rack themes)

Latest commit: `812cc1e` — Light white-crate theme; remove Tracks Amp panel

Latest local/Pi change:
- Removed the Tracks Amp VU/EQ panel; volume lives in the transport bar again.
- Themes: **Dark · Amp rack** (default, dark crate), **Light · Amp rack** (white Cindy crate + light room chrome), **Dark · Lounge**.
- Both amp-rack themes share the deck-on-amp footage; crate + page chrome switch with the room.
- Hard refresh `?v=84`. Rebuild `vinyl`.

Previous:
- Queue finish reconcile (`04f9e2f`).

---

## 2026-07-31 Session update (queue: finished prints not marked CANCELLED)

Latest commit: `04f9e2f` — Mark stuck queue jobs DONE after real finish

Latest local/Pi change:
- Pyramid job showed CANCELLED + “Cleared stale queue state after printer returned to idle” even though the print had finished and the printer was idle.
- Cause: queue row stayed `printing` after a missed finish transition; reconciler treated idle/finished as stale cancel.
- Now: `finished` / recent finish / last print FINISHED matching the queue filename → mark DONE; only true orphans get the soft cancel.
- Backend restart required.

Previous:
- Vinyl crate speed (`8051c77`).

---

## 2026-07-31 Session update (Cindy Vinyl — fast crates / startup)

Latest commit: `8051c77` — Precompute folder stubs; warm A–Z (~0.1s digs)

Latest local/Pi change:
- Cold A–Z was ~24–31s: crate collapse built full tracklists / re-scanned `media_file` per pack.
- One library pass now primes merge maps + slim folder sleeves; letter A warmed before ready.
- Pi bench after deploy: A/K/R/newest/letters all ~0.1–0.15s (was 24s+ cold).
- Letters GROUP BY; shared cover httpx client; cue videos after first crate paint.
- Hard refresh `?v=83`. Rebuild `vinyl`.

Previous:
- Amp-rack theme / crate carousel polish (Claude touch-up series).

---

## 2026-07-30 Session update (Cindy Vinyl — crate-carousel A–Z browse)

Latest commit: `3f8ec8f` — Cindy Vinyl: crate-carousel A-Z browse

Latest local/Pi change:
- A–Z letter-chip rail replaced with a themed crate carousel: the real "Cindy · Vinyl" crate photo as the frame, sleeves paged per non-empty letter inside its interior opening.
- `[` / `]` page between letters (not ←/→ — already bound to track skip). New `GET /api/letters` (cached) supplies the non-empty-letter list once, so empty letters are skipped entirely.
- Sleeve click-to-play and drag-to-deck unchanged (reuses `sleeveButton()`). CSS perspective/tilt on the sleeves is deferred to a follow-up pass.
- Hard refresh `?v=63`. Rebuild `vinyl` (backend + static change).

Previous:
- Windows folder drop play (`32a3747`).

---

## 2026-07-30 Session update (Cindy Vinyl — Windows folder drop play)

Latest commit: `32a3747` — Play dropped Windows folders locally

Latest local/Pi change:
- Chris was dropping Explorer folders (status showed the old “can’t drop” line).
- Deck now accepts OS folder/file drops: walks mp3/flac/m4a/… and plays via blob URLs.
- Hard refresh `?v=62`. Rebuild `vinyl`.

Previous:
- Pointer-drag sleeves (`5b33b14`).

---

## 2026-07-30 Session update (Cindy Vinyl — pointer drag, no ⊘ cursor)

Latest commit: `5b33b14` — Pointer-drag sleeves onto deck (skip HTML5 ⊘)

Latest local/Pi change:
- HTML5 drag showed the Windows ⊘ “can’t drop” cursor in Edge app windows even over the deck.
- Sleeve / track / queue → deck now uses pointer capture drag (no HTML5 DnD).
- Hard refresh `?v=61`. Rebuild `vinyl`.

Previous:
- Folder-pack drop harden (`22e1d8f`).

---

## 2026-07-30 Session update (Cindy Vinyl — folder-pack drop fix)

Latest commit: `22e1d8f` — Harden folder-pack drops; collapse A–Z; virtualize track list

Latest local/Pi change:
- Dropping folder packs was flaky / felt broken: DnD payload race, drop zone only on the photo, and huge packs (100–600 tracks) froze the Tracks panel with cover imgs.
- Keep drag payload longer; accept drop on whole `.hero-main`; status when drop misses.
- A–Z / VA letter rail now folder-collapses (over-fetch then merge).
- Tracks list virtualizes (~80 rows, covers near the needle only).
- Hard refresh `?v=60`. Rebuild `vinyl` (backend letter collapse).

Previous:
- Prism sleeve on cupboard (`6685cb5`).

---

## 2026-07-30 Session update (Cindy Vinyl — icon, VA crate, prism sleeve)

Latest commit: `f499bc5` — App icon; VA A–Z chip; prism sleeve cover back (bigger)

Latest local/Pi change:
- `cindy-vinyl.ico` for Windows shortcuts + favicon; installer downloads icon from LAN.
- A–Z adds **VA** chip (Various Artists / compilation albums via SQLite).
- Restored leaning prism sleeve cover at ~15.5% width (a bit bigger than before), in front of the glass.
- Hard refresh `?v=58`. Rebuild `vinyl`. Re-run installer on Maz’s PC for the icon.

Previous:
- LAN :4541 + Windows install (`e29e1b4` / UNC fix `eecaf3f`).

---

## 2026-07-30 Session update (Cindy Vinyl — drag & drop onto deck)

Latest commit: `a5731ca` — Drag sleeves/tracks onto the deck to play

Latest local/Pi change:
- Left vinyl colour alone.
- Drag a crate/search sleeve, a search track, or a Tracks-panel side onto the deck — gold “Drop to play” highlight, then it cues up.
- Hard refresh `?v=50`. Rebuild `vinyl`.

Previous:
- Album-gated tint (`6d333c9`).

---

## 2026-07-30 Session update (Cindy Vinyl — colour per album)

Latest commit: `6d333c9` — Random vinyl tint only when the album changes

Latest local/Pi change:
- Vinyl colour stays put across tracks on the same record; new random tint when a different album lands.
- Hard refresh `?v=49`. Rebuild `vinyl` (static).

Previous:
- Faster label swaps (`8a2eb63`).

---

## 2026-07-30 Session update (Cindy Vinyl — faster label swaps)

Latest commit: `8a2eb63` — Reuse sleeve-sized covers; prefetch; cache covers

Latest local/Pi change:
- Platter label was fetching 600px covers (cache miss vs crate sleeves at 300). Now uses 300px, prefetches nearby queue covers, and `/api/cover` sends `Cache-Control` for a week.
- Hard refresh `?v=48`. Rebuild `vinyl` (backend cover headers).

Previous:
- Warm tint polish (`14e5f71`).

---

## 2026-07-29 Session update (Cindy Vinyl — warm tint palette polish)

Latest commit: `14e5f71` — Warmer vinyl colours; tiny label/tint nudge

Latest local/Pi change:
- Chris called `?v=46` the best yet — light polish only: warmer oxblood/plum/amber resin palette (less neon), slightly richer soft-light, micro-nudge label onto spindle.
- Hard refresh `?v=47`. Rebuild `vinyl`.

Previous:
- Circular label spin (`cab13bb`).

---

## 2026-07-29 Session update (Cindy Vinyl — stop orbiting centre label)

Latest commit: `cab13bb` — Circular label spins in place; tint stays soft

Latest local/Pi change:
- Centre art was an ellipse being rotated — that made it orbit inside the record. Now a circle with `rotateX` pose; only the inner wrapper spins.
- Tint stays the softer fuller-disc fade from `?v=45`.
- Hard refresh `?v=46`. Rebuild `vinyl`.

Previous:
- Dial back tint wipe (`53616cf`).

---

## 2026-07-29 Session update (Cindy Vinyl — dial back tint wipe)

Latest commit: `53616cf` — Softer arm fade; fuller colour disc

Latest local/Pi change:
- Hard right-half wipe was too aggressive (looked like a left wedge). Now a gentle far-right fade only, slightly softer opacity, smaller centre hole.
- Hard refresh `?v=45`. Rebuild `vinyl`.

Previous:
- Screen-space elliptical tint (`ed3694f`).

---

## 2026-07-29 Session update (Cindy Vinyl — screen-space elliptical tint)

Latest commit: `ed3694f` — Elliptical tint (no rotateX); arm-side wipe; bigger label

Latest local/Pi change:
- Tint is an ellipse in screen space (perspective via width≠height) so the arm cutout lines up with the video — `rotateX` was fighting the mask.
- Soft-light blend + hard wipe on the right half where the tonearm lives.
- Larger elliptical centre art covers the Navidrome/baked-in label.
- Hard refresh `?v=44`. Rebuild `vinyl`.

Previous:
- Sleeve edit + overlay polish (`a0c3caa`).

---

## 2026-07-29 Session update (Cindy Vinyl — sleeve Edit ⋯ + overlay polish)

Latest commit: `a0c3caa` — Sleeve edit; tilt/shrink tint; arm corridor; cover label

Latest local/Pi change:
- Each crate sleeve has ⋯ → Edit names (album/artist) without spinning first.
- Colour tint: more back-tilt (`rotateX(58deg)`), slightly smaller, bigger centre hole, wider arm cutout so gold sits on top; centre art enlarged to cover baked-in video label.
- Hard refresh `?v=43`. Rebuild `vinyl`.

Previous:
- Nudge + arm mask (`b0dcb93`).

---

## 2026-07-29 Session update (Cindy Vinyl — nudge + arm over tint)

Latest commit: `b0dcb93` — Micro-nudge label; mask colour under tonearm

Latest local/Pi change:
- Nudged platter overlay right/down to `41.5% / 56%`.
- Colour tint punches out the tonearm path so gold arm sits on top; slightly softer opacity.
- Hard refresh `?v=41`. Rebuild `vinyl`.

Previous:
- Centre label + arm park (`0e38b7c`).

---

## 2026-07-29 Session update (Cindy Vinyl — centre label + arm park + colour)

Latest commit: `0e38b7c` — Nudge label onto spindle; short hold; visible vinyl tint

Latest local/Pi change:
- Label was ~5% left of the spindle — moved to 40.2% / 54.8%; spin on inner wrapper so 3D pose doesn’t drift.
- Hold loop back to 3.55→4.2s so the arm stays on the outer grooves (long loop was crawling then snapping).
- Vinyl colour is a saturated translucent groove ring (soft-light on black was invisible).
- Hard refresh `?v=40`. Rebuild `vinyl`.

Previous:
- Revolution hold + centre art (`a812eaf`).

---

## 2026-07-29 Session update (Cindy Vinyl — label seam + colour + centre art)

Latest commit: `a812eaf` — Revolution hold loop; spinning centre label; random vinyl colour

Latest local/Pi change:
- Hold loop is one platter revolution (3.55→5.008s) so label phase matches at the seam.
- Restored spinning album-art label over the platter centre (covers residual video jump).
- Random vinyl colour tint each track (`mix-blend-mode` so the video tonearm stays visible).
- Hard refresh `?v=39`. Rebuild `vinyl` (static only; restart optional).

Previous:
- Tight outer-groove loop (`02b6a6f`).

---

## 2026-07-29 Session update (Cindy Vinyl — strip hero overlays)

Latest commit: `10448c8` — Remove prism sleeve + platter overlays

Latest local/Pi change:
- Hero is photo/video only — no floating album sleeve or fake spinning label.
- Cover art stays in the transport bar / track list.
- Waiting on Chris’s new ~10s locked-camera loop (easier than cinematic + overlays).
- Hard refresh `?v=32`. Rebuild `vinyl`.

Previous:
- Forward hold + new still (`4d0b37c`).

---

## 2026-07-29 Session update (Cindy Vinyl — tight outer-groove loop)

Latest commit: `02b6a6f` — Loop only outer-groove spin (~0.65s)

Latest local/Pi change:
- Hold loop was 2.0→5.15s so the arm crawled to the label then jumped back.
- Now loops 3.55→4.2s (needle parked on the lead-in). Hard refresh `?v=38`.

Previous:
- Spin loop after drop (`d27f956`).

---

## 2026-07-29 Session update (Cindy Vinyl — keep spinning after drop)

Latest commit: `d27f956` — Forward play + spin loop (no freeze)

Latest local/Pi change:
- Cue-in is the forward first ~5.4s (spin up / arm over).
- Then loops 2.0s→5.15s so the platter keeps spinning with the arm down.
- Queue end still plays the lift/stop outro. Hard refresh `?v=37`. Rebuild `vinyl`.

Previous:
- Full drop then freeze (`5b42922`).

---

## 2026-07-29 Session update (Cindy Vinyl — full drop then freeze)

Latest commit: `5b42922` — Longer cue-in; don’t abort mid-drop

Latest local/Pi change:
- Cue-in is the full arm-to-record move (~4.5s), then freeze on that frame.
- Fixed video kickoff so a transient `play()` reject no longer freezes mid-swing.
- Hard refresh `?v=36`. Rebuild `vinyl`.

Previous:
- Freeze after short cue-in (`5d9086d`).

---

## 2026-07-29 Session update (Cindy Vinyl — freeze after cue-in)

Latest commit: `5d9086d` — Arm drops once, then freezes (no hold loop jump)

Latest local/Pi change:
- After cue-in, freeze on needle-down frame instead of looping a hold clip that jumped the arm back.
- Hard refresh `?v=35`. Rebuild `vinyl`.

Previous:
- New arm-lift clip (`a215cd6`).

---

## 2026-07-29 Session update (Cindy Vinyl — new arm-lift stop clip)

Latest commit: `a215cd6` — Wire Chris’s arm-lift / stop 10s clip

Latest local/Pi change:
- New video split: short reverse drop-in (~2.2s), forward hold loop (~3.5s), cue-out lift/stop (~4.5s).
- Rest `deck.png` = end still. Hard refresh `?v=34`. Rebuild `vinyl`.

Previous:
- Overflow menu + properties (`10448c8`).

---

## 2026-07-29 Session update (Cindy Vinyl — ⋯ menu + properties)

Latest commit: `10448c8` — Top-right menu: Cindy path + rename props

Latest local/Pi change:
- Hero overlays stripped (photo/video only).
- Header **⋯** menu: Show on Cindy (UNC path), Properties (Vinyl-only album/track rename), Refresh packs.
- Overrides stored on Pi at `/home/flightdeck/cindy-vinyl-data` — Cindy stays read-only.
- Hard refresh `?v=33`. Rebuild `vinyl`.

Previous:
- Forward hold + new still (`4d0b37c`).

---

## 2026-07-29 Session update (Cindy Vinyl — forward hold + new deck still)

Latest commit: `4d0b37c` — Forward-only spin loop + fresher rest still

Latest local/Pi change:
- Hold loop is **forward-only** (no reverse spin).
- Rest/startup `deck.png` replaced with Chris’s matched still; prism sleeve + platter retuned for 16:9.
- Hard refresh `?v=31`. Rebuild `vinyl`.

Previous:
- Ping-pong hold (`5267827`).

---

## 2026-07-29 Session update (Cindy Vinyl — loop hold after cue-in)

Latest commit: `5267827` — Ping-pong hold loop; no snap back to still

Latest local/Pi change:
- Cue-in trimmed (~1.35s), then seamless handoff to `deck-cue-hold.mp4` (forward+reverse of post-drop).
- Stays on video while playing; pause freezes frame; queue end still plays cue-out then static rest.
- Hard refresh `?v=30`. Rebuild `vinyl`.

Previous:
- Start/stop cues (`3298d22`).

---

## 2026-07-29 Session update (Cindy Vinyl — start/stop cue clips)

Latest commit: `3298d22` — Silent spin-up / spin-down deck cues

Latest local/Pi change:
- `start.mp4` → `deck-cue-in.mp4`, stop clip → `deck-cue-out.mp4` (audio stripped).
- Play from rest → cue-in (~3s), then static deck + spinning label + prism sleeve.
- Queue end → cue-out (~1.8s). Pause / track skip keep hold (no re-cue).
- Hard refresh `?v=29`. Rebuild `cindy-vinyl` (`vinyl` service).

Previous:
- Prism sleeve lean (`72fbda1`).

---

## 2026-07-29 Session update (Cindy Vinyl — sleeve on Technics prism)

Latest commit: `72fbda1` — Album cover leans against Technics prism

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
