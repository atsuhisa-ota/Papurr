// Run background.js (a service worker) in a sandbox with a fake `chrome` to check it starts and behaves.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const dir = require("path").join(__dirname, "..", "extension") + "/";
const listeners = {}; const calls = []; const store = {};
const ev = (name) => ({ addListener: (f) => ((listeners[name] = listeners[name] || []).push(f)) });
const alarms = {}; const notes = []; let grantedPerms = new Set(); let feedAnswer = null; const fetched = [];
const granted = new Set(["https://arxiv.org/*", "https://inspirehep.net/*", "https://ui.adsabs.harvard.edu/*"]);
const chrome = {
  runtime: { onMessage: ev("msg"), onInstalled: ev("installed"), onStartup: ev("startup"), getURL: (p) => "chrome-extension://id/" + p, openOptionsPage() {} },
  tabs: { create: (o) => calls.push(["tabs.create", o.url]) },
  action: { onClicked: ev("actionClick"), setBadgeText: (o) => calls.push(["badge", o.text]), setBadgeBackgroundColor() {} },
  permissions: { onAdded: ev("pAdded"), onRemoved: ev("pRemoved"), contains: async ({ origins, permissions }) => origins ? granted.has(origins[0]) : permissions.every((p) => grantedPerms.has(p)) },
  alarms: { onAlarm: ev("alarm"), get: async (n) => alarms[n], create: (n, o) => { alarms[n] = { name: n, ...o }; }, clear: async (n) => { delete alarms[n]; } },
  notifications: { onClicked: ev("noteClick"), create: (id, o) => notes.push({ id, ...o }), clear: (id) => calls.push(["note.clear", id]) },
  scripting: { getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => {}, registerContentScripts: async (s) => calls.push(["register", s[0].matches.slice().sort().join(",")]) },
  storage: { onChanged: ev("storageChanged"), local: { remove: async (k) => { delete store[k]; }, get: async (k) => { const keys = Array.isArray(k) ? k : [k]; return Object.fromEntries(keys.map((x) => [x, store[x]])); }, set: async (o) => Object.assign(store, o) } },
  contextMenus: { removeAll: async () => {}, create: (o) => calls.push(["menu.create", o.id, o.checked]), update: async (id, o) => calls.push(["menu.update", id, o.checked]), onClicked: ev("menuClick") },
};
const ctx = vm.createContext({ chrome, console, setTimeout, clearTimeout, Promise, Date, Object, Array, Map, Set, JSON, Math, Error, RegExp, Intl, TextEncoder, AbortController, String, parseInt,
  fetch: async (url) => { fetched.push(url); if (feedAnswer instanceof Error) throw feedAnswer; return feedAnswer; },
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
  // ---- the notification for a new announcement of Today's arXiv
  const feed = (date, items) => ({ ok: true, status: 200, text: async () => "<?xml version='1.0'?><rss><channel><title>x</title><pubDate>" + date + " 00:00:00 -0400</pubDate>" +
    items.map(([id, type]) => "<item><title>t</title><link>https://arxiv.org/abs/" + id + "</link><description>arXiv:" + id + "v1 Announce Type: " + type + " \nAbstract: a</description><arxiv:announce_type>" + type + "</arxiv:announce_type></item>").join("") + "</channel></rss>" });
  const FRI = "Fri, 16 Oct 2026", THU = "Thu, 15 Oct 2026";
  const now1 = Date.UTC(2026, 9, 16, 0, 45); // Thursday 20:45 New York time: Friday's announcement (made at 20:00) is out
  const check1 = async (now = now1) => { store.arxivLastRequest = 0; return checkTodayNotify(now); };
  const checkTodayNotify = (n) => vm.runInContext("checkTodayNotify", ctx)(n);
  store.arxivCategories = ["hep-th", "astro-ph.CO"];
  store.todayNotify = true;
  grantedPerms = new Set();
  t("notification: without the permission nothing is asked", (await check1()) === "no-permission" && fetched.length === 0, fetched.length);
  grantedPerms = new Set(["notifications"]);
  for (const f of listeners.storageChanged) f({ todayNotify: { newValue: true } }, "local");
  await sleep(100);
  t("switching it on sets a 30-minute alarm and remembers what was announced before (not news)", !!alarms["today-notify"] && alarms["today-notify"].periodInMinutes === 30 && !!(store.todayNotifyState && store.todayNotifyState.seen), JSON.stringify([alarms, store.todayNotifyState]));
  store.todayNotifyState = { seen: "2026-10-15", expected: "", tries: 0 };
  feedAnswer = feed(THU, [["2610.00001", "new"]]);
  t("the feed still shows the old announcement: it waits (and counts the try)", (await check1()) === "waiting" && store.todayNotifyState.tries === 1 && notes.length === 0, JSON.stringify(store.todayNotifyState));
  t("the feed is asked for the followed categories", fetched[0] === "https://export.arxiv.org/rss/hep-th+astro-ph.CO", fetched[0]);
  feedAnswer = feed(FRI, [["2610.00001", "new"], ["2610.00002", "new"], ["2610.00003", "new"], ["2610.00003", "new"], ["2610.00004", "cross"], ["2610.00005", "replace"], ["2610.00006", "replace-cross"]]);
  t("a new announcement: one notification with the number of papers (new and cross-lists, each once; replacements not counted)", (await check1()) === "notified" && notes.length === 1 && notes[0].id === "today-2026-10-16" && notes[0].message.includes("4") && notes[0].message.includes("hep-th, astro-ph.CO"), JSON.stringify(notes));
  const fetchedBefore = fetched.length;
  t("afterwards nothing more is asked or shown for that announcement", (await check1()) === "up-to-date" && fetched.length === fetchedBefore && notes.length === 1);
  listeners.noteClick[0]("today-2026-10-16");
  t("a click on the notification opens Today's arXiv and clears it", calls.some((c) => c[0] === "tabs.create" && c[1] === "chrome-extension://id/today.html") && calls.some((c) => c[0] === "note.clear"));
  const tabsBefore = calls.filter((c) => c[0] === "tabs.create").length;
  listeners.noteClick[0]("something-else");
  t("a notification that is not ours is left alone", calls.filter((c) => c[0] === "tabs.create").length === tabsBefore);
  // next announcement (Monday's): a feed without any new paper of these categories moves on silently
  const now2 = Date.UTC(2026, 9, 19, 0, 45);
  feedAnswer = feed("Mon, 19 Oct 2026", [["2610.00007", "replace"]]);
  t("an announcement without a new paper of these categories gives no notification (and is not asked again)", (await check1(now2)) === "empty" && notes.length === 1 && (await check1(now2)) === "up-to-date", JSON.stringify(store.todayNotifyState));
  // a holiday: the feed never shows the new date; it is asked at most 8 times
  const now3 = Date.UTC(2026, 9, 20, 0, 45);
  feedAnswer = feed("Mon, 19 Oct 2026", [["2610.00007", "new"]]);
  fetched.length = 0; const results8 = [];
  for (let i = 0; i < 10; i++) results8.push(await check1(now3));
  t("when the announcement never shows up (a holiday) it gives up after 8 tries", results8.slice(0, 8).every((r) => r === "waiting") && results8[8] === "gave-up" && fetched.length === 8, results8.join());
  // a failing request
  const now4 = Date.UTC(2026, 9, 21, 0, 45);
  feedAnswer = new Error("offline");
  t("a failed request is not an error and not a notification", (await check1(now4)) === "failed" && notes.length === 1);
  feedAnswer = { ok: true, status: 200, text: async () => "<html>maintenance</html>" };
  t("an answer that is not a feed is not read as 'no papers'", (await check1(now4)) === "failed" && notes.length === 1);
  feedAnswer = feed("Wed, 21 Oct 2026", [["2610.00008", "new"]]);
  t("and the next try after it works", (await check1(now4)) === "notified" && notes.length === 2);
  // no categories, switched off
  store.arxivCategories = [];
  store.todayNotifyState = { seen: "2026-10-01", expected: "", tries: 0 };
  t("without followed categories there is nothing to ask", (await check1(now4)) === "no-categories");
  store.arxivCategories = ["hep-th"]; store.todayNotify = false;
  t("switched off: nothing is asked", (await check1(now4)) === "off");
  for (const f of listeners.storageChanged) f({ todayNotify: { newValue: false } }, "local");
  await sleep(100);
  t("switching it off removes the alarm and what it remembered", !alarms["today-notify"] && !store.todayNotifyState, JSON.stringify([alarms, store.todayNotifyState]));
  fetched.length = 0; listeners.alarm[0]({ name: "other" }); await sleep(30);
  t("an alarm of another name does nothing", fetched.length === 0);
  t("the alarm handler never touches the AI", !/aiRun|ai\.js/.test(fs.readFileSync(dir + "background.js", "utf8")));
  console.log(res.join("\n"));
})();
