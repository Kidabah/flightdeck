from pathlib import Path

# Shared nav
nav = Path('makerforge/js/nav.js')
s = nav.read_text(encoding='utf-8')
old_tools = """const TOOLS = [
  { id: 'container', label: 'Container', href: 'index.html' },
  { id: 'painter',   label: 'STL Painter', href: 'painter.html' },
  { id: 'paper3d',   label: 'Paper3D', href: 'paper3d.html' },
  { id: 'meshprep',  label: 'Mesh Prep', href: 'meshprep.html' },
  { id: 'chop',      label: 'Chop', href: 'chop.html' },
];"""
new_tools = """const TOOLS = [
  { id: 'container', label: 'Container', href: 'index.html' },
  { id: 'meshprep',  label: 'Mesh Prep', href: 'meshprep.html' },
  { id: 'painter',   label: 'STL Painter', href: 'painter.html' },
  { id: 'paper3d',   label: 'Paper3D', href: 'paper3d.html' },
  { id: 'chop',      label: 'Chop', href: 'chop.html' },
];"""
if old_tools not in s:
    raise SystemExit('nav tool list anchor missing')
s = s.replace(old_tools, new_tools, 1)
old_link = "${TOOLS.map(t => `<a class=\"md-nav-link${t.id === active ? ' active' : ''}\" href=\"${t.href}\">${t.label}</a>`).join('')}"
new_link = "${TOOLS.map(t => `<a class=\"md-nav-link md-nav-link--${t.id}${t.id === active ? ' active' : ''}\" href=\"${t.href}\">${t.label}</a>`).join('')}"
if old_link not in s:
    raise SystemExit('nav link template anchor missing')
s = s.replace(old_link, new_link, 1)
nav.write_text(s, encoding='utf-8')

# Shared Mesh Prep violet identity
css = Path('makerforge/css/makerdeck.css')
s = css.read_text(encoding='utf-8')
anchor = ".md-nav-link.active{color:var(--accent);background:var(--accent-dim)}\n"
extra = anchor + """
/* Mesh Prep has its own violet identity across MakerDeck. */
.md-nav-link--meshprep{color:#c9a7ff}
.md-nav-link--meshprep:hover{color:#eadcff;background:rgba(184,117,255,.13)}
.md-nav-link--meshprep.active{color:#d9bfff;background:rgba(184,117,255,.18);box-shadow:inset 0 0 0 1px rgba(184,117,255,.24)}
"""
if anchor not in s:
    raise SystemExit('shared nav CSS anchor missing')
s = s.replace(anchor, extra, 1)
css.write_text(s, encoding='utf-8')

# Container main menu promotion
index = Path('makerforge/index.html')
s = index.read_text(encoding='utf-8')
old = """          <a href=\"painter.html?v=626\" class=\"btn btn-secondary\" style=\"text-decoration:none;display:inline-flex;align-items:center;gap:4px\" title=\"Open STL Painter\">STL Painter</a>
          <a href=\"paper3d.html\" class=\"btn btn-secondary\" style=\"text-decoration:none;display:inline-flex;align-items:center;gap:4px\" title=\"Open Paper3D\">Paper3D</a>
          <a href=\"meshprep.html\" class=\"btn btn-secondary\" style=\"text-decoration:none;display:inline-flex;align-items:center;gap:4px\" title=\"Open Mesh Prep\">Mesh Prep</a>
          <a href=\"chop.html\" class=\"btn btn-secondary\" style=\"text-decoration:none;display:inline-flex;align-items:center;gap:4px\" title=\"Open Chop\">Chop</a>"""
new = """          <a href=\"meshprep.html\" class=\"btn btn-secondary\" style=\"text-decoration:none;display:inline-flex;align-items:center;gap:5px;color:#d9bfff;border-color:rgba(184,117,255,.65);background:rgba(184,117,255,.10);box-shadow:inset 0 0 0 1px rgba(184,117,255,.08)\" title=\"Open Mesh Prep\">◆ Mesh Prep</a>
          <a href=\"painter.html?v=626\" class=\"btn btn-secondary\" style=\"text-decoration:none;display:inline-flex;align-items:center;gap:4px\" title=\"Open STL Painter\">STL Painter</a>
          <a href=\"paper3d.html\" class=\"btn btn-secondary\" style=\"text-decoration:none;display:inline-flex;align-items:center;gap:4px\" title=\"Open Paper3D\">Paper3D</a>
          <a href=\"chop.html\" class=\"btn btn-secondary\" style=\"text-decoration:none;display:inline-flex;align-items:center;gap:4px\" title=\"Open Chop\">Chop</a>"""
