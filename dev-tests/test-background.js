// Run background.js (a service worker) in a sandbox with a fake `chrome` to check it starts and behaves.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const dir = require("path").join(__dirname, "..", "extension") + "/";
const listeners = {}; const calls = []; const store = {};
const ev = (name) => ({ addListener: (f) => ((listeners[name] = listeners[name] || []).push(f)) });
const granted = new Set(["https://arxiv.org/*", "https://inspirehep.net/*", "https://ui.adsabs.harvard.edu/*"]);
const chrome = {
  runtime: { onMessage: ev("msg"), onInstalled: ev("installed"), onStartup: ev("startup"), getURL: (p) => "chrome-extension://id/" + p, openOptionsPage() {} },
  tabs: { create: (o) => calls.push(["tabs.create", o.url]) },
  action: { onClicked: ev("actionClick"), setBadgeText: (o) => calls.push(["badge", o.text]), setBadgeBackgroundColor() {} },
  permissions: { onAdded: ev("pAdded"), onRemoved: ev("pRemoved"), contains: async ({ origins }) => granted.has(origins[0]) },
  scripting: { getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => {}, registerContentScripts: async (s) => calls.push(["register", s[0].matches.slice().sort().join(",")]) },
  storage: { onChanged: ev("storageChanged"), local: { get: async (k) => { const keys = Array.isArray(k) ? k : [k]; return Object.fromEntries(keys.map((x) => [x, store[x]])); }, set: async (o) => Object.assign(store, o) } },
  contextMenus: { removeAll: async () => {}, create: (o) => calls.push(["menu.create", o.id, o.checked]), update: async (id, o) => calls.push(["menu.update", id, o.checked]), onClicked: ev("menuClick") },
};
const ctx = vm.createContext({ chrome, console, setTimeout, clearTimeout, Promise, Date, Object, Array, Map, Set, JSON, Math, Error, RegExp, TextEncoder, AbortController, String, parseInt,
  importScripts: (...names) => names.forEach((f) => vm.runInContext(fs.readFileSync(dir + f, "utf8"), ctx)) });
vm.runInContext(fs.readFileSync(dir + "background.js", "utf8"), ctx);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const res = []; const t = (n, c, x) => { res.push((c ? "ok   " : "FAIL ") + n + (c ? "" : " -> " + x)); if (!c) process.exitCode = 1; };
  t("background starts (common.js imported without errors)", Object.keys(listeners).length > 5, Object.keys(listeners));
  listeners.msg[0]({ type: "open-paper", id: "2301.12345", version: "v2" });
  listeners.msg[0]({ type: "open-journal", doi: "10.1/x", pdf: "https://p.example/a.pdf?x=1&y=2" });
  t("open-paper opens helper tab with id and version", calls.some((c) => c[1] === "chrome-extension://id/open.html?id=2301.12345&v=v2"), JSON.stringify(calls));
  t("open-journal opens helper tab with encoded pdf address", calls.some((c) => c[1] === "chrome-extension://id/open.html?doi=10.1%2Fx&pdf=https%3A%2F%2Fp.example%2Fa.pdf%3Fx%3D1%26y%3D2"), JSON.stringify(calls));
  listeners.msg[0]({ type: "open-journal", doi: "10.1/x", pdf: "https://p.example/a.pdf" }, { tab: { id: 42 } });
  t("open-journal passes the tab where the link was clicked (for a retry through that page)", calls.some((c) => c[1] === "chrome-extension://id/open.html?doi=10.1%2Fx&pdf=https%3A%2F%2Fp.example%2Fa.pdf&src=42"), JSON.stringify(calls.slice(-1)));
  listeners.actionClick[0]();
  t("toolbar icon opens the library", calls.some((c) => c[1] === "chrome-extension://id/library.html"));
  // existing user with a customized site list gets the publishers once
  store.sites = ["arxiv.org", "example.org"];
  const FIRST5 = ["journals.aps.org", "link.springer.com", "iopscience.iop.org", "www.sciencedirect.com", "academic.oup.com"];
  for (const f of listeners.installed) await f({ reason: "update" });
  await sleep(50);
  t("publisher sites added once to a customized list", FIRST5.concat(["www.aanda.org", "www.nature.com", "www.science.org", "www.annualreviews.org", "onlinelibrary.wiley.com", "www.mdpi.com", "scipost.org"]).every((h) => store.sites.includes(h)) && store.sites.includes("example.org"), JSON.stringify(store.sites));
  store.sites = store.sites.filter((h) => h !== "journals.aps.org");
  for (const f of listeners.installed) await f({ reason: "update" });
  await sleep(50);
  t("...and not again (user removal is respected)", !store.sites.includes("journals.aps.org"));
  // a user who already had the first five publishers gets only the new ones
  store.sites = ["arxiv.org", ...FIRST5.filter((h) => h !== "academic.oup.com")]; // removed OUP on purpose
  delete store.publisherSitesSeen; store.publishersAdded = true;
  for (const f of listeners.installed) await f({ reason: "update" });
  await sleep(50);
  t("update from the first version adds only the newer publishers", store.sites.includes("www.nature.com") && !store.sites.includes("academic.oup.com"), JSON.stringify(store.sites));
  t("content script registered only where permission exists", calls.filter((c) => c[0] === "register").every((c) => !c[1].includes("example.org")) && calls.some((c) => c[0] === "register"), JSON.stringify(calls.filter((c) => c[0] === "register")));
  t("menu created checked", calls.some((c) => c[0] === "menu.create" && c[1] === "capture" && c[2] === true));
  // switch off
  calls.length = 0;
  for (const f of listeners.menuClick) f({ menuItemId: "capture", checked: false });
  await sleep(20);
  t("menu click stores the switch", store.captureEnabled === false);
  for (const f of listeners.storageChanged) f({ captureEnabled: { newValue: false } }, "local");
  await sleep(50);
  t("badge shows 'off'", calls.some((c) => c[0] === "badge" && c[1] === "off"), JSON.stringify(calls));
  for (const f of listeners.storageChanged) f({ sites: { newValue: [] } }, "local");
  console.log(res.join("\n"));
})();
