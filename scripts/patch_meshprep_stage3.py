from pathlib import Path

core_path = Path('makerforge/js/sanitiser-core.js')
core = core_path.read_text(encoding='utf-8')
anchor = "export function analyseSanitiserMesh(positions, nTri) {"
if anchor not in core:
    raise SystemExit('analysis anchor missing')

helper = r'''function analyseShellIntersections(positions, nTri, faceShellIds, shellFaceCounts, modelMaxDim, avgEdge) {
  const shellCount = shellFaceCounts?.length || 0;
  if (!nTri || shellCount < 2) return { shellAabbPairs:0, intersectingShellPairs:0, triangleIntersections:0, testedTrianglePairs:0, truncated:false, pairs:[] };

  const triBounds = new Array(nTri);
  const shellBounds = Array.from({length:shellCount},()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}));
  for (let fi=0; fi<nTri; fi++) {
    const o=fi*9;
    const ax=positions[o],ay=positions[o+1],az=positions[o+2],bx=positions[o+3],by=positions[o+4],bz=positions[o+5],cx=positions[o+6],cy=positions[o+7],cz=positions[o+8];
    const min=[Math.min(ax,bx,cx),Math.min(ay,by,cy),Math.min(az,bz,cz)], max=[Math.max(ax,bx,cx),Math.max(ay,by,cy),Math.max(az,bz,cz)];
    triBounds[fi]={min,max};
    const sb=shellBounds[faceShellIds[fi]];
    for(let d=0;d<3;d++){sb.min[d]=Math.min(sb.min[d],min[d]);sb.max[d]=Math.max(sb.max[d],max[d]);}
  }
  const overlap=(a,b,e=0)=>a.min[0]<=b.max[0]+e&&a.max[0]+e>=b.min[0]&&a.min[1]<=b.max[1]+e&&a.max[1]+e>=b.min[1]&&a.min[2]<=b.max[2]+e&&a.max[2]+e>=b.min[2];
  const aabbEps=Math.max(modelMaxDim*1e-8,1e-7), shellCandidates=[];
  for(let a=0;a<shellCount;a++) for(let b=a+1;b<shellCount;b++) if(shellFaceCounts[a]&&shellFaceCounts[b]&&overlap(shellBounds[a],shellBounds[b],aabbEps)) shellCandidates.push([a,b]);
  if(!shellCandidates.length) return { shellAabbPairs:0, intersectingShellPairs:0, triangleIntersections:0, testedTrianglePairs:0, truncated:false, pairs:[] };

  const candidateSet=new Set(shellCandidates.map(([a,b])=>`${a}|${b}`));
  const cellSize=Math.max(avgEdge*3,modelMaxDim/40,0.5), grid=new Map(), maxCells=125;
  const gk=(x,y,z)=>`${x},${y},${z}`;
  for(let fi=0;fi<nTri;fi++){
    const b=triBounds[fi],x0=Math.floor(b.min[0]/cellSize),x1=Math.floor(b.max[0]/cellSize),y0=Math.floor(b.min[1]/cellSize),y1=Math.floor(b.max[1]/cellSize),z0=Math.floor(b.min[2]/cellSize),z1=Math.floor(b.max[2]/cellSize);
    if((x1-x0+1)*(y1-y0+1)*(z1-z0+1)>maxCells) continue;
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++){const k=gk(x,y,z);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(fi);}
  }
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const point=(fi,v)=>{const o=fi*9+v*3;return[positions[o],positions[o+1],positions[o+2]]};
  function segTri(p0,p1,t0,t1,t2){const dir=sub(p1,p0),e1=sub(t1,t0),e2=sub(t2,t0),h=cross(dir,e2),det=dot(e1,h),eps=Math.max(modelMaxDim*1e-10,1e-9);if(Math.abs(det)<eps)return false;const inv=1/det,s=sub(p0,t0),u=inv*dot(s,h);if(u<-eps||u>1+eps)return false;const q=cross(s,e1),v=inv*dot(dir,q);if(v<-eps||u+v>1+eps)return false;const t=inv*dot(e2,q);return t>eps&&t<1-eps;}
  function triHit(a,b){if(!overlap(triBounds[a],triBounds[b],aabbEps))return false;const A=[point(a,0),point(a,1),point(a,2)],B=[point(b,0),point(b,1),point(b,2)];for(let i=0;i<3;i++)if(segTri(A[i],A[(i+1)%3],B[0],B[1],B[2]))return true;for(let i=0;i<3;i++)if(segTri(B[i],B[(i+1)%3],A[0],A[1],A[2]))return true;return false;}

  const seen=new Set(),hits=new Map();let testedTrianglePairs=0,triangleIntersections=0,truncated=false;const maxTests=350000,maxHits=20000;
  outer:for(const faces of grid.values())for(let i=0;i<faces.length;i++)for(let j=i+1;j<faces.length;j++){
    const a=faces[i],b=faces[j],sa=faceShellIds[a],sb=faceShellIds[b];if(sa===sb)continue;const lo=Math.min(sa,sb),hi=Math.max(sa,sb),sp=`${lo}|${hi}`;if(!candidateSet.has(sp))continue;const tp=a<b?`${a}|${b}`:`${b}|${a}`;if(seen.has(tp))continue;seen.add(tp);testedTrianglePairs++;
    if(triHit(a,b)){triangleIntersections++;hits.set(sp,(hits.get(sp)||0)+1);if(triangleIntersections>=maxHits){truncated=true;break outer;}}
    if(testedTrianglePairs>=maxTests){truncated=true;break outer;}
  }
  const pairs=[...hits.entries()].map(([k,n])=>{const[a,b]=k.split('|').map(Number);return{shellA:a,shellB:b,intersections:n,shellAFaces:shellFaceCounts[a]||0,shellBFaces:shellFaceCounts[b]||0}}).sort((a,b)=>b.intersections-a.intersections);
  return {shellAabbPairs:shellCandidates.length,intersectingShellPairs:pairs.length,triangleIntersections,testedTrianglePairs,truncated,pairs:pairs.slice(0,100)};
}

'''
core = core.replace(anchor, helper + anchor, 1)

