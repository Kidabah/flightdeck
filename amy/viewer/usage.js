/* Billing credentials stay on Amy's server. This view only receives totals. */
(() => {
  const byId = id => document.getElementById(id);
  const money = n => n == null ? '—' : new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(n);
  let timer;
  let codexTimer;
  let suggestedBudget = null;
  const settings = byId('usage-settings');
  byId('usage-open').addEventListener('click', () => { settings.showModal(); refresh(); });
  byId('usage-close').addEventListener('click', () => settings.close());
  function render(data) {
    byId('usage-spend').textContent = money(data.spend);
    byId('usage-percent').textContent = data.percent == null ? '—' : data.percent.toFixed(1) + '%';
    byId('usage-progress').value = Math.max(0, Math.min(100, data.percent || 0));
    byId('usage-requests').textContent = data.requests == null ? '—' : data.requests.toLocaleString('en-US');
    byId('usage-remaining').textContent = money(data.remaining);
    byId('usage-budget-label').textContent = money(data.budget);
    if (!settings.open) byId('usage-budget').value = data.budget;
    byId('usage-period').textContent = 'Period ends ' + data.period_end + ' (UTC) · ' + data.scope;
    const synced = data.cost_updated_at ? ' Synced ' + new Date(data.cost_updated_at * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + '.' : '';
    byId('usage-note').textContent = data.status === 'unconfigured'
      ? 'Reporting key needed. Add an OpenAI Admin API key to Amy’s server configuration.'
      : data.error ? 'Estimate · ' + data.error + synced
      : data.status === 'loading' && data.spend == null ? 'Fetching OpenAI reporting…'
      : 'Estimate · OpenAI reporting can lag.' + synced;
    byId('usage-ticker').dataset.warning = data.warning || '';
    byId('usage-warning').textContent = data.warning ? data.warning + '% budget threshold reached' : '';
    byId('usage-forecast').textContent = data.projected_spend == null
      ? 'This month’s projection needs at least one day of reported costs.'
      : 'This month: ' + money(data.spend) + ' so far · projected ' + money(data.projected_spend) + ' at the current daily rate (estimate).';
    const history = data.history || {};
    const months = history.months || [];
    const container = byId('usage-history');
    container.replaceChildren();
    const max = Math.max(1, ...months.map(m => Math.max(0, m.spend)));
    for (const month of months) {
      const row = document.createElement('div'); row.className = 'usage-month';
      const label = document.createElement('span');
      label.textContent = new Date(month.month + '-01T00:00:00Z').toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});
      const bar = document.createElement('progress'); bar.max = max; bar.value = Math.max(0,month.spend); bar.setAttribute('aria-label',label.textContent + ' spending');
      const amount = document.createElement('span'); amount.textContent = money(month.spend);
      row.append(label,bar,amount); container.append(row);
    }
    if (!months.length) container.textContent = data.status === 'unconfigured' ? 'Add the reporting key to see monthly history.' : history.history_error || (data.history_loading ? 'Fetching completed months…' : 'Monthly history unavailable.');
    const summary = data.history_summary || {};
    byId('usage-average').textContent = summary.average == null ? 'No spending reported in the completed months yet.' : 'Average: ' + money(summary.average) + ' across ' + summary.active_months + ' months with spending. Zero-spend months are excluded.';
    suggestedBudget = history.history_error ? null : summary.suggested_budget;
    byId('usage-suggestion').textContent = suggestedBudget == null ? 'Amy will suggest a budget once a completed month has reported spending.' : 'Suggested budget: ' + money(suggestedBudget) + ' · average plus 25% headroom, rounded up to a whole dollar.';
    byId('usage-apply-suggestion').disabled = suggestedBudget == null;
    byId('usage-settings-note').textContent = 'Estimate · ' + data.scope + '. UTC calendar months. History refreshes hourly. ' + (history.history_error || 'OpenAI reporting can lag. Budget changes require your approval.');
  }
  async function refresh() {
    clearTimeout(timer);
    try {
      const response = await fetch('/api/usage', {cache:'no-store', signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error();
      const data = await response.json();
      render(data);
      timer = setTimeout(refresh, data.status === 'loading' || (settings.open && data.history_loading) ? 10000 : 300000);
    } catch (_) {
      byId('usage-note').textContent = 'Estimate · Reporting connection unavailable. Retrying automatically.';
      timer = setTimeout(refresh, 300000);
    }
  }
  async function saveBudget(budget) {
    const buttons = [byId('usage-budget-form').querySelector('button'),byId('usage-apply-suggestion')];
    buttons.forEach(button => button.disabled = true);
    try {
      const response = await fetch('/api/usage/budget', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({budget}), signal:AbortSignal.timeout(10000)});
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not save budget.');
      byId('usage-budget').value = data.budget;
      render(data);
      byId('usage-settings-status').textContent = 'Budget saved: ' + money(data.budget);
    } catch (error) { byId('usage-settings-status').textContent = error.message; }
    finally { buttons[0].disabled = false; buttons[1].disabled = suggestedBudget == null; }
  }
  byId('usage-budget-form').addEventListener('submit', event => { event.preventDefault(); saveBudget(Number(byId('usage-budget').value)); });
  byId('usage-apply-suggestion').addEventListener('click', () => { if (suggestedBudget != null) saveBudget(suggestedBudget); });
  async function refreshCodex() {
    clearTimeout(codexTimer);
    try {
      const response = await fetch('/api/usage/codex',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if (response.status === 404) throw new Error('Amy’s server needs a restart to load Codex reporting.');
      if (!response.ok) throw new Error('Codex reporting request failed. Retrying automatically.');
      const data = await response.json();
      const container = byId('codex-windows');
      container.replaceChildren();
      for (const window of data.windows || []) {
        const label = window.duration_minutes === 10080 ? 'Weekly' : window.duration_minutes === 300 ? '5-hour' : window.duration_minutes ? (window.duration_minutes / 60) + '-hour' : 'Allowance';
        const row = document.createElement('div');
        row.textContent = label + ': ' + window.remaining_percent.toFixed(0) + '% left';
        const bar = document.createElement('progress'); bar.max = 100; bar.value = window.remaining_percent; bar.setAttribute('aria-label',label + ' allowance remaining');
        const reset = document.createElement('small');
        reset.textContent = window.resets_at ? 'Resets ' + new Date(window.resets_at * 1000).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Reset time unavailable';
        container.append(row,bar,reset);
      }
      byId('codex-note').textContent = data.error ? (data.windows ? 'Last reported figures · ' : '') + data.error : data.status === 'loading' && !data.windows ? 'Connecting to local Codex…' : 'ChatGPT plan allowance · refreshed every 5 minutes' + (data.updated_at ? ' · synced ' + new Date(data.updated_at*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '');
      codexTimer = setTimeout(refreshCodex,data.status === 'loading' ? 10000 : 300000);
    } catch (error) {
      byId('codex-note').textContent = error.message.startsWith('Amy’s') ? error.message : 'Codex connection unavailable. Retrying automatically.';
      codexTimer = setTimeout(refreshCodex,10000);
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCodex(); });
  window.addEventListener('pagehide', () => clearTimeout(codexTimer));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pagehide', () => clearTimeout(timer));
  refresh();
  refreshCodex();
})();
