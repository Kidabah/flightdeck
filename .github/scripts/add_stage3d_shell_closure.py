from pathlib import Path

core = Path('makerforge/js/sanitiser-core.js')
s = core.read_text(encoding='utf-8')
marker = "export function repairSanitiserIntersectionStage3C(positions, nTri, pair) {"
if 'analyseSanitiserIntersectionStage3D' not in s:
    if marker not in s:
        raise SystemExit('Stage 3C marker missing')
    insert = r'''
function stage3DShellProfile(positions, nTri, shellId) {
  const { faceShellIds, shellFaceCounts } = buildStage3CShellIds(positions, nTri);
  if (!Number.isInteger(shellId) || shellId < 0 || !shellFaceCounts[shellId]) {
    throw new Error('Stage 3D shell identity is no longer valid.');
  }

  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (let fi=0; fi<nTri; fi++) {
    if (faceShellIds[fi] !== shellId) continue;
    const o=fi*9;
    for (let v=0;v<3;v++) {
      const p=o+v*3,x=positions[p],y=positions[p+1],z=positions[p+2];
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);
      minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
    }
  }
  const maxDim=Math.max(maxX-minX,maxY-minY,maxZ-minZ,1e-9);
  const eps=Math.max(maxDim*1e-7,1e-7);
  const key=(x,y,z)=>`${Math.round(x/eps)},${Math.round(y/eps)},${Math.round(z/eps)}`;
  const vertexMap=new Map(), vertexPositions=[];
  const edgeMap=new Map();
  const vertexId=(x,y,z)=>{
    const k=key(x,y,z);
    if(!vertexMap.has(k)){const id=vertexMap.size;vertexMap.set(k,id);vertexPositions[id]=[x,y,z];}
    return vertexMap.get(k);
  };

  for(let fi=0;fi<nTri;fi++){
    if(faceShellIds[fi]!==shellId)continue;
    const o=fi*9;
    const ids=[
      vertexId(positions[o],positions[o+1],positions[o+2]),
      vertexId(positions[o+3],positions[o+4],positions[o+5]),
      vertexId(positions[o+6],positions[o+7],positions[o+8])
    ];
    for(let e=0;e<3;e++){
      const from=ids[e],to=ids[(e+1)%3];
      if(from===to)continue;
      const k=from<to?`${from}|${to}`:`${to}|${from}`;
      const ex=edgeMap.get(k);
      if(ex){ex.count++;ex.faces.push(fi);}
      else edgeMap.set(k,{count:1,a:Math.min(from,to),b:Math.max(from,to),from,to,faces:[fi]});
    }
  }

  const open=[...edgeMap.values()].filter(e=>e.count===1);
  const nonManifoldEdges=[...edgeMap.values()].filter(e=>e.count>2).length;
  const vertexEdges=new Map();
  const add=(v,i)=>{if(!vertexEdges.has(v))vertexEdges.set(v,[]);vertexEdges.get(v).push(i);};
  open.forEach((e,i)=>{add(e.a,i);add(e.b,i);});
  const visited=new Uint8Array(open.length), loops=[];

  const quadSafe = pts => {
    const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const n=cross(sub(pts[1],pts[0]),sub(pts[2],pts[0]));
    const nl=Math.hypot(...n);
    if(nl<=eps*eps)return false;
    const nn=n.map(v=>v/nl), tol=Math.max(maxDim*1e-5,1e-5);
    if(Math.abs(dot(sub(pts[3],pts[0]),nn))>tol)return false;
    const drop=Math.abs(nn[0])>Math.abs(nn[1])?(Math.abs(nn[0])>Math.abs(nn[2])?0:2):(Math.abs(nn[1])>Math.abs(nn[2])?1:2);
    const p2=pts.map(p=>drop===0?[p[1],p[2]]:drop===1?[p[0],p[2]]:[p[0],p[1]]);
    let sign=0;
    for(let i=0;i<4;i++){
      const a=p2[i],b=p2[(i+1)%4],c=p2[(i+2)%4];
      const z=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
      if(Math.abs(z)<=eps*eps)return false;
      const sgn=Math.sign(z);if(!sign)sign=sgn;else if(sgn!==sign)return false;
    }
    return true;
  };

  for(let start=0;start<open.length;start++){
    if(visited[start])continue;
    const stack=[start], comp=[], degree=new Map();visited[start]=1;
    while(stack.length){
      const i=stack.pop(),e=open[i];comp.push(e);
      degree.set(e.a,(degree.get(e.a)||0)+1);degree.set(e.b,(degree.get(e.b)||0)+1);
      for(const v of [e.a,e.b])for(const nb of vertexEdges.get(v)||[])if(!visited[nb]){visited[nb]=1;stack.push(nb);}
    }
    const verts=[...new Set(comp.flatMap(e=>[e.a,e.b]))];
    const closed=comp.length>=3&&verts.every(v=>degree.get(v)===2);
    let cycleIds=[], repairable=false, reason='Boundary is not a simple closed 3/4-edge loop.';
    if(closed&&(comp.length===3||comp.length===4)){
      const byFrom=new Map();let directed=true;
      for(const e of comp){if(byFrom.has(e.from)){directed=false;break;}byFrom.set(e.from,e);}
      if(directed){
        const first=comp[0];cycleIds=[first.from,first.to];
        let cur=first.to;
        for(let guard=0;guard<comp.length-2;guard++){
          const next=byFrom.get(cur);if(!next){directed=false;break;}cycleIds.push(next.to);cur=next.to;
        }
        const last=byFrom.get(cur);
        if(!last||last.to!==first.from||new Set(cycleIds).size!==comp.length)directed=false;
      }
      if(directed){
        const pts=cycleIds.map(id=>vertexPositions[id]);
        if(comp.length===3){
          const a=pts[0],b=pts[1],c=pts[2];
          const area2=Math.hypot((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
          repairable=area2>eps*eps*2; reason=repairable?'Simple triangular shell opening.':'Triangular opening is degenerate.';
        } else {
          repairable=quadSafe(pts); reason=repairable?'Planar convex quadrilateral shell opening.':'Quad opening failed planarity/convexity safety checks.';
        }
      } else reason='Boundary winding is inconsistent.';
    }
    loops.push({edgeCount:comp.length,closed,repairable,reason,cyclePoints:cycleIds.map(id=>vertexPositions[id])});
  }

  const repairableLoops=loops.filter(l=>l.repairable);
  const repairableEdges=repairableLoops.reduce((sum,l)=>sum+l.edgeCount,0);
  const blockedOpenings=loops.filter(l=>!l.repairable).length;
  const canPrepare=nonManifoldEdges===0&&open.length>0&&repairableEdges===open.length&&blockedOpenings===0;
  return {shellId,faces:shellFaceCounts[shellId],openEdges:open.length,nonManifoldEdges,openings:loops.length,repairableOpenings:repairableLoops.length,repairableEdges,blockedOpenings,canPrepare,loops};
}

export function analyseSanitiserIntersectionStage3D(positions, nTri, pair) {
  if(!positions||!nTri||!pair)throw new Error('Stage 3D requires the current mesh and a shell pair.');
  const shellA=stage3DShellProfile(positions,nTri,pair.shellA);
  const shellB=stage3DShellProfile(positions,nTri,pair.shellB);
  const alreadyReady=shellA.openEdges===0&&shellB.openEdges===0&&shellA.nonManifoldEdges===0&&shellB.nonManifoldEdges===0;
  const canPrepare=!alreadyReady&&
    shellA.nonManifoldEdges===0&&shellB.nonManifoldEdges===0&&
    (shellA.openEdges===0||shellA.canPrepare)&&
    (shellB.openEdges===0||shellB.canPrepare);
  return {shellA,shellB,alreadyReady,canPrepare,repairableOpenings:shellA.repairableOpenings+shellB.repairableOpenings,repairableEdges:shellA.repairableEdges+shellB.repairableEdges};
}

export function repairSanitiserIntersectionStage3D(positions, nTri, pair) {
  const pre=analyseSanitiserIntersectionStage3D(positions,nTri,pair);
  if(pre.alreadyReady)throw new Error('Stage 3D is not required; both shells are already closed solids.');
  if(!pre.canPrepare)throw new Error('Stage 3D refused: one or more shell openings are ambiguous or non-manifold.');
  const caps=[];
  for(const profile of [pre.shellA,pre.shellB]){
    for(const loop of profile.loops){
      if(!loop.repairable)continue;
      const p=loop.cyclePoints;
      if(loop.edgeCount===3)caps.push([...p[0],...p[2],...p[1]]);
      else if(loop.edgeCount===4){caps.push([...p[0],...p[2],...p[1]]);caps.push([...p[0],...p[3],...p[2]]);}
    }
  }
  if(!caps.length)throw new Error('Stage 3D found no safe shell openings to close.');
  const repaired=new Float32Array(positions.length+caps.length*9);repaired.set(positions,0);
  let w=positions.length;for(const cap of caps)for(const v of cap)repaired[w++]=v;
  return {positions:repaired,nTri:nTri+caps.length,addedFaces:caps.length,repairedOpenEdges:pre.repairableEdges,repairedOpenings:pre.repairableOpenings,preflight:pre};
}

'''
    s = s.replace(marker, insert + marker, 1)
