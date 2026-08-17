# SESSION_NEXT (active)

Recent Flightdeck / MakerDeck session notes (last ~4 weeks). Older history: [docs/archive/SESSION_NEXT_before_2026-06-28.md](docs/archive/SESSION_NEXT_before_2026-06-28.md).

MakerDeck detailed notes: [makerforge/SESSION_NEXT.md](makerforge/SESSION_NEXT.md).

---

## 2026-08-17 Session update (Hoodie dual nozzle)

Latest commit: `00b15f0` — MakerDeck **b604**, hoodie 3MF maps **white body to left** (AMS HT) and **red/black art to right**. Prime tower on (right nozzle cannot purge into left infill).

Latest local/Pi change:
- b602/b603 pinned every slot to the left, so Studio showed right nozzle empty. Dual map is back; colour merge still caps ~3–4 slots so the tower should stay far under the old 20h. Hard refresh (`app.js?v=711`, MakerDeck `app.js?v=604` / **b604**). Header **b604**. Re-export. Filament grouping: 1 on left, 2+3 on right.

Previous:
- Hoodie dark grey stays black (`2d7b7a4`).

---

## 2026-08-17 Session update (Hoodie dark grey stays black)

Latest commit: `2d7b7a4` — MakerDeck **b603**, crest **Dark grey** (knight) no longer merges into the white body slot.

Latest local/Pi change:
- b602 parked `Art Dark grey` on filament 1, so the knight vanished. Dark grey / black now get their own slot (priority: body, red, black, white). Hard refresh (`app.js?v=710`, MakerDeck `app.js?v=603` / **b603**). Header **b603**. Re-export. Do not click Set to Optimal.

Previous:
- Hoodie no prime tower (`5291bf3`).

---

## 2026-08-17 Session update (Hoodie no prime tower)

Latest commit: `5291bf3` — MakerDeck **b602**, hoodie 3MF maps all filaments to the **left** nozzle, merges similar crest colours (cap 4), and keeps **prime tower off** via `different_settings_to_system`.

Latest local/Pi change:
- 19h 44m + tower was 8 AMS slots with art on the **right** nozzle (flush-into-body cannot eat right-nozzle purges). Export now: ~3–4 filaments all on left, tower off, purge into hoodie infill/objects. Hard refresh (`app.js?v=709`, MakerDeck `app.js?v=602` / **b602**). Header **b602**. Re-export. In Studio: do **not** click “Set to Optimal” (that puts colours back on the right). Prime tower should be off.

Previous:
- Hoodie 3MF loads as H2C 0.24 Standard (`beaf424`).

---

## 2026-08-17 Session update (Hoodie 3MF loads as H2C 0.24 Standard)

Latest commit: `beaf424` — MakerDeck **b601**, 3MF is a real Bambu project on **0.24mm Standard @BBL H2C**.

Latest local/Pi change:
- Studio dumped settings because Application was `BambuStudio` (no version) and the JSON had no `nozzle_diameter` / `extruder_type`. There is no Hoodie Fast in System presets — fastest stock is **0.24mm Standard**. Hard refresh (`app.js?v=708`, MakerDeck `app.js?v=601` / **b601**). Header **b601**. Re-export. Process dropdown should show 0.24mm Standard, no “invalid config”.

Previous:
- Hoodie 0.4 slice cracks (`ee77d2a`).

---

## 2026-08-17 Session update (Hoodie 0.4 slice cracks + H2C config)

Latest commit: `ee77d2a` — MakerDeck **b600**, thicker 0.4 mm stamp; 3MF is H2C 0.4 / 0.20mm Standard.

Latest local/Pi change:
- Grey cracks in the crest and LITTLE were a 0.62 mm stamp (one 0.4 mm line). Export is ~0.90 mm (two lines) with a deeper bite into the fabric. 3MF now says **Bambu Lab H2C 0.4 nozzle** + **0.20mm Standard @BBL H2C** so Studio should keep the settings (not 20 hr geometry-only). Hard refresh (`app.js?v=707`, MakerDeck `app.js?v=600` / **b600**). Header **b600**. Re-click Stubby holder, re-export. **Do not click Repair.**

Previous:
- Hoodie Body 3 open edges (`cf8f26c`).

---

## 2026-08-17 Session update (Hoodie Body 3 open edges)

Latest commit: `cf8f26c` — MakerDeck **b599**, 3MF sanitiser strips duplicate faces before peel so the hoodie Body stays closed.

Latest local/Pi change:
- Export warned “Body 3 open” because peel treated 24 duplicate faces as non-manifold and punched a hole. Duplicates go first now. Hard refresh (`app.js?v=706`, MakerDeck `app.js?v=599` / **b599**). Header **b599**. Re-click Stubby holder, export 3MF. **Do not click Repair.**

Previous:
- Hoodie back uses the chest stamp (`c1d7dee`).

---

## 2026-08-17 Session update (Hoodie back uses the chest stamp)

Latest commit: `c1d7dee` — MakerDeck **b598**, back text uses the same Y-stamp + 5-pass blur as the chest.

Latest local/Pi change:
- Front LITTLE is close because it stamps on a min-Y heightfield with pocket-close blur. Back now uses that same path on the outer +Y skin (no cylinder unwrap, no normals). Face → Back, type in Text. PNG still chest-only. Hard refresh (`app.js?v=705`, MakerDeck `app.js?v=598` / **b598**). Header **b598**. Re-click Stubby holder.

Previous:
- Drop hoodie back text (`fa27395`).

---

## 2026-08-17 Session update (Drop hoodie back text)

Latest commit: `fa27395` — MakerDeck **b597**, stubby holder text/logo on the chest only.

Latest local/Pi change:
- Back text on the hoodie well was never going to sit clean (cylinder + stamp kept clipping/crumpling). Face Back is gone. Type in Text or drop a PNG on the chest. Hard refresh (`app.js?v=704`, MakerDeck `app.js?v=597` / **b597**). Header **b597**. Re-click Stubby holder.

Previous:
- Hoodie back text wraps the cylinder (`26ab787`).

---

## 2026-08-17 Session update (Hoodie back text wraps the cylinder)

Latest commit: `26ab787` — MakerDeck **b596**, back text wraps around the well like a can label.

Latest local/Pi change:
- Chest-style Y-stamp cannot sit on the cylindrical back — letters crumpled into the wall. Back text now unwraps around `backY` (same Text box, Face → Back). Front logo unchanged. Hard refresh (`app.js?v=703`, MakerDeck `app.js?v=596` / **b596**). Header **b596**. Re-click Stubby holder, Face → Back — rear text, type again.

Previous:
- Hoodie back text uses the front stamp (`efff7b2`).

---

## 2026-08-17 Session update (Hoodie back text uses the front stamp)

Latest commit: `efff7b2` — MakerDeck **b595**, back text uses the same Y-stamp as the chest.

Latest local/Pi change:
- Back LITTLE was a comb of spikes from offsetting along noisy surface normals. Back text now uses the same setup as the front: type in the Text box, stamp along world Y. Face Front = chest logo or text; Back = rear text. Hard refresh (`app.js?v=702`, MakerDeck `app.js?v=595` / **b595**). Header **b595**. Re-click Stubby holder.

