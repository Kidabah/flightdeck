from pathlib import Path

core = Path('makerforge/js/sanitiser-core.js')
s = core.read_text(encoding='utf-8')
insert_anchor = '\nexport function analyseSanitiserMesh(positions, nTri) {'
if insert_anchor not in s:
    raise SystemExit('analyseSanitiserMesh anchor missing')

helper = r'''

function buildStage3CShellIds(positions, nTri) {
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i=0;i<nTri;i++){
    const o=i*9;
    for(let v=0;v<3;v++){
      const p=o+v*3,x=positions[p],y=positions[p+1],z=positions[p+2];
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
    }
  }
  const maxDim=Math.max(maxX-minX,maxY-minY,maxZ-minZ,1e-9);
  const eps=Math.max(maxDim*1e-7,1e-7);
  const key=(x,y,z)=>`${Math.round(x/eps)},${Math.round(y/eps)},${Math.round(z/eps)}`;
  const vertexMap=new Map(), faceVerts=new Array(nTri), vertexFaces=[];
  for(let fi=0;fi<nTri;fi++){
    const o=fi*9, ids=[];
    for(let v=0;v<3;v++){
      const p=o+v*3,k=key(positions[p],positions[p+1],positions[p+2]);
      if(!vertexMap.has(k)){const id=vertexMap.size;vertexMap.set(k,id);vertexFaces[id]=[];}
      const id=vertexMap.get(k);ids.push(id);vertexFaces[id].push(fi);
    }
    faceVerts[fi]=ids;
  }
  const visited=new Uint8Array(nTri), faceShellIds=new Int32Array(nTri);faceShellIds.fill(-1);
  const shellFaceCounts=[];let shells=0;
  for(let start=0;start<nTri;start++){
    if(visited[start])continue;
    const sid=shells++,stack=[start];visited[start]=1;faceShellIds[start]=sid;let count=0;
    while(stack.length){
      const fi=stack.pop();count++;
      for(const vi of faceVerts[fi])for(const nb of vertexFaces[vi])if(!visited[nb]){visited[nb]=1;faceShellIds[nb]=sid;stack.push(nb);}
    }
    shellFaceCounts[sid]=count;
  }
  return {faceShellIds,shellFaceCounts};
}

export function repairSanitiserIntersectionStage3C(positions, nTri, pair) {
  if(!positions || !nTri || !pair) throw new Error('Stage 3C requires a current mesh and selected shell pair.');
  if(pair.overlapType !== 'STRAY FRAGMENT CONTACT') throw new Error('Stage 3C currently repairs only proven stray-fragment contacts. Deep overlaps require the union stage.');
  const aFaces=Number(pair.shellAFaces)||0,bFaces=Number(pair.shellBFaces)||0;
  const smallerFaces=Math.min(aFaces,bFaces);
  if(smallerFaces<1 || smallerFaces>4) throw new Error('Stage 3C fragment safety gate refused this shell size.');
  if(aFaces===bFaces) throw new Error('Stage 3C cannot safely choose which equal-sized shell is stray.');
  const removeShellId=aFaces<bFaces ? pair.shellA : pair.shellB;
  const {faceShellIds,shellFaceCounts}=buildStage3CShellIds(positions,nTri);
  const actualCount=shellFaceCounts[removeShellId]||0;
  if(actualCount!==smallerFaces || actualCount>4) throw new Error('Stage 3C shell identity changed; original mesh preserved.');
  const kept=[];let removedFaces=0;
  for(let fi=0;fi<nTri;fi++){
    if(faceShellIds[fi]===removeShellId){removedFaces++;continue;}
    const o=fi*9;for(let k=0;k<9;k++)kept.push(positions[o+k]);
  }
  if(removedFaces!==actualCount) throw new Error('Stage 3C removal count mismatch; original mesh preserved.');
  return {positions:new Float32Array(kept),nTri:nTri-removedFaces,removedFaces,removedShellId:removeShellId};
}
'''
s = s.replace(insert_anchor, helper + insert_anchor, 1)
core.write_text(s, encoding='utf-8')

page = Path('makerforge/meshprep.html')
h = page.read_text(encoding='utf-8')
old_import = "import { analyseSanitiserMesh, repairSanitiserMeshStage1, repairSanitiserBoundaryStage2B, repairSanitiserBoundaryStage2C } from './js/sanitiser-core.js?v=9';"
if old_import not in h:
    old_import = "import { analyseSanitiserMesh, repairSanitiserMeshStage1, repairSanitiserBoundaryStage2B, repairSanitiserBoundaryStage2C } from './js/sanitiser-core.js?v=10';"
new_import = "import { analyseSanitiserMesh, repairSanitiserMeshStage1, repairSanitiserBoundaryStage2B, repairSanitiserBoundaryStage2C, repairSanitiserIntersectionStage3C } from './js/sanitiser-core.js?v=10';"
if old_import not in h:
    raise SystemExit('sanitiser import anchor missing')
h = h.replace(old_import, new_import, 1)

css_anchor = '.intersection-item b{color:var(--text)}\n'
css_new = css_anchor + '.intersection-actions{display:flex;gap:6px;margin-top:7px}.intersection-actions .btn{width:100%;font-size:10px;padding:6px}.intersection-item[data-type="STRAY FRAGMENT CONTACT"]{border-color:rgba(52,211,153,.38)}\n'
if css_anchor not in h:
    raise SystemExit('intersection CSS anchor missing')