core.write_text(s, encoding='utf-8')

page = Path('makerforge/meshprep.html')
s = page.read_text(encoding='utf-8')
s = s.replace("repairSanitiserIntersectionStage3C, repairSanitiserIntersectionStage3CBatch } from './js/sanitiser-core.js?v=13';",
              "repairSanitiserIntersectionStage3C, repairSanitiserIntersectionStage3CBatch, analyseSanitiserIntersectionStage3D, repairSanitiserIntersectionStage3D } from './js/sanitiser-core.js?v=14';")
s = s.replace("repairSanitiserIntersectionStage3C, repairSanitiserIntersectionStage3CBatch } from './js/sanitiser-core.js?v=12';",
              "repairSanitiserIntersectionStage3C, repairSanitiserIntersectionStage3CBatch, analyseSanitiserIntersectionStage3D, repairSanitiserIntersectionStage3D } from './js/sanitiser-core.js?v=14';")
if '.stage3d-prep{' not in s:
    s = s.replace('</style>', '''\n.stage3d-prep{margin-top:7px;border:1px solid rgba(52,211,153,.45);border-radius:6px;padding:7px;background:rgba(52,211,153,.055);font-size:10px;line-height:1.4;color:var(--muted)}\n.stage3d-prep b{color:#6ee7b7}.stage3d-prep.blocked{border-color:rgba(251,191,36,.42);background:rgba(251,191,36,.045)}.stage3d-prep.blocked b{color:#fbbf24}.stage3d-prep .btn{width:100%;margin-top:7px;font-size:10px;padding:6px}\n</style>''',1)
