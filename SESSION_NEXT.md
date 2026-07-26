# SESSION_NEXT (active)

Recent Flightdeck / MakerDeck session notes (last ~4 weeks). Older history: [docs/archive/SESSION_NEXT_before_2026-06-28.md](docs/archive/SESSION_NEXT_before_2026-06-28.md).

MakerDeck detailed notes: [makerforge/SESSION_NEXT.md](makerforge/SESSION_NEXT.md).

---

## 2026-07-26 Session update

Latest commit: `fba3d81` — PrintShelf real thumbnails

Latest local/Pi change:
- PrintShelf thumbs: STL mesh previews, better 3MF `Metadata/thumbnail.png` pickup, OBJ texture preview.
- Clear tiny placeholder thumbs + **Rescan** so the library fills with real previews.
- Restart `printshelf.service` after pull.

Previous:
- Copy fallback over HTTP; Windows path copy; PrintShelf v0.1. Archives in `docs/archive/`.

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
