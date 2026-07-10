## MakerDeck session handoff

Latest GitHub/Pi state:
- Branch: `main`
- Latest commit: _(pending — b216 deploy)_
- Cache-bust: `app.js?v=216` — header **b216**

> MakerDeck session notes live here — not in the repo-root `SESSION_NEXT.md` (Flightdeck farm/queue/UI only).

### 2026-07-10 — b216: Remove stubby / drink holder preset (wrong direction)

**Scrapped b214 + b215 drink-holder work** per Chris — clean removal, working MakerDeck.

**Removed:**
- **Stubby holder** / **Drink holder** preset chip in Design tab
- Entire `#section-stubby` UI (Can fit chips, rolled top, twist opener, holder mode)
- `stubbyHolder` shape, `STUBBY_HOLDER_PRESET`, `DRINK_HOLDER_PRESET`
- Modular holder geometry (`buildHolderModularParts`, snap rings, can ring / neck / cap)
- `topRimRoll`, twist opener hooks, holder stack ZIP export + exploded preview
- b215 WIP holder-mode UI (never shipped cleanly)

**Kept:** Unit dropdown (b213), ZIP container+lid export, gasket toggle, kitchen canisters, all other presets.

**Session restore:** saved `stubbyHolder` sessions fall back to **circle**.

- Cache **b216** (`app.js?v=216`, `geometry.js?v=216`, `features.js?v=216`). Hard refresh MakerDeck. **Backend restart required** (geometry.js changed).

### 2026-07-10 — b215: Modular drink holder — **SCRAPPED** (see b216)

Wrong direction — removed entirely in b216. Notes kept for history only.

### 2026-07-10 — b214: Stubby holder preset — **SCRAPPED** (see b216)

Wrong direction — removed entirely in b216. Notes kept for history only.

### 2026-07-10 — b213: Display unit dropdown (mm / cm / in)

**Design UI** (`js/app.js`, `index.html`, `css/style.css`)

- **Topbar** dropdown: **mm** | **cm** | **in** (imperial inches). Internal geometry stays mm; only sliders, value-edits, labels, and **Outer** stat readout convert.
- `state.displayUnit` persisted in session save/restore (`makerdeck-session-v1`).
- Conversion: cm ÷10 display / ×10 input; in ÷25.4 / ×25.4. Export filenames unchanged (always mm in STL/3MF names).
- Length fields: inner W/D/H, walls/floor, edges, lid dims, joiner, insert, vase, emboss/art offsets & sizes, accent band height/wave.
- Cache **b213**. Hard refresh MakerDeck. UI-only — Pi pull sufficient; restart optional.

### 2026-07-10 — b212: Separate gasket groove from gasket 3MF export

**Lid tab** (`js/app.js`, `index.html`)

- **Problem:** Unchecking **Gasket groove** removed both the underside groove (needed for TPU cord) and the separate **Gasket** part in lid 3MF — no way to keep groove-only.
- **Fix:** New toggle **Include gasket in 3MF** (`lidGasketExportRing`, default on) appears when groove is enabled. Uncheck to keep groove geometry in the lid but export lid-only (no Gasket part). Hint: "Uncheck to keep the groove for TPU cord but export lid-only in the 3MF."
- `collectColoredLidExportParts` respects `lidGasketExportRing`; session save/restore and presets already carried the param.
- Cache **b212**. Hard refresh MakerDeck. UI-only — Pi pull sufficient; restart optional.

### 2026-07-10 — b211: Art/Text manifold sanitize + export open-edge warning

**Export** (`js/app.js`, `index.html`)

- **Root cause:** Body+Art+Text+Accent multi-part 3MF had correct `model_settings.config` extruder slots, but Art/Text still used `prepareMeshFor3mf` (light weld only). Open/non-manifold art meshes made Bambu block AMS colour assignment until **Repair** — Repair then remeshes/merges parts and breaks filament slots.
- **Fix:** Art and Text export parts now run through `sanitizeMeshForStl` (weld + non-manifold peel). Export status reports open edges for accent too; warns to avoid Bambu Repair when any part has open edges.
- Cache **b211**. Hard refresh, re-export — status should show `open edges: body 0, art 0, text 0, accent 0`.

### 2026-07-10 — b210: Dual-file ZIP export (container + lid 3MF)

**Export** (`js/3mf.js`, `js/app.js`, `index.html`)

- **Problem:** b203–b209 single-file multi-plate 3MF never produced separate Bambu plate tabs on Chris's H2D — container+lid always landed on plate 1. No working 2-plate golden reference in repo.
- **Fix:** when lid is enabled, **3MF project** download is now a **ZIP** with:
  - `{name}-container.3mf` — Body + Art + Text + Accent (single plate, known working)
  - `{name}-lid.3mf` — Lid + Gasket (+ lid art if any), plate-down (known working)
  - `README.txt` — Import both files in Bambu Studio. Slice container first, then lid.
- Uses browser `createZipStore` (no CDN). UI: export plan chip **ZIP · container + lid**, dropdown **3MF · ZIP (container + lid)**, status **ZIP downloaded — open container.3mf and lid.3mf in Bambu**.
- **Removed** broken single-file multi-plate path from `buildBody3mfExport` (multi-plate builder remains in `3mf.js` for verify script only).
- **Bambu workflow:** unzip → open `container.3mf` → slice plate 1 → open `lid.3mf` → slice plate 1 (lid is plate-down).
- Cache **b210**. Hard refresh, re-download with lid on — expect `.zip` not `.3mf`.

### 2026-07-10 — b209: Fix Bambu H2D multi-plate tabs (H2D grid stride) — SUPERSEDED by b210 ZIP export

**Export** (`js/3mf.js`, `js/app.js`, `index.html`, `.ref/multi-plate-3mf-verify.mjs`)

- **Golden reference:** Bambu `PartPlate.cpp` `reload_all_objects()` — plate tabs come from **bbox intersection** with each plate's world grid box, not `model_instance` alone. H2D `printable_area` 350×320 from `.ref/repaired-unzip/Metadata/project_settings.config`.
- **Root cause:** b208 used **256 mm** bed for transforms; Chris opens on **H2D (350 mm)**. Plate stride = 350×1.2 = **420 mm**. Lid at ~431 mm still intersected plate 0 (0–350) → both objects on plate 1; plate 2 empty → tab deleted.
- **Fix:** default bed **350×320**, `plateGridOffset()` + `worldTransformForPlate()` (local centre + grid offset) on build + assemble. `plate_N.json` stays plate-local. `project_settings` embeds H2D `printable_area`. Verify simulates Bambu plate intersection.
- Verify: `node .ref/multi-plate-3mf-verify.mjs`
- Cache **b209**. Hard refresh, re-download 3MF, open in Bambu H2D — expect **Plate 01 Container** + **Plate 02 Lid** tabs.

### 2026-07-10 — b208: Fix Bambu H2D multi-plate tabs (plate-local layout)

**Export** (`js/3mf.js`, `js/app.js`, `index.html`, `.ref/multi-plate-3mf-verify.mjs`)

- **Root cause:** b207 applied **+303 mm plate-grid X offset** to build + assemble transforms. That offset is for Bambu project-overview thumbnail layout, not plate-tab separation. Both container+lid rendered side-by-side on plate 01; container partially off bed; only one plate tab.
- **Fix:** remove `plateGridOffset`; plate assignment via `<model_instance>` only. Build + assemble transforms use **plate-local bed-centring** (`centeringOffsetOnBed` on 256×256 mm bed). `plate_N.json` bbox translated to match. Verify script checks separate plate object assignment and rejects +303 mm grid offsets.
- Verify: `node .ref/multi-plate-3mf-verify.mjs`
- Cache **b208**. Hard refresh, re-download 3MF, open in Bambu H2D — expect **Plate 01 Container** + **Plate 02 Lid** tabs, each centred on its own bed.

### 2026-07-10 — b207: Fix Bambu H2D multi-plate stacking (12-value transforms)

**Export** (`js/3mf.js`, `js/app.js`, `index.html`, `.ref/multi-plate-3mf-verify.mjs`)

- **Root cause:** b205/b206 wrote **15-number** transform strings (`1 0 0 0 0 1 0 0 0 0 1 0 tx ty tz`). Bambu/Orca `bbs_get_transform_from_3mf_specs_string` requires **exactly 12** values (4×3 column-major); anything else → **identity**. Both container+lid landed at origin on plate 1; `auto_drop="1"` stacked lid on container bbox. plate_2.json bbox was also world-offset (+303 mm) instead of plate-local.
- **Fix:** `formatTransform3x4` → `1 0 0 0 1 0 0 0 1 tx ty tz` (12 values). plate_N.json bbox uses plate-local coords. Added `pattern_bbox_file` metadata per Orca export. Verify script checks transform length, +303 mm plate-2 offset, local bbox.
- Verify: `node .ref/multi-plate-3mf-verify.mjs`
- Cache **b207**. Hard refresh, re-download 3MF, open in Bambu H2D — expect **Plate 1 Container** + **Plate 2 Lid** tabs, lid on its own bed.

### 2026-07-10 — b206: Fix Bambu H2D multi-plate tabs (plate_N.json)

**Export** (`js/3mf.js`, `js/app.js`, `index.html`, `.ref/multi-plate-3mf-verify.mjs`)