Previous:
- Hoodie back letters wrap the curve (`3973047`).

---

## 2026-08-17 Session update (Hoodie back letters wrap the curve)

Latest commit: `3973047` — MakerDeck **b594**, back text follows the outer curve, not a flat plane.

Latest local/Pi change:
- LITTLE was buried at the spine and floating at the ends because the back field was flattened and offset in +Y. It now keeps the cylinder envelope and stamps along the surface normal. Front unchanged. Hard refresh (`app.js?v=701`, MakerDeck `app.js?v=594` / **b594**). Header **b594**. Re-click Stubby holder.

Previous:
- Hoodie back text through the wall (`32986c3`).

---

## 2026-08-17 Session update (Hoodie back text through the wall)

Latest commit: `32986c3` — MakerDeck **b593**, back stamp uses the outer fabric only.

Latest local/Pi change:
- Back LITTLE was shredded through the well wall because the heightfield kept every vertex past Y=2 (inner well + outer skin). It now only samples the outer back. Front chest path unchanged. Hard refresh (`app.js?v=700`, MakerDeck `app.js?v=593` / **b593**). Header **b593**. Re-click Stubby holder.

Previous:
- Undo b591 front spikes (`be456ba`).

---

## 2026-08-17 Session update (Undo b591 front field)

Latest commit: `be456ba` — MakerDeck **b592**, chest logo field restored; back-only drape stays.

Latest local/Pi change:
- b591 sampled the pouch interior and exploded the front shield into spikes. Front heightfield is back to the pocket-close blur. Back text path unchanged. Hard refresh (`app.js?v=699`, MakerDeck `app.js?v=592` / **b592**). Header **b592**. Re-click Stubby holder and drop the PNG again.

Previous:
- Hoodie LITTLE Swiss cheese (`cd0ad7b`) — reverted.

---

## 2026-08-17 Session update (Hoodie LITTLE Swiss cheese)

Latest commit: `cd0ad7b` — MakerDeck **b591**, chest stamp follows the pocket skin.

Latest local/Pi change:
- LITTLE on the chest was holey because the heightfield was mean-blurred behind the kangaroo pocket, then sat 0.04 mm “on” that fake surface. Stamp now follows the outer fabric; preview sits 0.25 mm proud. Hard refresh (`app.js?v=698`, MakerDeck `app.js?v=591` / **b591**). Header **b591**. Re-click Stubby holder.

Previous:
- Hoodie back text too deep (`01fbcff`).

---

## 2026-08-17 Session update (Hoodie back text too deep)

Latest commit: `01fbcff` — MakerDeck **b590**, back text sits on the fabric again.

Latest local/Pi change:
- b589 embedded 0.55 mm into the hoodie on preview, so LITTLE punched through the back. Preview is a 0.5 mm stamp on the fabric; export only bites 0.12 mm for bonding. Back heightfield no longer mean-blurs inward. Hard refresh (`app.js?v=697`, MakerDeck `app.js?v=590` / **b590**). Header **b590**. Re-click Stubby holder, Face → Back — text.

Previous:
- Hoodie shield slice + manifold (`edb6a7c`).

---

## 2026-08-17 Session update (Hoodie shield slice + manifold)

Latest commit: `edb6a7c` — MakerDeck **b589**, 3MF sanitiser peels 3+ face edges; crest embeds into the fabric.

Latest local/Pi change:
- Bambu’s “24 non-manifold edges” on `stubby-holder-65x145mm` was real: the sanitiser only counted **open** (1-face) edges, so a closed hoodie with 3-face edges skipped repair. Shield also sat ~0.04 mm off the chest so the slice could drop it. Hard refresh (`app.js?v=696`, MakerDeck `app.js?v=589` / **b589**). Header **b589**. Re-click Stubby holder, re-drop the PNG, re-export 3MF. **Do not click Repair.** Side view: crest and back text should sit in the fabric.

Previous:
- Hoodie text on the back (`7007588`).

---

## 2026-08-17 Session update (Hoodie text on the back)

Latest commit: `7007588` — MakerDeck **b588**, Face Back puts text on the rear, chest logo stays.

Latest local/Pi change:
- Stubby holder Face is Front or Back. PNG/logo stays on the chest; Text on Back drapes on the rear fabric. Hard refresh (`app.js?v=695`, MakerDeck `app.js?v=588` / **b588**). Header **b588**. Art tab → Face → **Back — text**, then type on the Text pane.

Previous:
- Stubby holder empty after b586 (`b5bbbe7`).

---

## 2026-08-17 Session update (Stubby holder empty after b586)

Latest commit: `b5bbbe7` — MakerDeck **b587**, one hoodie-stubby module instance.

Latest local/Pi change:
- Clicking Stubby holder loaded the STL into one JS cache and built the mesh from another (empty) because `hoodie-stubby.js?v=586` vs `?v=585`. Hard refresh (`app.js?v=694`, MakerDeck `app.js?v=587` / **b587**). Header must say **b587**. Click Stubby holder again.

Previous:
- Hoodie AMS flush (`23da307`).

---

## 2026-08-17 Session update (Hoodie 18h slice was AMS, not geometry)

Latest commit: `23da307` — MakerDeck **b586**, one-object 3MF + flush into the hoodie body.

Latest local/Pi change:
- test2 in Bambu was **18h 43m** with 553 AMS swaps, prime tower on, flush-into-infill off. Crest is ~56 mm tall so it hits ~280 layers × 3 colours. Next export is one assembly (not separate objects), purge into infill, no tower, art on the right H2D nozzle. Hard refresh (`app.js?v=693`, MakerDeck `app.js?v=586` / **b586**). Re-export 3MF. In the open slicer: Flush into infill + objects, multiplier ~0.4, prime tower off, then slice again. Orca preset **0.28mm Hoodie Fast @H2D**.

Previous:
- Hoodie crest stamp (`bf04e9f`).

---

## 2026-08-17 Session update (Hoodie crest is a fine stamp)

Latest commit: `bf04e9f` — MakerDeck **b585**, shared-vertex chest stamp, no 0.22 mm cells / scanlines.

Latest local/Pi change:
- St George was Lego-blocky with horizontal scanlines because b584 forced 0.22 mm voxels and `DECAL_LAYER_MM` row banding. Chest art now uses Painter’s shared-vertex heightfield (~0.06 mm start, grid cap 520 ≈ 0.11 mm on a 56 mm logo). Skin stays 0.04 / ~0.72 mm. Hard refresh (`app.js?v=692`, MakerDeck `app.js?v=585` / **b585**). Header must say **b585**. Re-click Stubby holder and drop the PNG again.

Previous:
- Hoodie stamp matches Painter thickness (`57fee2b`).

---

## STOP — pick up 2026-08-17 (hoodie logo still not crisp)

Latest commit: `57fee2b` / `19593e3` — session parked. MakerDeck **b584** is live. Do not ship another depth/drape tweak until crispness is fixed.

**What Chris sees:** St George crest on the hoodie in MakerDeck is blocky, scanlined, and a bit engraved. STL Painter is the look we want (thin stamp on the fabric, clean edges). He was comparing Painter vs MakerDeck; MakerDeck is the one that’s wrong.

**This is the same family of bugs as this morning, not a new one.**