if old not in s:
    raise SystemExit('container tool menu anchor missing')
s = s.replace(old, new, 1)
index.write_text(s, encoding='utf-8')

# Mesh Prep clear command
page = Path('makerforge/meshprep.html')
s = page.read_text(encoding='utf-8')
css_anchor = ".drop-zone .icon{font-size:28px;margin-bottom:6px}\n"
css_new = css_anchor + ".load-model-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px}.load-model-head .section-label{margin-bottom:0}.clear-model-btn{padding:3px 8px;font-size:10px;color:#d9bfff;border-color:rgba(184,117,255,.45)}.clear-model-btn:hover{border-color:#b875ff;background:rgba(184,117,255,.12)}\n"
if css_anchor not in s:
    raise SystemExit('Mesh Prep load CSS anchor missing')
s = s.replace(css_anchor, css_new, 1)
old_load = """    <div>
      <div class=\"section-label\">Load Model</div>
      <div class=\"drop-zone\" id=\"dropZone\">"""
new_load = """    <div>
      <div class=\"load-model-head\">
        <div class=\"section-label\">Load Model</div>
        <button class=\"btn clear-model-btn\" id=\"clearModelBtn\" type=\"button\" disabled>CLEAR</button>
      </div>
      <div class=\"drop-zone\" id=\"dropZone\">"""
if old_load not in s:
    raise SystemExit('Load Model markup anchor missing')
s = s.replace(old_load, new_load, 1)
s = s.replace("import './js/nav.js?v=551';", "import './js/nav.js?v=552';", 1)
load_anchor = "\nasync function loadFile(file) {"
clear_fn = r'''

function clearMeshPrepModel() {
  clearBoundaryHighlight();
  if (wire) {
    scene.remove(wire);
    wire.geometry?.dispose?.();
    wire.material?.dispose?.();
    wire = null;
  }
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
    mesh = null;
  }

  sourceParsed = null;
  currentParsed = null;
  sourceName = '';
  scaleWarningDismissed = false;
  scaleReference = null;
  scaleEditingAxis = null;
  repairDismissed = false;
  repairLastResult = null;
  boundaryRepairLastResult = null;
  boundaryAnalysis = null;
  selectedBoundaryIndex = -1;
  resetBoundaryIds();

  hideScaleWarning();
  hideRepairPanel();
  hideBoundaryInspector();
  hideBoundaryRepairComplete();
  $('intersectionPanel').hidden = true;
  $('intersectionList').innerHTML = '';
  $('fileInput').value = '';

  for (const id of ['statFaces','statSize','statEdge','statRough','statOpen','statBad','statDegenerate','statShells','statWatertight','statBaseDetected','statBaseArea','statBaseSize','statBaseCoverage','statBaseRating']) {
    $(id).textContent = '-';
  }

  $('fileName').textContent = 'No model loaded';
  $('exportBtn').disabled = true;
  $('exportBtn').textContent = 'EXPORT PREPARED STL';
  $('clearModelBtn').disabled = true;
  controls.target.set(0, 0, 0);
  camera.position.set(0, 0, 100);
  controls.update();
  setStatus('Workspace cleared — ready for a new STL');
}
'''
if load_anchor not in s:
    raise SystemExit('loadFile function anchor missing')
s = s.replace(load_anchor, clear_fn + load_anchor, 1)
analysis_anchor = "    $('exportBtn').disabled = false;\n"
if analysis_anchor not in s:
    raise SystemExit('analysis export enable anchor missing')
s = s.replace(analysis_anchor, analysis_anchor + "    $('clearModelBtn').disabled = false;\n", 1)
event_anchor = "$('boundaryRepairSelected').addEventListener('click', applySelectedBoundaryRepair);\n"
if event_anchor not in s:
    raise SystemExit('event listener anchor missing')
s = s.replace(event_anchor, "$('clearModelBtn').addEventListener('click', clearMeshPrepModel);\n" + event_anchor, 1)
page.write_text(s, encoding='utf-8')
