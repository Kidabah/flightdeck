/* Persistent notebook and alert delivery. Existing Amy speech owns the microphone. */
(() => {
  'use strict';
  window.AmyCompanion = {
    handles(text) {
      const q = String(text).replace(/^(?:(?:hey amy|amy|please|can you|could you|would you)[ ,:]*)+/i, '');
      return /^(?:remind me|remember|note to self|log this|don['’]?t let me forget|(?:set|start).*\btimer\b|cancel.*\b(?:timer|reminder)|(?:list|show|what).*\b(?:timers|reminders|projects)|(?:work on|switch to|open).*\bproject|(?:create|select) (?:a )?project|(?:leave|close|clear).*\bproject|where did we get to|project recap|what(?:'s| is) my current project|i['’]?m (?:away|back)|i am (?:away|back)|away mode|(?:turn |switch )?(?:printer )?(?:announcements|printer alerts)|(?:enable|disable) (?:printer )?(?:announcements|alerts)|(?:show|list|open).*\b(?:chat|conversation) history|what did we talk about|(?:search|find).*\b(?:chat|conversation) history|(?:clear|delete|forget|erase).*\b(?:chat|conversation) history)/i.test(q);
    },
  };
  const button = document.createElement('button');
  button.id = 'companion-open';
  button.type = 'button';
  button.textContent = 'NOTEBOOK · timers, projects & alerts';
  // The notebook belongs in Amy's left notes rail, directly below the folders.
  const notebookSlot = document.getElementById('notebook-slot');
  (notebookSlot || document.body).append(button);
  const dialog = document.createElement('dialog');
  dialog.id = 'companion-dialog';
  dialog.setAttribute('aria-labelledby', 'companion-title');
  dialog.innerHTML = `
    <div class="companion-row companion-head"><h2 id="companion-title">Amy’s notebook</h2><button type="button" id="companion-close">Close</button></div>
    <p class="companion-muted">Timers, project notes and printer updates, saved between visits.</p>
    <p id="companion-feedback" role="status"></p>
    <section><h3>Timers & reminders</h3>
      <form id="companion-timer-form" class="companion-row">
        <input name="label" aria-label="Reminder name" placeholder="Check the first layer" required maxlength="160">
        <input name="duration" aria-label="Duration" placeholder="5 minutes" required>
        <button>Add timer</button>
      </form><div id="companion-timers"></div>
      <small>Say “remind me to check the first layer in five minutes”. If Amy is closed, overdue reminders appear when she opens.</small>
    </section>
    <section><h3>Project memory</h3>
      <div class="companion-row"><select id="companion-project-select" aria-label="Saved projects"><option value="">Choose a project</option></select><button type="button" id="companion-project-clear">Close project</button></div>
      <form id="companion-project-form" class="companion-row"><input name="name" aria-label="New project name" placeholder="Windmill" required maxlength="80"><button>Create / open</button></form>
      <p id="companion-project-title"></p>
      <form id="companion-note-form"><textarea name="body" aria-label="Project note" placeholder="Dimensions, filament, what worked, what to try next…" required maxlength="4000"></textarea><button>Save note</button></form>
      <div id="companion-notes"></div>
    </section>
    <section><h3>Chat history</h3>
      <p class="companion-muted">Saved text conversations Amy can remember after a restart. Attachments themselves are not stored here.</p>
      <form id="companion-history-search" class="companion-row"><input name="query" aria-label="Search chat history" placeholder="Search saved conversations" maxlength="200"><button>Search</button><button type="button" id="companion-history-clear-search">Show all</button></form>
      <div class="companion-row"><small id="companion-history-count"></small><button type="button" id="companion-history-clear">Clear saved chat history</button></div>
      <div id="companion-history" aria-live="polite"></div>
    </section>
    <section><h3>Announcements</h3>
      <div class="companion-row"><label><input type="checkbox" id="companion-announcements"> Printer announcements</label><label><input type="checkbox" id="companion-away"> I’m away</label></div>
      <form id="companion-quiet-form" class="companion-row"><label>Quiet from <input type="time" name="start" aria-label="Quiet hours start"></label><label>until <input type="time" name="end" aria-label="Quiet hours end"></label><button>Save hours</button><button type="button" id="companion-quiet-clear">Clear hours</button></form>
      <small id="companion-voice-status"></small><p id="companion-monitor" class="companion-muted"></p>
      <div id="companion-events" aria-live="polite"></div>
    </section>`;
  document.body.append(dialog);
  const find = id => document.getElementById('companion-' + id);
  const feedback = message => { find('feedback').textContent = message; };
  const owner = globalThis.crypto?.randomUUID?.() || 'listener-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  let state = null, loading = false, delivering = false, renderKey = '', speechCooldown = 0;
  let historyQuery = '', historyData = null, historyLoading = false;
  let settingsDirty = false;
  const api = async (path, body) => {
    const response = await fetch('/api/companion' + path, {
      ...(body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}),
      cache:'no-store', signal:AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'The notebook could not save that.');
    return data;
  };
  const historyApi = async (query = '') => {
    const response = await fetch('/api/history?q=' + encodeURIComponent(query), {cache:'no-store', signal:AbortSignal.timeout(10000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Chat history is unavailable.');
    return data;
  };
  const historyAction = async body => {
    const response = await fetch('/api/history', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), cache:'no-store', signal:AbortSignal.timeout(10000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Chat history could not be changed.');
    return data;
  };
  const mutate = async (body, message) => {
    await api('', body);
    if (message) feedback(message);
    await refresh();
  };
  const safe = fn => async event => {
    event?.preventDefault();
    const submit = event?.submitter;
    if (submit) submit.disabled = true;
    try { await fn(event); } catch (error) { feedback(error.message); }
    finally { if (submit) submit.disabled = false; }
  };
  function card(container, text, subtitle, action) {
    const item = document.createElement('div');
    item.className = 'companion-card';
    const row = document.createElement('div');
    row.className = 'companion-row';
    const content = document.createElement('p');
    content.textContent = text;
    row.append(content);
    if (action) {
      const control = document.createElement('button');
      control.type = 'button'; control.textContent = action.label;
      control.addEventListener('click', safe(action.run));
      row.append(control);
    }
    item.append(row);
    if (subtitle) { const small = document.createElement('small'); small.textContent = subtitle; item.append(small); }
    container.append(item);
  }
  function remaining(due) {
    const seconds = Math.max(0, Math.ceil(due - Date.now()/1000));
    if (seconds < 60) return `${seconds}s left`;
    if (seconds < 3600) return `${Math.floor(seconds/60)}m ${seconds%60}s left`;
    return `${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m left`;
  }
  function renderHistory() {
    if (!historyData) return;
    find('history-count').textContent = historyData.query
      ? `${historyData.entries.length} matching entr${historyData.entries.length === 1 ? 'y' : 'ies'} · ${historyData.count} saved overall.`
      : `${historyData.count} saved entr${historyData.count === 1 ? 'y' : 'ies'}.`;
    const container = find('history'); container.replaceChildren();
    if (!historyData.entries.length) { container.textContent = historyData.query ? 'No matching saved conversations.' : 'No saved chat yet.'; return; }
    historyData.entries.forEach(entry => {
      const item = document.createElement('div'); item.className = 'companion-card history-card';
      const head = document.createElement('div'); head.className = 'companion-row';
      const title = document.createElement('strong'); title.textContent = entry.role === 'user' ? 'Chris' : 'Amy';
      const when = document.createElement('small'); when.textContent = new Date(entry.created * 1000).toLocaleString();
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Forget';
      remove.addEventListener('click', safe(async () => { await historyAction({action:'delete',id:entry.id}); await loadHistory(); }));
      head.append(title, when, remove); item.append(head);
      const body = document.createElement('p'); body.textContent = entry.content; item.append(body);
      container.append(item);
    });
  }
  async function loadHistory(query = historyQuery) {
    if (historyLoading) return;
    historyLoading = true; historyQuery = query;
    try { historyData = await historyApi(query); renderHistory(); }
    catch (error) { find('history').textContent = error.message; }
    finally { historyLoading = false; }
  }
  function render() {
    if (!state) return;
    const unread = state.events.filter(e => !e.acknowledged).length;
    button.textContent = `NOTEBOOK · ${state.timers.length} timer${state.timers.length === 1 ? '' : 's'}${unread ? ` · ${unread} alert${unread === 1 ? '' : 's'}` : ''}`;
    button.classList.toggle('has-alert', unread > 0);
    const timers = find('timers'); timers.replaceChildren();
    state.timers.forEach(t => card(timers, `${t.label} · ${remaining(t.due)}`, `Timer ${t.id}`, {label:'Cancel',run:() => mutate({action:'cancel_timer',target:String(t.id)}, 'Timer cancelled.')}));
    if (!state.timers.length) timers.textContent = 'No active timers.';
    const key = JSON.stringify([state.projects,state.project,state.events]);
    if (key !== renderKey) {
      renderKey = key;
      const select = find('project-select'); select.replaceChildren(new Option('Choose a project', ''));
      state.projects.forEach(p => select.add(new Option(p.name, p.name)));
      select.value = state.project?.name || '';
      find('project-title').textContent = state.project ? `Working on ${state.project.name}` : 'Choose a project to save notes.';
      find('note-form').hidden = !state.project;
      const notes = find('notes'); notes.replaceChildren();
      (state.project?.notes || []).forEach(n => card(notes, n.body, new Date(n.created*1000).toLocaleString()));
      window.dispatchEvent(new CustomEvent('amy-project-inspections', {detail:state.project?.inspections || []}));
      const events = find('events'); events.replaceChildren();
      state.events.filter(e => !e.acknowledged).forEach(e => card(events, e.message, new Date(e.created*1000).toLocaleString(), {label:'Dismiss',run:() => mutate({action:'event',id:e.id,event_action:'ack'}, 'Alert dismissed.')}));
      if (!events.childElementCount) events.textContent = 'No new alerts.';
    }
    find('announcements').checked = state.settings.announcements;
    find('away').checked = state.settings.away;
    if (!settingsDirty) {
      find('quiet-form').elements.start.value = state.settings.quiet_start;
      find('quiet-form').elements.end.value = state.settings.quiet_end;
    }
    find('voice-status').textContent = `Quiet hours use ${state.timezone}. ${state.settings.away || state.quiet ? 'Spoken alerts are paused; alerts remain here.' : 'Spoken alerts play while Amy is open, awake and audio is enabled.'}`;
    find('monitor').textContent = state.monitor.error || (state.monitor.checked ? 'Printer status checked ' + new Date(state.monitor.checked*1000).toLocaleTimeString() + '.' : 'Waiting for Flightdeck printer status…');
    if (dialog.open && !historyData) loadHistory();
  }
  function canSpeak() {
    return !MUTE && unlockedAudio && !asleep && !isSpeaking && !chatAbort && !desktopMic.busy && !desktopMic.speaking && !pending && !inputEl.value.trim() && Date.now() > speechCooldown;
  }
  async function deliver() {
    if (delivering || !state || state.settings.away || state.quiet || !canSpeak()) return;
    const event = [...state.events].reverse().find(e => !e.acknowledged && !e.spoken && (e.kind === 'timer' || (state.settings.announcements && e.created > Date.now()/1000 - 300)));
    if (!event) return;
    delivering = true;
    let claimed = false;
    try {
      const claim = await api('', {action:'event',id:event.id,event_action:'claim',owner});
      if (!claim.claimed) return;
      claimed = true;
      if (!canSpeak()) return;
      // Mark delivery once before speaking: reloads and a second tab cannot repeat it.
      await api('', {action:'event',id:event.id,event_action:'spoken',owner});
      claimed = false;
      event.spoken = 1;
      speechCooldown = Date.now() + 7000;
      await speak(event.message);
    } catch (error) { console.warn('Amy alert delivery:', error.message); }
    finally {
      if (claimed) { try { await api('', {action:'event',id:event.id,event_action:'release',owner}); } catch (_) {} }
      delivering = false;
    }
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    try { state = await api(''); render(); }
    catch (error) { button.textContent = 'NOTEBOOK · connection unavailable'; if (dialog.open) feedback(error.message); }
    finally { loading = false; }
    await deliver();
  }
  button.addEventListener('click', () => { dialog.showModal(); refresh(); loadHistory(); });
  find('close').addEventListener('click', () => dialog.close());
  find('timer-form').addEventListener('submit', safe(async e => {
    const form = e.currentTarget;
    await mutate({action:'add_timer',label:form.elements.label.value,duration:form.elements.duration.value}, 'Timer saved.');
    form.reset();
  }));
  find('project-form').addEventListener('submit', safe(async e => {
    const form = e.currentTarget;
    await mutate({action:'select_project',name:form.elements.name.value}, 'Project opened.'); form.reset();
  }));
  find('project-select').addEventListener('change', safe(async e => {
    if (e.target.value) await mutate({action:'select_project',name:e.target.value}, 'Project opened.');
  }));
  find('project-clear').addEventListener('click', safe(() => mutate({action:'close_project'}, 'Project closed; notes are saved.')));
  find('note-form').addEventListener('submit', safe(async e => {
    const form = e.currentTarget;
    await mutate({action:'add_note',body:form.elements.body.value}, 'Note saved.'); form.reset();
  }));
  for (const id of ['announcements','away']) find(id).addEventListener('change', safe(e => mutate({action:'settings',changes:{[id]:e.target.checked}})));
  find('quiet-form').addEventListener('input', () => { settingsDirty = true; });
  find('quiet-form').addEventListener('submit', safe(async e => {
    await mutate({action:'settings',changes:{quiet_start:e.currentTarget.elements.start.value,quiet_end:e.currentTarget.elements.end.value}}, 'Quiet hours saved.');
    settingsDirty = false;
  }));
  find('quiet-clear').addEventListener('click', safe(async () => {
    settingsDirty = false;
    await mutate({action:'settings',changes:{quiet_start:'',quiet_end:''}}, 'Quiet hours cleared.');
  }));
  find('history-search').addEventListener('submit', safe(async event => {
    await loadHistory(event.currentTarget.elements.query.value.trim());
  }));
  find('history-clear-search').addEventListener('click', safe(async () => {
    find('history-search').elements.query.value = '';
    await loadHistory('');
  }));
  find('history-clear').addEventListener('click', safe(async () => {
    if (!window.confirm('Clear all saved chat history from Amy?')) return;
    await historyAction({action:'clear'});
    historyData = null;
    await loadHistory('');
    feedback('Saved chat history cleared.');
  }));
  window.addEventListener('amy-companion-changed', () => refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => refresh(), 2500);
  refresh();
})();
