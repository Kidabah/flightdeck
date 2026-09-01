from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{path}: expected one match, found {n}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

# b627 closed the positive inlay, but body subtraction still fed Manifold the
# preview-grade deboss cutter. Route BOTH deboss solids through export-grade
# watertight builders so manifold-3d gets a valid cutter.
replace_once(
    "makerforge/js/features.js",
    'function isLabelExport(params) {\n  return !!params?.__labelExportStandoff || params?.__embossMode === "deboss-inlay";\n}',
    'function isLabelExport(params) {\n  return !!params?.__labelExportStandoff\n    || params?.__embossMode === "deboss-inlay"\n    || params?.__embossMode === "deboss-cutter";\n}',
)

replace_once("makerforge/js/app.js", 'const MAKERDECK_BUILD = "b627";', 'const MAKERDECK_BUILD = "b628";')
replace_once("makerforge/js/app.js", 'from "./geometry.js?v=627";', 'from "./geometry.js?v=628";')
replace_once("makerforge/js/app.js", 'from "./features.js?v=627";', 'from "./features.js?v=628";')
replace_once("makerforge/js/geometry.js", 'from "./features.js?v=627";', 'from "./features.js?v=628";')
replace_once("makerforge/index.html", 'src="js/app.js?v=627"', 'src="js/app.js?v=628"')

p = Path("makerforge/SESSION_NEXT.md")
text = p.read_text(encoding="utf-8")
marker = "# MakerDeck SESSION_NEXT (active)\n"
entry = '''\n## b628 — Deboss cutter manifold fix\n**Date:** 2026-09-01\n\n### MakerDeck\n- Fixes b627 export failure: `Not a valid manifold mesh (Not manifold) — repair it in Mesh Prep first.`\n- Root cause: b627 made the positive `Text inlay` watertight, but the hidden `deboss-cutter` used for body subtraction was still built by the preview extrusion path and was open. `subtractMesh()` correctly rejected that cutter before creating the 3MF.\n- Both `deboss-inlay` and `deboss-cutter` now route through MakerDeck's export-grade closed-solid builders. Pocket/inlay dimensions are unchanged.\n- Build/cache: MakerDeck `b628`, `geometry.js?v=628`, `features.js?v=628`, `app.js?v=628`.\n\n### Validation / next physical gate\n- Runner checks JS syntax, full MakerDeck regression suite, and verifies both deboss modes are classified as export-grade solids.\n- Next: re-export the same `COFFEE` test. Expected: no manifold warning and no Mesh Prep error; then inspect Body + Text inlay in Bambu Studio.\n\n'''
if marker not in text:
    raise SystemExit("SESSION_NEXT heading missing")
p.write_text(text.replace(marker, marker + entry, 1), encoding="utf-8")
