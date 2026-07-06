## MakerDeck session handoff

Latest GitHub state:
- Branch: `main` (same repo as Flightdeck — `makerforge/` folder)
- `main` commit: see b114 entry below

### 2026-07-06 — b115: Screw lid fit fix (first print wouldn't thread on)

**What changed:** Chris's printed 35mm screw lid wouldn't screw on — modelled pass-over clearance was only 0.35 mm, which FDM perimeter swell (bore prints small, external threads print big) eats entirely.
- **FDM fit compensation**: lid bore gets +0.25 mm radial on top of the Fit clearance (pass-over now 0.6 mm at default 0.35), and the lid's internal thread flanks are slimmed 0.15 mm so they can't bind axially.
- **Chunkier thread**: pitch 3.2 → 4.0, depth 1.2 → 1.4, wider root — coarser thread is more forgiving of stringing/blobs and keeps 0.8 mm radial engagement despite the extra bore room.
- Node-verified at 80 mm and at the printed 35 mm size: engagement 0.80 mm, pass-over 0.60 mm, watertight components unchanged.
- Bodies and lids must be **re-exported together** — old body + new lid mixes thread pitches.

**Files:** `js/geometry.js?v=115`, `js/app.js?v=115`, `index.html` — header **b115**

**Deploy:** Pi `git pull`. Hard refresh — confirm header shows **b115**. Re-export both STLs and reprint; if still snug, raise Fit clearance slider (each +0.1 = +0.1 radial all round).

### 2026-07-06 — b114: Vase studio — new styles, flutes, twist

**What changed:** Vase / pot generator got a designer upgrade.
- **4 new styles**: Bowl planter (low + wide), Goblet (stem + cup), Hourglass (pinched waist), Bud vase (narrow neck) — alongside the existing five.
- **Smooth profiles**: control points now interpolate with a monotone cubic spline (Fritsch–Carlson) instead of straight lines — bellies and necks curve naturally with no overshoot. Applies to all styles including the old ones.
- **Flutes (ribs)**: 0–24 vertical ribs, depth 0.5–6 mm. Cosine modulation preserves mean radius; inner wall follows the wave so wall thickness stays constant (vase-mode friendly). Flutes fade to circular at the base for bed adhesion and a clean bottom cap.
- **Twist**: −180° to +180° over the height — turns flutes into spirals. Tessellation auto-densifies (segments up to 240, layers up to 160) so twisted/fluted surfaces stay smooth.
- Node-verified watertight (0 open edges) across all 9 styles × 7 variant combos (flutes, twist, deep ribs, small diameter, no-drain).

**Files:** `js/vase.js?v=114`, `js/geometry.js?v=114`, `js/app.js?v=114`, `index.html` — header **b114**

**Deploy:** Pi `git pull` (static only, restart optional). Hard refresh — confirm header shows **b114**. Try: Vase / pot → Goblet, Flutes 12, Twist 90°.

### 2026-07-06 — b113: Screw-top lids (round containers)

**What changed:** New **Screw top** lid type, offered only when shape = Circle.
- Coarse 2-start trapezoid thread (pitch 3.2, lead 6.4, depth 1.2 mm, tapered run-in/out) — prints without support on vertical walls.
- Body gets matching external neck threads over the skirt zone; lid is a knurled cap (24 grip flutes) with internal threads.
- Existing sliders drive it: **Skirt** = thread engagement depth (8–12 mm sweet spot), **Clearance** = radial fit (0.35 default), **Thickness** = top plate.
- Node-verified: 0.85 mm radial thread engagement, 0.35 mm pass-over clearance, lid/body watertight (shell + 2 thread-start solids each), print orientation plate-down.
- Non-circle shapes never see the option; saved sessions with screw on other shapes normalize to slip.

**Files:** `js/geometry.js`, `js/app.js?v=113`, `js/features.js?v=99`, `js/art-editor.js`, `index.html` — header **b113**

