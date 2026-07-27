# SESSION_NEXT (active)

Recent Flightdeck / MakerDeck session notes (last ~4 weeks). Older history: [docs/archive/SESSION_NEXT_before_2026-06-28.md](docs/archive/SESSION_NEXT_before_2026-06-28.md).

MakerDeck detailed notes: [makerforge/SESSION_NEXT.md](makerforge/SESSION_NEXT.md).

---

## 2026-07-27 Session update

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
