from pathlib import Path
p = Path('makerforge/meshprep.html')
s = p.read_text(encoding='utf-8')

css_anchor = ".boundary-list{display:flex;flex-direction:column;gap:6px;margin-top:9px}\n"
css_new = css_anchor + """.boundary-group{border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,.015);overflow:hidden}\n.boundary-group+.boundary-group{margin-top:6px}\n.boundary-group-header{width:100%;display:grid;grid-template-columns:1fr auto auto;gap:7px;align-items:center;border:0;background:var(--panel-2);color:var(--text);padding:9px;cursor:pointer;text-align:left}\n.boundary-group-header:hover{background:rgba(255,255,255,.035)}\n.boundary-group-title{font-size:11px;font-weight:800;letter-spacing:.04em}\n.boundary-group-count{font-size:10px;font-weight:800;color:var(--muted);white-space:nowrap}\n.boundary-group-chevron{font-size:11px;color:var(--muted);transition:transform .16s ease}\n.boundary-group.open .boundary-group-chevron{transform:rotate(90deg)}\n.boundary-group-body{display:none;padding:6px}\n.boundary-group.open .boundary-group-body{display:flex;flex-direction:column;gap:6px}\n.boundary-group-summary{font-size:10px;color:var(--muted);line-height:1.35;padding:0 3px 4px}\n.boundary-group[data-class=\"INTERSECTING SHELL\"] .boundary-group-title{color:#d3a7ff}\n.boundary-group[data-class=\"HOLE\"] .boundary-group-title{color:var(--green)}\n.boundary-group[data-class=\"SHELL OPENING\"] .boundary-group-title{color:var(--amber)}\n.boundary-group[data-class=\"COMPLEX\"] .boundary-group-title{color:var(--red)}\n"""
if css_anchor not in s:
    raise SystemExit('boundary-list CSS anchor missing')
s = s.replace(css_anchor, css_new, 1)

old_start = s.index('function showBoundaryInspector(san) {')
old_end = s.index('\n\n\nfunction showIntersectionInspector(san) {', old_start)
new = r'''function showBoundaryInspector(san) {
  assignPersistentBoundaryIds(san);
  boundaryAnalysis = san;
  clearBoundaryHighlight();
  const loops = san.boundaryLoops || [];
  if (!loops.length) {
    $('boundaryPanel').hidden = true;
    $('boundaryList').innerHTML = '';
    return;
  }
  $('boundaryPanel').hidden = false;
  $('boundaryFileName').textContent = sourceName || 'Unnamed STL';
  $('boundaryLoopCount').textContent = loops.length.toLocaleString();
  $('boundaryEdgeCount').textContent = san.openEdges.toLocaleString();
  const list = $('boundaryList');
  list.innerHTML = '';
  const order = ['INTERSECTING SHELL', 'HOLE', 'SHELL OPENING', 'COMPLEX'];
  const grouped = new Map(order.map(name => [name, []]));
  for (let index = 0; index < loops.length; index++) {
    const loop = loops[index];
    const key = grouped.has(loop.classification) ? loop.classification : 'COMPLEX';
    grouped.get(key).push({ loop, index });
  }
  const descriptions = {
    'INTERSECTING SHELL': 'Boundaries on shells with proven cross-shell intersections. Resolve overlap first.',
    'HOLE': 'Proven simple hole candidates. Stage 2 safety checks still apply before any cap.',
    'SHELL OPENING': 'Closed boundaries not proven to be holes. Treat as open shell perimeters until reviewed.',
    'COMPLEX': 'Branched or open-chain topology. Manual or advanced repair only.'
  };
  const defaultOpen = grouped.get('HOLE')?.length ? 'HOLE' : null;
  for (const classification of order) {
    const items = grouped.get(classification) || [];
    if (!items.length) continue;
    const group = document.createElement('div');
    group.className = 'boundary-group';
    group.dataset.class = classification;
    if (classification === defaultOpen) group.classList.add('open');
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'boundary-group-header';
    header.innerHTML = `<span class="boundary-group-title">${classification}</span><span class="boundary-group-count">${items.length.toLocaleString()}</span><span class="boundary-group-chevron">▶</span>`;
    const body = document.createElement('div');
    body.className = 'boundary-group-body';
    const summary = document.createElement('div');
    summary.className = 'boundary-group-summary';
    const edgeTotal = items.reduce((sum, item) => sum + (item.loop.edgeCount || 0), 0);
    summary.textContent = `${descriptions[classification]} ${edgeTotal.toLocaleString()} open edges across this group.`;
    body.appendChild(summary);
    for (const { loop, index } of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'boundary-item';
      button.dataset.class = loop.classification;
      button.dataset.boundaryIndex = String(index);
      const capLabel = (loop.edgeCount === 3 || loop.edgeCount === 4)
        ? (loop.classification === 'INTERSECTING SHELL' ? ' · CAP BLOCKED' : (loop.repairEligible ? ' · CAP SAFE' : ' · CAP REFUSED'))
        : '';
      button.innerHTML = `<span class="name">${boundaryLabel(loop, index)}</span><span class="class">${loop.classification}</span><span class="meta">${loop.edgeCount.toLocaleString()} edges · ${loop.maxSpan.toFixed(1)} mm span · ${loop.perimeter.toFixed(1)} mm perimeter${capLabel}<br>${loop.recommendation}</span>`;
      button.addEventListener('click', () => highlightBoundary(index));
      body.appendChild(button);
    }
    header.addEventListener('click', () => group.classList.toggle('open'));
    group.appendChild(header);
    group.appendChild(body);
    list.appendChild(group);
  }
}'''
s = s[:old_start] + new + s[old_end:]
old_active = """  document.querySelectorAll('.boundary-item').forEach((el, i) => {\n    el.classList.toggle('active', i === index);\n  });"""
new_active = """  document.querySelectorAll('.boundary-item').forEach(el => {\n    el.classList.toggle('active', Number(el.dataset.boundaryIndex) === index);\n  });"""
if old_active not in s:
    raise SystemExit('boundary active selection block missing')
s = s.replace(old_active, new_active, 1)
p.write_text(s, encoding='utf-8')
