importScripts("i18n.js", "common.js");

// Receive a paper ID and open the handler page (open.html) for it in a new tab.
// For a journal PDF the tab the link was clicked in is passed along (src): if the publisher refuses the extension's own
// request, open.js can ask that very page to fetch the same PDF (see fetchThroughPage in open.js).
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === "open-journal") {
    let url = chrome.runtime.getURL("open.html") + "?doi=" + encodeURIComponent(message.doi) + "&pdf=" + encodeURIComponent(message.pdf);
    if (sender && sender.tab && Number.isInteger(sender.tab.id)) url += "&src=" + sender.tab.id;
    chrome.tabs.create({ url });
  } else if (message && message.type === "open-ads") {
    let url = chrome.runtime.getURL("open.html") + "?ads=" + encodeURIComponent(message.bibcode) + "&pdf=" + encodeURIComponent(message.pdf) +
      "&title=" + encodeURIComponent(message.title || "") + "&authors=" + encodeURIComponent(JSON.stringify(message.authors || []));
    if (sender && sender.tab && Number.isInteger(sender.tab.id)) url += "&src=" + sender.tab.id;
    chrome.tabs.create({ url });
  } else if (message && message.type === "open-paper") {
    let url = chrome.runtime.getURL("open.html") + "?id=" + encodeURIComponent(message.id);
    if (message.version) url += "&v=" + encodeURIComponent(message.version);
    chrome.tabs.create({ url });
  }
});

// Clicking the toolbar icon opens the paper library in a normal tab
// (a folder picker opened from a popup closes the popup and can crash the browser).
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("library.html") }));

// Register the link-watching script on exactly the sites in the list that we have permission for.
const SCRIPT_ID = "paper-links";
let syncQueue = Promise.resolve();

function syncScripts() {
  syncQueue = syncQueue.then(async () => {
    const matches = [];
    for (const host of await getSites()) {
      const pattern = "https://" + host + "/*";
      if (await chrome.permissions.contains({ origins: [pattern] })) matches.push(pattern);
    }
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    if (matches.length) {
      await chrome.scripting.registerContentScripts([
        { id: SCRIPT_ID, matches, js: ["content.js"], runAt: "document_start" },
      ]);
    }
  }).catch((e) => console.error("syncScripts failed", e));
  return syncQueue;
}

// Users who customized their site list get newly added publisher sites once (sites they removed stay removed).
// "publisherSitesSeen" remembers which publisher sites have already been offered.
async function addPublisherSites() {
  const stored = await chrome.storage.local.get(["sites", "publishersAdded", "publisherSitesSeen"]);
  const seen = stored.publisherSitesSeen || (stored.publishersAdded ? FIRST_PUBLISHER_SITES : []);
  const fresh = PUBLISHER_SITES.filter((h) => !seen.includes(h));
  if (!fresh.length) return;
  const update = { publisherSitesSeen: PUBLISHER_SITES };
  if (stored.sites) update.sites = [...stored.sites, ...fresh.filter((h) => !stored.sites.includes(h))];
  await chrome.storage.local.set(update);
}

chrome.runtime.onInstalled.addListener(() => addPublisherSites().then(syncScripts));
chrome.runtime.onStartup.addListener(syncScripts);
chrome.permissions.onAdded.addListener(syncScripts);
chrome.permissions.onRemoved.addListener(syncScripts);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.sites) syncScripts();
});

// The same on/off switch is also in the toolbar icon's right-click menu; the badge shows "off" while it is off.
const MENU_ID = "capture";

async function applyCaptureState() {
  const on = await isCaptureEnabled();
  chrome.action.setBadgeText({ text: on ? "" : "off" });
  chrome.action.setBadgeBackgroundColor({ color: "#777777" });
  chrome.contextMenus.update(MENU_ID, { checked: on }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(async () => {
  await setLanguageFromStorage();
  await chrome.contextMenus.removeAll(); // avoids a duplicate-id error when the extension is reloaded
  chrome.contextMenus.create({ id: MENU_ID, title: tr("menu.handle"), type: "checkbox", contexts: ["action"], checked: await isCaptureEnabled() });
  applyCaptureState();
});
chrome.runtime.onStartup.addListener(async () => {
  await setLanguageFromStorage();
  chrome.contextMenus.update(MENU_ID, { title: tr("menu.handle") }).catch(() => {});
  applyCaptureState();
});
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID) chrome.storage.local.set({ captureEnabled: info.checked });
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes.captureEnabled) applyCaptureState();
  if (changes.language) {
    await setLanguageFromStorage();
    chrome.contextMenus.update(MENU_ID, { title: tr("menu.handle") }).catch(() => {});
  }
});