| When | What we did | What it caused |
| --- | --- | --- |
| Painter b590 | Paint colours onto hoodie triangles | Jagged red spikes (`f13c15b` / b591 undid this) |
| Painter b589 | One prism per bitmap cell | Millions of faces, 0-byte 3MF. Fix: **shared-vertex heightfield**, grid ~0.2 mm |
| Painter b584–b588 | Raw PNG grey halo | Fringe / saw-teeth around the shield |
| MakerDeck b584 tonight | Forced hoodie art to **0.22 mm cells** + row banding | **Tonight’s “not crisp”** — stepped letters, horizontal scanlines |

**Tomorrow — do this:**

1. **Undo the 0.22 mm hoodie cap** in `features.js` (`buildFlatShapeGroupsSolidMesh` stepMm and `buildWrapTraceSlabMesh` stepPx). That cap is why ST. GEORGE / ILLAWARRA look like Lego. Box art stays crisp at **0.035 mm export / 0.05 mm preview**.
2. **Do not row-band the crest** with `DECAL_LAYER_MM` (0.2 mm). That’s the horizontal striations across the shield.
3. **Keep** b584’s good bits: Painter skin **0.04 mm**, shell **~0.72 mm**, smoothed front-face chest field. Those fixed the side-on brick, not the top-down pixels.
4. Prefer **Painter’s `appendStampHeightfield`** (`makerforge/js/painter-art.js`) on MakerDeck’s `getEmbossFaceFrame` / chest field — one shell per colour, shared verts — instead of voxel marching with fat cells.
5. **Never** paint the hoodie mesh triangles again (b591). Logo stays a separate colour part.
6. If the grey halo is back, reuse Painter’s `scrubTraceMat` / paper knockout — don’t restamp the raw PNG.

**Do not:** another proud/depth pass, pocket-interior drape, or painting the STL. Crispness is grid + builder, not millimetres of offset.

Hard refresh still **b584** until tomorrow’s build. Re-click Stubby holder after the crisp fix.

Previous:
- MakerDeck hoodie stamp matches Painter thickness (`57fee2b`).

---

## 2026-08-16 Session update (MakerDeck hoodie stamp matches Painter)

Latest commit: `57fee2b` — Match MakerDeck hoodie logos to STL Painter's thin smooth stamp.

Latest local/Pi change:
- MakerDeck was voxel-extruding a noisy chest field (~0.85 mm proud). It now uses Painter’s skin (0.04 mm) + ~0.72 mm shell, a smoothed front-face heightfield, and a ~0.22 mm grid. Hard refresh (`app.js?v=691`, MakerDeck `app.js?v=584` / **b584**). Header must say **b584**. Re-click Stubby holder, drop the PNG again.

Previous:
- Hoodie 3MF Bambu export (`29aa8ab`).

---

## 2026-08-16 Session update (Hoodie 3MF survives Bambu)

Latest commit: `29aa8ab` — Export hoodie logos as closed 3MF solids that stay standing in Bambu.

Latest local/Pi change:
- MakerDeck preview was right; Bambu dropped the art as zero-volume parts and auto-dropped the hoodie onto its back. 3MF now ships Body + colour art as separate objects, closed ~0.8 mm proud slabs, no auto_drop. Hard refresh (`app.js?v=690`, MakerDeck `app.js?v=583` / **b583**). Header must say **b583**. Re-export 3MF from MakerDeck (not the original STL).

Previous:
- Hoodie stamp follows fabric (`7c08c52`).

---

## 2026-08-16 Session update (Hoodie stamp follows the fabric)

Latest commit: `7c08c52` — Sit hoodie logos on the outer fabric instead of a recessed chest plane.

Latest local/Pi change:
- b581 still flattened the stamp onto the chest plane while the pocket stuck out (side-view step). Art now follows the front-most fabric and sits ~0.85 mm proud. Hard refresh (`app.js?v=689`, MakerDeck `app.js?v=582` / **b582**). Header must say **b582**. Re-click Stubby holder, drop the PNG again.

Previous:
- Hoodie stamp too deep (`8cbe554`).

---

## 2026-08-16 Session update (Hoodie stamp too deep)

Latest commit: `8cbe554` — Keep hoodie chest logos as a shallow stamp, not a pocket carve.

Latest local/Pi change:
- Per-vertex chest drape was sampling the pouch interior and pulling the WAK logo ~28 mm into the pocket. Art now sits on hole-closed front fabric (~0.4 mm proud). Hard refresh (`app.js?v=688`, MakerDeck `app.js?v=581` / **b581**). Header must say **b581**. Re-click Stubby holder, drop the PNG again.

Previous:
- Stubby holder round1 crash (`d1e7ef6`).

---

## 2026-08-16 Session update (Stubby holder round1 crash)

Latest commit: `d1e7ef6` — Fix Stubby holder crash: round1 was missing after the chest-drape change.

Latest local/Pi change:
- Clicking Stubby holder threw `round1 is not defined`. Helper is back. Hard refresh (`app.js?v=687`, MakerDeck `app.js?v=580` / **b580**). Header must say **b580**.

Previous:
- Hoodie chest art drape (`21449f9`).

---

## 2026-08-16 Session update (Hoodie chest art sits on the surface)

Latest commit: `21449f9` — Drape MakerDeck logos onto the hoodie chest instead of the belly bounding box.

Latest local/Pi change:
- The logo was floating in front of the hoodie because art sat on the pocket AABB, not the chest. It now drapes onto the chest surface. Hard refresh (`app.js?v=686`, MakerDeck `app.js?v=579` / **b579**). Header must say **b579**. Re-click Stubby holder, drop the PNG again.

Previous:
- Hoodie is the MakerDeck stubby holder (`085927b`).

---

## 2026-08-16 Session update (Hoodie is the MakerDeck stubby holder)

Latest commit: `085927b` — Put the Panthers hoodie mesh in MakerDeck as Stubby holder.

Latest local/Pi change:
- Stubby holder is the hoodie (150 mm / 65 mm well), not the can-cup. Drop a PNG on the Art tab — chest logo exports as a separate colour part like other MakerDeck boxes. Hard refresh (`app.js?v=685`, MakerDeck `app.js?v=578` / **b578**). Header must say **b578**.

Previous:
- MakerDeck stubby holder cup (`6713cfe`).

---

## 2026-08-16 Session update (MakerDeck stubby holder back)

Latest commit: `6713cfe` — Restore the MakerDeck stubby holder preset so wrap art can be tested on a cup.

Latest local/Pi change:
- Painter logo still does not transfer the way MakerDeck wrap-art does, so the parametric **Stubby holder** is back on MakerDeck Quick presets. Can vs Bottle, Easy 68 mm / Snug 67.5 mm. Drop a PNG on the Art tab — it wraps the cup wall. Export is `*-base.3mf` + `*-stack.3mf`. Hard refresh (`app.js?v=684`, MakerDeck `app.js?v=577` / **b577**). Header must say **b577**.

Previous:
- Painter logo separate 3MF part (`f13c15b`).

---

## 2026-08-16 Session update (Painter logo clean edges + separate 3MF part)

Latest commit: `f13c15b` — Stop painting hoodie triangles; export the logo as its own 3MF part.

