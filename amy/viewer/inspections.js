/* On-demand camera evidence. Never operates a printer. */
(() => {
  'use strict';
  const dialog = document.getElementById('companion-dialog');
  const section = document.createElement('section');
  section.id = 'inspection-section';
  section.innerHTML = `
    <h3>Print inspection</h3>
    <p class="companion-muted">A fresh camera image is sent to Amy’s configured AI service for assessment. Close-up detail may need a closer photo.</p>
    <form id="inspection-form">
      <div class="companion-row"><select id="inspection-printer" aria-label="Printer to inspect" required><option value="">Choose a printer</option></select><button type="button" id="inspection-reload">Refresh printers</button></div>
      <div class="companion-row"><input id="inspection-question" aria-label="What to inspect" value="Check the visible print and first layer." required maxlength="1000"><button id="inspection-run">Check camera</button></div>
    </form>
    <p id="inspection-status" role="status"></p>
    <div id="inspection-result" hidden>
      <p id="inspection-caption"></p>
      <img id="inspection-image" alt="Printer camera snapshot under review">
      <small id="inspection-freshness"></small>
      <p id="inspection-answer"></p>
      <button type="button" id="inspection-save">Save image & observations to current project</button>
    </div>
    <small>On-demand checks only. Unsaved images expire after 24 hours or ten newer checks; saved project images are kept.</small>`;
  dialog.querySelector('section').before(section);
  const $ = id => document.getElementById('inspection-' + id);
  const open = document.createElement('button');
  open.type = 'button'; open.id = 'inspection-open'; open.textContent = 'PRINT CHECK · camera inspection';
  // Keep the rail control outside the transformed HUD so fixed positioning uses the window.
  document.body.append(open);
  let latest = null, busy = false, loaded = false, previousId = null;
  const storageKey = 'amy-displayed-inspection';
  const status = text => { $('status').textContent = text; };
  function kind(text) {
    const q = String(text).replace(/^(?:(?:hey amy|amy|hey|please|can you|could you|would you)[ ,:]*)+/i, '').replace(/[.!?]+$/, '');
    if (/^save (?:that|this|(?:the|that|this) (?:inspection|print check))\b/i.test(q)) return 'save';
    if (/^(?:check|inspect|look at|have a look at)\b/i.test(q) && /\b(first layer|prints?|printers?|camera|bed|big ?boy|big ?girl|little ?boy|h2[dc]|x1c?|o1c2|greyhound|voron)\b/i.test(q) && !/\b(status|temperature|temps?|queue|spool|filament level)\b/i.test(q)) return 'inspect';
    if (/^what(?:'s| is| looks) wrong with (?:this|the|.+?['’]s) print\b/i.test(q)) return 'inspect';
    return null;
  }
  function rememberId(id) { try { if (id) sessionStorage.setItem(storageKey,id); else sessionStorage.removeItem(storageKey); } catch (_) {} }
  function render(record) {
    latest = record; rememberId(record?.id);
    $('result').hidden = !record;
    $('image').removeAttribute('src');
    if (!record) { open.textContent = 'PRINT CHECK · camera inspection'; return; }
    $('image').src = record.image_url;
    $('caption').textContent = `${record.printer_name} · retrieved ${new Date(record.created*1000).toLocaleString()}`;
    $('freshness').textContent = record.freshness;
    $('answer').textContent = record.answer;
    $('save').disabled = !!record.project_id || busy;
    $('save').textContent = record.project_id ? 'Saved in project notebook' : 'Save image & observations to current project';
    open.textContent = `PRINT CHECK · ${record.printer_name} · view image`;
  }
  function setBusy(value) {
    busy = value;
    $('run').disabled = value;
    $('save').disabled = value || !latest || !!latest.project_id;
  }
  async function api(path, body) {
    const r = await fetch('/api/inspections' + path, {cache:'no-store', signal:AbortSignal.timeout(150000),
      ...(body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
    const payload = await r.json();
    if (!r.ok) throw new Error(payload.detail || 'Camera check failed.');
    return payload;
  }
  async function printers() {
    try {
      const value = $('printer').value;
      const data = await api('/printers');
      $('printer').replaceChildren(new Option('Choose a printer', ''));
      data.printers.forEach(p => $('printer').add(new Option(`${p.name} · ${p.state}`, p.id)));
      $('printer').value = value;
      loaded = true;
    } catch (error) { status(error.message); }
  }
  function reveal() {
    if (!dialog.open) dialog.showModal();
    section.scrollIntoView({block:'start'});
    if (!loaded) printers();
  }
  function receive(payload) {
    if (payload.tool !== 'inspection') return;
    if (payload.inspection) render(payload.inspection);
    status(payload.inspection && !payload.inspection.project_id ? (payload.ok ? 'Camera check ready. Open a project to file this image and assessment.' : 'Image available; assessment failed.') : payload.answer || '');
    if (!payload.inspection && !latest) open.textContent = 'PRINT CHECK · camera inspection';
    window.dispatchEvent(new Event('amy-companion-changed'));
  }
  window.AmyInspection = {
    handles: text => !!kind(text), currentId: () => previousId || latest?.id || null,
    begin(text) { if (kind(text)) { previousId = latest?.id || null; setBusy(true); if (kind(text) === 'inspect') render(null); status(kind(text) === 'inspect' ? 'Retrieving a camera image and checking visible details…' : 'Saving the displayed inspection…'); } },
    end() { previousId = null; setBusy(false); }, receive,
  };
  open.addEventListener('click', reveal);
  document.getElementById('companion-open').addEventListener('click', () => { if (!loaded) printers(); });
  $('reload').addEventListener('click', printers);
  $('form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); render(null); status('Retrieving a camera image and checking visible details…');
    try { receive(await api('', {action:'inspect',printer_id:$('printer').value,question:$('question').value})); }
    catch (error) { status(error.message); }
    finally { setBusy(false); }
  });
  $('save').addEventListener('click', async () => {
    if (!latest || busy) return;
    setBusy(true);
    try { receive(await api('', {action:'save',id:latest.id})); }
    catch (error) { status(error.message); }
    finally { setBusy(false); }
  });
  window.addEventListener('amy-project-inspections', event => {
    const target = document.getElementById('companion-inspections');
    if (!target) return;
    target.replaceChildren();
    for (const record of event.detail || []) {
      const card = document.createElement('div'); card.className = 'companion-card';
      const caption = document.createElement('p');
      caption.textContent = `${record.printer_name} · ${new Date(record.created*1000).toLocaleString()}`;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'View saved inspection';
      button.addEventListener('click', () => { if (!busy) { render(record); status('Saved project evidence — this is a past image.'); reveal(); } });
      card.append(caption,button); target.append(card);
    }
  });
  (async () => {
    let id; try { id = sessionStorage.getItem(storageKey); } catch (_) {}
    if (id && /^[a-f0-9]{32}$/.test(id)) {
      try { const data = await api('/'+id); if (!busy && !latest) render(data.inspection); }
      catch (_) { rememberId(null); }
    }
  })();
})();