**Deploy:** Pi `git pull`. Hard refresh — confirm header shows **b113**. Try: Circle → Lid tab → enable → Screw top.

### 2026-07-06 — b112: floor marks, heart knuckles, smooth curves — `a57799a`

### 2026-07-06 — b112: floor marks, heart knuckles, smooth curves

**What changed:**
- **Floor marks on every shape** were shadow-map acne (self-shadowing from the key light), not geometry — verified with a Node mesh scan (all shapes = 1 watertight component, no flipped floor tris). Shadows now disabled in the preview renderer.
- **Heart/star knuckle balls**: `filletedOutline` forced every arc CCW, so reflex corners (heart notch, star inner points) drew near-full circles. Fillets now skip reflex corners and sweep the short way; radius adapts to clamped trim so sharp tips stay tangent. This also removed a stray 23-tri patch on the heart floor.
- **Smoother curves**: heart outline 52 → 160 segments, teardrop 32 → 72 — prints and previews smooth instead of faceted.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` — `app.js?v=112`, header **b112**

**Deploy:** Pi `git pull`. Hard refresh — confirm header shows **b112**.

### 2026-07-06 — Houdini fix: earcut annulus crash (b111) — `e772aa4`

### 2026-07-06 — Houdini fix: earcut annulus crash (b111)

**What changed:** b110 passed only outer coords to `earcut()` while declaring a hole index — earcut threw, preview went blank. Now passes outer+hole flat coords; try/catch falls back to radial `capRing`.

**Files:** `js/geometry.js`, `index.html`, `js/app.js` — `app.js?v=111`, header **b111**

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-06 — Floor artifacts v2 (radial pairing + earcut annulus)

**What changed:** v109 arc-length resample was not enough — capRing quads still crossed the floor when fillet counts matched but angles did not. Now: radial ray-cast pairing, horizontal rims use earcut annulus (hole winding fixed), build tag **b110** in header so you can confirm the loaded bundle.

**Files:** `js/geometry.js`, `index.html`, `css/style.css?v=21`, `js/app.js` — `app.js?v=110`

**Deploy:** Pi `git pull`. Hard refresh — confirm header shows **b110**.

### 2026-07-06 — Preview floor artifacts (all shapes)

**What changed:** Center floor slivers and star/heart “knuckle” spikes were from (1) duplicate coplanar floor caps in `capFloorSlab` and (2) `capRing` pairing outer/inner vertices by index when filleted profiles had different point counts. Inner rings are now arc-length resampled to match outer; floor slabs use a single cap face.

**Files:** `js/geometry.js`, `index.html`, `js/app.js` — `app.js?v=109`

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R).

### 2026-07-06 — Houdini fix (vase earcut import)

**What changed:** `vase.js` imported earcut from `three/examples/...` which is not in the import map — module load failed and the whole preview went blank ("Houdini"). Switched to same `esm.sh/earcut` as `geometry.js`.

**Files:** `js/vase.js`, `index.html`, `js/app.js` — `app.js?v=108`

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R).

### 2026-07-06 — Preview artifact fix (slip lid + vase caps)

**What changed:** Slip-over lids had a hollow top rim so the internal skirt floor looked like a floating plane in every lidded preview. Solid earcut top plate now. Vase floors use earcut caps too.

**Files:** `js/geometry.js`, `js/vase.js`, `index.html` — `app.js?v=107`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-06 — Divider top clearance (match lid)

**What changed:** Insert tab — **Match lid clearance** (default on) shortens dividers when inset plug skirt or flat-cap lip hangs inside. **Top clearance** slider for manual override.

**Files:** `js/features.js?v=98`, `js/insert-slots.js`, `js/app.js?v=106`, `js/geometry.js`, `index.html`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 — Inset plug lid restored

**What changed:** Inset plug (skirt inside the opening) is back as a third simple lid — distinct from slip-over and flat cap. Hinges/slide/roll still gone.

**Files:** `js/geometry.js`, `js/app.js?v=105`, `js/art-editor.js`, `index.html`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 — KISS lids (slip-over + flat cap only)

**What changed:** Chris asked to drop hinges and keep it simple.
- **Two lid types:** Slip-over skirt outside walls, Flat cap plate on rim (+ optional lip).
- **Removed:** Hinge tab, clip/slide/roll/hinge lid types, `hinge-hardware.js`, `clip-hinge.js`, `hinge-lid.js`, `slide-lid.js`, `roll-lid.js`.
- Old saved sessions auto-map `hinge`/`clip`/`slide`/`roll`/`plug` → slip or flat.
- Preview is vertical lift/lower only — no knuckle cylinders on star/heart/teardrop.

**Files:** `js/geometry.js`, `js/app.js?v=104`, `js/features.js?v=97`, `js/art-editor.js`, `js/stl.js`, `index.html` — deleted hinge/slide modules

**Deploy:** Pi `git pull`. Hard refresh MakerDeck / `#/makerdeck`. UI-only — no backend restart.