Latest local/Pi change:
- b590 painted the chest mesh, so the crest grew jagged red spikes and a white triangle. Logo now sits on the surface again (~0.72 mm) and exports as `object_2` so Bambu keeps it after slice without shattering the hoodie. Hard refresh (`app.js?v=683`, Painter `painter.html?v=591` / **b591**). Reload the STL, stamp once, export. Preview colour mode: **Filament**.

Previous:
- Painter logo survives slice (`55f1b8f`).

---

## 2026-08-16 Session update (Painter logo survives slice)

Latest commit: `55f1b8f` — Sink Painter logos into the hoodie so Bambu keeps them after slice.

Latest local/Pi change:
- Logo showed in Prepare then vanished after slice (15s filament changes). The stamp was a 0.32 mm shell floating 0.14 mm off the chest, so the slicer dropped it. Stamp now embeds ~0.55 mm, is ~0.8 mm thick, stacks ink above the white plate, and paints the hoodie triangles (including white). Hard refresh (`app.js?v=682`, Painter `painter.html?v=590` / **b590**). Reload the STL, stamp once, export. In Preview switch the colour legend from Line Type to **Filament**.

Previous:
- Painter 3MF empty export (`40a1ea7`).

---

## 2026-08-16 Session update (Painter 3MF export empty file)

Latest commit: `40a1ea7` — Stop Painter logo stamps from writing a 0-byte 3MF.

Latest local/Pi change:
- The painted hoodie 3MFs (`obj_1_Hoodie_stubby_150x65_painted.3mf`, `test.3mf`) are **0 bytes** — the save picker created the file, then export died building a per-cell stamp mesh (white crest plate = hundreds of thousands of isolated prisms). Those files cannot be repaired; reload the STL and re-export.
- Stamp is now a shared-vertex heightfield, grid capped (~0.2 mm), 3MF XML is built in one join, empty exports are rejected. Hard refresh (`app.js?v=681`, Painter `painter.html?v=589` / **b589**). Header must say **b589**. Reload the hoodie STL, stamp the logo once, export again.

Previous:
- Tools dismiss failed queue leftovers (`420acc3`).

---

## 2026-08-16 Session update (Tools dismiss failed queue leftovers)

Latest commit: `420acc3` — Add Settings → Tools dismiss for failed/cancelled queue leftovers.

