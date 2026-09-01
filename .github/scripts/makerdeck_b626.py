from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{path}: expected one match, found {n}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# b625 built preview-grade vector text for the inlay. That path is not guaranteed
# watertight. Mark deboss inlay as an export-grade label so the existing voxel/solid
# builders are used for text/art while retaining the deboss depth mode.
replace_once(
    "makerforge/js/features.js",
    'function isLabelExport(params) {\n  return !!params?.__labelExportStandoff;\n}',
    'function isLabelExport(params) {\n  return !!params?.__labelExportStandoff || params?.__embossMode === "deboss-inlay";\n}',
)

replace_once("makerforge/js/app.js", 'const MAKERDECK_BUILD = "b625";', 'const MAKERDECK_BUILD = "b626";')
replace_once("makerforge/js/app.js", 'from "./geometry.js?v=625";', 'from "./geometry.js?v=626";')
replace_once("makerforge/js/app.js", 'from "./features.js?v=625";', 'from "./features.js?v=626";')
replace_once("makerforge/js/geometry.js", 'from "./features.js?v=625";', 'from "./features.js?v=626";')
replace_once("makerforge/index.html", 'src="js/app.js?v=625"', 'src="js/app.js?v=626"')

p = Path("makerforge/SESSION_NEXT.md")
text = p.read_text(encoding="utf-8")
marker = "# MakerDeck SESSION_NEXT (active)\n"
entry = '''\n## b626 — Deboss inlay manifold export fix\n**Date:** 2026-09-01\n\n### MakerDeck\n- Fixes b625 export warning where `Text inlay` could report thousands of open edges (observed: 2915 on `COFFEE`).\n- Root cause: b625 correctly introduced `deboss-inlay` depth, but generated the positive inlay through the preview vector extrusion path. Deboss inlays now count as export-grade labels, so text uses the existing watertight solid/voxel export builder and art uses the corresponding closed export slab path.\n- Pocket geometry is unchanged: coloured inlay fills from the pocket floor to the original outside surface; cutter remains 0.05 mm deeper for clean body subtraction.\n- Build/cache: MakerDeck `b626`, `geometry.js?v=626`, `features.js?v=626`, `app.js?v=626`.\n\n### Validation / next physical gate\n- Runner checks JS syntax, full MakerDeck regression suite, and verifies `deboss-inlay` is routed through `isLabelExport`.\n- Next: re-export the same `COFFEE` design. Manifold check must no longer flag `Text inlay`; then inspect Body + Text inlay in Bambu Studio before printing.\n\n'''
if marker not in text:
    raise SystemExit("SESSION_NEXT heading missing")
p.write_text(text.replace(marker, marker + entry, 1), encoding="utf-8")
