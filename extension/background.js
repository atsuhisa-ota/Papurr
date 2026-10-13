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