needle = """    if (p.overlapType !== 'STRAY FRAGMENT CONTACT') {\n      const preflight = document.createElement('div');\n      preflight.className = `union-preflight ${p.unionReady ? 'ready' : 'blocked'}`;\n      preflight.innerHTML = p.unionReady\n        ? `<b>UNION READY</b> · Both source shells are closed and manifold at the pair-local topology gate.`\n        : `<b>UNION BLOCKED</b> · ${p.unionBlockReason || 'Pair-local topology is not safe for a solid boolean yet.'}`;\n      el.appendChild(preflight);\n    }\n"""
replacement = needle + """    if (p.overlapType !== 'STRAY FRAGMENT CONTACT' && !p.unionReady) {\n      try {\n        const parsed = currentParsed || sourceParsed;\n        const prep = parsed ? analyseSanitiserIntersectionStage3D(parsed.positions, parsed.nTri, p) : null;\n        if (prep) {\n          const box = document.createElement('div');\n          box.className = `stage3d-prep ${prep.canPrepare ? '' : 'blocked'}`;\n          const a = prep.shellA, b = prep.shellB;\n          box.innerHTML = prep.canPrepare\n            ? `<b>PRE-UNION REPAIR AVAILABLE</b> · ${prep.repairableOpenings} safe opening${prep.repairableOpenings===1?'':'s'} / ${prep.repairableEdges} open edges can be closed.<br>Shell ${a.shellId+1}: ${a.openEdges} open · ${a.repairableOpenings} repairable. Shell ${b.shellId+1}: ${b.openEdges} open · ${b.repairableOpenings} repairable.`\n            : `<b>PRE-UNION REPAIR BLOCKED</b> · Shell ${a.shellId+1}: ${a.openEdges} open / ${a.blockedOpenings} ambiguous. Shell ${b.shellId+1}: ${b.openEdges} open / ${b.blockedOpenings} ambiguous.`;\n          if (prep.canPrepare) {\n            const btn = document.createElement('button'); btn.type='button'; btn.className='btn'; btn.textContent='PREPARE SHELLS';\n            btn.addEventListener('click', () => applyStage3DShellPreparation(pairIndex));\n            box.appendChild(btn);\n          }\n          el.appendChild(box);\n        }\n      } catch (err) { console.warn('Stage 3D preflight unavailable:', err); }\n    }\n"""
if 'PRE-UNION REPAIR AVAILABLE' not in s:
    if needle not in s: raise SystemExit('intersection preflight UI marker missing')
    s=s.replace(needle,replacement,1)