### 2026-07-05 — Hinge dropdown + live 3D preview

**What changed:** Hinge tab now works like a real hinge generator:
- **Hinge type** dropdown (Snap clip, Butt pin, Strap door, Flush barrel)
- Switching type shows that hinge in the **viewport** (orange hardware; snap clip also shows gold pin)
- **Length / width** sliders update the preview live; leaf types also expose thickness, knuckle, and pin controls
- Box hides while the Hinge tab is active so the hardware is easy to inspect
- Standalone leaf hinges preview without needing a box; snap clip previews on supported shapes even before Clip hinge lid is enabled

**Files:** `js/hinge-hardware.js`, `js/app.js?v=102`, `js/geometry.js?v=102`, `index.html`

**Deploy:** Pi `git pull`. Hard refresh MakerDeck / `#/makerdeck`.

### 2026-07-05 — Hinge generator presets (butt, strap, barrel)

**What changed:** Hinge tab is now a **hinge generator** with style presets:
- **Snap clip** — box rail system (needs Clip hinge lid)
- **Butt pin** — flat-leaf alternating knuckles
- **Strap door** — long door leaf + short frame leaf
- **Flush barrel** — compact cabinet barrel hinge

Each style has tuned sliders, assembly steps, and Download hinge / pin STLs (manifold, flat on bed).

**Files:** `js/hinge-hardware.js` (new), `js/app.js?v=101`, `js/geometry.js`, `js/stl.js`, `index.html`, `css/style.css?v=20`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 — Hinge tab (clip generator)

**What changed:** Dedicated **Hinge** tab for clip hinge hardware — rail/pin/position sliders, assembly steps, and **Download clips / pins** buttons. Clips + pins removed from main export dropdown. Picking Clip hinge on Lid tab jumps you to Hinge.

**Files:** `index.html`, `css/style.css?v=19`, `js/app.js?v=100`, `js/geometry.js`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 — Clip export: one fused part, 4-up on bed

**What changed:** Clip STL was two floating pieces (C-grip + ring) — unusable in Bambu. Now:
- Grip + knuckle barrel **fused** with web ribs (one solid per clip)
- **Laid flat on the bed** (barrel down, arch up)
- Export arranges **4 clips** or **2 pins** on the plate automatically

**Files:** `js/clip-hinge.js`, `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=99`

**Deploy:** Pi `git pull`. Hard refresh. Re-export clip + pin STLs.

### 2026-07-05 — Fix blank preview (duplicate export crash)

