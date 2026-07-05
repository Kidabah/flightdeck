## MakerDeck session handoff

Latest GitHub state:
- Branch: `main` (same repo as Flightdeck — `makerforge/` folder)
- Latest commit: _(pending)_ — served at `/makerdeck/` on Flightdeck

### 2026-07-05 — Insert body gap + slide-in shelf slots

**What changed:** **0.12 mm air gap** between Insert and Body (fixes Bambu Insert ↔ Body gcode conflicts). Insert gets its own extruder slot in 3MF. New **Mount** option: **Slide-in slots** (horizontal shelves only) — dados on side walls, shelves slide in from the front.

**Files:** `js/insert-slots.js`, `js/features.js`, `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=79`

**Deploy:** Pi `git pull`. Hard refresh. Re-export 3MF.

### 2026-07-05 — Fat quarters: open-front bookcase preview

**What changed:** **Fat quarters** now builds an **open-front bookcase** (no front wall — like your reference), **front-facing camera**, **amber shelf** panels with edge lines. Still 300×135×400 mm, 3 tiers, horizontal shelves.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=78`

**Deploy:** Pi `git pull`. Hard refresh; turn off X-ray if shelves are hard to see.

### 2026-07-05 — Fat quarters: standing bookcase (horizontal shelves)

**What changed:** **Fat quarters** preset is now a **standing bookcase** — tall box with **2 horizontal shelves** (3 tiers), not a flat tray. New insert axis **Height — horizontal shelves**. Inner **300 × 135 × 400 mm** (~133 mm per tier for ~132 mm standing quarters).

**Files:** `js/features.js`, `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=77`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`. Print lying on back if build height is tight.

### 2026-07-05 — Fat quarters preset: bookcase (standing) layout

**What changed:** **Fat quarters** preset reworked for **bookcase storage** — quarters stand on edge (~8 mm thick), not flat. Inner **300 × 135 × 135 mm**, **1 divider** → two rows (~**148 × 134 mm** each, ~18 quarters per row). Insert tab shows bookcase hint on this preset.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=76`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 — Fat quarters preset tuned for real folded size

**What changed:** **Fat quarters** preset now uses **1 divider** (2 bays **~147 × 299 mm**) sized for **~130 × 132 × 8 mm** folded quarters. Inner height **45 mm** (~5 stacks at 8 mm); use the height slider for more.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=75`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 — Export dropdown, divider count, fat quarters preset

**What changed:**
- **Download** is now a format dropdown (default **3MF project**) + single Download button — extra formats (lid, accent, insert, deboss cutter, saucer) appear only when relevant.
- **Reset defaults** button is red normally, flashes green with ✓ on success.
- **Insert** tab: divider **count** slider (1–4) splits the cavity into equal bays; hint shows compartments.
- New **Fat quarters** preset: 300×300×45 mm box, 1 divider (2 bays) for ~130×132×8 mm folded fabric.

**Files:** `js/app.js`, `js/features.js`, `js/geometry.js`, `index.html`, `css/style.css` — cache-bust `app.js?v=74`, `style.css?v=18`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/` (Ctrl+Shift+R).

### 2026-07-05 — Reset defaults button

**What changed:** **Reset defaults** in the top bar clears all settings back to the starter box (dimensions, colours, accent, insert, lid, art, etc.) and saves that as the new session. **Reset view** still only moves the camera.

**Files:** `js/app.js`, `index.html` — cache-bust `app.js?v=72`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 — Divider insert (half split)

**What changed:** New **Insert** tab — optional flat divider splits the cavity into two halves (length or depth). Separate **Insert** part in 3MF export (box filament). **Pencil box** preset enables it by default (length split).

**Files:** `js/features.js`, `js/geometry.js`, `js/app.js`, `js/stl.js`, `index.html` — cache-bust `app.js?v=71`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 — Fix Bambu 3MF auto filament assignment

**What changed:** **Download 3MF** now writes Bambu-compatible colour data — `Metadata/model_settings.config` as **XML** with per-object extruder slots (was JSON, which Bambu ignored), plus `paint_color` on every triangle so Body / Text / Accent import with the right filament without manual repainting.

**Files:** `js/3mf.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=70`

**Deploy:** Pi `git pull`. Re-export 3MF and open in Bambu (fresh import, not merge into existing project).

### 2026-07-05 — Fix accent preview strobing (z-fight)

**What changed:** Accent band geometry sits **0.08 mm outside** the body shell so it no longer shares the same faces (classic z-fight flicker). Preview accent also skips shadow casting and uses depth bias toward the camera.

**Files:** `js/features.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=69`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 — Preview matches customer 3MF colours

**What changed:** Viewport preview now mirrors what ships in **Download 3MF** — body and lid use the same box filament colour (was a hardcoded grey-blue lid), accent/text use their picker hex with matte PLA shading (no fake glow), deboss no longer shows a red dev overlay, and wireframe edges only appear in X-ray mode.

**Files:** `js/app.js`, `index.html` — cache-bust `app.js?v=68`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/` or `#/makerdeck`.

### 2026-07-05 — Accent bands follow profile + contrast picker

**What changed:** Accent bands (rim / front / floor) now **follow the box outline** — rounded pencil box corners curve with the body instead of a square axis-aligned skirt. **Floor stripe** is an outer base ring only (no solid fill slab). Preview accent has subtle emissive glow so it reads on the dark viewport. **Suggest contrast** picks a complementary filament swatch from the box colour.

