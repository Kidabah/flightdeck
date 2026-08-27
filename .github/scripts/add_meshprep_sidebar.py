from pathlib import Path

# --- FlightDeck shell view ---
idx = Path('app/static/index.html')
s = idx.read_text(encoding='utf-8')
anchor = '''      <section id="view-makerdeck" class="view" hidden>
        <div class="makerdeck-page">
          <iframe id="makerdeck-frame" title="MakerDeck — container generator" loading="lazy"></iframe>
        </div>
      </section>

      <section id="view-painter" class="view" hidden>'''
replacement = '''      <section id="view-makerdeck" class="view" hidden>
        <div class="makerdeck-page">
          <iframe id="makerdeck-frame" title="MakerDeck — container generator" loading="lazy"></iframe>
        </div>
      </section>

      <section id="view-meshprep" class="view" hidden>
        <div class="makerdeck-page meshprep-page">
          <iframe id="meshprep-frame" title="Mesh Prep — inspect and repair STL meshes" loading="lazy"></iframe>
        </div>
      </section>

      <section id="view-painter" class="view" hidden>'''
if anchor not in s and 'id="view-meshprep"' not in s:
    raise SystemExit('index Mesh Prep view anchor missing')
if 'id="view-meshprep"' not in s:
    s = s.replace(anchor, replacement, 1)
s = s.replace('/static/style.css?v=509', '/static/style.css?v=510')
s = s.replace('/static/app.js?v=735', '/static/app.js?v=736')
idx.write_text(s, encoding='utf-8')

# --- FlightDeck sidebar/router ---
app = Path('app/static/app.js')
s = app.read_text(encoding='utf-8')

def rep(old, new, label):
    global s
    if new in s:
        return
    if old not in s:
        raise SystemExit(f'{label} anchor missing')
    s = s.replace(old, new, 1)

rep("let _onMakerDeck = false;       // true while MakerDeck embed is active\nlet _onPainter = false;", "let _onMakerDeck = false;       // true while MakerDeck embed is active\nlet _onMeshPrep = false;        // true while Mesh Prep embed is active\nlet _onPainter = false;", 'state')
rep("    ['MakerDeck', '#/makerdeck', 'Design boxes, pencil cases, lids — export STL and 3MF'],\n    ['STL Painter'", "    ['MakerDeck', '#/makerdeck', 'Design boxes, pencil cases, lids — export STL and 3MF'],\n    ['Mesh Prep', '#/meshprep', 'Inspect STL health, repair safe defects, and resolve mesh intersections'],\n    ['STL Painter'", 'command')
rep("  if (hash === '#/makerdeck') return { view: 'makerdeck' };\n  if (hash === '#/painter')", "  if (hash === '#/makerdeck') return { view: 'makerdeck' };\n  if (hash === '#/meshprep') return { view: 'meshprep' };\n  if (hash === '#/painter')", 'route')
rep("function _ensurePainterFrame() {", "function _ensureMeshPrepFrame() {\n  const frame = document.getElementById('meshprep-frame');\n  if (!frame || frame.dataset.loaded === '1') return;\n  frame.src = '/makerdeck/meshprep.html?v=651';\n  frame.dataset.loaded = '1';\n}\n\nfunction _ensurePainterFrame() {", 'ensure')
rep("  _onMakerDeck = route.view === 'makerdeck';\n  _onPainter", "  _onMakerDeck = route.view === 'makerdeck';\n  _onMeshPrep = route.view === 'meshprep';\n  _onPainter", 'router-state')
rep("  document.getElementById('view-makerdeck').hidden = route.view !== 'makerdeck';\n  document.getElementById('view-painter')", "  document.getElementById('view-makerdeck').hidden = route.view !== 'makerdeck';\n  document.getElementById('view-meshprep').hidden = route.view !== 'meshprep';\n  document.getElementById('view-painter')", 'view-hide')
rep("      (route.view === 'makerdeck' && href === '#/makerdeck') ||\n      (route.view === 'painter'", "      (route.view === 'makerdeck' && href === '#/makerdeck') ||\n      (route.view === 'meshprep' && href === '#/meshprep') ||\n      (route.view === 'painter'", 'active')
rep("  if (route.view === 'makerdeck') _ensureMakerDeckFrame();\n  if (route.view === 'painter')", "  if (route.view === 'makerdeck') _ensureMakerDeckFrame();\n  if (route.view === 'meshprep') _ensureMeshPrepFrame();\n  if (route.view === 'painter')", 'ensure-call')
rep("      `<a class=\"tab tab-makerdeck\" href=\"#/makerdeck\">MakerDeck</a>`,\n      `<a class=\"tab tab-painter\"", "      `<a class=\"tab tab-makerdeck\" href=\"#/makerdeck\">MakerDeck</a>`,\n      `<a class=\"tab tab-meshprep\" href=\"#/meshprep\">Mesh Prep</a>`,\n      `<a class=\"tab tab-painter\"", 'sidebar')
app.write_text(s, encoding='utf-8')