**What changed:** `geometry.js` exported `clipHingeAvailable` and `normalizeLidType` twice — the module failed to load and the viewport showed no box. Removed duplicate re-exports; added missing `skirtDepth` on clip fit guides.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=98`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 — Clip hinge: snap rails + separate clip/pin exports

**What changed:** Replaced the hidden integrated flip hinge with a focused **clip hinge** system:
- **Clip hinge** lid type — clean inset plug + snap rails on box/lid back rim (no integrated knuckles)
- **Separate exports:** STL hinge clip (×4) and STL hinge pin (×2) in the download dropdown
- Clip + pin meshes are **manifold** (0 open edges after sanitize) — no Bambu Repair
- Preview reuses flip animation on back edge; saved `hinge` lid type maps to `clip`

**Files:** `js/clip-hinge.js` (new), `js/geometry.js`, `js/app.js`, `js/stl.js`, `js/art-editor.js`, `index.html` — cache-bust `app.js?v=97`

**Deploy:** Pi `git pull`. Hard refresh. Enable lid → Clip hinge → export body, lid, clips, pins.

### 2026-07-05 — Flip hinge hidden (not strong enough yet)

**What changed:** **Flip hinge** removed from the lid-type dropdown for now — filament knuckles aren’t strong enough for real use. Saved sessions with hinge selected fall back to **Inset plug**. Code stays in repo (`HINGE_LID_ENABLED = false`) for a future stronger design.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=95`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 — Manifold exports (no slicer repair)

**What changed:** Exports should load in Bambu without **Repair**:
- **Hinge lid** — closed plug shell (no open back wall); pin tunnels capped with washer end-faces
- **STL sanitize** — stronger non-manifold peel (8 passes) + open-edge check (warns in console if any remain)

**Files:** `js/hinge-lid.js`, `js/stl.js`, `js/app.js`, `js/3mf.js`, `index.html` — cache-bust `app.js?v=94`, `stl.js?v=74`

**Deploy:** Pi `git pull`. Hard refresh. Re-export STLs/3MF.

### 2026-07-05 — Flip hinge v2: flat lid export, pin tunnels, tighter knuckles

**What changed:** Hinge redesign from Chris’s Bambu slice feedback:
- **Lid exports flat** on the bed (vertical rim knuckles, no horizontal Y overhang; bottom shifted to Z=0)
- **5 knuckle positions** (body/lid/body/lid/body) packed with tighter pitch — not 2+1 at the ends
- **Pin tunnels** through each knuckle (1.75 mm filament slides in from either side along box width)
- Default knuckle radius **4 mm**, count **5**

**Files:** `js/hinge-lid.js`, `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=93`

**Deploy:** Pi `git pull`. Hard refresh. Re-export body + lid STL/3MF.

### 2026-07-05 — Fat quarters: fuse dividers to floor/walls (print fix)

**What changed:** Fat quarters tray dividers were floating **0.12 mm** above the floor with side gaps — fine for removable inserts, but when merged into one 3MF they printed as weak free-standing walls that delaminated (layer ribbons). Dividers now **fuse to floor and side walls** on the fat quarters preset; default divider thickness **3.2 mm**.

**Files:** `js/features.js`, `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=92`

**Deploy:** Pi `git pull`. Hard refresh. **Re-export 3MF** before reprinting.

### 2026-07-05 — Fix flip hinge reverting / clearing lid

**What changed:** Selecting **Flip hinge** was crashing during preview guide setup (`plateOuter` missing on hinge fit guides → rebuild error → emergency reset to default box). Hinge guides now use the correct rim/plate loops; fat quarters preset also listed as hinge-capable.

**Files:** `js/app.js`, `js/hinge-lid.js`, `index.html` — cache-bust `app.js?v=90`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 — Fix flip hinge lid preview (invisible lid)

**What changed:** Hinge lid preview was offset ~27 mm behind the box (invisible). Now uses a pivot group on the back edge. Picking a lid type also auto-enables **Enable lid** if it was off.

**Files:** `js/app.js`, `js/hinge-lid.js`, `index.html` — cache-bust `app.js?v=89`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 — Lids: flip hinge + roll lock (bayonet)

**What changed:** Two new lid types on the Lid tab:
- **Flip hinge** — pin knuckles on the back edge (box + lid interleave). Use **1.75 mm filament** as hinge pin. Best on box / rounded / pencil box. Preview animates clamshell open.
- **Roll lock** — push-down + twist bayonet cap for **circle, oval, hex**. Body gets inner rim tracks; lid gets radial lugs. Preview animates lift + quarter-turn.