**Files:** `js/features.js`, `js/geometry.js`, `js/color-picker.js`, `js/app.js`, `index.html`, `css/style.css` — cache-bust `app.js?v=67`, `style.css?v=17`

**Deploy:** Pi `git pull`. Hard refresh (`Ctrl+Shift+R`) on `/makerdeck/` or `#/makerdeck`. Backend restart not required.

### 2026-07-05 — MakerDeck tab inside Flightdeck

**What changed:** **MakerDeck** is now a sidebar page in Flightdeck (`#/makerdeck`) — no separate URL or port. Opens `/makerdeck/` in a full-height iframe on the same origin (Tailscale HTTPS works).

**Files:** `app/static/index.html`, `app/static/app.js?v=625`, `app/static/style.css?v=481`

**Deploy:** Pi `git pull` + **restart flightdeck.service** (Flightdeck static JS changed). MakerDeck iframe still uses `app.js?v=66`.

### 2026-07-05 — Restore text colour + L/C/R align (cache bust)

**What changed:** Text **colour** picker and **Left / Centre / Right** align stay visible with deboss on (align still positions multiline text). Full module cache-bust (`app.js?v=66`, `features.js?v=66`, `color-picker.js?v=66`, `style.css?v=16`) so Pi/browsers don't serve stale JS without the formatting UI.

**Files:** `js/app.js`, `js/3mf.js`, `index.html`

**Deploy:** Hard refresh (`Ctrl+Shift+R`) on `/makerdeck/`. Backend restart optional (static files).

### 2026-07-05 — Fix slide lid on pencil tube + grooves when lid off

**What changed:**
- **Channel slide** no longer offered on **pencil tube** (stadium ends) — rectangular slide lid/rails were the wrong shape; use slip-over or inset plug instead. **Pencil box** still supports channel slide.
- **Rail grooves** only carved into the body when **Enable lid** is on — turning the lid off no longer leaves square slider bumps on the case.

**Files:** `js/slide-lid.js`, `js/geometry.js`, `js/app.js`, `index.html` — `app.js?v=65`, `geometry.js?v=65`

**Deploy:** Hard refresh required. Backend restart not needed.

### 2026-07-05 — Fix 3MF export crash on multiline text

**What changed:** **Download 3MF** no longer throws `object null is not iterable` when exporting multiline label text (e.g. FAT / QUARTERS). Root cause was `repairNonManifoldFaces` in `stl.js` nulling a triangle mid-pass then dereferencing it on the same edge. STL export now has try/catch like 3MF.

**Files:** `js/stl.js`, `js/app.js`, `js/3mf.js`, `index.html` — `app.js?v=64`, `stl.js?v=64`

**Deploy:** Hard refresh required (Ctrl+Shift+R). Backend restart not needed.

### 2026-07-05 — Fix pencil box blank after preset switch (with text)

**What changed:** Switching pencil tube ↔ pencil box with label text no longer wipes the viewport. Rebuild is serialized (no overlapping art-timer + preset rebuilds), pending art rebuilds cancel on preset change, lid+label children dispose cleanly, camera fit guards NaN.

**Files:** `js/app.js`, `js/geometry.js`, `index.html` — `app.js?v=63`

**Deploy:** Hard refresh required (Ctrl+Shift+R). Backend restart not needed.

### 2026-07-05 — Fix pencil preset switching blank viewport

**What changed:** Pencil tube / pencil box no longer bleed lid+slide state into each other. Rebuild validates new geometry before removing old preview. `PENCIL_PRESET` resets lid off + front face.

**Files:** `js/app.js`, `js/geometry.js`, `index.html` — `app.js?v=62`

### 2026-07-05 — Fix 3MF export, pencil box, text align

**What changed:**
- **3MF download** — replaced fflate CDN zip with built-in writer; guards null mesh indices (fixes "null is not iterable")
- **Pencil box** — `cornerRadius` now passed to geometry for `pencilBox` shape (was forced to 0); slide lid + rounded case work again
- **Text align** — Left / Centre / Right buttons on Art tab (multiline lines align within the block)

**Files:** `js/3mf.js`, `js/app.js`, `js/features.js`, `js/geometry.js`, `index.html`, `css/style.css` — `app.js?v=61`, `style.css?v=15`

### 2026-07-05 — Visual colour pickers + 3MF Orca export + multiline text

**What changed:**
- **Colour pickers** — swatch grid + hex chip (box, text, accent) instead of tiny native colour input
- **Download 3MF** — body / text / accent as separate objects with `filament_colour` for Orca; **Download STL** kept for single mesh
- **Multiline text** — textarea, Enter for new line (up to 4 lines)
- **Preview** — text shown as separate coloured mesh matching export slots
- **Pencil presets** — "Quick presets" heading + better camera framing for pencil tube/box

**Files:** `js/color-picker.js`, `js/3mf.js`, `js/app.js`, `js/features.js`, `js/geometry.js`, `js/art-editor.js`, `index.html`, `css/style.css` — cache-bust `app.js?v=60`, `style.css?v=14`

**Deploy:** Pi `git pull` + hard refresh.

### 2026-07-05 — Box preview colour picker

**What changed:** Design tab → **Preview colour** → **Box** colour picker. Updates the 3D preview body material; saved in session like accent colour. STL export unchanged (pick filament in slicer).

**Files:** `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=59`

**Deploy:** Pi `git pull` + hard refresh (UI-only; restart optional).

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
