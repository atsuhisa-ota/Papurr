const folderStatus = document.getElementById("folder-status");
const siteStatus = document.getElementById("site-status");
const sitesEl = document.getElementById("sites");
const dbSitesEl = document.getElementById("sites-db");
const dbStatus = document.getElementById("db-status");
const newDbSiteEl = document.getElementById("new-db-site");
const newSiteEl = document.getElementById("new-site");
const newNameEl = document.getElementById("new-name");
const newTemplateEl = document.getElementById("new-template");

const originOf = (host) => "https://" + host + "/*";

// ---- Folder ----
async function refreshFolder() {
  const dir = await loadDir();
  folderStatus.textContent = dir ? tr("folder.current", { name: dir.name }) : tr("folder.none");
  await showFolderPath(dir);
}

// The full path of the folder. Chrome never tells it to an extension; the helper finds it on disk by the marker file
// (as for the external PDF app; on every system the helper runs on). The marker is only created when the helper is there, so that a folder of somebody who
// does not use the helper gets no extra file.
async function showFolderPath(dir) {
  const el = document.getElementById("folder-path");
  el.textContent = "";
  const os = await aiPlatform();
  if (!dir || helperOs(os) === "other" || (await dir.queryPermission({ mode: "readwrite" })) !== "granted") return;
  try {
    let token = ((await readFileText(dir, ".paper-folder-id")) || "").trim();
    if (!token) {
      await chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: "ping", viewer: "" }); // throws if there is no helper
      token = await ensureMarker(dir);
    }
    el.textContent = tr("folder.path.finding");
    const reply = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: "locate", token });
    el.textContent = reply && reply.ok ? reply.path : "";
  } catch (e) {
    el.textContent = tr("folder.path.nohelper");
  }
}

document.getElementById("choose").addEventListener("click", async () => {
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await saveDir(handle);
    await refreshFolder();
    await refreshImportNote();
  } catch (e) {
    if (e.name !== "AbortError") folderStatus.textContent = tr("err.generic", { msg: e.message });
  }
});

// ---- Opening papers ----
const openStatus = document.getElementById("open-status");
const viewerEl = document.getElementById("viewer");

// The setup steps and examples for this computer's system only.
const HELPER_TEXTS = {
  mac: ["helper.setup.mac", "viewer.placeholder.mac"],
  linux: ["helper.setup.linux", "viewer.placeholder.linux"],
  win: ["helper.setup.win", "viewer.placeholder.win"],
  other: ["helper.setup.other", ""],
};
const helperOs = (os) => (HELPER_TEXTS[os] ? os : "other");

async function loadOpenSettings() {
  const [setupKey, placeholderKey] = HELPER_TEXTS[helperOs(await aiPlatform())];
  viewerEl.placeholder = placeholderKey ? tr(placeholderKey) : "";
  await showHelperStatus(setupKey);
  const { openMode, viewer } = await getOpenSettings();
  document.querySelector('input[name="open-mode"][value="' + openMode + '"]').checked = true;
  viewerEl.value = viewer;
  await showOpenApp();
}

// Whether the helper program is registered (asking it is free): if not, say what it is for and point to Help, then show
// the steps for this computer's system.
async function showHelperStatus(setupKey) {
  const status = document.getElementById("helper-status");
  const setup = document.getElementById("helper-setup");
  status.textContent = "";
  setup.textContent = "";
  let ready = false;
  try {
    const reply = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: "ping", viewer: "" });
    ready = !!(reply && reply.ok);
  } catch (e) {} // no helper
  if (ready) return void (status.textContent = tr("helper.status.ok"));
  status.append(tr("helper.status.none") + " ");
  const link = document.createElement("a");
  link.href = "help.html#openwith";
  link.textContent = tr("helper.status.help");
  status.append(link);
  setup.textContent = tr(setupKey);
}

// With "External PDF app": which app will really open the PDFs (the system's default one when the box is empty).
async function showOpenApp() {
  const el = document.getElementById("open-app");
  el.textContent = "";
  const { openMode, viewer } = await getOpenSettings();
  if (openMode !== "external") return;
  try {
    const reply = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: "ping", viewer });
    if (reply && reply.ok && reply.app && reply.app.name) el.textContent = tr("viewer.app", { name: reply.app.name, path: reply.app.path ? " (" + reply.app.path + ")" : "" });
    else if (reply && !reply.ok) el.textContent = tr("viewer.problem", { msg: reply.error });
  } catch (e) {} // no helper: the setup hint below says what to do
}

for (const radio of document.querySelectorAll('input[name="open-mode"]')) {
  radio.addEventListener("change", async () => {
    await chrome.storage.local.set({ openMode: radio.value });
    await showOpenApp();
  });
}
viewerEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ viewer: viewerEl.value.trim() });
  await showOpenApp();
});

