const HANDS = "http://127.0.0.1:4701";

async function poll() {
  try {
    const r = await fetch(`${HANDS}/commands/next`);
    const data = await r.json();
    const cmd = data.command;
    if (!cmd) return;
    let result = { id: cmd.id, ok: false };
    try {
      if (cmd.action === "tabs_list") {
        const tabs = await chrome.tabs.query({});
        result = {
          id: cmd.id,
          ok: true,
          tabs: tabs.slice(0, 40).map(t => ({
            id: t.id,
            title: t.title || "",
            url: t.url || "",
            active: !!t.active,
            windowId: t.windowId,
          })),
        };
      } else if (cmd.action === "tabs_focus") {
        const q = String(cmd.query || "").toLowerCase();
        const tabs = await chrome.tabs.query({});
        const hit = tabs.find(t =>
          (t.title || "").toLowerCase().includes(q) || (t.url || "").toLowerCase().includes(q)
        );
        if (!hit) {
          result = { id: cmd.id, ok: false, detail: `No tab matched “${cmd.query}”` };
        } else {
          await chrome.windows.update(hit.windowId, { focused: true });
          await chrome.tabs.update(hit.id, { active: true });
          result = { id: cmd.id, ok: true, title: hit.title, url: hit.url };
        }
      } else if (cmd.action === "tabs_open") {
        const tab = await chrome.tabs.create({ url: cmd.url, active: true });
        result = { id: cmd.id, ok: true, title: tab.title, url: tab.url };
      } else {
        result = { id: cmd.id, ok: false, detail: `Unknown action ${cmd.action}` };
      }
    } catch (err) {
      result = { id: cmd.id, ok: false, detail: String(err) };
    }
    await fetch(`${HANDS}/commands/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
  } catch (_) {
    // Hands not running — silent.
  }
}

setInterval(poll, 800);
poll();