Latest local/Pi change:
- Tools can dismiss leftover failed/cancelled queue rows (like BigBoy job #307) without touching the printer. Hard refresh (`app.js?v=680`, `style.css?v=509`).

Previous:
- Clear BigBoy cancelled-print fault (`29391e8`).

---

## 2026-08-16 Session update (Clear BigBoy cancelled-print fault)

Latest commit: `29391e8` — Treat Bambu 0300-400C (printing was cancelled) as a cleared cancel, not a live fault.

Latest local/Pi change:
- BigBoy was stuck `error` after a cancelled print (`0300-400C`). Flightdeck now dismisses that retained FAILED banner and sends `clean_print_error`. Backend restart required.

Previous:
- Painter sit logo on hoodie (`75369e1`).

---

## 2026-08-16 Session update (Painter sit logo on hoodie)

Latest commit: `75369e1` — Sit Painter logos on the hoodie surface and drop the grey under-layer.

Latest local/Pi change:
- Stamp follows the chest (no more flat slab cutting in). Logo sits ~0.14 mm on top, ~0.32 mm thick. Pale grey fringe layers are dropped.
- Hard refresh (`app.js?v=679`, Painter `painter.html?v=588` / **b588**). Reload the hoodie STL, drop the logo, stamp once. Header must say **b588**.

Previous:
- Painter stop restamping grey PNG (`019832a`).

---

## 2026-08-16 Session update (Painter stop restamping the grey PNG)

Latest commit: `019832a` — Stop Painter from rebuilding the grey logo fringe off the raw PNG.

Latest local/Pi change:
- Stamp uses the scrubbed trace only (no raw-PNG fallback that put the grey halo back). Grey layers and border-connected grey pixels are dropped; the white crest plate stays; 1px spikes on the plate edge are opened off.
- Hard refresh (`app.js?v=678`, Painter `painter.html?v=587` / **b587**). Reload the hoodie STL, drop the logo, stamp once. Header must say **b587**.

Previous:
- Painter clip logo to ink island (`0ebd0de`).

---

## 2026-08-16 Session update (Painter clip logo to ink island)

Latest commit: 0ebd0de — Clip Painter logos to the sealed red/black island and stop fringe growth.

Latest local/Pi change:
- Stamp now floods from the crop edge and stops at a sealed red/black outline, so the grey halo around the shield is punched. Slab downsample needs a majority of ink (no more fat saw-teeth).
- Hard refresh (`app.js?v=677`, Painter `painter.html?v=586` / **b586**). Reload the hoodie STL, drop the logo, stamp once.

Previous:
- Painter source-flood logo mat (`36a232f`).

---

## 2026-08-16 Session update (Painter source-flood logo mat)

Latest commit: `36a232f` — Knock out logo paper from the PNG pixels, and replace the old stamp.

Latest local/Pi change:
- Artwork scrub now floods the **source PNG** from the border (same idea as MakerDeck paper knockout), so grey/white mats die even when they were quantized as White.
- Re-stamp replaces the previous logo mesh. Hard refresh (`app.js?v=676`, Painter `painter.html?v=585` / **b585**). Reload the hoodie STL, drop the logo, stamp once.

Previous:
- Painter punch grey logo halo (`2734919`).

---

## 2026-08-15 Session update (Painter punch grey logo halo)

Latest commit: `2734919` — Punch grey halo outside the crest, not just the full-frame mat.

Latest local/Pi change:
- Flood from the crop edge through grey/empty so a jagged silver halo around the shield is removed. Interior white stays.
- Hard refresh (`app.js?v=675`, Painter `painter.html?v=584` / **b584**). Undo the old stamp (geometry), drop/trace again, click the chest.

Previous:
- Painter drop grey logo mat (`358bbea`).

---

## 2026-08-15 Session update (Painter drop grey logo mat)

Latest commit: `358bbea` — Drop the grey bounding-mat around Painter team logos.

Latest local/Pi change:
- Multi-colour stamp now throws away grey/white paper that hugs the image edge (the jagged grey box around the Dragons crest). Shield colours stay.
- Hard refresh (`app.js?v=674`, Painter `painter.html?v=583` / **b583**). Undo or Clear Paint, drop/trace again, stamp the chest.

Previous:
- Painter multi-colour team-logo trace (`2dd3bab`).

---

## 2026-08-15 Session update (Painter multi-colour team-logo trace)

Latest commit: `2dd3bab` — Stamp Painter logos via MakerDeck Multi-colour AMS trace.

Latest local/Pi change:
- STL Painter Artwork uses the same **Multi-colour — team logo (AMS)** trace as Art on box, then extrudes those ink layers (no grey mat, no pixel shards).
- Threshold / Invert match MakerDeck. Hard refresh (`app.js?v=673`, Painter `painter.html?v=582` / **b582**). Drop the logo again, wait for "AMS colours traced", then click the chest.

Previous:
- Painter MakerDeck-style logo (`3ddb736`).

---

## 2026-08-15 Session update (Painter MakerDeck-style logo)

Latest commit: `3ddb736` — Stamp artwork as raised logo geometry, not painted triangles.

Latest local/Pi change:
- STL Painter Artwork now builds MakerDeck-style ~0.28 mm slabs on the click plane (same clear logo look as boxes/vases).
- Hard refresh (`app.js?v=672`, Painter `painter.html?v=581` / **b581**). Clear Paint, then stamp the logo again.

Previous:
- Painter stamp sharpness (`0217012`).

---

## 2026-08-15 Session update (Painter stamp sharpness)

Latest commit: `0217012` — Stop shattered logo stamps in STL Painter.

Latest local/Pi change:
- Artwork stamp auto Fine (Ultra if still coarse). Only paints faces mostly on solid logo pixels.
- Ignores anti-alias white/grey fringe; re-stamp wipes the stamp rectangle.
- Hard refresh (`app.js?v=671`, Painter `painter.html?v=580` / **b580**). Clear Paint then stamp again on the hoodie.

Previous:
- Painter PNG/JPG artwork (`f04b288`).

---

## 2026-08-15 Session update (Painter PNG/JPG artwork)

Latest commit: `f04b288` — Accept PNG/JPG artwork in STL Painter, not just SVG.

Latest local/Pi change:
- Artwork drop now takes **PNG, JPG, WebP, GIF**, plus SVG. White-background knockout for photos (toggle).
- Logo colours come from the image palette. Same click-to-stamp on the mesh.
- Hard refresh (`app.js?v=670`, Painter `painter.html?v=579` / **b579**). Backend restart not required.

Previous:
- Painter SVG artwork (`5b10ec9`).

---

## 2026-08-15 Session update (Painter SVG artwork)

Latest commit: `5b10ec9` — Stamp SVG artwork onto meshes in STL Painter.

Latest local/Pi change:
- STL Painter Paint tab: drop an SVG, set size/rotation, click the model to stamp as paint.
- SVG colours map onto AMS slots; Active slot stamps a silhouette. Ghost preview on hover.
- Hard refresh (`app.js?v=669`, Painter `painter.html?v=578` / **b578**). Backend restart not required (static only).

Previous:
- Tiered sell strategies (`751290b`).

---

## 2026-08-15 Session update (Tiered sell strategies)

Latest commit: `751290b` — Add batch, machine-hour, and value sell strategies on top of shop costing.

Latest local/Pi change:
- Settings → Costing keeps **floor** (filament + shop hours + optional labour) as true cost.
- New **Sell strategies**: Shop markup (current default), Batch (filament × 4–6), Machine-hour (filament + hours × rate), Value (filament × 10 as an art starting price). Fail buffer (default 8%) is in sell prices only. Design $/hr is a separate quote-helper line.
- Quote helper, passports, and projects show all three plus Suggested from the strategy you pick. Save costing after choosing.
- Hard refresh (`app.js?v=668`, `style.css?v=508`). Backend restart required.

Previous:
- Queue Release / Tools (`ecff7b1`).

---

## 2026-08-15 Session update (Queue Release / Tools)

Latest commit: `ecff7b1` — Add Flightdeck-only queue Release so stuck printing jobs can be cleared from the UI.

Latest local/Pi change:
- Printing/uploading queue rows now have **Release** (Queue page and Settings → Tools). Drops the Flightdeck row only — does not cancel or stop the printer. If the bay is idle, the next pending job may auto-start.
- Settings → **Tools** lists stuck jobs and flags when the printer is idle but the queue still says printing.
- Hard refresh (`app.js?v=667`, `style.css?v=507`). Backend restart required.

Previous:
- Quote-slice .gcode.3mf (`a917993`).

---

## 2026-08-15 Session update (Quote-slice .gcode.3mf)

Latest commit: `a917993` — Keep quote-slice output as .gcode.3mf and sanitize MakerWorld H2D G-code placeholders.

Latest local/Pi change:
- Docker sidecar was saving quote-slices as generic `result.3mf`, so Print Bay still showed **Slice** on the source. Output is now `{source}_{printer}.gcode.3mf`. Print Bay offers **Queue sliced** when that sibling exists (also treats leftover `result.3mf` as sliced).
- MakerWorld/H2D 3MF custom G-code: rewrite `{elsif}` / `ceil()` / `filament_map` / `old_extruder_variant` so Orca 2.4.0-alpha can slice highland cow style files.
- Hard refresh (`app.js?v=666`). Backend restart on Pi **and** Windows worker.

Previous:
- H2D G-code placeholders (`f7290ce`).

---

## 2026-08-14 Session update (H2D G-code placeholders)

Latest commit: `f7290ce` — Strip unknown H2D G-code placeholders so Docker Orca can slice MakerWorld 3MFs.

Latest local/Pi change:
- Nightly Orca (and even stable 2.4.2) still fails windowless CLI without Mesa. Slice unsliced now uses the Docker sidecar (`:3003`, Orca 2.4.0-alpha) when **Use Slicer API** is on.
- H2D machine G-code uses placeholders that alpha does not know (`cooling_filter_enabled`, `timelapse_inline_photo`, `farthest_point_timelapse_enabled`). Flightdeck treats those as false (keep `{else}` / ternary false-arm) and retries leftover unknown vars from the sidecar error.
- Friendly slicer errors skip the useless `Slic3r::CLI::run found error` footer.
- Desktop Orca is now **2.4.2** (was Nightly). Local CLI still needs a `mesa\` copy from Bambu Studio for windowless GPU; sidecar is the working path.
- Backend restart required on the Pi **and** Windows worker. Hard refresh not required (`app.js?v=665`). On highland cow hit **Slice unsliced**.

Previous:
- Multi-plate queue split (`0700b11`).

---

## 2026-08-14 Session update (Multi-plate queue split)

Latest commit: `0700b11` — Queue an all-plates `.gcode.3mf` as one job per plate.

Latest local/Pi change:
- Bambu **Export all plates** `.gcode.3mf` now enqueues **N prints** (plate 1…N), not one print of plate 1.
- Each queue row shows `Plate 3 of 8` plus that plate’s time/grams/thumbnail; send uses `Metadata/plate_N.gcode`.
- Projects file row shows `8 plates · …` when the export has more than one plate.
- Hard refresh (`app.js?v=665`). Backend restart required.

Previous:
- Project quote line items (`b026b71`).

---

## 2026-08-14 Session update (Project quote line items)

Latest commit: `b026b71` — Show filament, shop time, labour, and suggested separately on Projects.

Latest local/Pi change:
- Project quote was labelling the full floor as “shop”, so filament looked extra. Cards now split filament / shop hours / my time / suggested.
- Hard refresh (`app.js?v=664`). Backend restart required.

Previous:
- 3MF CLI sentinels (`516e8a1`).

---

## 2026-08-14 Session update (3MF CLI sentinels)

Latest commit: `516e8a1` — Strip Bambu inherit-sentinels so Orca CLI can slice MakerWorld 3MFs.

Latest local/Pi change:
- Orca CLI was failing with `Param values in 3mf/config` because Bambu writes `-1` / filament `0` inherit sentinels. Flightdeck now strips those from `project_settings.config` before slice (and retries any leftover keys from the error).
- Backend restart required. On Bully hit **Slice unsliced**.

Previous:
- Slice without dead sidecar (`dfe35b7`).

---

## 2026-08-14 Session update (Slice without dead sidecar)

Latest commit: `dfe35b7` — Quote slices use Windows Orca when the Slicer API sidecar is down.

Latest local/Pi change:
- Project auto-slice was timing out on the offline Slicer API (`:3003`). 3MF/project files now go to the Windows worker’s local Orca (`orca-slicer.exe`) and skip the sidecar unless an H2D STL/OBJ actually needs it.
- Backend restart required. On the Bully project hit **Slice unsliced**.

Previous:
- Project auto-slice (`2b1fe1a`).

---

## 2026-08-14 Session update (Project auto-slice)

Latest commit: `2b1fe1a` — Auto-slice unsliced project 3MF files for quotes.

Latest local/Pi change:
- Drop a MakerWorld / Save Project `.3mf` (or STL) into a Project: Flightdeck background-slices it with slicer defaults and writes a `.gcode.3mf` into the vault folder, then quotes grams/time.
- Pick **Slice / quote printer** on the project (or Auto matches the 3MF printer / first printer with defaults). **Slice unsliced** retries failures.
- Needs Settings → Slicer defaults + worker/API. Hard refresh (`app.js?v=663`, `style.css?v=506`). Backend restart required.

Previous:
- Overhead electric name match (`44f0f71`).

---

## 2026-08-14 Session update (Overhead electric name match)

Latest commit: `44f0f71` — Only fill the Electricity overhead from Power this month.

Latest local/Pi change:
- “Daily Network Electricity Access” was matching `electric` in the name and getting overwritten to the power $ total. Power now binds only to the dedicated Electricity line (id/name exactly Electricity).
- Hard refresh (`app.js?v=662`). Re-enter the network line amount if it already saved as the power figure.

Previous:
- Electricity from power calc (`60ff95e`).

---

## 2026-08-14 Session update (Electricity from power calc)

Latest commit: `60ff95e` — Fill Costing Electricity overhead from Power this month.

Latest local/Pi change:
- Monthly overheads **Electricity** is filled from the Power this month $ total (print hours × wiki watts × tariff). Shop rate updates live; Save costing to persist.
- Hard refresh (`app.js?v=661`, `style.css?v=505`). Backend restart optional.

Previous:
- Power this month (`f17089a`).

---

## 2026-08-14 Session update (Power this month)

Latest commit: `f17089a` — Estimate print electricity from History hours × Bambu wiki watts × tariff.

Latest local/Pi change:
- Settings → Costing: **Power this month** panel — month picker, print hours by printer, wiki avg W (material-aware when known), editable W overrides, $/kWh tariff → kWh and $.
- Does **not** dump the whole bill onto printers; shop-rate overhead “Electricity” line stays a bill share. Quotes still use shop $/hr.
- API: `GET /api/costing/power?month=YYYY-MM`. Costing settings store `electricity_rate_per_kwh` + optional `power_watts` overrides.
- Hard refresh (`app.js?v=660`, `style.css?v=504`). Backend restart required.

Previous:
- Projects delete stick (`97999f4`).

---

## 2026-08-14 Session update (Projects delete stick)

Latest commit: `97999f4` — Keep deleted Projects from coming back via orphan folder adopt.

Latest local/Pi change:
- Delete project was toasting success then immediately re-adopting the vault folder. Dismissed folders are now remembered so delete sticks; files still stay on disk.
- Hard refresh (`app.js?v=659`). Backend restart required.

Previous:
- Projects Bambu Save vs Export (`cf6bdfd`).

---

## 2026-08-14 Session update (Projects — Bambu Save vs Export)

Latest commit: `cf6bdfd` — Explain Bambu Save Project vs plate .gcode.3mf exports in Projects.

Latest local/Pi change:
- Bambu **Save Project** `.3mf` keeps plate previews but empties `slice_info` — Flightdeck now labels that clearly instead of “Not sliced yet”.
- Quotes need **Export plate data** `.gcode.3mf` files (per plate). Orphan `Projects/*` vault folders are re-linked on Projects list.
- Hard refresh (`app.js?v=658`). Backend restart required.

Previous:
- Project folders (`03ca599`).

---

## 2026-08-14 Session update (Project folders)

Latest commit: `03ca599` — Add project folders so a vault kit quotes from sliced grams and time.

Latest local/Pi change:
- New **Projects** tab: named Print Vault folder (`Projects/Summer Goose`), drop sliced plates, Flightdeck sums grams + time from 3MF/gcode.
- Quote uses Costing shop rate: filament, printer-hours (shop floor), and **elapsed** (overlap = max(longest plate, total ÷ printers)).
- PrintShelf stays the library. Hard refresh (`app.js?v=657`, `style.css?v=503`). **Backend restart required.**

Previous:
- Shop costing for local quotes (`3db4475`).

---

## 2026-08-14 Session update (Shop costing for local quotes)

Latest commit: `3db4475` — Add shop costing so local quotes cover overhead without a full labour rate.

Latest local/Pi change:
- Settings → **Costing**: monthly overheads (Bambu, electricity, other), expected print hours (prefill from last 30 days), markup %, optional “my time” $/hr (default $0).
- Derived **shop rate** = monthly ÷ hours. Quote helper: grams + hours → filament / time / floor / suggested.
- Passports and Print Memory show **filament / time / floor / suggested**. Filament `total_cost` is unchanged so old numbers don’t lie.
- Hard refresh (`app.js?v=656`, `style.css?v=502`). **Backend restart required.**

Previous:
- Flight Recorder Windows lockup (`68f3635`).

---

## 2026-08-13 Session update (Flight Recorder — Windows lockup)

Latest commit: `68f3635` — Don't auto-decode Bambu clips in Flight Recorder

Latest local/Pi change:
- Opening a print passport auto-loaded the Flight Recorder video (`preload=metadata`). Bambu harvested MP4s keep `moov` at the **end**, so the browser downloads the whole clip and hardware-decodes it immediately — that can freeze/crash Windows (GPU TDR).
- Videos now `preload="none"` (click play to load), previous clip is aborted when switching prints, and new harvests/uploads are remuxed with faststart.
- Hard refresh (`app.js?v=655`). Backend restart required.

Previous:
- Painter Flip + Chop socket seating (`482d294`).

---

## 2026-08-13 Session update (Painter — Flip + Chop socket seating)

Latest commit: `482d294` — Painter Flip; seat on cut face not socket

Latest local/Pi change:
- Chop connector sockets were fooling Painter's "lay on bed" heuristic (minY = pocket floor → Trix sat on her snout). Now scores the dominant flat instead.
- **Flip** / Spin 90° / Roll 90° in Painter (toolbar + Model tab) so you can turn a model over.
- Hard refresh (`app.js?v=654`, Painter **b577** / `painter.html?v=577`). Reload Trix if she is already open.

Previous:
- Chop Flexi range + own menu (`f654a16`).

---

## 2026-08-13 Session update (Chop — Flexi range + own menu)

Latest commit: `f654a16` — Chop Flexi Cut 256 planes; own sidebar tab

Latest local/Pi change:
- Flexi Cut plane count max **64 → 256**; adjust-plane slider is 10× finer (full piece length).
- **Chop** is now its own Flightdeck sidebar tab (`#/chop`), same iframe pattern as STL Painter. Still reachable from MakerDeck too.
- Hard refresh (`app.js?v=653` / `style.css?v=501`). Chop HTML is served fresh on first open of the tab.

Previous:
- Vinyl — drop Taskbar, playlist in Small (`59393e0`).

---

## 2026-08-12 Session update (Vinyl — drop Taskbar, playlist in Small)

Latest commit: `59393e0` — Remove Taskbar; + Playlist in Small player

Latest local/Mora change:
- Removed Taskbar mode (worth a shot; can’t embed in the OS bar).
- Small player keeps **SPIN** and now has **+ Playlist** beside it.
- Hard refresh / reopen Cindy. Rebuild `vinyl` on Mora.

Previous:
- Taskbar layout attempts.

---

## 2026-08-12 Session update (Vinyl — Taskbar layout fix)

Latest commit: `0a8b7f6` — Taskbar fills window as one row

Latest local/Mora change:
- Taskbar mode was leaving a huge empty grey slab (ribbon CSS pinned the bar to the bottom).
- Now fills the compact window as a single strip; also stops the ≤700px wrap stacking.
- Hard refresh / reopen Cindy. Rebuild `vinyl` on Mora.

Previous:
- Dock above OS taskbar (`81794a0`).

---

## 2026-08-12 Session update (Vinyl — Taskbar above OS bar)

Latest commit: `81794a0` — Dock compact modes above Windows taskbar

Latest local/Mora change:
- Taskbar/Small player now re-measure `outerHeight` and sit **above** the Windows taskbar (was sliding underneath).
- Hard refresh / reopen Cindy. Rebuild `vinyl` on Mora.

Previous:
- Taskbar mode (`5fdd075`).

---

## 2026-08-12 Session update (Vinyl — Taskbar mode)

Latest commit: `5fdd075` — Third chrome mode: Taskbar strip

Latest local/Mora change:
- Header **Taskbar** (and ⋯ / Small→Taskbar chip) docks an ultra-slim strip (~560×92).
- Taskbar keeps art, title, prev/play/next, **Small**, **ROOM**.
- Modes: vinyl room → Small player → Taskbar.
- Hard refresh / reopen Cindy. Rebuild `vinyl` on Mora.

Previous:
- Small player button (`9c657e6`).

---

## 2026-08-12 Session update (Vinyl — Small player button)

Latest commit: `9c657e6` — Named Small player size (680×210)

Latest local/Mora change:
- Header **Small player** button (and ⋯ menu) opens the compact player at the size Chris liked.
- **ROOM** still restores the full vinyl room.
- Hard refresh / reopen Cindy. Rebuild `vinyl` on Mora.

Previous:
- ROOM restore + shuffle/norm (`cc5dca5`).

---

## 2026-08-12 Session update (Vinyl — ROOM restore + ribbon controls)

Latest commit: `cc5dca5` — ROOM opens vinyl room; keep shuffle/norm on ribbon

Latest local/Mora change:
- **ROOM** (not Windows maximise) opens a clean large vinyl-room window.
- Windows maximise while ribboned is redirected through the same ROOM restore.
- Shuffle + loudness normalise stay on the slim ribbon bar.
- Hard refresh / reopen Cindy. Rebuild `vinyl` on Mora.

Previous:
- Ribbon SPIN visibility (`af924d2`).

---

## 2026-08-12 Session update (Vinyl — ribbon SPIN actually shows)

Latest commit: `af924d2` — SPIN/ROOM always on slim bar; fix ribbon race

Latest local/Mora change:
- SPIN + ROOM show whenever the window is short (not only when `.ribbon` class sticks).
- Entering ribbon no longer immediately auto-exits (race with resizeTo).
- ROOM restores a tall window so the vinyl room can come back.
- Hard refresh / reopen the installed Cindy app. Rebuild `vinyl` on Mora.

Previous:
- Ribbon SPIN attempt (`d039444`).

---

## 2026-08-12 Session update (Vinyl — ribbon fixes)

Latest commit: `d039444` — Ribbon SPIN + auto-restore on maximise

Latest local/Mora change:
- Ribbon bar now has **SPIN** (random sleeve) and **▴ Room** to browse crates.
- Maximising / expanding the window auto-restores the full vinyl room (no more gray “Playing in the ribbon” stuck state).
- Hard refresh Vinyl. Rebuild `vinyl` on Mora.

Previous:
- Ribbon mode first pass (`7e0e694`).

---

## 2026-08-12 Session update (Vinyl — minimise to ribbon)

Latest commit: `7e0e694` — Cindy Vinyl ribbon / windowshade mode

Latest local/Mora change:
- **▬** in the header (and ⋯ → Minimise to ribbon) collapses the vinyl room to a slim now-playing bar. ▴ or Escape restores.
- Installed PWA: tries to shrink the window and dock it to the bottom of the screen.
- Browser (Edge/Chrome): uses a floating always-on-top ribbon when Document Picture-in-Picture is available.
- Hard refresh Vinyl (`http://192.168.4.77:4541`). Rebuild `vinyl` on Mora.

Previous:
- Chop part-number offset (`fe47d5f`).

---

## 2026-08-12 Session update (Chop — part # away from connectors)

Latest commit: `pending` — Stamp part numbers in a corner, not on the peg

Latest local/Pi change:
- Auto-finish was engraving huge centered part numbers on the same cut face as the connector → jagged boolean junk.
- Numbers are now small and in a **corner**; skipped if the face is too small to host both.
- Hard refresh Chop (`mesh-cut.js?v=24`). Recut (or undo + recut) to clear existing artifacts.

Previous:
- Chop UI flow (`c618353`).

---

## 2026-08-12 Session update (Chop — tidy sidebar, finish by default)

Latest commit: `c618353` — Chop UI flow + connectors/part # after every cut

Latest local/Pi change:
- Sidebar is now **Load → Setup → Cut → Finish → Pieces** instead of a pile of add-on panels.
- **Connectors** and **Part numbers** are on by default and run automatically after Commit Cut / Auto-Chop. Uncheck to skip; “Apply to current pieces” re-runs on an existing cut.
- Hard refresh Chop (`mesh-cut.js?v=23`).

Previous:
- Thickness-capped pegs / merge strips connectors (`2bb01b4`).

---

## 2026-08-12 Session update (Chop — merge strips connectors / no punch-through)

Latest commit: `2bb01b4` — Thickness-capped pegs; merge removes internal connectors

Latest local/Pi change:
- Thin neck/shell joints were getting pegs that punched through; merge kept that geometry.
- Connector depth now capped at **40% of wall thickness** (skip if wall &lt; 8 mm).
- **Merge Selected** strips any connector that sat between the pieces you merge.
- Hard refresh Chop (`mesh-cut.js?v=22`). Undo connectors, re-add, then merge — or merge now to strip the poking peg.

Previous:
- Catch missing joints (`5e5fbce`).

---

## 2026-08-12 Session update (Chop — catch missing joints)

Latest commit: `5e5fbce` — Detect staggered cut faces; lower tiny-face skip to 22mm

Latest local/Pi change:
- Some joints got no connectors: adjacency only matched near-identical scars (missed staggered/partial overlaps), and the 40mm skip was too aggressive.
- `findAdjacentPieces` now uses UV AABB overlap + slightly looser normal/plane tolerances.
- Tiny-face glue-only threshold lowered to **22 mm**; mid faces still get small pegs.
- Hard refresh Chop (`mesh-cut.js?v=21`). Undo + Add Connectors again.

Previous:
- Skip tiny-face connectors (`9de77f1`).

---

## 2026-08-12 Session update (Chop — skip connectors on tiny faces)

Latest commit: `9de77f1` — Skip connectors on faces under 40mm

Latest local/Pi change:
- Ear-tip / sliver joints still got pegs that swallowed the piece.
- Add Connectors now skips interfaces where the shared face min-dim is **&lt; 40 mm** (glue only); status reports how many were skipped.
- Hard refresh Chop (`mesh-cut.js?v=20`). Tiny pieces can still be **Merge Selected** into a neighbour if you don't want them separate.

Previous:
- Connector 30×18 cap (`9446912`).

---

## 2026-08-12 Session update (Chop — connectors smaller again)

Latest commit: `9446912` — Lower connector cap to 30×18 mm

Latest local/Pi change:
- Neck/rump pegs still looked brick-like at 55mm/40mm depth.
- Cap now **30 mm** wide, depth **≤18 mm** (0.6× width); face ratio 40%→12%.
- Hard refresh Chop (`mesh-cut.js?v=19`). Undo + Add Connectors on a clean cut.

Previous:
- Connector size cap 55mm (`9d5f003`).

---

## 2026-08-12 Session update (Chop — LuBan connectors, smaller)

Latest commit: `9d5f003` — Cap connector size / depth so pegs aren't bricks

Latest local/Pi change:
- After LuBan single-connector pass, life-size faces still got oversized pegs (up to ~35% of face, depth 1.5× width).
- Now: width blends 55%→18% of face min-dim, **hard cap 55 mm**; depth = min(0.75×width, 40 mm).
- Hard refresh Chop (`mesh-cut.js?v=18`). Undo + Add Connectors again on a clean cut.

Previous:
- LuBan single connectors (`1a994e3`).

---

## 2026-08-12 Session update (Chop — LuBan-style single connectors)

Latest commit: `1a994e3` — One proportional connector per joint (LuBan-style)

Latest local/Pi change:
- **Problem:** Add Connectors tiled a dense grid of tiny pegs (~12 mm cap) across every cut face — unprintable on life-size Trixie pieces vs LuBan’s single large interlocking peg.
- **Fix:** One centred peg/socket per shared interface; width scales with face size (~85% of min dim on small faces, ~35% on large). Shrinks to fit organic cut boundaries.
- Files: `makerforge/js/mesh-cut.js`, `makerforge/chop.html` (`mesh-cut.js?v=17`), `makerforge/test/chop-manifold.mjs`.
- Hard refresh Chop. UI-only static — pull required; restart optional.
- Verified: `chop-manifold.mjs` — all 203 checks passed.

Previous:
- Cindy Vinyl post-outage recovery (`35157e2`).

---

## 2026-08-08 Session update (Cindy Vinyl — post-power-outage recovery)

Latest commit: `35157e2` — Fix Mora vinyl mounts after Cindy NAS offline / reboot

Latest Mora change:
- **Root cause:** power outage → Cindy NAS off → Mora lost `/share/{Cindy,Checked,Jamal}` remote mounts → `cindy-navidrome` exited; vinyl health/covers/stream failed.
- **Fix:** Navidrome compose now bind-mounts `/volume2/cindy-vinyl/mounts/{Cindy,Checked,Jamal}` (stable SSD paths). New `jukebox/scripts/mount-cindy-on-mora.sh` CIFS-mounts Cindy when it's back online.
- **Deployed on Mora:** Navidrome restarted; `/api/health` ok, random album 200. **Playback needs Cindy NAS powered on** + run mount script.
- When Cindy is back: on Mora (sudo) `cd /volume2/cindy-vinyl/compose && sh mount-cindy-on-mora.sh && sh build-mora-library-view.sh && docker compose -f docker-compose.mora.yml restart navidrome`
- LAN: `http://192.168.4.77:4541` — no app.js bump (infra only).

Previous:
- Vinyl — add to playlist from crates/Stacks (`6cd9885`).

---

## 2026-08-04 Session update (MakerDeck — new Chop plane-cutting tool)

Latest local/Pi change:
- New MakerDeck tool **Chop** (`/makerdeck/chop.html`): load STL/OBJ → scale to a target size → straight/angled plane cuts → per-piece STL export, with a bed-fit pill sourced from `printers.yaml` build volumes.
- From-scratch plane-cutting core (`makerforge/js/mesh-cut.js`) — no CSG existed in the repo before. Verified watertight via new `makerforge/test/chop-manifold.mjs` (axis-aligned / angled / vertex-through / multi-loop / chained cuts, all 0 open edges) and a scripted headless-Chrome pass.
- New STL+OBJ loaders (`makerforge/js/mesh-import.js`), new `GET /api/printers/bed-sizes` endpoint.
- Connectors (pegs/sockets) and part-number stamping intentionally deferred to a follow-up session — this is Phase 1 only.
- **Backend restart required** (new API route).
- MakerDeck session notes → [makerforge/SESSION_NEXT.md](makerforge/SESSION_NEXT.md)

Previous:
- Vinyl — add to playlist from crates/Stacks (`6cd9885`).

---

## 2026-08-04 Session update (Vinyl — add to playlist from crates/Stacks)

Latest commit: `6cd9885` — Add albums/tracks from crates & Stacks to playlist

Latest Mora change:
- Sleeve ⋯ on crates + Found in the stacks albums: **Add album to playlist**.
- Stacks track tiles ⋯: **Add to playlist**.
- Reuses existing playlist APIs; no new crates.
- Also ships `python-multipart` (cover upload Form routes).
- Mora compose host port is **4541 only** (Tailscale serve owns 4540).
- Hard refresh Vinyl (`http://192.168.4.77:4541`).

Previous:
- H-series unload path-skip (`0caaa79`).

---

## 2026-08-03 Session update (H-series unload — drop path skip)

Latest commit: `0caaa79` — Always unload low-temp before H-series high-temp jobs

Latest local/Pi change:
- BigBoy test (job #243): ASA on left metadata + PETG on AMS HT skipped unload because of H2D “other path” logic.
- Removed that skip — any low-temp at `tray_now` before a high-temp queue job now auto-unloads.
- **Backend restart required**.

Previous:
- H-series unload gate (`6653256`).

---

## 2026-08-03 Session update (H-series high-temp nozzle unload)

Latest commit: `6653256` — Auto-unload low-temp before H-series high-temp queue jobs

Latest local/Pi change:
- On **H-series** queue dispatch: if the job needs high-temp (ABS/ASA/PA/PC/…) and AMS `tray_now` still shows low-temp (PLA/PETG/TPU/…) at the nozzle, Flightdeck **auto-unloads**, waits until clear (up to 5 min), then starts the print.
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