old = """  const boundaryLoops = buildBoundaryDiagnostics(
    edgeMap,
    vertexPositions,
    maxDim,
    faceShellIds,
    shellFaceCounts
  );"""
if old not in core:
    raise SystemExit('boundary diagnostics call missing')
core = core.replace(old, old + """

  const intersections = analyseShellIntersections(
    positions, nTri, faceShellIds, shellFaceCounts, maxDim, avgEdge
  );""", 1)
old_return = """    watertight,
    scale,
    boundaryLoops,"""
if old_return not in core:
    raise SystemExit('analysis return anchor missing')
core = core.replace(old_return, """    watertight,
    scale,
    boundaryLoops,
    intersections,""", 1)
core_path.write_text(core, encoding='utf-8')

ui_path=Path('makerforge/meshprep.html')
ui=ui_path.read_text(encoding='utf-8')
style='''.intersection-panel{border:1px solid #b875ff;border-radius:8px;padding:10px;background:rgba(184,117,255,.055)}
.intersection-title{color:#d3a7ff;font-size:11px;font-weight:800;letter-spacing:.06em;margin-bottom:6px}.intersection-text{font-size:11px;color:var(--muted);line-height:1.45}.intersection-summary{display:grid;grid-template-columns:1fr auto;gap:5px 10px;margin-top:8px;font-size:11px}.intersection-summary .value{color:var(--text);font-weight:700;text-align:right}.intersection-list{margin-top:8px;display:flex;flex-direction:column;gap:5px}.intersection-item{border:1px solid var(--border);border-radius:6px;background:var(--panel-2);padding:7px;font-size:10px;color:var(--muted)}.intersection-item b{color:var(--text)}
'''
ui=ui.replace('</style>',style+'</style>',1)
panel='''    <div id="intersectionPanel" class="intersection-panel" hidden>
      <div class="intersection-title">SHELL INTERSECTION INSPECTOR</div>
      <div class="intersection-text">Stage 3A is diagnostic only. It detects overlapping shell bounds, then proves cross-shell triangle intersections.</div>
      <div class="intersection-summary"><span>Shell AABB overlaps</span><span class="value" id="intersectionAabb">0</span><span>Intersecting shell pairs</span><span class="value" id="intersectionPairs">0</span><span>Triangle intersections</span><span class="value" id="intersectionHits">0</span><span>Triangle pairs tested</span><span class="value" id="intersectionTests">0</span></div>
      <div id="intersectionNote" class="intersection-text" style="margin-top:7px"></div><div id="intersectionList" class="intersection-list"></div>
    </div>

'''
anchor_panel='    <div id="boundaryRepairComplete" class="boundary-repair-complete" hidden>'
if anchor_panel not in ui: raise SystemExit('panel anchor missing')
ui=ui.replace(anchor_panel,panel+anchor_panel,1)
func='''function showIntersectionInspector(san) {
  const x=san?.intersections;if(!x||(!x.shellAabbPairs&&!x.intersectingShellPairs)){$('intersectionPanel').hidden=true;$('intersectionList').innerHTML='';return;}
  $('intersectionPanel').hidden=false;$('intersectionAabb').textContent=(x.shellAabbPairs||0).toLocaleString();$('intersectionPairs').textContent=(x.intersectingShellPairs||0).toLocaleString();$('intersectionHits').textContent=(x.triangleIntersections||0).toLocaleString();$('intersectionTests').textContent=(x.testedTrianglePairs||0).toLocaleString();$('intersectionNote').textContent=x.truncated?'Safety budget reached: proven lower bound only.':'Analysis completed within the Stage 3A safety budget.';
  const list=$('intersectionList');list.innerHTML='';(x.pairs||[]).slice(0,12).forEach(p=>{const el=document.createElement('div');el.className='intersection-item';el.innerHTML=`<b>Shell ${p.shellA+1} / ${p.shellB+1}</b> - ${p.intersections.toLocaleString()} proven crossings<br>${p.shellAFaces.toLocaleString()} faces / ${p.shellBFaces.toLocaleString()} faces`;list.appendChild(el);});
}

'''
anchor_func='function hideBoundaryRepairComplete() {'
if anchor_func not in ui: raise SystemExit('function anchor missing')
ui=ui.replace(anchor_func,func+anchor_func,1)
old="""    showBoundaryInspector(san);
    console.log('[Sanitiser Core 0.1]', san);"""
if old not in ui: raise SystemExit('updateAnalysis anchor missing')
ui=ui.replace(old,"""    showBoundaryInspector(san);
    showIntersectionInspector(san);
    console.log('[Sanitiser Core 0.1]', san);""",1)
if './js/sanitiser-core.js?v=6' not in ui: raise SystemExit('cache token missing')
ui=ui.replace('./js/sanitiser-core.js?v=6','./js/sanitiser-core.js?v=7',1)
ui_path.write_text(ui,encoding='utf-8')
