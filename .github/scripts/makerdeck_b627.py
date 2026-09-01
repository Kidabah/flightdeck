from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{path}: expected one match, found {n}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

# b626 correctly marked deboss-inlay as export-grade, but buildEmbossText still
# only used the closed solid builder for hoodie art. Route every export-grade
# label through the closed solid path. The fallback vector path deliberately
# caps only the top and is preview geometry, which is why COFFEE reported
# thousands of open edges.
replace_once(
    "makerforge/js/features.js",
    '  if (isHoodieArtParams(params)) {\n    const solid = buildFlatShapeGroupsSolidMesh(collected.frame, collected.shapeGroups, d0, d1, params);\n    if (solid?.indices?.length) return solid;\n  }',
    '  if (isHoodieArtParams(params) || isLabelExport(params)) {\n    const solid = buildFlatShapeGroupsSolidMesh(collected.frame, collected.shapeGroups, d0, d1, params);\n    if (solid?.indices?.length) return solid;\n  }',
)

replace_once("makerforge/js/app.js", 'const MAKERDECK_BUILD = "b626";', 'const MAKERDECK_BUILD = "b627";')
replace_once("makerforge/js/app.js", 'from "./geometry.js?v=626";', 'from "./geometry.js?v=627";')
replace_once("makerforge/js/app.js", 'from "./features.js?v=626";', 'from "./features.js?v=627";')
replace_once("makerforge/js/geometry.js", 'from "./features.js?v=626";', 'from "./features.js?v=627";')
replace_once("makerforge/index.html", 'src="js/app.js?v=626"', 'src="js/app.js?v=627"')

p = Path("makerforge/SESSION_NEXT.md")
text = p.read_text(encoding="utf-8")
marker = "# MakerDeck SESSION_NEXT (active)\n"
entry = '''\n## b627 — Close deboss Text inlay solids\n**Date:** 2026-09-01\n\n### MakerDeck\n- Fixes the second `COFFEE` deboss export failure (3100 open edges on Text inlay).\n- Root cause isolated: b626 marked deboss inlays as export-grade, but `buildEmbossText()` still sent them through its preview vector fallback, which caps only the visible/top face. That guarantees an open mesh.\n- Export-grade text, including `deboss-inlay`, now uses `buildFlatShapeGroupsSolidMesh()` so every glyph gets a fully closed printable solid. Preview-only vector emboss remains unchanged.\n- Build/cache: MakerDeck `b627`, `geometry.js?v=627`, `features.js?v=627`, `app.js?v=627`.\n\n### Validation / next physical gate\n- JS syntax + full MakerDeck regression suite pass before commit. Source guard confirms export-grade labels use the closed solid builder.\n- Next: re-export the exact same `COFFEE` design. Text inlay must report zero open/non-manifold edges before Bambu Studio inspection.\n\n'''
if marker not in text:
    raise SystemExit("SESSION_NEXT heading missing")
p.write_text(text.replace(marker, marker + entry, 1), encoding="utf-8")
