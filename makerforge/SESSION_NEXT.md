## MakerDeck session handoff

Latest GitHub state:
- Branch: `main` (same repo as Flightdeck — `makerforge/` folder)
- Latest commit: `104fffa` — served at `/makerdeck/` on Flightdeck

### 2026-07-05 — Watertight STL export for embossed text

**What changed:** Download box now rebuilds a **watertight export mesh** — solid wall behind letters, closed letter solids, overlapping wall tris stripped under ink. STL pass welds verts + peels non-manifold faces. Preview unchanged.

**Files:** `js/features.js`, `js/stl.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=58`

### 2026-07-05 — Revert cut-through emboss (restore raised letters)

**What changed:** Rolled back the "punch holes in wall" manifold experiment — it cut straight through the box. Text is **raised emboss** again: flush with the wall, top cap + side walls only (no bottom cap duplicating the face).

**Files:** `js/features.js`, `js/geometry.js`, `index.html`

- STL export still welds vertices / drops duplicate tris (may reduce Orca warnings vs before).
- Cache-bust: `app.js?v=57`

### 2026-07-05 — Manifold STL export (Orca non-manifold fix)

**What changed:** Text emboss is now **integrated into the shell face** (punch holes + shared edges) instead of stacking two meshes. STL export also welds nearby vertices and drops duplicate triangles.

**Files:** `js/features.js`, `js/contour.js`, `js/geometry.js`, `js/stl.js`, `index.html`

- Side-face text (front/back/left/right/top) builds one watertight mesh — no 400+ non-manifold edges in Orca.
- Lid / joiner / trace art still use the legacy merge + weld fallback.
- Cache-bust: `app.js?v=56`

**Deploy:** Pi `git pull` + hard refresh.

### 2026-07-05 — Live text art (no bounding box)

**What changed:** Removed the misaligned viewport bounding box and draft/Apply workflow. Text edits go straight to the box mesh — type, adjust Size / Move / Rotation sliders, done.

**Files:** `index.html`, `css/style.css`, `js/app.js`, `js/art-editor.js`

- Removed `#art-overlay` handles and all overlay JS/CSS.
- Removed **Apply to box** / **Cancel** — text updates live via debounced rebuild.
- Added **Move left/right** and **Move up/down** sliders (`decorOffsetX/Y`).
- Fixed text vanishing after apply: body preview now uses merged mesh when emboss is on a body face.
- Cache-bust: `app.js?v=55`

**Deploy:** `git pull` on Pi — static files only; hard refresh (`Ctrl+Shift+R`).

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