# --- Sidebar colour identity ---
css = Path('app/static/style.css')
s = css.read_text(encoding='utf-8')
marker = '/* Mesh Prep sidebar identity */'
if marker not in s:
    s += '''\n\n/* Mesh Prep sidebar identity */\n#tab-strip .tab-meshprep {\n  color: #d8b4fe;\n  border-left-color: rgba(184,117,255,.55);\n}\n#tab-strip .tab-meshprep:hover {\n  color: #f0e3ff;\n  background: rgba(184,117,255,.10);\n}\n#tab-strip .tab-meshprep.active {\n  color: #f3e8ff;\n  background: linear-gradient(90deg, rgba(184,117,255,.20), rgba(184,117,255,.06));\n  box-shadow: inset 3px 0 0 #b875ff;\n}\n.meshprep-page iframe { width:100%; height:100%; border:0; display:block; }\n'''
css.write_text(s, encoding='utf-8')

# --- Undo the earlier wrong target inside MakerDeck, but retain Clear Model ---
nav = Path('makerforge/js/nav.js')
s = nav.read_text(encoding='utf-8')
s = s.replace("  { id: 'container', label: 'Container', href: 'index.html' },\n  { id: 'meshprep',  label: 'Mesh Prep', href: 'meshprep.html' },\n  { id: 'painter',   label: 'STL Painter', href: 'painter.html' },\n  { id: 'paper3d',   label: 'Paper3D', href: 'paper3d.html' },", "  { id: 'container', label: 'Container', href: 'index.html' },\n  { id: 'painter',   label: 'STL Painter', href: 'painter.html' },\n  { id: 'paper3d',   label: 'Paper3D', href: 'paper3d.html' },\n  { id: 'meshprep',  label: 'Mesh Prep', href: 'meshprep.html' },")
s = s.replace('class="md-nav-link md-nav-link--${t.id}${t.id === active ? \' active\' : \'\'}"', 'class="md-nav-link${t.id === active ? \' active\' : \'\'}"')
nav.write_text(s, encoding='utf-8')

mdcss = Path('makerforge/css/makerdeck.css')
s = mdcss.read_text(encoding='utf-8')
block = '''\n/* Mesh Prep has its own violet identity across MakerDeck. */\n.md-nav-link--meshprep{color:#c9a7ff}\n.md-nav-link--meshprep:hover{color:#eadcff;background:rgba(184,117,255,.13)}\n.md-nav-link--meshprep.active{color:#d9bfff;background:rgba(184,117,255,.18);box-shadow:inset 0 0 0 1px rgba(184,117,255,.24)}\n'''
s = s.replace(block, '\n')
mdcss.write_text(s, encoding='utf-8')

midx = Path('makerforge/index.html')
s = midx.read_text(encoding='utf-8')
wrong = '''          <a href="meshprep.html" class="btn btn-secondary" style="text-decoration:none;display:inline-flex;align-items:center;gap:5px;color:#d9bfff;border-color:rgba(184,117,255,.65);background:rgba(184,117,255,.10);box-shadow:inset 0 0 0 1px rgba(184,117,255,.08)" title="Open Mesh Prep">◆ Mesh Prep</a>\n          <a href="painter.html?v=626" class="btn btn-secondary" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px" title="Open STL Painter">STL Painter</a>\n          <a href="paper3d.html" class="btn btn-secondary" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px" title="Open Paper3D">Paper3D</a>'''
right = '''          <a href="painter.html?v=626" class="btn btn-secondary" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px" title="Open STL Painter">STL Painter</a>\n          <a href="paper3d.html" class="btn btn-secondary" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px" title="Open Paper3D">Paper3D</a>\n          <a href="meshprep.html" class="btn btn-secondary" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px" title="Open Mesh Prep">Mesh Prep</a>'''
s = s.replace(wrong, right)
midx.write_text(s, encoding='utf-8')
