## MakerDeck session handoff

Latest GitHub state:
- Branch: `main` (same repo as Flightdeck — `makerforge/` folder)
- Latest commit: `734b8e9` — trace autosave + localStorage session restore
- Prior: `e91f615` — full MakerDeck MVP (geometry, trace emboss, STL export)

### Run locally (not on Pi service)

```bash
cd makerforge
python -m http.server 8765
```

Open [http://localhost:8765](http://localhost:8765) — **hard refresh** (`Ctrl+Shift+R`) after pulling JS changes.

No cache-bust query strings on `js/app.js`; browser may cache modules — use hard refresh when UI looks stale.

### 2026-07-04 — Import QoL + autosave

**Files:** `index.html`, `css/style.css`, `js/app.js`, `js/trace.js`

- **Paste** — Ctrl+V on Import tab loads clipboard images into trace pipeline.
- **Clear from box** — removes applied trace emboss without hard refresh.
- **Undo / redo** — ↶ ↷ (or Ctrl+Z / Ctrl+Y) for apply vs clear on the box.
- **Session autosave** — box settings, applied trace, and import image saved to `localStorage` (`makerdeck-session-v1`); survives refresh.
- Pi `git pull` syncs files only — Flightdeck service does **not** serve MakerDeck; run local http.server above.

### Working features

- Shapes: rect, rounded, hex, circle, pencil/teardrop/star/heart presets
- Lid, link joiner, accent stripe, honeycomb, stackable feet
- Label tab: text emboss, SVG upload
- Import tab: image → silhouette/outline trace → emboss on front face
- STL export (body, lid, accent)

### Known / later

- Preview rougher than Bambu slice at small art sizes
- Deboss (cut inward) not built yet
- Face picker for emboss (front/back/side) not built yet
- No Pi-hosted URL yet — local dev only