- **Root cause:** b205 added `<plate>` + `<assemble>` + build transforms, but Bambu Studio still lumped container+lid on plate 1 because **`Metadata/plate_1.json` / `Metadata/plate_2.json` were missing**. BS/Orca GUI loader requires per-plate JSON bbox files to register separate plate tabs (Orca #13729).
- **Fix:** emit `Metadata/plate_N.json` (bbox_all + bbox_objects with identify_id), minimal `plate_N.png` + top/pick/no_light stubs, plate thumbnail paths in `model_settings.config`, identify_id aligned to assembly object id, multi-plate build items with `printable="1" auto_drop="1"`.
- Verify: `node .ref/multi-plate-3mf-verify.mjs`
- Cache **b206**. Hard refresh, re-download 3MF, open in Bambu H2D — expect **Plate 1 Container** tab and **Plate 2 Lid** tab.

### 2026-07-10 — b205: Fix 2-plate Bambu/Orca lid placement

**Export** (`js/3mf.js`, `js/app.js`, `index.html`)

- **Root cause:** multi-plate 3MF had two `<plate>` blocks but build items had no transforms and no `<assemble>` section — Bambu Studio imported both assemblies at origin on plate 1.
- **Fix:** plate-grid transforms on build items (+303 mm X for plate 2), `<assemble>` block with matching `assemble_item` entries, unique `identify_id` per plate.
- Cache **b205**. Superseded by **b206** (missing plate JSON).

### 2026-07-10 ??? b204: Export top bar + save dialog rework

**UI** (`index.html`, `css/style.css`, `js/app.js`)

- Top bar split: title/tools row, then dedicated **export dock** underneath.
- Live **export plan** chip shows plate layout before download (`2 plates ?? P1 Body + Art ?? P2 Lid`).
- Status line moved to full-width bar below export controls (shorter headline, hover for detail).
- Export dialog renamed **Export** with plate chips + parts list; submit button **Export**.
- Cache **b204**. Hard refresh.

### 2026-07-10 ??? b203: 2-plate 3MF when lid is enabled

**Export** (`js/3mf.js`, `js/app.js`, `index.html`)

- **3MF project** download now auto-includes **Container on plate 1** and **Lid on plate 2** when lid is enabled (Bambu/Orca multi-plate `model_settings.config`).
- Lid parts are plate-down (`orientLidForPrint`) with filament slots offset after body/art/text/accent colours.
- Save dialog hint updated when lid is on. Separate **3MF lid** export still available for lid-only.
- Cache **b203**. Hard refresh, re-download 3MF, open in Bambu Studio ??? expect two plates.

### 2026-07-10 ??? b202: Accent front panel + floor stripe placement

**Accent** (`js/features.js`, `js/accent-bands.js`, `js/app.js`, `index.html`)

- **Front panel only** was on the back: `frontProfileEdgeFilter` used `maxY` (back) and rect front band used `+Y`; front is `-Y` / `minY` (same as COFFEE text).
- **Floor stripe** appeared at top: `bandToBuildParams` treated `face: floor` as rim when default `pos` was 50; floor face now always maps to floor ring. UI sets `pos=0` when floor is selected.
- Cache **b202**. Hard refresh only (UI/static JS). Pi pull still required.

### 2026-07-10 ??? b201: Art/text export like accent bands (horizontal wall slabs)

**Export** (`js/features.js`, `index.html`)

- **Insight:** accent rim bands slice cleanly because they're **horizontal wall slabs** per layer ??? not thin plaques extruded into the wall.
- Art + COFFEE text now export via `buildFaceDecalSlabMesh` ??? 0.2 mm rows, 0.12+0.45 mm proud (same skin/thickness as accent).
- Preview still uses normal emboss; only 3MF Art/Text parts use slab path.
- Cache **b201**. Hard refresh, re-export.

### 2026-07-10 ??? b200: Lid colour picker on Lid tab

**UI** (`index.html`, `js/app.js`)

- **Lid** tab ??? **Lid colour** swatch + **Match body** (clears separate lid colour).
- **Size** tab **Box colour** hint updated ??? body only.
- Lid colour saved in session and used for lid 3MF export.
- Cache **b200**. Hard refresh.

### 2026-07-10 ??? b199: Shallow export emboss (sticker skin, fewer text seams)

**Export** (`js/features.js`, `index.html`)

- White dashes in Bambu preview are **Seams** (confirmed) ??? thick 1.0 mm plaques multiply perimeter loops on arc COFFEE.
- Export caps: **text 0.36 mm**, **art 0.48 mm** (respects lower Emboss depth slider). Top-cap-only on flush skin.
- Preview still uses full emboss depth; only 3MF export is shallow.
- Cache **b199**. Hard refresh, re-export. Tip: Emboss depth slider ??? 0.3???0.4 for even flatter.

### 2026-07-10 ??? b198: Fix white layer-gap seams in art + COFFEE text

**Export** (`js/features.js`, `js/app.js`, `index.html`)

- **Root cause:** (1) 0.2 mm proud standoff left an air gap between body and art ??? grey shows through as white horizontal seams. (2) Hatch trace slivers not fully unioned ??? slicer drops sparse layers inside the sack/letters.
- **Fix:** flush embed on outer skin (no standoff gap, still no wall punch). Always raster-union trace art on export with heavier dilate. Text mask dilate 4. Emboss depth snapped to 1.0 mm (0.2 mm layer grid).
- Cache **b198**. Hard refresh, re-export.

### 2026-07-10 ??? b197: Hollow body export (stop punching front-wall holes)

**Export** (`js/app.js`, `index.html`)

- **Root cause:** `punchBodyShellForLabelExport` deleted front-wall triangles under art ??? **through-holes** into the cavity. Bambu treated the canister as a solid block (red infill filling the interior).
- **Fix:** export intact hollow `boxShell` (no punch). Art/Text sit **0.2 mm proud** of the wall (`__labelExportEmbedded: false`) so filaments stay separate without breaching the shell.
- Cache **b197**. Hard refresh, re-export.

### 2026-07-10 ??? b196: Restore 3-part export (Body + Art + Text filaments)

**Export** (`js/app.js`, `index.html`)

- **Root cause:** b194 merged AMS mesh painted art+text per-triangle, but `prepareMeshFor3mf` weld/dedup dropped `triangleExtruders` alignment ??? Bambu saw one "Body" object with art colour on everything.
- **Fix:** back to **3 separate parts** (Body / Art / Text), each with its own filament slot. Keeps b195 scale fix + flush embedded placement (no 0.2 mm air gap).
- Cache **b196**. Hard refresh, re-export. Bambu object list should show Body + Art + Text.

### 2026-07-10 ??? b195: Fix shrunk bag + missing COFFEE text on export

**Export** (`js/contour.js`, `js/features.js`, `js/app.js`, `index.html`)

- **Root cause:** `unionShapeGroupsToPrepared` rasterised at 1024px but returned polygons in **downscaled** coordinates. Export then mapped them with the full-resolution scale ??? bag ~50% size, text shifted off-face / invisible. Status falsely showed `art 0, text 0` (no separate Art/Text parts in merged AMS).
- **Fix:** rescale united polygons back to original trace/mask pixel space before placement.
- Arc **COFFEE** text no longer unioned (letters stay on the curve).
- Export status now shows `art N tris, text N tris` for AMS painted mesh.
- Cache **b195**. Hard refresh, re-export.

### 2026-07-10 ??? b194: Single AMS mesh (fix empty layers + shattered art)

**Export** (`js/app.js`, `js/features.js`, `index.html`)

- **Root cause of ???worse???:** b193 exported **3 separate floating parts** (Body + Art + Text). Bambu saw empty layers at 129.8???130.2 mm (box top) and sparse red dots ??? floating 0.2 mm standoff meshes don???t slice as one solid.
- **Fix:** multi-colour export now builds **one watertight mesh** via `buildMergedAmsExportMesh` + `punchBodyShellForLabelExport` on plain `boxShell` (no stack feet).
- Art/text **embedded flush** (`__labelExportEmbedded`) ??? no air gap; pockets cut in front wall under ink.
- Min emboss depth **0.8 mm** on label export for reliable toolpaths.
- Heavier trace union dilate (4???5 passes) for hatch-heavy coffee-sack traces.
- Export status shows **???AMS painted 3MF???** (one object, per-triangle filament colours).
- Cache **b194**. Run `DEPLOY-B194.bat`, hard refresh, **re-export** ??? do not reuse old `coffee jar (3).3mf`.

### 2026-07-10 ??? b193: Fix coffee canister slice (manifold body + united COFFEE text)

**Export** (`js/geometry.js`, `js/features.js`, `js/app.js`)

- **Body:** exported plain `boxShell` without stack feet / honeycomb (those merged ~5k open edges in Bambu).
- **Text:** export unions all letters into **one** solid (letter solids touching = non-manifold).
- **Art:** closed-cap extrude path aligned with text (watertight plaque).
- **Watermark:** skipped on multi-part AMS export (bottom deboss broke body shell).
- Export status shows open-edge counts per part (body / art / text) ??? all should be 0.
- Cache **b193**. Deploy, hard refresh, **re-export** coffee jar (old 3MF still broken).

### 2026-07-10 ??? b192: Fix 3MF export freeze (Page Unresponsive)

**Export** (`js/contour.js`, `js/stl.js`, `js/app.js`, `index.html`)

- **Root cause:** b191 unioned traced art by testing every pixel ?? every shape group (billions of point-in-polygon hits on coffee-sack traces) ??? browser froze on Download.
- Union now uses **canvas fill** + **1024px max** working resolution.
- Art/text export skips heavy non-manifold repair (already solid union mesh).
- 3MF export is **async** with status text ("Preparing???", "Building meshes???").
- Cache **b192**. Hard refresh, re-download coffee jar 3MF.

### 2026-07-10 ??? b191: Fix blank canvas (duplicate pointInRing in contour.js)

**Boot** (`js/contour.js`, cache-bust **b191**)

- **Root cause:** b189 added a second `pointInRing` in `contour.js` ??? file already had one at line 127. ES module parse error: `Identifier 'pointInRing' has already been declared` ??? entire app dead, blank viewport.
- Removed duplicate; kept `pointInShapeGroup` + union helpers.
- Hard refresh until header shows **b191**.

### 2026-07-10 ??? b190: Fix blank canvas after b189 (contour.js cache)

**Boot** (`js/features.js`, `js/trace.js`, `js/app.js`, `index.html`)

- **Root cause:** b189 added `unionShapeGroupsToPrepared` to `contour.js` but imports were unversioned ??? browser kept stale `contour.js`, `features.js?v=189` failed to load (`export not found`) ??? blank viewport, header stuck on HTML **b189**.
- Versioned `contour.js?v=190`; bumped all module tags to **b190**; fixed `MAKERDECK_BUILD` constant.
- Hard refresh (`Ctrl+Shift+R`) until header shows **b190** and preview renders.

### 2026-07-10 ??? b189: Union traced art for manifold 3MF export

**Export** (`js/contour.js`, `js/features.js`, `js/app.js`, `index.html`)

- **Root cause:** silhouette / colour-separated traces store hundreds of `shapeGroups` (coffee-sack hatching). Export extruded each as its own solid ??? adjacent slivers share faces ??? 3000+ open edges, 284 non-manifold, Bambu swiss-cheese toolpaths. b186???b188 only fixed the `strokePaths` branch; `shapeGroups` was still broken.
- New `unionShapeGroupsToPrepared` ??? rasterises all trace loops to one ink mask, re-polygonises, extrudes as a single solid.
- Art/text 3MF parts now run through `sanitizeMeshForStl` after weld (non-manifold peel).
- Cache **b189**. Hard refresh, **re-export** coffee jar 3MF (old `coffee jar (3).3mf` will still be broken).

### 2026-07-10 ??? b188: Wrap art follows surface texture (swiss-cheese fix)

**Export / preview** (`js/features.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- **Root cause:** wall-wrap emboss sat on the *smooth* cylinder while ripple/scales displaced the body wall outward ??? texture peaks punched through COFFEE / coffee-sack art ??? Bambu swiss-cheese toolpaths.
- Wrap `mapPoint` now adds the same `vaseTextureDisplacement` as the body shell, then emboss depth on top.
- Separate-colour export standoff grows with texture depth so peaks never pierce thin art.
- Also bumped stale `geometry.js` ??? `features.js?v=188` (was stuck on v=174).
- Cache **b188**. Hard refresh and **re-export** coffee jar 3MF (don't reuse old files).

### 2026-07-10 ??? b187: Export actually uses solid art mesh path

**Export** (`js/features.js`, `js/app.js`, `index.html`)

- **Root cause:** b186 improved `collectBitmapGraphicShapeGroups` but export still called `buildEmbossBitmap`, which bypassed it and extruded thin stroke quads for outline traces.
- New `buildGraphicLabelExportMesh` ??? export now routes through solid filled shape groups + closed caps.
- Removed centroid inflate on export (was breaking concave letters like C/E); wider stroke raster + more mask dilate instead.
- Arc text export raster at 1280px. Cache **b187**. Hard refresh and re-export.

### 2026-07-10 ??? b186: Solid trace + arc text export

**Export** (`js/contour.js`, `js/features.js`, `js/app.js`, `index.html`)

- Outline trace art (coffee sack line art) now **rasterises to filled solids** on export instead of thousands of thin quad segments ??? fixes horizontal gaps / missing chunks in Bambu.
- Arc text export: 1px mask dilate, no smooth pass, slightly more inflate (0.15 mm).
- Cache **b186**. Hard refresh and re-export coffee canister 3MF (upright on base).

### 2026-07-10 ??? b185: Library upload fix + export art detail

**Export / library** (`app/main.py`, `js/features.js`, `js/library.js`, `index.html`)

- Fixed library save crash: `max_file_size` not supported on Pi Starlette ??? bump `MultiPartParser` limits at boot instead.
- Export art/text: finer simplify, thicker strokes, slight inflate so COFFEE letters and trace lines don't lose chunks in Bambu.
- Cache **b185**. Hard refresh + **backend restart required**.

### 2026-07-10 ??? b184: Closed export solids + library upload limit

**Export** (`js/features.js`, `js/app.js`, `app/main.py`, `index.html`)

- Art/text export meshes are now **closed solids** (not open-bottom shells) with **0.2 mm** standoff ??? fixes empty layers and pitting when sliced upright.
- Library POST raised Starlette multipart limit (was 1 MB ??? blocked large 3MF saves).
- Open-edge warning now reports **body only** (art/text open bottoms no longer scare you).
- Print canisters **standing upright** (lid flat separately). Cache **b184**. Hard refresh + **backend restart**.

### 2026-07-10 ??? b183: Fix 3MF colours (separate parts) + library save

**Export** (`js/app.js`, `js/features.js`, `index.html`)

- Reverted merged single-mesh AMS export ??? it created ~20k open edges and Bambu imported one grey body with no filament colours.
- Body + art + text export as **3 separate 3MF objects** (extruders 1???3) with **0.06 mm proud standoff** on art/text.
- Library save compresses preview/trace images before upload; retries without trace if needed; shows error text in export status.
- Cache **b183**. Hard refresh and re-export coffee canister 3MF.

### 2026-07-10 ??? b182: Export filename dialog + optional library save

**Export** (`index.html`, `js/app.js`, `js/library.js`, `css/style.css`, `app/makerdeck_library.py`, `app/main.py`)

- **Download** opens a dialog ??? edit the file name before saving (all STL / 3MF formats).
- **Save to design library** checkbox (body STL + 3MF only); preference remembered in localStorage.
- Library upload no longer stuffs huge trace/thumbnail data into JSON ??? separate multipart files fix silent save failures.
- Cache **b182**. Hard refresh. **Backend restart required** (library API change).

### 2026-07-10 ??? b181: Fix blank preview (duplicate stl export)

**Boot** (`js/stl.js`, `js/app.js`, `js/3mf.js`, `index.html`)

- `prepareMeshFor3mf` was declared **twice** in `stl.js` ??? ES module parse error killed the whole app (header showed b180 from HTML but viewport stayed empty).
- Removed duplicate; kept the version that preserves `triangleExtruders` for AMS export.
- Cache **b181**. Hard refresh (Ctrl+Shift+R); header must show **b181** and box preview should render.

### 2026-07-10 ??? b180: Fix export crash (stack overflow)

**Export** (`js/3mf.js`, `js/app.js`, `index.html`)

- b179 export crashed silently: `Math.max(...triangleExtruders)` overflowed on large meshes ??? no download.
- Visible build tag now updates to **b180** so you can confirm fresh JS loaded.
- Cache **b180**. Hard refresh; check header says **b180** before exporting.

### 2026-07-10 ??? b179: AMS merged export + arc text mesh fix

**Export** (`js/features.js`, `js/app.js`, `js/stl.js`, `js/3mf.js`, `index.html`)

- Body + art + text export as **one mesh** with per-triangle filament paint (stops Bambu stripping the front wall).
- Body shell uses **light 3MF prep** only ??? no face-peeling sanitize.
- Text export uses **open-bottom** shells (top cap + walls), matching preview ??? fixes arc letter glitches like the striped **F**.
- Cache **b179**. Hard refresh and re-export 3MF.

### 2026-07-10 ??? b178: Keep body wall on multi-colour export (standoff fix)

**Export** (`js/features.js`, `js/app.js`, `index.html`)

- Reverted wall **punching** (left 17k+ open edges ??? broken shell in Bambu).
- Body stays **fully closed**; Art/Text export **0.06 mm proud** so Bambu does not strip coplanar faces.
- Preview unchanged (flush); only download geometry shifts.
- Cache **b178**. Hard refresh and **re-export** 3MF.

### 2026-07-10 ??? b177: Fix missing front wall on multi-colour export

**Export** (`js/features.js`, `js/app.js`, `index.html`)

- Body export now **punches wall pockets only under art + text** instead of leaving a coplanar face Bambu strips away.
- Art/Text parts fill those pockets; wall remains everywhere else on the front face.
- Cache **b177**. Hard refresh and re-export 3MF.

### 2026-07-09 ??? b176: Fix arch down + wide preset

**Arc text geometry** (`js/features.js`, `js/app.js`, `index.html`, `js/geometry.js`)

- **Arch down** ??? text on bottom of circle, right-side up (C left, E right under the graphic); auto-nudges below the art.
- **Wide** (was Banner) ??? shallow arch over the top, same orientation as arch up.
- Cache **b176**. Hard refresh MakerDeck.

### 2026-07-09 ??? b175: Word-style arc text (presets + curve slider)

**Arc text UX** (`js/features.js`, `js/app.js`, `js/geometry.js`, `index.html`)

- **Curve style** presets: Arch up, Arch down, Banner (like Word WordArt).
- Single **Curve amount** slider (0???100) bends radius; old radius/sweep/start/tilt/spacing tucked under **Fine tune arc???**
- Letter spacing now **centres the word** on the arc (no more ???rotating??? the whole word).
- Typing text with a graphic auto-applies **Arch up** and nudges text above the art.
- Flat **Text rotation** hidden in arc mode (syncArtEditorUi fix).
- Cache **b175**. Hard refresh MakerDeck.


**Arc text tuning** (`js/features.js`, `js/app.js`, `index.html`, `js/geometry.js`)

- Arc centre moves independently (left/right + up/down position the circle centre, not just the bbox).
- New sliders: **Arc start** (???90 = top), **Arc tilt**, **Letter spacing**.
- Arc span 40???360??; radius up to ~115% of face width; auto sizes wider around traced art.
- Flat-mode **Text rotation** hidden in arc mode ??? use **Arc tilt** instead (fixes the 104?? mess).
- Cache **b174**. Hard refresh MakerDeck.

### 2026-07-09 ??? b173: Larger arc radius for label text

**Art tab arc text** (`js/features.js`, `js/app.js`, `index.html`)

- Auto arc radius now sizes from **traced/SVG graphic** bounds (not just SVG).
- Bigger auto radius + manual slider up to ~92% of face width.
- Cache **b173**. Hard refresh MakerDeck.

### 2026-07-09 ??? b172: Independent text vs graphic placement

**Art tab** (`js/decor.js`, `js/features.js`, `js/app.js`, `js/geometry.js`, `index.html`)

- Typing text **no longer clears** traced/SVG line art.
- **Separate move/rotate** for text vs graphic (text position sliders + graphic sliders).
- Typing text while art is on auto-switches to **Arc** path so COFFEE curves around the graphic.
- Wider move sliders (??80 mm); graphic size up to 56 mm.
- Cache **b172**. Hard refresh MakerDeck.

### 2026-07-09 ??? b171: Art colour picker (SVG / trace)

**Art tab** (`js/app.js`, `js/geometry.js`, `index.html`)

- **Art colour** picker for SVG and traced image art ??? separate from body and text colours.
- Preview shows graphic in chosen colour (brown `#4a3728` default ??? good on white canisters).
- **3MF export** adds an **Art** part (separate filament slot) alongside Body / Text.
- Coffee canister preset seeds `artColor: #4a3728`.
- Cache **b171**. Hard refresh MakerDeck.

### 2026-07-09 ??? b170: Text + SVG together, arc labels, Windows fonts

**Art tab** (`js/features.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- **Text and SVG at the same time** ??? type COFFEE while a coffee-bean SVG stays on the face; 3MF exports body (with graphic) + separate Text colour part.
- **Arc text path** ??? Flat | Arc chips; arc span + radius (0 = auto around centre graphic).
- **36 Windows/office fonts** ??? Bahnschrift, Candara, Gabriola, Franklin Gothic, Palatino, etc.
- SVG toggle renamed **Add SVG graphic**; text fields stay visible when SVG is on.
- Cache **b170**. Hard refresh MakerDeck. UI-only ??? pull on Pi sufficient (restart harmless).

### 2026-07-09 ??? b169: SVG import overhaul (filled paths + smart fallback)

**Art tab SVG** (`js/features.js`, `js/app.js`, `index.html`)

- **Filled SVG** paths emboss as solid geometry (logos, plaques) ??? not just stroke outlines.
- **Transform-aware** parsing (`getCTM`) ??? grouped/scaled SVGs land in the right place.
- **Wrap face** uses same seam normalization as text/trace for jar plaques.
- **Smart import**: vector first; auto-fallback to silhouette trace when paths are empty.
- Status line reports `filled vector`, `stroke vector`, or `traced silhouette`.
- Cache **b169**. Hard refresh MakerDeck.

### 2026-07-09 ??? b168: Flat-lid gasket groove + TPU ring export

**Optional dust seal for canisters** (`js/features.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- **Gasket groove** toggle on Lid tab (flat cap) ??? underside annular channel; on by default for kitchen canister presets.
- Lid **3MF** exports a third **Gasket** part (grey slot) sized to the groove ??? print in TPU; or press in 2 mm cord.
- Sliders: groove width / depth. Not fully airtight ??? better dust seal than bare plastic-on-plastic.
- Cache **b168**. Hard refresh MakerDeck.


**Uniform T/C/S jar tower** (`js/features.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- New **Stack set** preset ??? 250g round jars, nest-stack flat lids (raised rim + outer seating groove), single-letter wrap labels.
- **Stack trio** chips: T ?? Tea, C ?? Coffee, S ?? Sugar ??? auto body colour + wood-tone `lidColor` for 3MF export.
- `stackStyle: "nest"` vs hex feet; nest geometry in `appendNestStackLidRim`.
- Cache **b167** (`app.js?v=167`, `geometry.js?v=167`, `features.js?v=167`). Hard refresh MakerDeck. Pi deployed + restarted.

### 2026-07-09 ??? b163: True 2-manifold welded divider (0 open / 0 overused)

**Sharp-box welded export topology rewrite** (`js/features.js`)

- Root cause of Bambu non-manifold: solid divider end-caps + long unsplit rim edges ??? **6 overused (n=3) edges** at wall/divider junctions, plus T-junctions on the top rim.
- **Fix:** bay faces + top only (no end caps / bottom); split outer walls, bottom, and rim at every divider station; corner ears share verts with side rim.
- Depth + length axes, 1???3 dividers: audit shows **0 open edges, 0 overused edges** (~76 tris for one divider).
- Export guard expects ???50 tris for sharp welded boxes.
- Cache **b163**. Hard refresh. Re-download 3MF ??? Bambu should show **0 non-manifold** without Repair. Do **not** Repair old b134/b135 files.

### 2026-07-09 ??? b166: 1.5 kg biscuit canister size

**Fourth size tier for biscuits** (`js/app.js`, `js/geometry.js`, `index.html`)

- New **1.5kg** chip ??? wide square biscuit tin (150??115??165 mm inner) or tall round jar (145??232 mm).
- Picking **Biscuits** in Contents auto-selects 1.5kg.
- Cache **b166**. Hard refresh.

### 2026-07-09 ??? b165: Canister sizes from OEM coffee-tin chart

**125g / 250g / 500g footprints** (`js/app.js`, `js/geometry.js`, `index.html`)

- Size chips now match common tin outer dimensions (250 ml ??? 125g, 500 ml ??? 250g, 1 L ??? 500g).
- Inner cavity derived from chart ????height minus wall + floor; hover chip for outer mm reference.
- Default preset = **250g** (500 ml tin).
- Cache **b165**. Hard refresh.

### 2026-07-09 ??? b164: Canister preset buttons always visible

**Kitchen canister UX** (`index.html`, `css/style.css`)

- Square canister / Round jar preset buttons now always show under **Kitchen canisters** (were hidden until already on a canister ??? catch-22).
- Contents + Size chips appear after you pick a preset.
- Cache **b164**. Hard refresh.

### 2026-07-09 ??? b162: Kitchen canister presets

**Square canister + round jar** (`js/geometry.js`, `js/features.js`, `js/app.js`, `index.html`, `css/style.css`)

- New presets: **Square canister** (flat front label, flat stackable lid) and **Round jar** (wrap label, optional screw lid).
- Contents picker: Coffee / Tea / Sugar / Biscuits / Custom ??? sets label text on Art tab.
- Size chips: Small / Medium / Large footprint presets.
- Food-contact filament hint in Design tab.
- Cache **b162**. Hard refresh MakerDeck.

### 2026-07-08 ??? b161: Accent rotation + on-top layering

**Multi-band accents** (`js/accent-bands.js`, `js/vase.js`, `js/features.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- **Rotate pattern** (??) on wavy vase bands ??? spins the wave around the pot.
- **On top** checkbox per band when two colours ??? mutually exclusive; top band sits ~0.22 mm further out so it crosses over the other (preview + print).
- New second band defaults to on top.
- Cache **b161**. Hard refresh.

### 2026-07-08 ??? b160: Accent band click-to-edit values

**Accent tab** (`js/app.js`, `index.html`)

- Band height, position %, and wave sliders now wire `data-slider` like box dimensions ??? click the number to type a value.
- Works on boxes, profile pots, and vases.
- Cache **b160**. Hard refresh.

### 2026-07-08 ??? b159: Profile wrap art polish

**Wall-wrap emboss fixes** (`js/contour.js`, `js/decor.js`, `js/features.js`, `js/app.js`, `index.html`)

- Cap triangulation uses art-space (arc ?? height) on curved walls ??? no more twisted caps on heart/teardrop.
- Art anchors on the front (-Y) of the profile; vertical centering on wrap pots.
- Seam unwrap keeps polygons near their anchor so edges don't chord across the perimeter.
- Offset sliders relabel for wrap: **Around wall** / **Height**.
- Cache **b159**. Hard refresh + re-export.

### 2026-07-08 ??? b158: Profile wall-wrap art + box textures

**Art tab on profile pots** (`js/features.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- Teardrop / heart / star / circle / oval: **Art** tab enabled with **Wrap (around wall)** face ??? text, SVG, and trace emboss follow the outer profile.
- Box / rounded / pencil shapes: **Surface texture** (Walls tab) now supported via profile relief path.
- Cache **b158**. Hard refresh + re-export.

### 2026-07-08 ??? b157: Profile pot wall textures

**Surface relief on teardrop / heart / star / circle / oval** (`js/vase-textures.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- Reuses vase texture styles (ripple, scales, bark, weave, knit) on profile containers ??? outward-normal displacement, constant wall thickness.
- Walls tab ??? **Surface texture** when a supported preset/round shape is selected.
- Cache **b157**. Hard refresh + re-export.

### 2026-07-08 ??? b156: Heart accent cleft ??? whisker more

**Tiny extra carry into back V** (`js/features.js`)

- Edge cutoff 0.28 ??? 0.25, taper step 0.10 ??? 0.09 ??? band nudges a whisker closer without bleed.
- Cache **b156**. Hard refresh + re-export.

### 2026-07-08 ??? b155: Heart wall smoothing (adaptive segments)

**Faceted lobe walls on heart accent + body** (`js/geometry.js`)

- Heart profile now uses adaptive segment count (~1 mm facets, 256???512) instead of fixed 160 ??? lobe curves ~2.3 mm facets ??? ~1 mm.
- Cache **b155**. Hard refresh + re-export.

### 2026-07-08 ??? b154: Heart accent cleft ??? extend band slightly

**Back V gap a touch wide after b153** (`js/features.js`)

- Narrower pinch taper (8 passes / 0.10) and lower edge cutoff (0.28) so the band carries a bit further into the cleft without reintroducing bleed.
- Cache **b154**. Hard refresh + re-export.

### 2026-07-08 ??? b153: Heart accent cleft overflow fix

**Orange still bleeding inside back V after b152** (`js/features.js`)

- Heart cleft vertices are tessellated convex ??? concave-only pinch never fired.
- Pinch now keys off **offset points inside the profile** (where the band folds through the wall), plus edge skip on low-weight bridge quads.
- Cache **b153**. Hard refresh + re-export.

### 2026-07-08 ??? b152: Heart accent pinch at cleft (revert fragment patches)

**b150/b151 broke the band into lobe patches** (`js/features.js`)

- Skipping whole edge runs left disjoint orange slabs ??? not the goal.
- New approach: **continuous** accent ring, but thickness **pinches to zero** at concave notches (heart cleft) with a smooth taper ??? band fades out at the V instead of punching through.
- Cache **b152**. Hard refresh + re-export.

### 2026-07-08 ??? b151: Heart accent wide cleft exclusion zone

**Gold still bleeding inside heart notch** (`js/features.js`)

- b150 skipped concave edges only; adjacent lobe edges still offset into the footprint.
- Now: dilated skip mask (16 hops), 14 mm+ clearance from sharpest concave apex, drop edge if parallel offset lands inside profile polygon.
- Band may have a wider intentional gap at the back V ??? no interior bleed.
- Cache **b151**. Hard refresh + re-export.

### 2026-07-08 ??? b150: Heart accent skip concave cleft edges

**Gold band bleeding inside heart notch** (`js/features.js`)

- Cleft has dozens of concave profile vertices ??? joined offset ring still folded through the wall at the back V.
- Accent sleeve now extrudes **per-edge** with parallel outward offset; edges touching any concave vertex are skipped (small gap at notch, no interior bleed).
- Cache **b150**. Hard refresh MakerDeck.

### 2026-07-08 ??? b149: Basket weave + knit textures; heart accent cleft fix

**Vase textures** (`js/vase-textures.js`, `index.html`)
- New styles: **Basket weave** (alternating over/under strands) and **Knitted** (staggered V-stitch rows)
- Finer auto-tessellation for weave/knit

**Heart/star accent at cleft and tip** (`js/features.js`)
- Profile accent sleeve used vertex-normal miters that folded **through** concave corners (heart notch) and spiked at sharp tips ??? gold band showed on the inside. Now uses edge-intersection outward offset with spike clamp.

- Cache **b149**. Hard refresh MakerDeck.

### 2026-07-08 ??? b148: Vase surface textures (ripple, scales, bark)

**Parametric relief on vase/pot walls** (`js/vase-textures.js`, `js/vase.js`, `js/app.js`, `index.html`)

- New **Surface texture** toggle on Vase tab ??? styles: **Ripple**, **Scales**, **Bark**
- Depth + scale sliders; fades at floor (bed adhesion) and near rim
- Inner wall mirrors outer displacement for constant wall thickness (vase mode safe)
- Accent bands follow textured surface via `outerRingAt`
- Cache **b148**. Hard refresh MakerDeck. UI-only ??? Pi pull sufficient.

### 2026-07-08 ??? b147: Profile accent solid sleeve + teardrop CCW

**Teardrop accent invisible / body looked like inside-out ribbon** (`geometry.js`, `features.js`)

- Teardrop footprint was CW while star/heart/circle are CCW ??? wall quads faced inward; exterior accent was backface-culled.
- Profile accent was a 0.08 mm skin (visible inside before b146, invisible outside after). Now a **0.45 mm solid sleeve** on the exterior wall.
- Cache **b147**. Hard refresh MakerDeck.

### 2026-07-08 ??? b146: Accent offset to exterior wall

- Vertex-normal offset used inward normal for CCW footprints ??? bands hugged cavity side. Flipped to exterior normals.
- Cache **b146**. Hard refresh.

### 2026-07-08 ??? b145: Profile accent meshes discarded

- `buildContainer` built `accentMeshes` for profile shapes but non-box return path hard-coded `accentMeshes: []`.
- Cache **b145**. Hard refresh.

### 2026-07-07 ??? b144: Profile accent normal offset + position %

- Centroid radial offset wrong on concave profiles; now vertex-normal offset. Profile shapes use position % slider like vases.
- Cache **b144**. Hard refresh.

### 2026-07-07 ??? b143: Band 2 colour picker

- `ensureStateAccentBands` replaced band objects on UI refresh ??? Band 2 picker updated stale copy. Fixed in-place + index handlers.
- Cache **b143**. Hard refresh.

### 2026-07-07 ??? b141: Multi-accent bands (up to 2)

- Accent tab: Band 1 / Band 2 cards, separate 3MF filament slots. Legacy sessions migrate to `accentBands[]`.
- Cache **b141**. UI-only ??? Pi pull sufficient.

### 2026-07-07 ??? b140: Boot fix + library thumbnails

- Missing `buildWatermarkPreviewMesh` export broke entire app load. Library thumbnails moved to separate files + `GET /api/makerdeck/designs/{id}/thumbnail`.
- Cache **b140**. **Backend restart required.**

### 2026-07-07 ??? b139: Design library copy cleanup

**What changed:** User-facing labels stay **Design library** (Library tab). Removed Print Vault / recall wording from hints, export status, and delete confirm.

**Files:** `index.html`, `js/app.js?v=139`, `js/library.js?v=139` ??? header **b139**

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-07 ??? b138: Watermark orientation fix

**What changed:** Bottom watermark was double-mirrored (`-px, -py`) so text read backwards in Bambu. Now maps normally on the exterior underside ??? reads correctly on layer 1 / when you flip the part over.

**Files:** `js/features.js?v=138`, cache-bust **b138**

**Deploy:** Pi `git pull`. Hard refresh. Re-download export.

### 2026-07-07 ??? b137: Design library (auto-save on export)

**What changed:**
- **Auto-archive** ??? body **3MF** and **STL** downloads POST to `POST /api/makerdeck/exports`. Files land in Print Vault `MakerDeck/` with a `.makerdeck.json` sidecar (full slider state + trace thumbnail).
- **Library tab** ??? browse saved designs, **Load** restores params, **Delete** removes vault file + manifest entry.
- **Backend** ??? `app/makerdeck_library.py`, manifest `makerdeck_designs.json` on Pi.

**Files:** `app/makerdeck_library.py`, `app/main.py`, `js/library.js?v=137`, `js/app.js?v=137`, `index.html` ??? header **b137**

**Deploy:** Pi `git pull` + **restart flightdeck.service** (backend routes added). Hard refresh MakerDeck.

### 2026-07-07 ??? b136: Bottom watermark + SVG lid emboss polish

**What changed:**
- **Bottom watermark** ??? every body 3MF/STL export gets a shallow 0.6mm deboss on the underside: chunky **MD** monogram + `MakerDeck ?? YYYY-MM-DD ?? #NNNN`. Mirrored for read-from-below. Toggle in top bar (**Watermark** checkbox, on by default). Serial counter in `localStorage` (`makerdeck-export-serial`).
- **SVG stroke emboss** ??? SVG uploads now use native path extrusion (`buildEmbossSvg`) instead of rasterize-and-trace. **Mechanic badge sample** button on Label tab. Badge sample auto-sets Face ??? Lid top when lid is enabled.

**Files:** `js/features.js?v=136`, `js/app.js?v=136`, `js/geometry.js?v=136`, `index.html` ??? header **b136**, `css/style.css`

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+F5). Backend restart optional (UI-only).

### 2026-07-07 ??? b135: Solid divider slab (0 open edges in Bambu)

**What changed:** Bambu still reported 8 open edges on b134 ??? divider panels were zero-thickness sheets (2 faces only), leaving open top edges at the cavity rim.
- **`appendWeldedDividerSolid()`** ??? welded dividers are now a proper 6-face slab (floor, top cap, bay faces, wall-plane sides) with shared `WeldPool` verts.
- Sharp + rounded export paths both use the solid slab.
- Expect **~46 triangles** and **0 open edges** in Bambu without Repair.

**Files:** `js/features.js?v=135`, `js/app.js?v=135`, `index.html` ??? header **b135**

**Deploy:** Pi `git pull`. Hard refresh. Re-download for next print ??? current job on b134 is fine to finish.

### 2026-07-07 ??? b134: From-scratch watertight welded box mesh

**What changed:** b133 made things worse (16 open edges). Bambu Repair then filled the cavity solid (2.3kg). Root cause: merging a 6-face divider box into a stripped shell left T-junctions; depth-axis dividers only need left/right wall slots, not front/back.
- **`buildSharpWeldedBoxExport()`** ??? sharp rect welded exports are now one mesh from a shared `WeldPool`: shell + split floor patches + two divider faces per panel (not a solid box).
- **Correct wall slots** ??? depth axis segments left/right walls only; length axis segments front/back only; perpendicular walls stay full height.
- **Rounded fallback** ??? floor strip + two divider faces, no wall stripping.

**Files:** `js/features.js?v=134`, `js/app.js?v=134`, `index.html` ??? header **b134**

**Deploy:** Pi `git pull`. Hard refresh. Re-download ??? do **not** use Bambu Repair. Should show ~36 tris, 0 open edges.

### 2026-07-07 ??? b133: Segmented welded divider walls (manifold fix)

**What changed:** Chris's sharp-corner welded divider box exported (~40 tris) but Bambu still reported **8 non-manifold edges** at top corners + divider/wall junctions. Partial face stripping left T-junctions; divider and shell didn't share vertices.
- **Segmented inner walls** ??? for sharp rect profiles, remove full-height inner wall quads and rebuild only the wall bands above/below the divider slot; divider panel fills the gap with shared corners via `mergeMeshesSnap()`.
- **Welded divider height** ??? fixed mount panels now run floor-to-cavity-top (no lid-clearance gap that left open side walls).
- **Rounded fallback** ??? curved inner walls still use coplanar strip + snap merge.
- Export sanitize vertex weld tightened to **0.05 mm**; download status shows open-edge count if any remain.

**Files:** `js/features.js?v=133`, `js/stl.js?v=133`, `js/app.js?v=133`, `js/geometry.js?v=133`, `js/3mf.js?v=133`, `index.html` ??? header **b133**

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R). Re-download 3MF ??? Bambu should show **0 non-manifold edges** without Repair.

### 2026-07-07 ??? b132: Welded divider wall-strip + sharp-box export guard

**What changed:** Chris's export alert showed `shell=28, joiner=off` and blocked at 40 triangles ??? looked like the old joiner-shell leak, but **28 tris is the correct sharp-corner rect shell** (4-point profile = ~28 faces). The `<200` triangle guard was a false positive; Bambu non-manifold on welded dividers was duplicate **inner-wall** faces where the panel meets the cavity walls (only the floor was being stripped before merge).
- **`fixedDividerStripBoxes()`** ??? also strips inner-wall tris along welded divider edges (left/right/front/back contact patches), not just the floor footprint.
- **`weldedDividerExportLooksBroken()`** ??? shape-aware guard: sharp boxes expect ~40 tris total; rounded/filleted boxes still require ~300+ (catches real joiner-shell leaks).
- **`buildParams()`** ??? forces `joinerEnabled: false` when mount is Fixed; session restore does the same.
- **Cache-bust** all MakerDeck modules to `v=132` (geometry.js was still importing `features.js?v=102`).

**Files:** `js/features.js?v=132`, `js/geometry.js?v=132`, `js/app.js?v=132`, `js/3mf.js?v=132`, `js/stl.js?v=132`, `index.html` ??? header **b132**

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R). Re-download 3MF ??? sharp-corner box should show **~40 triangles** and pass; Bambu should report **0 non-manifold edges**. Rounded-corner boxes still expect ~328 tris.

### 2026-07-07 ??? b131: Export builds fresh geometry (fixes stale 40-tri joiner cache)

**What changed:** Chris still hit the b130 export block (40 triangles) even with Fixed welded + Joiner off. Headless export with the same params produces **328 triangles** ??? so the browser was exporting **stale preview meshCache** (e.g. joiner shell left over from before toggling Joiner off, or `rebuild()` skipped while `rebuildBusy`).
- **`buildFreshExportCache()`** ??? export always calls `buildContainer(buildParams())` from current UI state instead of reusing preview cache.
- **`collectColoredExportParts(exportCache)`** / STL export use the fresh cache for body, accent, and insert parts.
- Blocked-export alert now includes a **diagnostic line** (`shell=`, `joiner=`, `axis=`, `mount=`) to spot mismatches quickly.

**Files:** `js/app.js?v=131`, `js/3mf.js?v=131`, `index.html` ??? header **b131**

**Deploy:** Pi `git pull` ??? UI-only; restart optional but harmless. Hard refresh MakerDeck (Ctrl+Shift+R) to load `app.js?v=131`.

### 2026-07-07 ??? b130: Root cause ??? 40-tri joiner shell export, not Bambu packaging

**What we missed:** Headless tests used `.ref/mdtest/` copies of geometry/features ??? **not the same files** as `makerforge/js/` served to the browser. The repaired.3MF Chris shared preserved `MakerDeck-Triangles: 40`, proving the downloaded file literally contained **40 triangles**, not 328 misread by Bambu. That count exactly matches the **Link/joiner shell** export path when the welded divider merge does not run.

**Fixes:**
- Fixed (welded) divider export no longer depends on preview `insertCache` ??? always calls `buildWatertightFixedDividerExport` when mount is Fixed.
- Sync insert/joiner controls from DOM right before export (guards stale state).
- Block 3MF download when fixed divider expected but &lt;200 triangles ??? shows alert instead of silently shipping broken mesh.
- Block fixed divider + joiner together; selecting Fixed mount auto-disables joiner.
- **Cache-bust all modules to v=130** (features.js was stuck at ?v=102 through b125???b129).

**Files:** `js/app.js?v=130`, `js/features.js?v=130`, `js/geometry.js?v=130`, `js/3mf.js?v=130`, `js/stl.js?v=130`, `index.html` ??? header **b130**

### 2026-07-07 ??? b129: Export guard after repaired.3mf diff

**What changed:** Chris shared Bambu-repaired 3MF; diff showed the original MakerDeck file only had **40 triangles** (`MakerDeck-Triangles=40`), not 328 misread by Bambu. Bambu split that into a 28-tri shell + 12-tri divider panel. 40-tri export matches the **joiner/link shell path** when the welded divider is not merged.
- Export merge check now falls back to `meshCache.insertMesh` if preview insert cache is stale.
- 3MF download warns when fixed divider is enabled but export has &lt;200 triangles (likely joiner on or mount not Fixed welded).

**Files:** `js/app.js?v=129`, `index.html` ??? header **b129**

### 2026-07-07 ??? b128: Plain 3MF for single-colour body (Bambu still 40 tris)

**What changed:** Chris's fixed-divider box 3MF still showed 40 triangles / 8 non-manifold in Bambu after b127. Headless export still had 328 triangles in the mesh XML ??? Bambu was ignoring the mesh when Bambu project metadata was present.
- **Root cause:** `Metadata/model_settings.config` + `project_settings.config` make Bambu treat the file as a multi-part project and look up triangle-range part volumes instead of the mesh object. With no valid ranges, it validates an empty shell (~40 tris, 8 non-manifold).
- **Fix:** single-part / single-extruder exports now write a **plain core 3MF** ??? mesh only, no `Metadata/` folder, no `paint_color`, no Bambu assembly metadata. Multi-colour exports (body + accent/text) still use the full Bambu coloured project format.
- Download status now says `plain 3MF` vs `colored 3MF` with triangle count.

**Files:** `js/3mf.js?v=128`, `js/app.js?v=128`, `index.html` ??? header **b128**

**Deploy:** Pi `git pull`. Hard refresh. Re-download ??? status should read **`plain 3MF downloaded ??? 328 triangles (Body)`**. Bambu should show ~328 tris, 0 non-manifold.

### 2026-07-07 ??? b127: 3MF model_settings single-mesh fix (Bambu still 40 tris)

**What changed:** Chris's fixed-divider box 3MF still showed ~40 triangles / 8 non-manifold edges in Bambu after b126 hard refresh. Headless export already had 328 triangles in the XML ??? Bambu was mis-reading the file.
- **Root cause:** `Metadata/model_settings.config` wrapped a lone mesh object in `<part id="1">` tags. Bambu treats that like an empty multi-part assembly shell (~40 tris, non-manifold) instead of the real Body geometry.
- **Fix:** single-part exports now write object-level extruder metadata only (no `<part>` children). Multi-part exports (body + accent/text) unchanged.
- 3MF model metadata now includes `MakerDeck-Triangles` count for verification.
- Export always rebuilds geometry first; Download shows triangle count under the button.
- Separate-colour text export still welds fixed dividers into the Body mesh.

**Files:** `js/3mf.js?v=127`, `js/app.js?v=127`, `index.html`, `css/style.css?v=22` ??? header **b127**

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R). Re-download 3MF (don't reopen an old file). Bambu should show **~328 triangles** and **0 non-manifold edges**. Download status should say `328 triangles (Body)`.

### 2026-07-07 ??? b126: 3MF single-part export fix (Bambu 40 tris / non-manifold)

**What changed:** Chris's fixed-divider box 3MF still showed ~40 triangles and 8 non-manifold edges in Bambu after b125.
- **Root cause:** single-part 3MF exports wrapped the real Body mesh in an empty assembly object (`<components>` only, 0 triangles). Bambu validates that shell as "makerdeck" instead of the 328-triangle Body geometry.
- **Fix:** when only one coloured part is exported, reference the mesh object directly ??? no assembly wrapper. Multi-part exports (body + accent/text) still use the assembly pattern.
- 3MF object name now uses the proper model name (`box-300x275x130mm`) instead of generic "makerdeck".
- Skip redundant second sanitize pass when writing 3MF (parts are already cleaned).

**Files:** `js/3mf.js?v=126`, `js/app.js?v=126`, `index.html` ??? header **b126**

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R). Re-download 3MF ??? Bambu should show ~328 triangles and 0 non-manifold edges.

### 2026-07-07 ??? b125: Manifold STL export (welded dividers + sanitize)

**What changed:** Bambu Studio flagged Chris's 300??270??130 box with a fixed divider as non-manifold (4 bad edges). Root cause: welded dividers were na??vely merged into the body shell, leaving duplicate internal faces where the panel overlaps the cavity floor and walls.
- New **`buildWatertightFixedDividerExport()`** ??? strips cavity-floor tris under the divider footprint, then merges the panel into one body mesh (STL + 3MF Body part).
- Fixed dividers are now **flush** with inner walls/floor (removed the 0.5mm overlap bite that created parallel duplicate faces).
- **STL sanitize** tightened for export: 0.04mm vertex weld, coplanar duplicate peel, 12 non-manifold repair passes.

**Files:** `js/features.js?v=102`, `js/stl.js?v=76`, `js/app.js?v=125`, `js/3mf.js?v=125`, `js/geometry.js?v=125`, `index.html` ??? header **b125**

**Deploy:** Pi `git pull`. Hard refresh MakerDeck (Ctrl+Shift+R). Re-download the box STL/3MF ??? Bambu should report 0 non-manifold edges.

### 2026-07-07 ??? b124: Retire Fat quarters preset + clean download filenames

**What changed:** Two tidy-ups Chris asked for.
- **Fat quarters preset removed** ??? shape button, preset config, size profile, and all special-case wiring (fuse-to-body is now purely the Fixed mount's job, from b123). Old saved sessions with the preset restore as a plain rounded box, same dimensions.
- **Filenames no longer full of float noise** (`box-93.39999999999999x93.39999999999999x154.6mm.3mf` ??? `box-93.4x93.4x154.6mm.3mf`). New shared `baseModelName()` in `stl.js` rounds to 0.1mm and drops trailing zeros; STL + 3MF now name identically. Bonus fixes: vases finally get proper names (`goblet-88.7x110mm.3mf` instead of generic `box-???`/`makerdeck`), and saucer / deboss-cutter STLs get `-saucer` / `-deboss-cutter` suffixes instead of silently reusing the body filename.

**Files:** `js/stl.js?v=75`, `js/3mf.js?v=124`, `js/geometry.js?v=124`, `js/app.js?v=124`, `index.html` ??? header **b124**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b124** and the Fat quarters button is gone; download any 3MF and check the tidy filename.

### 2026-07-06 ??? b123: Fixed (welded) divider option

**What changed:** Chris's snap-fit divider shifted mid-print and wrecked the print. New **Mount ??? Fixed ??? welded to body** option:
- Divider panels print as one piece with the box: zero clearance, panels bite 0.5mm into the walls and floor so the merged mesh overlaps firmly (coplanar faces can slice as a hairline gap).
- Exports: 3MF merges the dividers into the Body part; plain STL body download also includes them. No separate loose insert.
- Fixed is vertical-panels only (a welded horizontal shelf would print mid-air) ??? picking Fixed with Height shelves flips the axis back to Length, and vice versa, same interlock as slide-in slots.
- Wall-clearance slider hides when Fixed (nothing to tune); hint explains the one-piece print.
- Node-verified: welded panels exceed the cavity span (bite) but stay inside the outer shell and floor; snap panels still float clear.

**Files:** `js/features.js?v=101`, `js/geometry.js?v=123`, `js/app.js?v=123`, `index.html` ??? header **b123**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b123**. Try: rect box ??? Insert tab ??? Mount ??? Fixed ??? welded to body.

### 2026-07-06 ??? b122: Sliceable vase accents ??? solid band + single-object 3MF

**What changed:** Chris's 3MF looked right in MakerDeck but "reverted" in Bambu Studio ??? errors: empty first layer, floating regions, collision. Two root causes:
- **The accent was a zero-thickness skin** floating 0.12mm off the wall ??? unprintable, and Bambu's auto-repair mangles it. Exports now use a new **solid** variant (`buildVaseAccentMesh` with `accentSolid: true`): outer surface = the preview skin, inner surface bites ~0.6???1mm **into** the body wall (never through ??? always leaves ???0.4mm), edges capped ??? watertight ring with firm slicer overlap. Preview still uses the thin skin (crisp, no bleed).
- **3MF exported each mesh as a separate build object**, so Bambu saw a free-floating "Accent" model. `buildColoredProject3mf` now emits one assembled object with component parts (Bambu `<part>` entries in model_settings.config, per-part extruders). Body + accent (+ text/insert) import as a single model ??? parts mid-air are fine because the object as a whole sits on the plate.
- Node-verified: solid band watertight (open=0) for straight/wavy/base-wave/rolled-rim on fluted+twisted goblet; 3MF structure test checks assembly + parts + extruders; all prior accent/grid tests ALL OK.

**Files:** `js/vase.js?v=122`, `js/geometry.js?v=122`, `js/3mf.js?v=122`, `js/app.js?v=122`, `index.html` ??? header **b122**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b122**. Re-download the 3MF and drop into Bambu Studio: should import as ONE object with a Body + Accent part, no errors.

### 2026-07-06 ??? b121: Vase rim finishes (bevel / bullnose / rolled lip)

**What changed:** Chris's idea ??? the vase rim was a dead-flat annulus. New **Rim finish** select in the vase section:
- **Square (flat)** ??? unchanged default.
- **Bevelled** ??? 45?? chamfer on both rim edges.
- **Rounded (bullnose)** ??? half-circle sweep across the wall top.
- **Rolled lip** ??? the wall flares outward near the top (smoothstep, ~4.5% of diameter, clamped 2.2???6mm) and finishes in a bullnose, like a thrown-pottery rolled rim. Inner wall follows the flare so wall thickness stays constant (vase-mode safe).
- Rim sweep lerps per-vertex between the outer and inner rings so flutes + twist carry through the rim profile.
- Accent bands clamp below the rim sweep and track the rolled-lip flare (fixed the accent's z???layer interpolation to use rim-clamped layer heights).
- Node-verified: watertight (open=0) and exact height for all 9 styles ?? bevel/round/rolled incl. fluted+twisted; new ray-cast accent test on a rolled-lip wavy band at the rim passes; all prior accent/twist tests still ALL OK.

**Files:** `js/vase.js?v=121`, `js/geometry.js?v=121`, `js/app.js?v=121`, `index.html` ??? header **b121**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b121**. Try: urn, Rim finish ??? Rolled lip.

### 2026-07-06 ??? b120: Wavy accent band bleed-through fix (twisted/fluted vases)

**What changed:** Chris's screenshot showed the red body poking through the grey wavy band on a twisted goblet. Three root causes, all in `buildVaseAccentMesh`:
- **Non-planar body quads**: with flutes + twist the body's wall quads aren't flat, so its triangles bulge up to ~0.3mm outside the vertex-lerped surface the band was tracking. Band now pads its offset by the measured per-layer diagonal sag (`sagAt`).
- **Steep walls**: a fixed radial 0.12mm offset shrinks to almost nothing measured perpendicular to a leaning wall (goblet base flare). Skin is now slope-compensated (`skinAt`), capped at 0.5mm.
- **Wave chords cutting corners**: steep waves shift z by several mm between adjacent columns, so horizontal chords sliced diagonally through body layer kinks. Wavy bands now subdivide columns until each step's wave delta is ???0.5mm, and use denser vertical slices (every 0.5mm).
- New ray-cast test (M??ller???Trumbore against actual body triangles, sampling band vertices + edge midpoints): positive gap everywhere on twisted goblet with wavy band at the base flare, including max amp 10 / 16 waves. Old binned tests still pass (gap ceiling raised to 0.7 for the sag pad).

**Files:** `js/vase.js?v=120`, `js/geometry.js?v=120`, `js/app.js?v=120`, `index.html` ??? header **b120**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b120**. Try: goblet, flutes 12, twist 90, accent on, wavy edge near the base ??? no red patches.

### 2026-07-06 ??? b119: Taller accent bands + wavy band edge

**What changed:** More of Chris's accent ideas.
- **Band height** now goes 2???80 mm (was 10) ??? proper two-tone vases. Clamped to the part height on both vases and boxes.
- **Band edge** select (vase only): **Straight ring** or **Wavy (up-n-down)** ??? the whole ribbon undulates around the circumference. Wave height 0.5???10 mm, waves-around 2???16. Band height stays constant along the wave; wave flattens at the very base/rim so it never runs off the part.
- Node-verified: 55 mm tall band and wavy band (amp 4, 6 waves) both hug the wall with positive gap everywhere on fluted+twisted urns/goblets; all position/legacy tests still pass.

**Files:** `js/vase.js?v=119`, `js/geometry.js?v=119`, `js/features.js?v=100`, `js/app.js?v=119`, `index.html` ??? header **b119**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b119**. Try: goblet, accent on, height 30, position 40%, edge Wavy.

### 2026-07-06 ??? b118: Movable vase accent band + z-fighting fix

**What changed:** Chris's idea ??? slide the accent band anywhere on the vase wall.
- **Band position slider** (vase only, replaces the face select): 0% = base, 25/33/50 = part-way, 100% = rim. Type exact values via the number button. Legacy floor/rim sessions map to 0/100.
- **Red-through-grey patches fixed**: the band previously sampled the smooth analytic surface while the body wall is piecewise-linear between layers, so the skin cut in and out of the body (z-fighting patches in Chris's screenshots). Band slices now reuse the body's exact layer rings (per-vertex lerp between layers) pushed radially out by a fatter 0.12mm skin ??? verified constant 0.12mm gap at every matched sample across 4 styles ?? 5 positions with flutes 12 + twist 90.

**Files:** `js/vase.js?v=118`, `js/geometry.js?v=118`, `js/app.js?v=118`, `index.html` ??? header **b118**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b118**. Try: vase accent on ??? drag Band position to 33%.

### 2026-07-06 ??? b117: Accent bands on vases / pots

**What changed:** The Accent tab now works for vase / pot shapes.
- Band is a 0.08mm skin that follows the full outer surface ??? profile curve, flutes and twist included ??? so it prints as a clean second-colour ring even on spiralled vases.
- Faces: **Rim band** (below the top edge) or **Floor band** (above the base). "Front" is hidden for vases (no flat front on a revolve).
- Bundled in Download 3MF as its own filament slot, or exportable as a separate accent STL ??? same flow as boxes.
- Refactored `vase.js` with a shared `vaseSurface()` resolver so body + accent always agree on geometry.
- Node-verified: accent hugs the surface at exactly 0.08mm across cylinder/urn/goblet/bud ?? rim/floor with flutes 12 + twist 90??; full watertight grid + twist tests still ALL OK.

**Files:** `js/vase.js?v=117`, `js/geometry.js?v=117`, `js/app.js?v=117`, `index.html` ??? header **b117**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b117**. Try: Vase ??? flutes 12, twist 90 ??? Accent tab ??? enable, Floor band, 8mm.

### 2026-07-06 ??? b116: Vase twist fix (slider did ~nothing)

**What changed:** Twist was applied as `cos(flutes*a - phase)` ??? the rib pattern only rotated by twist/fluteCount (90?? slider = 7.5?? visible with 12 flutes). Now `cos(flutes*(a - phase))` so ribs rotate by the full twist angle.
- Node-verified: crest rotation between z-bands matches the expected twist fraction for 0/45/90/???120??; full 9-style watertight grid still ALL OK.
- Twist slider now hides when Flutes = 0 (twist has no visible effect on a smooth surface of revolution).

**Files:** `js/vase.js?v=116`, `js/geometry.js?v=116`, `js/app.js?v=116`, `index.html` ??? header **b116**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b116**. Try: flutes 12, twist 90?? ??? ribs should visibly spiral a quarter turn.

### 2026-07-06 ??? b115: Screw lid fit fix (first print wouldn't thread on)

**What changed:** Chris's printed 35mm screw lid wouldn't screw on ??? modelled pass-over clearance was only 0.35 mm, which FDM perimeter swell (bore prints small, external threads print big) eats entirely.
- **FDM fit compensation**: lid bore gets +0.25 mm radial on top of the Fit clearance (pass-over now 0.6 mm at default 0.35), and the lid's internal thread flanks are slimmed 0.15 mm so they can't bind axially.
- **Chunkier thread**: pitch 3.2 ??? 4.0, depth 1.2 ??? 1.4, wider root ??? coarser thread is more forgiving of stringing/blobs and keeps 0.8 mm radial engagement despite the extra bore room.
- Node-verified at 80 mm and at the printed 35 mm size: engagement 0.80 mm, pass-over 0.60 mm, watertight components unchanged.
- Bodies and lids must be **re-exported together** ??? old body + new lid mixes thread pitches.

**Files:** `js/geometry.js?v=115`, `js/app.js?v=115`, `index.html` ??? header **b115**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b115**. Re-export both STLs and reprint; if still snug, raise Fit clearance slider (each +0.1 = +0.1 radial all round).

### 2026-07-06 ??? b114: Vase studio ??? new styles, flutes, twist

**What changed:** Vase / pot generator got a designer upgrade.
- **4 new styles**: Bowl planter (low + wide), Goblet (stem + cup), Hourglass (pinched waist), Bud vase (narrow neck) ??? alongside the existing five.
- **Smooth profiles**: control points now interpolate with a monotone cubic spline (Fritsch???Carlson) instead of straight lines ??? bellies and necks curve naturally with no overshoot. Applies to all styles including the old ones.
- **Flutes (ribs)**: 0???24 vertical ribs, depth 0.5???6 mm. Cosine modulation preserves mean radius; inner wall follows the wave so wall thickness stays constant (vase-mode friendly). Flutes fade to circular at the base for bed adhesion and a clean bottom cap.
- **Twist**: ???180?? to +180?? over the height ??? turns flutes into spirals. Tessellation auto-densifies (segments up to 240, layers up to 160) so twisted/fluted surfaces stay smooth.
- Node-verified watertight (0 open edges) across all 9 styles ?? 7 variant combos (flutes, twist, deep ribs, small diameter, no-drain).

**Files:** `js/vase.js?v=114`, `js/geometry.js?v=114`, `js/app.js?v=114`, `index.html` ??? header **b114**

**Deploy:** Pi `git pull` (static only, restart optional). Hard refresh ??? confirm header shows **b114**. Try: Vase / pot ??? Goblet, Flutes 12, Twist 90??.

### 2026-07-06 ??? b113: Screw-top lids (round containers)

**What changed:** New **Screw top** lid type, offered only when shape = Circle.
- Coarse 2-start trapezoid thread (pitch 3.2, lead 6.4, depth 1.2 mm, tapered run-in/out) ??? prints without support on vertical walls.
- Body gets matching external neck threads over the skirt zone; lid is a knurled cap (24 grip flutes) with internal threads.
- Existing sliders drive it: **Skirt** = thread engagement depth (8???12 mm sweet spot), **Clearance** = radial fit (0.35 default), **Thickness** = top plate.
- Node-verified: 0.85 mm radial thread engagement, 0.35 mm pass-over clearance, lid/body watertight (shell + 2 thread-start solids each), print orientation plate-down.
- Non-circle shapes never see the option; saved sessions with screw on other shapes normalize to slip.

**Files:** `js/geometry.js`, `js/app.js?v=113`, `js/features.js?v=99`, `js/art-editor.js`, `index.html` ??? header **b113**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b113**. Try: Circle ??? Lid tab ??? enable ??? Screw top.

### 2026-07-06 ??? b112: floor marks, heart knuckles, smooth curves ??? `a57799a`

### 2026-07-06 ??? b112: floor marks, heart knuckles, smooth curves

**What changed:**
- **Floor marks on every shape** were shadow-map acne (self-shadowing from the key light), not geometry ??? verified with a Node mesh scan (all shapes = 1 watertight component, no flipped floor tris). Shadows now disabled in the preview renderer.
- **Heart/star knuckle balls**: `filletedOutline` forced every arc CCW, so reflex corners (heart notch, star inner points) drew near-full circles. Fillets now skip reflex corners and sweep the short way; radius adapts to clamped trim so sharp tips stay tangent. This also removed a stray 23-tri patch on the heart floor.
- **Smoother curves**: heart outline 52 ??? 160 segments, teardrop 32 ??? 72 ??? prints and previews smooth instead of faceted.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? `app.js?v=112`, header **b112**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b112**.

### 2026-07-06 ??? Houdini fix: earcut annulus crash (b111) ??? `e772aa4`

### 2026-07-06 ??? Houdini fix: earcut annulus crash (b111)

**What changed:** b110 passed only outer coords to `earcut()` while declaring a hole index ??? earcut threw, preview went blank. Now passes outer+hole flat coords; try/catch falls back to radial `capRing`.

**Files:** `js/geometry.js`, `index.html`, `js/app.js` ??? `app.js?v=111`, header **b111**

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-06 ??? Floor artifacts v2 (radial pairing + earcut annulus)

**What changed:** v109 arc-length resample was not enough ??? capRing quads still crossed the floor when fillet counts matched but angles did not. Now: radial ray-cast pairing, horizontal rims use earcut annulus (hole winding fixed), build tag **b110** in header so you can confirm the loaded bundle.

**Files:** `js/geometry.js`, `index.html`, `css/style.css?v=21`, `js/app.js` ??? `app.js?v=110`

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b110**.

### 2026-07-06 ??? Preview floor artifacts (all shapes)

**What changed:** Center floor slivers and star/heart ???knuckle??? spikes were from (1) duplicate coplanar floor caps in `capFloorSlab` and (2) `capRing` pairing outer/inner vertices by index when filleted profiles had different point counts. Inner rings are now arc-length resampled to match outer; floor slabs use a single cap face.

**Files:** `js/geometry.js`, `index.html`, `js/app.js` ??? `app.js?v=109`

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R).

### 2026-07-06 ??? Houdini fix (vase earcut import)

**What changed:** `vase.js` imported earcut from `three/examples/...` which is not in the import map ??? module load failed and the whole preview went blank ("Houdini"). Switched to same `esm.sh/earcut` as `geometry.js`.

**Files:** `js/vase.js`, `index.html`, `js/app.js` ??? `app.js?v=108`

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R).

### 2026-07-06 ??? Preview artifact fix (slip lid + vase caps)

**What changed:** Slip-over lids had a hollow top rim so the internal skirt floor looked like a floating plane in every lidded preview. Solid earcut top plate now. Vase floors use earcut caps too.

**Files:** `js/geometry.js`, `js/vase.js`, `index.html` ??? `app.js?v=107`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-06 ??? Divider top clearance (match lid)

**What changed:** Insert tab ??? **Match lid clearance** (default on) shortens dividers when inset plug skirt or flat-cap lip hangs inside. **Top clearance** slider for manual override.

**Files:** `js/features.js?v=98`, `js/insert-slots.js`, `js/app.js?v=106`, `js/geometry.js`, `index.html`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Inset plug lid restored

**What changed:** Inset plug (skirt inside the opening) is back as a third simple lid ??? distinct from slip-over and flat cap. Hinges/slide/roll still gone.

**Files:** `js/geometry.js`, `js/app.js?v=105`, `js/art-editor.js`, `index.html`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? KISS lids (slip-over + flat cap only)

**What changed:** Chris asked to drop hinges and keep it simple.
- **Two lid types:** Slip-over skirt outside walls, Flat cap plate on rim (+ optional lip).
- **Removed:** Hinge tab, clip/slide/roll/hinge lid types, `hinge-hardware.js`, `clip-hinge.js`, `hinge-lid.js`, `slide-lid.js`, `roll-lid.js`.
- Old saved sessions auto-map `hinge`/`clip`/`slide`/`roll`/`plug` ??? slip or flat.
- Preview is vertical lift/lower only ??? no knuckle cylinders on star/heart/teardrop.

**Files:** `js/geometry.js`, `js/app.js?v=104`, `js/features.js?v=97`, `js/art-editor.js`, `js/stl.js`, `index.html` ??? deleted hinge/slide modules

**Deploy:** Pi `git pull`. Hard refresh MakerDeck / `#/makerdeck`. UI-only ??? no backend restart.

### 2026-07-05 ??? Hinge dropdown + live 3D preview

**What changed:** Hinge tab now works like a real hinge generator:
- **Hinge type** dropdown (Snap clip, Butt pin, Strap door, Flush barrel)
- Switching type shows that hinge in the **viewport** (orange hardware; snap clip also shows gold pin)
- **Length / width** sliders update the preview live; leaf types also expose thickness, knuckle, and pin controls
- Box hides while the Hinge tab is active so the hardware is easy to inspect
- Standalone leaf hinges preview without needing a box; snap clip previews on supported shapes even before Clip hinge lid is enabled

**Files:** `js/hinge-hardware.js`, `js/app.js?v=102`, `js/geometry.js?v=102`, `index.html`

**Deploy:** Pi `git pull`. Hard refresh MakerDeck / `#/makerdeck`.

### 2026-07-05 ??? Hinge generator presets (butt, strap, barrel)

**What changed:** Hinge tab is now a **hinge generator** with style presets:
- **Snap clip** ??? box rail system (needs Clip hinge lid)
- **Butt pin** ??? flat-leaf alternating knuckles
- **Strap door** ??? long door leaf + short frame leaf
- **Flush barrel** ??? compact cabinet barrel hinge

Each style has tuned sliders, assembly steps, and Download hinge / pin STLs (manifold, flat on bed).

**Files:** `js/hinge-hardware.js` (new), `js/app.js?v=101`, `js/geometry.js`, `js/stl.js`, `index.html`, `css/style.css?v=20`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Hinge tab (clip generator)

**What changed:** Dedicated **Hinge** tab for clip hinge hardware ??? rail/pin/position sliders, assembly steps, and **Download clips / pins** buttons. Clips + pins removed from main export dropdown. Picking Clip hinge on Lid tab jumps you to Hinge.

**Files:** `index.html`, `css/style.css?v=19`, `js/app.js?v=100`, `js/geometry.js`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Clip export: one fused part, 4-up on bed

**What changed:** Clip STL was two floating pieces (C-grip + ring) ??? unusable in Bambu. Now:
- Grip + knuckle barrel **fused** with web ribs (one solid per clip)
- **Laid flat on the bed** (barrel down, arch up)
- Export arranges **4 clips** or **2 pins** on the plate automatically

**Files:** `js/clip-hinge.js`, `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=99`

**Deploy:** Pi `git pull`. Hard refresh. Re-export clip + pin STLs.

### 2026-07-05 ??? Fix blank preview (duplicate export crash)

**What changed:** `geometry.js` exported `clipHingeAvailable` and `normalizeLidType` twice ??? the module failed to load and the viewport showed no box. Removed duplicate re-exports; added missing `skirtDepth` on clip fit guides.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=98`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Clip hinge: snap rails + separate clip/pin exports

**What changed:** Replaced the hidden integrated flip hinge with a focused **clip hinge** system:
- **Clip hinge** lid type ??? clean inset plug + snap rails on box/lid back rim (no integrated knuckles)
- **Separate exports:** STL hinge clip (??4) and STL hinge pin (??2) in the download dropdown
- Clip + pin meshes are **manifold** (0 open edges after sanitize) ??? no Bambu Repair
- Preview reuses flip animation on back edge; saved `hinge` lid type maps to `clip`

**Files:** `js/clip-hinge.js` (new), `js/geometry.js`, `js/app.js`, `js/stl.js`, `js/art-editor.js`, `index.html` ??? cache-bust `app.js?v=97`

**Deploy:** Pi `git pull`. Hard refresh. Enable lid ??? Clip hinge ??? export body, lid, clips, pins.

### 2026-07-05 ??? Flip hinge hidden (not strong enough yet)

**What changed:** **Flip hinge** removed from the lid-type dropdown for now ??? filament knuckles aren???t strong enough for real use. Saved sessions with hinge selected fall back to **Inset plug**. Code stays in repo (`HINGE_LID_ENABLED = false`) for a future stronger design.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=95`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Manifold exports (no slicer repair)

**What changed:** Exports should load in Bambu without **Repair**:
- **Hinge lid** ??? closed plug shell (no open back wall); pin tunnels capped with washer end-faces
- **STL sanitize** ??? stronger non-manifold peel (8 passes) + open-edge check (warns in console if any remain)

**Files:** `js/hinge-lid.js`, `js/stl.js`, `js/app.js`, `js/3mf.js`, `index.html` ??? cache-bust `app.js?v=94`, `stl.js?v=74`

**Deploy:** Pi `git pull`. Hard refresh. Re-export STLs/3MF.

### 2026-07-05 ??? Flip hinge v2: flat lid export, pin tunnels, tighter knuckles

**What changed:** Hinge redesign from Chris???s Bambu slice feedback:
- **Lid exports flat** on the bed (vertical rim knuckles, no horizontal Y overhang; bottom shifted to Z=0)
- **5 knuckle positions** (body/lid/body/lid/body) packed with tighter pitch ??? not 2+1 at the ends
- **Pin tunnels** through each knuckle (1.75 mm filament slides in from either side along box width)
- Default knuckle radius **4 mm**, count **5**

**Files:** `js/hinge-lid.js`, `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=93`

**Deploy:** Pi `git pull`. Hard refresh. Re-export body + lid STL/3MF.

### 2026-07-05 ??? Fat quarters: fuse dividers to floor/walls (print fix)

**What changed:** Fat quarters tray dividers were floating **0.12 mm** above the floor with side gaps ??? fine for removable inserts, but when merged into one 3MF they printed as weak free-standing walls that delaminated (layer ribbons). Dividers now **fuse to floor and side walls** on the fat quarters preset; default divider thickness **3.2 mm**.

**Files:** `js/features.js`, `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=92`

**Deploy:** Pi `git pull`. Hard refresh. **Re-export 3MF** before reprinting.

### 2026-07-05 ??? Fix flip hinge reverting / clearing lid

**What changed:** Selecting **Flip hinge** was crashing during preview guide setup (`plateOuter` missing on hinge fit guides ??? rebuild error ??? emergency reset to default box). Hinge guides now use the correct rim/plate loops; fat quarters preset also listed as hinge-capable.

**Files:** `js/app.js`, `js/hinge-lid.js`, `index.html` ??? cache-bust `app.js?v=90`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Fix flip hinge lid preview (invisible lid)

**What changed:** Hinge lid preview was offset ~27 mm behind the box (invisible). Now uses a pivot group on the back edge. Picking a lid type also auto-enables **Enable lid** if it was off.

**Files:** `js/app.js`, `js/hinge-lid.js`, `index.html` ??? cache-bust `app.js?v=89`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Lids: flip hinge + roll lock (bayonet)

**What changed:** Two new lid types on the Lid tab:
- **Flip hinge** ??? pin knuckles on the back edge (box + lid interleave). Use **1.75 mm filament** as hinge pin. Best on box / rounded / pencil box. Preview animates clamshell open.
- **Roll lock** ??? push-down + twist bayonet cap for **circle, oval, hex**. Body gets inner rim tracks; lid gets radial lugs. Preview animates lift + quarter-turn.

**Files:** `js/hinge-lid.js`, `js/roll-lid.js`, `js/geometry.js`, `js/app.js`, `js/art-editor.js`, `index.html` ??? cache-bust `app.js?v=88`

**Deploy:** Pi `git pull`. Hard refresh. Re-export body + lid STLs.

### 2026-07-05 ??? Edge fillet: adaptive arc segments (box shape)

**What changed:** **Box + edge fillet** (the `box-*.stl` path, not the Rounded shape) now uses adaptive arc segments ??? ~1 mm facet target, min 12 / max 96 per corner. A **12 mm fillet** goes from 6 segments to **~19** per corner.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=87`

**Deploy:** Pi `git pull`. Hard refresh. Re-export STL/3MF.

### 2026-07-05 ??? Oval shape + smoother rounded corners

**What changed:** New **Oval** shape (width + depth elliptical box). **Rounded** boxes (and pencil / pencil box / fat quarters rounded corners) now use adaptive corner arc segments (~1.5 mm facet length, scales with corner radius) instead of a fixed 8???10 segments ??? much smoother walls in Bambu slice preview.

**Files:** `js/geometry.js`, `js/app.js`, `js/stl.js`, `js/3mf.js`, `index.html` ??? cache-bust `app.js?v=86`

**Deploy:** Pi `git pull`. Hard refresh. Re-export STL/3MF.

### 2026-07-05 ??? Circle boxes: smoother wall mesh for slicing

**What changed:** **Circle** shape no longer uses a fixed 56-sided outline. Segment count now scales with diameter (~1.5 mm facet length, 96???256 segments) so Bambu Studio shows round walls instead of chunky flat facets.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=84`

**Deploy:** Pi `git pull`. Hard refresh. Re-export STL/3MF for circle boxes.

### 2026-07-05 ??? Lids polish: flat cap retention lip + stackable lid pockets

**What changed:** **Flat cap** lids now support an optional **retention lip** (inner skirt that drops into the opening for alignment). New **Retention lip** slider on the Lid tab (flat cap only). **Fat quarters** preset defaults to **3 mm** lip when lid is enabled. When **Stack** hex feet are enabled, matching **pockets are cut into the top of flat lids** so trays can nest lid-on-tray. Preview fit guides show the lip ring.

**Planned next ??? adjustable removable dividers:** mirrored vertical slot pairs on left/right walls; slot positions on a slider scale so panels slide in and bays resize for on-call custom boxes.

**Files:** `js/geometry.js`, `js/features.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=83`

**Deploy:** Pi `git pull`. Hard refresh. UI-only ??? no backend restart required.

### 2026-07-05 ??? Lids: flat cap default for fat quarters tray

**What changed:** **Fat quarters** preset defaults to **Flat cap** lid type when you enable lid (still off by default). Lid tab shows tray hint for dust cover / stacking.

**Planned next ??? adjustable removable dividers:** mirrored vertical slot pairs on left/right walls; slot positions on a slider scale so panels slide in and bays resize for on-call custom boxes.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=82`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Fat quarters: single-colour export

**What changed:** **Fat quarters** preset dividers match **box colour** in preview. **3MF export** merges Insert into Body (one part, one extruder) for single-filament prints.

**Files:** `js/app.js`, `index.html` ??? cache-bust `app.js?v=81`

**Deploy:** Pi `git pull`. Hard refresh. Re-export 3MF.

### 2026-07-05 ??? Fat quarters preset: flat H-series tray

**What changed:** **Fat quarters** preset matches Chris???s print ??? **300??300??55 mm** flat tray, **2 vertical dividers** (3 bays ~98 mm), prints on H-series bed (~305??58 mm outer). Removed 400 mm bookcase layout.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=80`

**Deploy:** Pi `git pull`. Hard refresh. Re-export 3MF.

### 2026-07-05 ??? Insert body gap + slide-in shelf slots

**What changed:** **0.12 mm air gap** between Insert and Body (fixes Bambu Insert ??? Body gcode conflicts). Insert gets its own extruder slot in 3MF. New **Mount** option: **Slide-in slots** (horizontal shelves only) ??? dados on side walls, shelves slide in from the front.

**Files:** `js/insert-slots.js`, `js/features.js`, `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=79`

**Deploy:** Pi `git pull`. Hard refresh. Re-export 3MF.

### 2026-07-05 ??? Fat quarters: open-front bookcase preview

**What changed:** **Fat quarters** now builds an **open-front bookcase** (no front wall ??? like your reference), **front-facing camera**, **amber shelf** panels with edge lines. Still 300??135??400 mm, 3 tiers, horizontal shelves.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=78`

**Deploy:** Pi `git pull`. Hard refresh; turn off X-ray if shelves are hard to see.

### 2026-07-05 ??? Fat quarters: standing bookcase (horizontal shelves)

**What changed:** **Fat quarters** preset is now a **standing bookcase** ??? tall box with **2 horizontal shelves** (3 tiers), not a flat tray. New insert axis **Height ??? horizontal shelves**. Inner **300 ?? 135 ?? 400 mm** (~133 mm per tier for ~132 mm standing quarters).

**Files:** `js/features.js`, `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=77`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`. Print lying on back if build height is tight.

### 2026-07-05 ??? Fat quarters preset: bookcase (standing) layout

**What changed:** **Fat quarters** preset reworked for **bookcase storage** ??? quarters stand on edge (~8 mm thick), not flat. Inner **300 ?? 135 ?? 135 mm**, **1 divider** ??? two rows (~**148 ?? 134 mm** each, ~18 quarters per row). Insert tab shows bookcase hint on this preset.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=76`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 ??? Fat quarters preset tuned for real folded size

**What changed:** **Fat quarters** preset now uses **1 divider** (2 bays **~147 ?? 299 mm**) sized for **~130 ?? 132 ?? 8 mm** folded quarters. Inner height **45 mm** (~5 stacks at 8 mm); use the height slider for more.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=75`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 ??? Export dropdown, divider count, fat quarters preset

**What changed:**
- **Download** is now a format dropdown (default **3MF project**) + single Download button ??? extra formats (lid, accent, insert, deboss cutter, saucer) appear only when relevant.
- **Reset defaults** button is red normally, flashes green with ??? on success.
- **Insert** tab: divider **count** slider (1???4) splits the cavity into equal bays; hint shows compartments.
- New **Fat quarters** preset: 300??300??45 mm box, 1 divider (2 bays) for ~130??132??8 mm folded fabric.

**Files:** `js/app.js`, `js/features.js`, `js/geometry.js`, `index.html`, `css/style.css` ??? cache-bust `app.js?v=74`, `style.css?v=18`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/` (Ctrl+Shift+R).

### 2026-07-05 ??? Reset defaults button

**What changed:** **Reset defaults** in the top bar clears all settings back to the starter box (dimensions, colours, accent, insert, lid, art, etc.) and saves that as the new session. **Reset view** still only moves the camera.

**Files:** `js/app.js`, `index.html` ??? cache-bust `app.js?v=72`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 ??? Divider insert (half split)

**What changed:** New **Insert** tab ??? optional flat divider splits the cavity into two halves (length or depth). Separate **Insert** part in 3MF export (box filament). **Pencil box** preset enables it by default (length split).

**Files:** `js/features.js`, `js/geometry.js`, `js/app.js`, `js/stl.js`, `index.html` ??? cache-bust `app.js?v=71`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 ??? Fix Bambu 3MF auto filament assignment

**What changed:** **Download 3MF** now writes Bambu-compatible colour data ??? `Metadata/model_settings.config` as **XML** with per-object extruder slots (was JSON, which Bambu ignored), plus `paint_color` on every triangle so Body / Text / Accent import with the right filament without manual repainting.

**Files:** `js/3mf.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=70`

**Deploy:** Pi `git pull`. Re-export 3MF and open in Bambu (fresh import, not merge into existing project).

### 2026-07-05 ??? Fix accent preview strobing (z-fight)

**What changed:** Accent band geometry sits **0.08 mm outside** the body shell so it no longer shares the same faces (classic z-fight flicker). Preview accent also skips shadow casting and uses depth bias toward the camera.

**Files:** `js/features.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=69`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 ??? Preview matches customer 3MF colours

**What changed:** Viewport preview now mirrors what ships in **Download 3MF** ??? body and lid use the same box filament colour (was a hardcoded grey-blue lid), accent/text use their picker hex with matte PLA shading (no fake glow), deboss no longer shows a red dev overlay, and wireframe edges only appear in X-ray mode.

**Files:** `js/app.js`, `index.html` ??? cache-bust `app.js?v=68`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/` or `#/makerdeck`.

### 2026-07-05 ??? Accent bands follow profile + contrast picker

**What changed:** Accent bands (rim / front / floor) now **follow the box outline** ??? rounded pencil box corners curve with the body instead of a square axis-aligned skirt. **Floor stripe** is an outer base ring only (no solid fill slab). Preview accent has subtle emissive glow so it reads on the dark viewport. **Suggest contrast** picks a complementary filament swatch from the box colour.

**Files:** `js/features.js`, `js/geometry.js`, `js/color-picker.js`, `js/app.js`, `index.html`, `css/style.css` ??? cache-bust `app.js?v=67`, `style.css?v=17`

**Deploy:** Pi `git pull`. Hard refresh (`Ctrl+Shift+R`) on `/makerdeck/` or `#/makerdeck`. Backend restart not required.

### 2026-07-05 ??? MakerDeck tab inside Flightdeck

**What changed:** **MakerDeck** is now a sidebar page in Flightdeck (`#/makerdeck`) ??? no separate URL or port. Opens `/makerdeck/` in a full-height iframe on the same origin (Tailscale HTTPS works).

**Files:** `app/static/index.html`, `app/static/app.js?v=625`, `app/static/style.css?v=481`

**Deploy:** Pi `git pull` + **restart flightdeck.service** (Flightdeck static JS changed). MakerDeck iframe still uses `app.js?v=66`.

### 2026-07-05 ??? Restore text colour + L/C/R align (cache bust)

**What changed:** Text **colour** picker and **Left / Centre / Right** align stay visible with deboss on (align still positions multiline text). Full module cache-bust (`app.js?v=66`, `features.js?v=66`, `color-picker.js?v=66`, `style.css?v=16`) so Pi/browsers don't serve stale JS without the formatting UI.

**Files:** `js/app.js`, `js/3mf.js`, `index.html`

**Deploy:** Hard refresh (`Ctrl+Shift+R`) on `/makerdeck/`. Backend restart optional (static files).

### 2026-07-05 ??? Fix slide lid on pencil tube + grooves when lid off

**What changed:**
- **Channel slide** no longer offered on **pencil tube** (stadium ends) ??? rectangular slide lid/rails were the wrong shape; use slip-over or inset plug instead. **Pencil box** still supports channel slide.
- **Rail grooves** only carved into the body when **Enable lid** is on ??? turning the lid off no longer leaves square slider bumps on the case.

**Files:** `js/slide-lid.js`, `js/geometry.js`, `js/app.js`, `index.html` ??? `app.js?v=65`, `geometry.js?v=65`

**Deploy:** Hard refresh required. Backend restart not needed.

### 2026-07-05 ??? Fix 3MF export crash on multiline text

**What changed:** **Download 3MF** no longer throws `object null is not iterable` when exporting multiline label text (e.g. FAT / QUARTERS). Root cause was `repairNonManifoldFaces` in `stl.js` nulling a triangle mid-pass then dereferencing it on the same edge. STL export now has try/catch like 3MF.

**Files:** `js/stl.js`, `js/app.js`, `js/3mf.js`, `index.html` ??? `app.js?v=64`, `stl.js?v=64`

**Deploy:** Hard refresh required (Ctrl+Shift+R). Backend restart not needed.

### 2026-07-05 ??? Fix pencil box blank after preset switch (with text)

**What changed:** Switching pencil tube ??? pencil box with label text no longer wipes the viewport. Rebuild is serialized (no overlapping art-timer + preset rebuilds), pending art rebuilds cancel on preset change, lid+label children dispose cleanly, camera fit guards NaN.

**Files:** `js/app.js`, `js/geometry.js`, `index.html` ??? `app.js?v=63`

**Deploy:** Hard refresh required (Ctrl+Shift+R). Backend restart not needed.

### 2026-07-05 ??? Fix pencil preset switching blank viewport

**What changed:** Pencil tube / pencil box no longer bleed lid+slide state into each other. Rebuild validates new geometry before removing old preview. `PENCIL_PRESET` resets lid off + front face.

**Files:** `js/app.js`, `js/geometry.js`, `index.html` ??? `app.js?v=62`

### 2026-07-05 ??? Fix 3MF export, pencil box, text align

**What changed:**
- **3MF download** ??? replaced fflate CDN zip with built-in writer; guards null mesh indices (fixes "null is not iterable")
- **Pencil box** ??? `cornerRadius` now passed to geometry for `pencilBox` shape (was forced to 0); slide lid + rounded case work again
- **Text align** ??? Left / Centre / Right buttons on Art tab (multiline lines align within the block)

**Files:** `js/3mf.js`, `js/app.js`, `js/features.js`, `js/geometry.js`, `index.html`, `css/style.css` ??? `app.js?v=61`, `style.css?v=15`

### 2026-07-05 ??? Visual colour pickers + 3MF Orca export + multiline text

**What changed:**
- **Colour pickers** ??? swatch grid + hex chip (box, text, accent) instead of tiny native colour input
- **Download 3MF** ??? body / text / accent as separate objects with `filament_colour` for Orca; **Download STL** kept for single mesh
- **Multiline text** ??? textarea, Enter for new line (up to 4 lines)
- **Preview** ??? text shown as separate coloured mesh matching export slots
- **Pencil presets** ??? "Quick presets" heading + better camera framing for pencil tube/box

**Files:** `js/color-picker.js`, `js/3mf.js`, `js/app.js`, `js/features.js`, `js/geometry.js`, `js/art-editor.js`, `index.html`, `css/style.css` ??? cache-bust `app.js?v=60`, `style.css?v=14`

**Deploy:** Pi `git pull` + hard refresh.

### 2026-07-05 ??? Box preview colour picker

**What changed:** Design tab ??? **Preview colour** ??? **Box** colour picker. Updates the 3D preview body material; saved in session like accent colour. STL export unchanged (pick filament in slicer).

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=59`

**Deploy:** Pi `git pull` + hard refresh (UI-only; restart optional).

### 2026-07-05 ??? Watertight STL export for embossed text

**What changed:** Download box now rebuilds a **watertight export mesh** ??? solid wall behind letters, closed letter solids, overlapping wall tris stripped under ink. STL pass welds verts + peels non-manifold faces. Preview unchanged.

**Files:** `js/features.js`, `js/stl.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=58`

### 2026-07-05 ??? Revert cut-through emboss (restore raised letters)

**What changed:** Rolled back the "punch holes in wall" manifold experiment ??? it cut straight through the box. Text is **raised emboss** again: flush with the wall, top cap + side walls only (no bottom cap duplicating the face).

**Files:** `js/features.js`, `js/geometry.js`, `index.html`

- STL export still welds vertices / drops duplicate tris (may reduce Orca warnings vs before).
- Cache-bust: `app.js?v=57`

### 2026-07-05 ??? Manifold STL export (Orca non-manifold fix)

**What changed:** Text emboss is now **integrated into the shell face** (punch holes + shared edges) instead of stacking two meshes. STL export also welds nearby vertices and drops duplicate triangles.

**Files:** `js/features.js`, `js/contour.js`, `js/geometry.js`, `js/stl.js`, `index.html`

- Side-face text (front/back/left/right/top) builds one watertight mesh ??? no 400+ non-manifold edges in Orca.
- Lid / joiner / trace art still use the legacy merge + weld fallback.
- Cache-bust: `app.js?v=56`

**Deploy:** Pi `git pull` + hard refresh.

### 2026-07-05 ??? Live text art (no bounding box)

**What changed:** Removed the misaligned viewport bounding box and draft/Apply workflow. Text edits go straight to the box mesh ??? type, adjust Size / Move / Rotation sliders, done.

**Files:** `index.html`, `css/style.css`, `js/app.js`, `js/art-editor.js`

- Removed `#art-overlay` handles and all overlay JS/CSS.
- Removed **Apply to box** / **Cancel** ??? text updates live via debounced rebuild.
- Added **Move left/right** and **Move up/down** sliders (`decorOffsetX/Y`).
- Fixed text vanishing after apply: body preview now uses merged mesh when emboss is on a body face.
- Cache-bust: `app.js?v=55`

**Deploy:** `git pull` on Pi ??? static files only; hard refresh (`Ctrl+Shift+R`).

### 2026-07-04 fix (blank preview on Pi)

**`js/app.js`** ??? moved stray `import` to top of module (mid-file import caused SyntaxError; JS never ran).
- Prior: `734b8e9` ??? trace autosave; `e91f615` ??? full MakerDeck MVP

### URLs

- **Pi / Tailscale:** `https://flightdeck.tail7de73e.ts.net/makerdeck/`
- **Local dev server:** `http://localhost:8765` (`cd makerforge && python -m http.server 8765`)
- **Local Flightdeck:** `http://localhost:8000/makerdeck/` (after backend restart)

**Hard refresh** (`Ctrl+Shift+R`) after pulling JS changes. No cache-bust on `js/app.js`; Flightdeck serves with `no-store`.

### 2026-07-04 ??? Import QoL + autosave

**Files:** `index.html`, `css/style.css`, `js/app.js`, `js/trace.js`

- **Paste** ??? Ctrl+V on Import tab loads clipboard images into trace pipeline.
- **Clear from box** ??? removes applied trace emboss without hard refresh.
- **Undo / redo** ??? ??? ??? (or Ctrl+Z / Ctrl+Y) for apply vs clear on the box.
- **Session autosave** ??? box settings, applied trace, and import image saved to `localStorage` (`makerdeck-session-v1`); survives refresh.
- Served at `/makerdeck/` via `app/main.py` static mount ??? **backend restart required** after deploy.

### Working features

- Shapes: rect, rounded, hex, circle, pencil/teardrop/star/heart presets
- Lid, link joiner, accent stripe, honeycomb, stackable feet
- Label tab: text emboss, SVG upload
- Import tab: image ??? silhouette/outline trace ??? emboss on front face
- STL export (body, lid, accent)

### Known / later

- Preview rougher than Bambu slice at small art sizes
- Deboss (cut inward) not built yet
- Face picker for emboss (front/back/side) not built yet
- No Pi-hosted URL yet ??? local dev only