document.getElementById("test-viewer").addEventListener("click", async () => {
  await chrome.storage.local.set({ viewer: viewerEl.value.trim() });
  try {
    const reply = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: "ping", viewer: viewerEl.value.trim() });
    openStatus.textContent = reply && reply.ok ? tr("viewer.ok", { name: (reply.app && reply.app.name) || "?" }) : tr("viewer.problem", { msg: reply && reply.error });
    await showOpenApp();
  } catch (e) {
    openStatus.textContent = tr("viewer.unreachable", { msg: e.message });
  }
});

// ---- Sites ----
async function saveSites(sites) {
  await chrome.storage.local.set({ sites });
}

// A database (arXiv, INSPIRE, ADS, or a site added with a link icon) or a journal site (a publisher).
const isDatabase = (host, dbLinks) => DEFAULT_DB_LINKS.some((l) => l.host === host) || dbLinks.some((l) => l.host === host);

async function renderSites() {
  sitesEl.textContent = "";
  dbSitesEl.textContent = "";
  const dbLinks = await getDbLinks();
  for (const host of await getSites()) {
    const db = isDatabase(host, dbLinks);
    const li = document.createElement("li");
    const label = document.createElement("span");
    const hasIcon = dbLinks.some((l) => l.host === host);
    label.textContent = host + (DEFAULT_SITES.includes(host) ? " " + tr("site.default").trim() : "") + (hasIcon ? tr("site.withicon") : "");
    const btn = document.createElement("button");
    btn.textContent = tr("site.remove");
    btn.onclick = () => removeSite(host, db ? dbStatus : siteStatus);
    li.append(label, btn);
    (db ? dbSitesEl : sitesEl).append(li);
  }
}

// Accepts "scholar.google.com", "https://scholar.google.com/foo", or "*.example.org".
function parseHost(input) {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

// Build the link icon entry from the optional name/template fields (null if left blank).
function parseLink(host) {
  const name = newNameEl.value.trim();
  const template = newTemplateEl.value.trim();
  if (!name && !template) return { link: null };
  if (!name || !/^https:\/\/.+\{id\}/.test(template)) {
    return { error: tr("site.err.link") };
  }
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360; // same name -> same color
  const label = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 3) || name.slice(0, 2);
  return { link: { host, name, label, color: "hsl(" + hue + ", 45%, 35%)", template } };
}

// Add a site (a database with its link icon, or a journal site). Called first thing in a click, because Chrome
// shows its permission dialog only for a request made directly from the user's click.
async function addSite(host, link, statusEl) {
  const granted = await chrome.permissions.request({ origins: [originOf(host)] });
  if (!granted) {
    statusEl.textContent = tr("site.err.perm", { host });
    return false;
  }
  const sites = await getSites();
  if (!sites.includes(host)) await saveSites([...sites, host]);
  if (link) {
    const links = (await getDbLinks()).filter((l) => l.host !== host);
    await chrome.storage.local.set({ dbLinks: [...links, link] });
  }
  statusEl.textContent = tr("site.added", { host });
  await renderSites();
  return true;
}

document.getElementById("add-db").addEventListener("click", async () => {
  const host = parseHost(newDbSiteEl.value);
  if (!host) return (dbStatus.textContent = tr("site.err.invalid"));
  const { link, error } = parseLink(host);
  if (error || !link) return (dbStatus.textContent = error || tr("site.err.link")); // a database comes with its link icon
  if (await addSite(host, link, dbStatus)) newDbSiteEl.value = newNameEl.value = newTemplateEl.value = "";
});

document.getElementById("add").addEventListener("click", async () => {
  const host = parseHost(newSiteEl.value);
  if (!host) return (siteStatus.textContent = tr("site.err.invalid"));
  if (await addSite(host, null, siteStatus)) newSiteEl.value = "";
});

async function removeSite(host, statusEl) {
  await saveSites((await getSites()).filter((h) => h !== host));
  await chrome.storage.local.set({ dbLinks: (await getDbLinks()).filter((l) => l.host !== host) });
  try {
    await chrome.permissions.remove({ origins: [originOf(host)] }); // built-in sites cannot be revoked; that is fine
  } catch (e) {}
  statusEl.textContent = tr("site.removed", { host });
  await renderSites();
}

