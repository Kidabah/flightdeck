from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{path}: expected one match, found {n}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# A deboss inlay is a positive printable solid occupying the pocket, not raised emboss.
replace_once(
    "makerforge/js/features.js",
    '  if (params.__embossMode === "deboss-cutter") {\n    // Slicer-facing cutter STL: pokes 0.4mm past the surface and sinks (depth + 0.05)mm inward\n    // so the boolean subtract is clean at the outer skin.\n    return { d0: -depth - 0.05, d1: 0.4, depth, deboss: true };\n  }',
    '  if (params.__embossMode === "deboss-inlay") {\n    // Printable colour body: fill the pocket from its floor to the original outside surface.\n    return { d0: -depth, d1: 0, depth, deboss: true };\n  }\n  if (params.__embossMode === "deboss-cutter") {\n    // Boolean cutter reaches slightly beyond both ends for a clean subtraction.\n    return { d0: -depth - 0.05, d1: 0.4, depth, deboss: true };\n  }',
)

replace_once("makerforge/js/geometry.js", 'from "./features.js?v=600";', 'from "./features.js?v=625";')

# Main container deboss: keep cutter, but build printable text/art with the inlay depth mode.
replace_once(
    "makerforge/js/geometry.js",
    '      if (params.embossDeboss) {\n        labelMesh = buildLabelEmboss(artMeta, params, params.embossSvgText || "", "emboss");\n        if (labelMesh) centerPositions(labelMesh.positions, 0, 0);\n        debossCutterMesh = buildLabelEmboss(artMeta, params, params.embossSvgText || "", "deboss-cutter");\n        if (debossCutterMesh) centerPositions(debossCutterMesh.positions, 0, 0);\n        mesh = shellMesh;\n      } else {',
    '      if (params.embossDeboss) {\n        const parts = buildLabelEmbossParts(artMeta, params, params.embossSvgText || "", "deboss-inlay");\n        labelMesh = parts.text;\n        graphicMesh = parts.graphic;\n        graphicColourParts = parts.graphicColourParts || null;\n        if (labelMesh) centerPositions(labelMesh.positions, 0, 0);\n        if (graphicMesh) centerPositions(graphicMesh.positions, 0, 0);\n        if (graphicColourParts?.length) for (const cp of graphicColourParts) centerPositions(cp.mesh.positions, 0, 0);\n        debossCutterMesh = buildLabelEmboss(artMeta, params, params.embossSvgText || "", "deboss-cutter");\n        if (debossCutterMesh) centerPositions(debossCutterMesh.positions, 0, 0);\n        mesh = shellMesh;\n      } else {',
)

# Lid path gets matching inlay solids too. The existing lid exporter can consume them later.
replace_once(
    "makerforge/js/geometry.js",
    '    if (params.embossDeboss) {\n      labelMesh = buildLabelEmboss(resolved.meta, params, params.embossSvgText || "", "emboss");\n      if (labelMesh) centerPositions(labelMesh.positions, 0, 0);\n      debossCutterMesh = buildLabelEmboss(resolved.meta, params, params.embossSvgText || "", "deboss-cutter");\n      if (debossCutterMesh) centerPositions(debossCutterMesh.positions, 0, 0);\n      lid = shellLid;\n    } else {',
    '    if (params.embossDeboss) {\n      const parts = buildLabelEmbossParts(resolved.meta, params, params.embossSvgText || "", "deboss-inlay");\n      labelMesh = parts.text;\n      graphicMesh = parts.graphic;\n      graphicColourParts = parts.graphicColourParts || null;\n      if (labelMesh) centerPositions(labelMesh.positions, 0, 0);\n      if (graphicMesh) centerPositions(graphicMesh.positions, 0, 0);\n      if (graphicColourParts?.length) for (const cp of graphicColourParts) centerPositions(cp.mesh.positions, 0, 0);\n      debossCutterMesh = buildLabelEmboss(resolved.meta, params, params.embossSvgText || "", "deboss-cutter");\n      if (debossCutterMesh) centerPositions(debossCutterMesh.positions, 0, 0);\n      lid = shellLid;\n    } else {',
)

replace_once("makerforge/js/app.js", 'from "./geometry.js?v=623";', 'from "./geometry.js?v=625";')
replace_once("makerforge/js/app.js", 'from "./features.js?v=623";', 'from "./features.js?v=625";')
replace_once("makerforge/js/app.js", 'const MAKERDECK_BUILD = "b624";', 'const MAKERDECK_BUILD = "b625";')

# Deboss preview now shows the actual printable coloured text inlay.
replace_once(
    "makerforge/js/app.js",
    '  if (state.embossDeboss) {\n    const cutter = state.embossFace === "lid"\n      ? lidCache?.debossCutterMesh\n      : meshCache?.debossCutterMesh;\n    if (cutter) {\n      const cutterGeom = toBufferGeometry(THREE, cutter);\n      attachLabelPreviewMesh(cutterGeom, debossPreviewMaterial, params);\n    }\n  } else {',
    '  if (state.embossDeboss) {\n    labelMaterial.color.set(state.embossTextColor || "#f8fafc");\n    applyFilamentMaterial(labelMaterial);\n    const cache = state.embossFace === "lid" ? lidCache : meshCache;\n    if (cache?.labelMesh) attachLabelPreviewMesh(toBufferGeometry(THREE, cache.labelMesh), labelMaterial, params);\n  } else {',
)

