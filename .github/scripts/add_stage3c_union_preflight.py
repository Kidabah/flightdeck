from pathlib import Path

core = Path('makerforge/js/sanitiser-core.js')
s = core.read_text(encoding='utf-8')
old = '''  const intersections = analyseShellIntersections(
    positions, nTri, faceShellIds, shellFaceCounts, maxDim, avgEdge
  );

  // Stage 3A evidence feeds back into Stage 2A diagnosis, but never into
'''
new = '''  const intersections = analyseShellIntersections(
    positions, nTri, faceShellIds, shellFaceCounts, maxDim, avgEdge
  );

  // Stage 3C union preflight is deliberately shell-local. A whole STL may have
  // thousands of open edges while a particular intersecting pair is still made
  // from two valid closed solids. Count topology defects for each connected shell
  // so boolean-union eligibility is based on the actual pair, not the whole file.
  const shellTopology = Array.from({ length: shells }, () => ({ openEdges: 0, nonManifoldEdges: 0 }));
  for (const edge of edgeMap.values()) {
    if (!edge.faces?.length) continue;
    if (edge.count === 1) {
      const sid = faceShellIds[edge.faces[0]];
      if (sid >= 0 && shellTopology[sid]) shellTopology[sid].openEdges++;
    } else if (edge.count > 2) {
      const touched = new Set(edge.faces.map(fi => faceShellIds[fi]).filter(sid => sid >= 0));
      for (const sid of touched) if (shellTopology[sid]) shellTopology[sid].nonManifoldEdges++;
    }
  }
  for (const pair of intersections.pairs || []) {
    const ta = shellTopology[pair.shellA] || { openEdges: 0, nonManifoldEdges: 0 };
    const tb = shellTopology[pair.shellB] || { openEdges: 0, nonManifoldEdges: 0 };
    pair.shellAOpenEdges = ta.openEdges;
    pair.shellBOpenEdges = tb.openEdges;
    pair.shellANonManifoldEdges = ta.nonManifoldEdges;
    pair.shellBNonManifoldEdges = tb.nonManifoldEdges;
    pair.unionReady =
      pair.overlapType !== 'STRAY FRAGMENT CONTACT' &&
      pair.shellAFaces >= 4 && pair.shellBFaces >= 4 &&
      ta.openEdges === 0 && tb.openEdges === 0 &&
      ta.nonManifoldEdges === 0 && tb.nonManifoldEdges === 0;
    pair.unionBlockReason = pair.unionReady ? '' : (
      pair.overlapType === 'STRAY FRAGMENT CONTACT'
        ? 'Tiny fragment contacts use the safe fragment-removal path instead of boolean union.'
        : `Shell ${pair.shellA + 1}: ${ta.openEdges} open / ${ta.nonManifoldEdges} non-manifold edges; ` +
          `Shell ${pair.shellB + 1}: ${tb.openEdges} open / ${tb.nonManifoldEdges} non-manifold edges.`
    );
  }

  // Stage 3A evidence feeds back into Stage 2A diagnosis, but never into
'''
if old not in s:
    raise SystemExit('core anchor missing')
s = s.replace(old, new, 1)
core.write_text(s, encoding='utf-8')

page = Path('makerforge/meshprep.html')
s = page.read_text(encoding='utf-8')
s = s.replace(".intersection-batch{margin-top:8px}.intersection-batch .btn{width:100%;font-size:10px;padding:7px;border-color:rgba(52,211,153,.55)}", ".intersection-batch{margin-top:8px}.intersection-batch .btn{width:100%;font-size:10px;padding:7px;border-color:rgba(52,211,153,.55)}\n.union-preflight{margin-top:7px;padding:6px 7px;border-radius:6px;border:1px solid var(--border);font-size:10px;line-height:1.35}.union-preflight.ready{border-color:rgba(52,211,153,.5);background:rgba(52,211,153,.06);color:#86efac}.union-preflight.blocked{border-color:rgba(251,191,36,.42);background:rgba(251,191,36,.05);color:#fcd34d}.union-preflight b{color:inherit}")
old = '''    el.innerHTML = `<b>Shell ${p.shellA+1} / ${p.shellB+1}</b> · ${p.intersections.toLocaleString()} proven crossings<br>` +
      `${p.shellAFaces.toLocaleString()} faces / ${p.shellBFaces.toLocaleString()} faces${density}<br>` +
      `<b>${p.overlapType || 'CROSSING SHELLS'}</b> · ${p.reason || ''}<br>${p.recommendation || ''}`;
    if (p.overlapType === 'STRAY FRAGMENT CONTACT') {
'''
new = '''    el.innerHTML = `<b>Shell ${p.shellA+1} / ${p.shellB+1}</b> · ${p.intersections.toLocaleString()} proven crossings<br>` +
      `${p.shellAFaces.toLocaleString()} faces / ${p.shellBFaces.toLocaleString()} faces${density}<br>` +
      `<b>${p.overlapType || 'CROSSING SHELLS'}</b> · ${p.reason || ''}<br>${p.recommendation || ''}`;
    if (p.overlapType !== 'STRAY FRAGMENT CONTACT') {
      const preflight = document.createElement('div');
      preflight.className = `union-preflight ${p.unionReady ? 'ready' : 'blocked'}`;
      preflight.innerHTML = p.unionReady
        ? `<b>UNION READY</b> · Both source shells are closed and manifold at the pair-local topology gate.`
        : `<b>UNION BLOCKED</b> · ${p.unionBlockReason || 'Pair-local topology is not safe for a solid boolean yet.'}`;
      el.appendChild(preflight);
    }
    if (p.overlapType === 'STRAY FRAGMENT CONTACT') {
'''
if old not in s:
    raise SystemExit('page intersection anchor missing')
s = s.replace(old, new, 1)
s = s.replace("' Stage 3C can safely remove proven tiny stray fragments; deeper overlaps remain blocked pending boolean union.';", "' Stage 3C removes proven tiny stray fragments and now runs pair-local union preflight on deeper overlaps.';")
s = s.replace("./js/sanitiser-core.js?v=12", "./js/sanitiser-core.js?v=13")
page.write_text(s, encoding='utf-8')
