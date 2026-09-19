const HANDS = "http://127.0.0.1:4701";
const POLL_ALARM = "amy-hands-poll";

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
    // Hands companion not running — silent.
  }
}

function armAlarm() {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.025 }); // ~1.5s (min Chrome allows ~1 min on some builds; 0.025≈1.5s where supported)
}

chrome.runtime.onInstalled.addListener(() => {
  armAlarm();
  poll();
});
chrome.runtime.onStartup.addListener(() => {
  armAlarm();
  poll();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) poll();
});
// Also poke on click so you can wake it from the toolbar.
chrome.action.onClicked.addListener(() => {
  armAlarm();
  poll();
});

armAlarm();
poll();