// "Restore defaults", separately for the databases and for the journal sites (each section has its own button):
// the other kind is left as it is.
async function restoreDefaults(part, statusEl) {
  const dbLinks = await getDbLinks();
  const sites = await getSites();
  const isDb = (host) => isDatabase(host, dbLinks);
  const keep = sites.filter((h) => (part === "db" ? !isDb(h) : isDb(h)));
  for (const host of sites.filter((h) => !keep.includes(h) && !DEFAULT_SITES.includes(h))) {
    try {
      await chrome.permissions.remove({ origins: [originOf(host)] });
    } catch (e) {}
  }
  const next = part === "db" ? [...DEFAULT_DB_LINKS.map((l) => l.host), ...keep] : [...keep, ...PUBLISHER_SITES];
  await saveSites([...new Set(next)]);
  if (part === "db") await chrome.storage.local.remove("dbLinks"); // back to the built-in link icons
  statusEl.textContent = tr(part === "db" ? "db.restored" : "site.restored");
  await renderSites();
}
document.getElementById("reset-db").addEventListener("click", () => restoreDefaults("db", document.getElementById("db-status")));
document.getElementById("reset").addEventListener("click", () => restoreDefaults("journals", siteStatus));

// ---- Today's arXiv: the categories to follow ----
const catsEl = document.getElementById("arxiv-cats");
const newCatEl = document.getElementById("new-cat");
const catStatus = document.getElementById("cat-status");

async function renderCategories() {
  const chosen = await getArxivCategories();
  catsEl.textContent = "";
  for (const cat of [...ARXIV_PRESETS, ...chosen.filter((c) => !ARXIV_PRESETS.includes(c))]) {
    const chip = document.createElement("span");
    chip.className = "tag" + (chosen.includes(cat) ? " selected" : "");
    chip.textContent = cat;
    chip.onclick = async () => {
      // Work from what is stored now, not from what was drawn.
      const now = await getArxivCategories();
      await chrome.storage.local.set({ arxivCategories: now.includes(cat) ? now.filter((c) => c !== cat) : [...now, cat] });
      await renderCategories();
    };
    catsEl.append(chip);
  }
}

async function addCategory() {
  const cat = newCatEl.value.trim();
  if (!cat) return;
  if (!isArxivCategory(cat)) {
    catStatus.textContent = tr("today.cats.invalid");
    return;
  }
  const now = await getArxivCategories();
  if (!now.includes(cat)) await chrome.storage.local.set({ arxivCategories: [...now, cat] });
  catStatus.textContent = "";
  newCatEl.value = "";
  await renderCategories();
}
document.getElementById("add-cat").addEventListener("click", addCategory);
newCatEl.addEventListener("keydown", (e) => {
  if (e.isComposing || e.keyCode === 229) return; // Enter that only confirms an IME conversion
  if (e.key === "Enter") addCategory();
});

// ---- Today's arXiv: the notification (the checking itself is in background.js) ----
// The permission to show notifications is asked only here, when the user switches this on.
const notifyEl = document.getElementById("today-notify");
const notifyStatus = document.getElementById("notify-status");

async function showNotifyState() {
  const { todayNotify } = await chrome.storage.local.get("todayNotify");
  notifyEl.checked = !!todayNotify && (await chrome.permissions.contains({ permissions: ["notifications"] }));
}
notifyEl.addEventListener("change", async () => {
  notifyStatus.textContent = "";
  if (!notifyEl.checked) {
    await chrome.storage.local.set({ todayNotify: false });
    return;
  }
  if (!(await chrome.permissions.request({ permissions: ["notifications"] }))) {
    notifyEl.checked = false;
    notifyStatus.textContent = tr("today.notify.denied");
    return;
  }
  await chrome.storage.local.set({ todayNotify: true });
  // (Chrome itself may still be barred from showing notifications in the system settings)
  if ((await chrome.notifications.getPermissionLevel()) === "denied") notifyStatus.textContent = tr("today.notify.blocked");
});

// ---- Language ----
const languageEl = document.getElementById("language");
chrome.storage.local.get("language").then(({ language }) => (languageEl.value = language || "auto"));
languageEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ language: languageEl.value });
  try {
    localStorage.setItem("language", languageEl.value); // lets pages translate at once when they open
  } catch (e) {}
  location.reload(); // simplest way to redraw every text in the new language
});

i18nReady.then(() => {
  refreshFolder();
  refreshImportNote();
  loadOpenSettings();
  renderSites();
  renderCategories();
  showNotifyState();
  initAiSettings();
});

// The colour theme (theme.js applies it; other open pages follow at once).
(async () => {
  await i18nReady;
  const select = document.getElementById("theme");
  const names = { auto: "theme.auto", light: "theme.light", dark: "theme.dark", lavender: "theme.lavender", rose: "theme.rose", plum: "theme.plum", midnight: "theme.midnight" };
  select.replaceChildren(...THEMES.map((t) => new Option(tr(names[t]), t)));
  select.value = currentTheme();
  select.addEventListener("change", () => setTheme(select.value));
})();
