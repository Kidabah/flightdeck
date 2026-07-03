## MakerDeck session handoff

Latest GitHub state:
- Branch: `main` (same repo as Flightdeck — `makerforge/` folder)
- Latest commit: `681ea88` — served at `/makerdeck/` on Flightdeck

### 2026-07-04 fix (blank preview on Pi)

**`js/app.js`** — moved stray `import` to top of module (mid-file import caused SyntaxError; JS never ran).
- Prior: `734b8e9` — trace autosave; `e91f615` — full MakerDeck MVP

### URLs

- **Pi / Tailscale:** `https://flightdeck.tail7de73e.ts.net/makerdeck/`
- **Local dev server:** `http://localhost:8765` (`cd makerforge && python -m http.server 8765`)
- **Local Flightdeck:** `http://localhost:8000/makerdeck/` (after backend restart)

**Hard refresh** (`Ctrl+Shift+R`) after pulling JS changes. No cache-bust on `js/app.js`; Flightdeck serves with `no-store`.

### 2026-07-04 — Import QoL + autosave

**Files:** `index.html`, `css/style.css`, `js/app.js`, `js/trace.js`

- **Paste** — Ctrl+V on Import tab loads clipboard images into trace pipeline.
- **Clear from box** — removes applied trace emboss without hard refresh.
- **Undo / redo** — ↶ ↷ (or Ctrl+Z / Ctrl+Y) for apply vs clear on the box.
- **Session autosave** — box settings, applied trace, and import image saved to `localStorage` (`makerdeck-session-v1`); survives refresh.
- Served at `/makerdeck/` via `app/main.py` static mount — **backend restart required** after deploy.

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