// ---- A notification when a new announcement of Today's arXiv is out (off until the user switches it on in Settings) ----
// Every NOTIFY_PERIOD_MIN minutes an alarm wakes this worker; by the clock it asks arXiv's feed only while an announcement is
// due and not yet notified, at most NOTIFY_MAX_TRIES times per announcement (a holiday has none). It only counts the papers:
// no AI is involved and nothing else is fetched. `todayNotifyState` = { seen: date of the last announcement notified (or
// skipped at switching on), expected, tries } stays on this computer.
const NOTIFY_ALARM = "today-notify";
const NOTIFY_PERIOD_MIN = 30;
const NOTIFY_MAX_TRIES = 8;
const NOTIFY_ID_PREFIX = "today-";

async function syncNotifyAlarm() {
  const { todayNotify } = await chrome.storage.local.get("todayNotify");
  const alarm = await chrome.alarms.get(NOTIFY_ALARM);
  if (todayNotify && !alarm) {
    // (what was announced before switching on is not news)
    await chrome.storage.local.set({ todayNotifyState: { seen: lastAnnouncedDate(Date.now() - FEED_MARGIN_MS), expected: "", tries: 0 } });
    chrome.alarms.create(NOTIFY_ALARM, { periodInMinutes: NOTIFY_PERIOD_MIN, delayInMinutes: 1 });
  } else if (!todayNotify && alarm) {
    await chrome.alarms.clear(NOTIFY_ALARM);
    await chrome.storage.local.remove("todayNotifyState");
  }
}

// Returns what it did, as a word (for the tests): "off", "no-permission", "no-categories", "up-to-date", "gave-up", "failed",
// "waiting" (the feed does not show the new announcement yet), "empty" (it has no new paper of these categories), "notified".
async function checkTodayNotify(now = Date.now()) {
  const { todayNotify, todayNotifyState } = await chrome.storage.local.get(["todayNotify", "todayNotifyState"]);
  if (!todayNotify) return "off";
  if (!(await chrome.permissions.contains({ permissions: ["notifications"] }))) return "no-permission";
  const categories = await getArxivCategories();
  if (!categories.length) return "no-categories";
  const expected = lastAnnouncedDate(now - FEED_MARGIN_MS);
  const state = todayNotifyState || { seen: expected, expected: "", tries: 0 };
  if (state.seen >= expected) return "up-to-date";
  const tries = state.expected === expected ? state.tries : 0;
  if (tries >= NOTIFY_MAX_TRIES) return "gave-up";
  await chrome.storage.local.set({ todayNotifyState: { seen: state.seen, expected, tries: tries + 1 } }); // (counted before asking: a failing request is not repeated without limit)
  let found;
  try {
    const res = await arxivApiFetch(arxivFeedUrl(categories));
    const text = res.ok ? await res.text() : "";
    if (!/<rss[\s>]/.test(text)) return "failed";
    found = countArxivAnnouncement(text);
  } catch (e) {
    return "failed";
  }
  if (!found.date || found.date <= state.seen) return "waiting";
  await chrome.storage.local.set({ todayNotifyState: { seen: found.date, expected, tries: 0 } });
  if (!found.count) return "empty";
  await setLanguageFromStorage();
  const names = categories.length > 5 ? categories.slice(0, 5).join(", ") + "..." : categories.join(", ");
  chrome.notifications.create(NOTIFY_ID_PREFIX + found.date, {
    type: "basic", iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title: tr("notify.title"), message: tr("notify.body", { n: found.count, cats: names }),
  });
  return "notified";
}

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === NOTIFY_ALARM) checkTodayNotify(); });
// (chrome.notifications exists only once the user has allowed it, which happens when the switch is turned on: then this runs again)
let clickListening = false;
function listenForNotificationClicks() {
  if (clickListening || !chrome.notifications) return;
  clickListening = true;
  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith(NOTIFY_ID_PREFIX)) return;
    chrome.notifications.clear(id);
    chrome.tabs.create({ url: chrome.runtime.getURL("today.html") });
  });
}
listenForNotificationClicks();
chrome.permissions.onAdded.addListener(listenForNotificationClicks);
chrome.runtime.onInstalled.addListener(syncNotifyAlarm);
chrome.runtime.onStartup.addListener(() => syncNotifyAlarm().then(() => checkTodayNotify())); // (an announcement made while Chrome was closed)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.todayNotify) syncNotifyAlarm().then(() => checkTodayNotify());
});