**Files:** `js/hinge-lid.js`, `js/roll-lid.js`, `js/geometry.js`, `js/app.js`, `js/art-editor.js`, `index.html` — cache-bust `app.js?v=88`

**Deploy:** Pi `git pull`. Hard refresh. Re-export body + lid STLs.

### 2026-07-05 — Edge fillet: adaptive arc segments (box shape)

**What changed:** **Box + edge fillet** (the `box-*.stl` path, not the Rounded shape) now uses adaptive arc segments — ~1 mm facet target, min 12 / max 96 per corner. A **12 mm fillet** goes from 6 segments to **~19** per corner.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=87`

**Deploy:** Pi `git pull`. Hard refresh. Re-export STL/3MF.

### 2026-07-05 — Oval shape + smoother rounded corners

**What changed:** New **Oval** shape (width + depth elliptical box). **Rounded** boxes (and pencil / pencil box / fat quarters rounded corners) now use adaptive corner arc segments (~1.5 mm facet length, scales with corner radius) instead of a fixed 8–10 segments — much smoother walls in Bambu slice preview.

**Files:** `js/geometry.js`, `js/app.js`, `js/stl.js`, `js/3mf.js`, `index.html` — cache-bust `app.js?v=86`

**Deploy:** Pi `git pull`. Hard refresh. Re-export STL/3MF.

### 2026-07-05 — Circle boxes: smoother wall mesh for slicing

**What changed:** **Circle** shape no longer uses a fixed 56-sided outline. Segment count now scales with diameter (~1.5 mm facet length, 96–256 segments) so Bambu Studio shows round walls instead of chunky flat facets.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=84`

**Deploy:** Pi `git pull`. Hard refresh. Re-export STL/3MF for circle boxes.

### 2026-07-05 — Lids polish: flat cap retention lip + stackable lid pockets

**What changed:** **Flat cap** lids now support an optional **retention lip** (inner skirt that drops into the opening for alignment). New **Retention lip** slider on the Lid tab (flat cap only). **Fat quarters** preset defaults to **3 mm** lip when lid is enabled. When **Stack** hex feet are enabled, matching **pockets are cut into the top of flat lids** so trays can nest lid-on-tray. Preview fit guides show the lip ring.

**Planned next — adjustable removable dividers:** mirrored vertical slot pairs on left/right walls; slot positions on a slider scale so panels slide in and bays resize for on-call custom boxes.

**Files:** `js/geometry.js`, `js/features.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=83`

**Deploy:** Pi `git pull`. Hard refresh. UI-only — no backend restart required.

### 2026-07-05 — Lids: flat cap default for fat quarters tray

**What changed:** **Fat quarters** preset defaults to **Flat cap** lid type when you enable lid (still off by default). Lid tab shows tray hint for dust cover / stacking.

**Planned next — adjustable removable dividers:** mirrored vertical slot pairs on left/right walls; slot positions on a slider scale so panels slide in and bays resize for on-call custom boxes.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=82`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 — Fat quarters: single-colour export

**What changed:** **Fat quarters** preset dividers match **box colour** in preview. **3MF export** merges Insert into Body (one part, one extruder) for single-filament prints.

**Files:** `js/app.js`, `index.html` — cache-bust `app.js?v=81`

**Deploy:** Pi `git pull`. Hard refresh. Re-export 3MF.

### 2026-07-05 — Fat quarters preset: flat H-series tray

**What changed:** **Fat quarters** preset matches Chris’s print — **300×300×55 mm** flat tray, **2 vertical dividers** (3 bays ~98 mm), prints on H-series bed (~305×58 mm outer). Removed 400 mm bookcase layout.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` — cache-bust `app.js?v=80`

**Deploy:** Pi `git pull`. Hard refresh. Re-export 3MF.

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