h = h.replace(css_anchor, css_new, 1)

func_start = h.index('function showIntersectionInspector(san) {')
func_end = h.index('\n}\n\nfunction hideBoundaryRepairComplete()', func_start) + 2
new_func = r'''function showIntersectionInspector(san) {
  const x = san?.intersections;
  if (!x || (!x.shellAabbPairs && !x.intersectingShellPairs)) {
    $('intersectionPanel').hidden = true;
    $('intersectionList').innerHTML = '';
    return;
  }
  $('intersectionPanel').hidden = false;
  $('intersectionAabb').textContent = (x.shellAabbPairs || 0).toLocaleString();
  $('intersectionPairs').textContent = (x.intersectingShellPairs || 0).toLocaleString();
  $('intersectionHits').textContent = (x.triangleIntersections || 0).toLocaleString();
  $('intersectionTests').textContent = (x.testedTrianglePairs || 0).toLocaleString();
  const types = x.typeCounts || {};
  const typeSummary = Object.entries(types).sort((a,b)=>b[1]-a[1]).map(([name,count])=>`${name}: ${count}`).join(' · ');
  $('intersectionNote').textContent =
    (x.truncated ? 'Safety budget reached: proven lower bound only.' : 'Analysis completed within the Stage 3A safety budget.') +
    (typeSummary ? ` Stage 3B: ${typeSummary}.` : '') +
    ' Stage 3C can safely remove proven tiny stray fragments; deeper overlaps remain blocked pending boolean union.';
  const list = $('intersectionList');
  list.innerHTML = '';
  (x.pairs || []).slice(0,12).forEach((p, pairIndex) => {
    const el = document.createElement('div');
    el.className = 'intersection-item';
    el.dataset.type = p.overlapType || 'CROSSING SHELLS';
    const density = Number.isFinite(p.crossingDensity) ? ` · density ${p.crossingDensity.toFixed(2)}` : '';
    el.innerHTML = `<b>Shell ${p.shellA+1} / ${p.shellB+1}</b> · ${p.intersections.toLocaleString()} proven crossings<br>` +
      `${p.shellAFaces.toLocaleString()} faces / ${p.shellBFaces.toLocaleString()} faces${density}<br>` +
      `<b>${p.overlapType || 'CROSSING SHELLS'}</b> · ${p.reason || ''}<br>${p.recommendation || ''}`;
    if (p.overlapType === 'STRAY FRAGMENT CONTACT') {
      const actions = document.createElement('div');
      actions.className = 'intersection-actions';
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn'; btn.textContent = 'REMOVE STRAY FRAGMENT';
      btn.addEventListener('click', () => applyStage3CFragmentRepair(pairIndex));
      actions.appendChild(btn); el.appendChild(actions);
    }
    list.appendChild(el);
  });
}'''
h = h[:func_start] + new_func + h[func_end:]

handler_anchor = '\nfunction hideBoundaryRepairComplete() {'
handler = r'''

function applyStage3CFragmentRepair(pairIndex) {
  const parsed = currentParsed || sourceParsed;
  if (!parsed) { setStatus('No prepared mesh available for Stage 3C'); return; }
  const before = analyseSanitiserMesh(parsed.positions, parsed.nTri);
  const pair = before.intersections?.pairs?.[pairIndex];
  if (!pair) { setStatus('Stage 3C pair is no longer available; re-run analysis'); return; }
  try {
    setStatus(`Stage 3C: removing proven stray fragment from Shell ${pair.shellA+1} / ${pair.shellB+1}...`);
    const repaired = repairSanitiserIntersectionStage3C(parsed.positions, parsed.nTri, pair);
    const after = analyseSanitiserMesh(repaired.positions, repaired.nTri);
    if (after.nTri !== before.nTri - repaired.removedFaces) throw new Error('face-count safety gate failed');
    if (after.nonManifoldEdges > before.nonManifoldEdges) throw new Error('non-manifold topology increased');
    if (after.openEdges > before.openEdges) throw new Error('open-edge count increased');
    if (after.degenerateTriangles > before.degenerateTriangles) throw new Error('degenerate triangles increased');
    if ((after.intersections?.triangleIntersections || 0) > (before.intersections?.triangleIntersections || 0)) throw new Error('proven intersections increased');
    currentParsed = { positions: repaired.positions, nTri: repaired.nTri };
    sourceParsed = cloneParsed(currentParsed);
    repairDismissed = false; scaleReference = null;
    updateAnalysis(sourceName, currentParsed);
    setStatus(`Stage 3C complete — removed ${repaired.removedFaces} stray face${repaired.removedFaces === 1 ? '' : 's'} and passed topology safety gates`);
  } catch (err) {
    console.error('Stage 3C fragment repair refused:', err);
    setStatus(`Stage 3C repair refused: ${err.message || err}`);
  }
}
'''
if handler_anchor not in h:
    raise SystemExit('Stage 3C handler anchor missing')
h = h.replace(handler_anchor, handler + handler_anchor, 1)
page.write_text(h, encoding='utf-8')
