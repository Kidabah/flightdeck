from pathlib import Path

# One-time patch: Stage 3C must not compare truncated lower-bound intersection totals.
p = Path('makerforge/meshprep.html')
s = p.read_text(encoding='utf-8')
old = "    if ((after.intersections?.triangleIntersections || 0) > (before.intersections?.triangleIntersections || 0)) throw new Error('proven intersections increased');\n\n    currentParsed = { positions: repaired.positions, nTri: repaired.nTri };"
new = "\n".join([
    "    // Intersection totals are not directly comparable when either analysis hit the",
    "    // Stage 3A safety budget: each value is only a proven lower bound and the",
    "    // traversal order changes after a shell is removed. Compare totals only when",
    "    // both analyses completed within budget.",
    "    const beforeIx = before.intersections || {};",
    "    const afterIx = after.intersections || {};",
    "    if (!beforeIx.truncated && !afterIx.truncated &&",
    "        (afterIx.triangleIntersections || 0) > (beforeIx.triangleIntersections || 0)) {",
    "      throw new Error('proven intersections increased');",
    "    }",
    "",
    "    currentParsed = { positions: repaired.positions, nTri: repaired.nTri };",
])
if old not in s:
    raise SystemExit('Stage 3C intersection safety gate anchor not found')
s = s.replace(old, new, 1)
s = s.replace("./js/sanitiser-core.js?v=10", "./js/sanitiser-core.js?v=11", 1)
p.write_text(s, encoding='utf-8')