# Deboss exports Body + positive inlay. Body is carved in buildBody3mfExport below.
replace_once(
    "makerforge/js/app.js",
    '  if (separateColor && (params.embossFace || "front") !== "lid") {\n    // Separate Body / Art / Text — each part gets its own filament slot (merged AMS broke Bambu colours).',
    '  if (state.embossDeboss && (params.embossFace || "front") !== "lid") {\n    const boxShell = exportCache.boxShell || exportCache.shellMesh || exportCache;\n    const bodyClean = prepareMeshFor3mf({ positions: boxShell.positions.slice(), indices: boxShell.indices.slice() });\n    if (bodyClean?.indices?.length) parts.push({ name: "Body", mesh: bodyClean, color: state.boxColor || "#38bdf8", extruder: extruder++, filamentPreset: state.canisterFilamentPreset || "" });\n    for (const cp of exportCache.graphicColourParts || []) {\n      const cm = cp.mesh ? prepareMeshFor3mf(cp.mesh) : null;\n      if (cm?.indices?.length) parts.push({ name: `${cp.name || "Art"} inlay`, mesh: cm, color: cp.color, extruder: extruder++ });\n    }\n    if (!exportCache.graphicColourParts?.length && exportCache.graphicMesh) {\n      const art = prepareMeshFor3mf(exportCache.graphicMesh);\n      if (art?.indices?.length) parts.push({ name: "Art inlay", mesh: art, color: state.embossArtColor || "#4a3728", extruder: extruder++ });\n    }\n    if (exportCache.labelMesh) {\n      const text = prepareMeshFor3mf(exportCache.labelMesh);\n      if (text?.indices?.length) parts.push({ name: "Text inlay", mesh: text, color: state.embossTextColor || "#f8fafc", extruder: extruder++ });\n    }\n  } else if (separateColor && (params.embossFace || "front") !== "lid") {\n    // Separate Body / Art / Text — each part gets its own filament slot (merged AMS broke Bambu colours).',
)

# Remove native negative part. It would also subtract the positive inlay in Bambu Studio.
replace_once(
    "makerforge/js/app.js",
    '  if (state.embossDeboss && params.embossFace !== "lid" && exportCache.debossCutterMesh) {\n    const cutterClean = prepareMeshFor3mf(exportCache.debossCutterMesh);\n    if (cutterClean?.indices?.length) {\n      parts.push({\n        name: "Deboss (negative)",\n        mesh: cutterClean,\n        color: state.boxColor || "#38bdf8",\n        extruder: 1,\n        subtype: "negative_part",\n      });\n    }\n  }\n\n  return parts;',
    '  return parts;',
)

# Carve the pocket into Body before 3MF packing, then leave Text/Art as normal coloured parts.
replace_once(
    "makerforge/js/app.js",
    'async function buildBody3mfExport(exportCache, parts) {\n  const projectName = baseModelName(exportCache.meta);\n  const exportParts = state.shape === "stubbyHolder"\n    ? await prepareHoodieExportParts(parts)\n    : parts;',
    'async function carveDebossPocketIntoBody(parts, exportCache) {\n  if (!state.embossDeboss || (buildParams().embossFace || "front") === "lid" || !exportCache?.debossCutterMesh) return parts;\n  const bodyIndex = parts.findIndex((part) => part.name === "Body" || part.name === "Back");\n  if (bodyIndex < 0) return parts;\n  const { subtractMesh } = await import("./mesh-cut.js?v=24");\n  const carved = await subtractMesh(parts[bodyIndex].mesh, exportCache.debossCutterMesh);\n  const clean = carved ? prepareMeshFor3mf(carved) : null;\n  if (!clean?.indices?.length) throw new Error("Deboss pocket boolean returned no printable body.");\n  const next = parts.slice();\n  next[bodyIndex] = { ...next[bodyIndex], mesh: clean };\n  return next;\n}\n\nasync function buildBody3mfExport(exportCache, parts) {\n  const projectName = baseModelName(exportCache.meta);\n  const pocketParts = await carveDebossPocketIntoBody(parts, exportCache);\n  const exportParts = state.shape === "stubbyHolder"\n    ? await prepareHoodieExportParts(pocketParts)\n    : pocketParts;',
)

replace_once(
    "makerforge/index.html",
    'Red preview shows the subtracting volume. <strong>3MF project</strong> exports it as a native negative part automatically. <em>STL deboss cutter</em> remains available for manual workflows.',
    '<strong>3MF project</strong> carves a shallow pocket into the body and fills it with separate coloured text/art geometry. The inlay finishes flush with the surface, so no manual painting is required. <em>STL deboss cutter</em> remains available for manual workflows.',
)
replace_once("makerforge/index.html", 'src="js/app.js?v=624"', 'src="js/app.js?v=625"')

p = Path("makerforge/SESSION_NEXT.md")
text = p.read_text(encoding="utf-8")
marker = "# MakerDeck SESSION_NEXT (active)\n"
entry = '''\n## b625 — Deboss pocket + printable colour inlay\n**Date:** 2026-09-01\n\n### MakerDeck\n- Deboss 3MF boolean-carves the selected cutter from Body before packaging, then exports matching closed text/art inlay bodies in their selected filament colours. A Bambu native negative part is no longer left overlapping the printable inlay.\n- Inlay depth follows Deboss depth and finishes flush with the original outside surface. The cutter reaches 0.05 mm deeper for a clean pocket floor.\n- Preview shows the printable coloured text inlay instead of the red cutter. Standalone **STL deboss cutter** remains available.\n- Build/cache: MakerDeck `b625`, `geometry.js?v=625`, `features.js?v=625`, `app.js?v=625`.\n\n### Validation / next physical gate\n- Patch runner performs JS syntax checks plus the full MakerDeck geometry regression suite before committing.\n- Next: export Deboss `COFFEE`, open the 3MF in Bambu Studio, confirm Body + Text inlay are separate filament parts and slice flush, then print the small test.\n\n'''
if marker not in text:
    raise SystemExit("SESSION_NEXT heading missing")
p.write_text(text.replace(marker, marker + entry, 1), encoding="utf-8")