fn_marker = "\n\nfunction applyStage3CBatchFragmentRepair() {"
if 'function applyStage3DShellPreparation' not in s:
    fn = r'''

function applyStage3DShellPreparation(pairIndex) {
  const parsed=currentParsed||sourceParsed;
  if(!parsed){setStatus('No prepared mesh available for Stage 3D');return;}
  try{
    const before=analyseSanitiserMesh(parsed.positions,parsed.nTri);
    const pair=before.intersections?.pairs?.[pairIndex];
    if(!pair)throw new Error('Selected shell pair is no longer available; re-run analysis.');
    const pre=analyseSanitiserIntersectionStage3D(parsed.positions,parsed.nTri,pair);
    if(!pre.canPrepare)throw new Error('Shell-local closure safety gate no longer passes.');
    setStatus(`Stage 3D: closing ${pre.repairableOpenings} proven shell opening${pre.repairableOpenings===1?'':'s'}...`);
    const repaired=repairSanitiserIntersectionStage3D(parsed.positions,parsed.nTri,pair);
    const after=analyseSanitiserMesh(repaired.positions,repaired.nTri);
    if(after.nTri!==before.nTri+repaired.addedFaces)throw new Error('face-count safety gate failed');
    if(after.openEdges!==before.openEdges-repaired.repairedOpenEdges)throw new Error('open-edge closure count did not match the proven target');
    if(after.nonManifoldEdges>before.nonManifoldEdges)throw new Error('non-manifold topology increased');
    if(after.degenerateTriangles>before.degenerateTriangles)throw new Error('degenerate triangles increased');
    const fresh=analyseSanitiserIntersectionStage3D(repaired.positions,repaired.nTri,pair);
    if(!fresh.alreadyReady)throw new Error('target shells did not become closed manifold solids');
    currentParsed={positions:repaired.positions,nTri:repaired.nTri};sourceParsed=cloneParsed(currentParsed);
    repairDismissed=false;scaleReference=null;updateAnalysis(sourceName,currentParsed);
    setStatus(`Stage 3D complete — closed ${repaired.repairedOpenings} opening${repaired.repairedOpenings===1?'':'s'} / ${repaired.repairedOpenEdges} open edges. Pair is UNION READY.`);
  }catch(err){console.error('Stage 3D shell preparation refused:',err);setStatus(`Stage 3D refused: ${err.message||err}`);}
}
'''
    if fn_marker not in s: raise SystemExit('Stage 3C function marker missing')
    s=s.replace(fn_marker,fn+fn_marker,1)
page.write_text(s, encoding='utf-8')
