// "Today's arXiv": the latest announcement of the arXiv categories chosen in Settings, with abstracts.
// The papers and their details come from arXiv's feed (new submissions and cross-lists, exactly as on arXiv's "new"
// pages; replacements are left out), with one request; the API is used only when the feed has no details, when it is
// empty, and for "Load more". When the feed has nothing (weekends, holidays)
// or fails, the announcement is reconstructed from submission times (latestAnnouncement in rank.js). Papers of the
// announcement are marked `latest`. The list is kept until the next announcement is due (see cacheIsFresh); "Load more" adds
// older papers (newest submissions first).
// With AI switched on in Settings and a research profile, the list can also be ordered by relevance: the rank button
// (rankClick) asks the AI only for the papers of the latest announcement that have no score yet (rank.js); the
// "Why recommended" button of a paper (reasonClick) asks about that one paper (reason.js). These two clicks are the only
// places here that ask the AI.
const msgEl = document.getElementById("msg");
const listEl = document.getElementById("list");
const catsEl = document.getElementById("today-cats");
const updatedEl = document.getElementById("today-updated");
const refreshBtn = document.getElementById("today-refresh");
const PAGE_SIZE = window.TODAY_PAGE_SIZE || 200; // papers per request; "Load more" adds one page (the tests use a small page)
const MAX_FIRST_PAGES = 5; // without the feed, the first load stops after this many requests
const FEED_DETAILS_PER_REQUEST = window.TODAY_IDS_PER_REQUEST || 100; // ids per API request for the details of the announced papers
// arXiv announces at 20:00 US Eastern time on Sunday to Thursday; the announcement is dated the next weekday (Monday to
// Friday). The kept list stays valid until the next announcement is due (plus a margin for the feed to update), because
// arXiv publishes once a day. A list made from submission times (no feed: weekends) is only an estimate of a growing
// batch, so it is kept for a shorter time. (Holidays without an announcement are not modelled: the list is then just
// fetched again once after each regular announcement time.)
const ANNOUNCE_HOUR = 20;
const FEED_MARGIN_MS = 30 * 60 * 1000;
const ESTIMATE_CACHE_MS = 6 * 60 * 60 * 1000;
// Earlier announcements: the list of each announcement that was fetched is kept on this computer (`todayHistory`), for the
// last HISTORY_DAYS announcement days of the followed categories. arXiv's feed only has the latest announcement; an
// earlier day that is not kept is fetched once, on a click, from arXiv's API (its official interface for programs), by
// submission time: that day is then an estimate (papers arXiv held back, and cross-lists of older papers, are missing).
const HISTORY_DAYS = 5;
const DAY_PAGE = window.TODAY_DAY_PAGE || 500; // papers per API request for an earlier day
const DAY_MAX_PAGES = 4;
const HISTORY_KEEP = 15; // entries kept in all (other category choices included)
const daysEl = document.getElementById("today-days");
let viewing = null; // null: the latest announcement; otherwise the kept entry being shown
let latestDate = ""; // the date of the latest announcement loaded (its kept copy is not offered as an earlier day)

let categories = [];
let papers = [];
let filter = ""; // "" = all followed categories, otherwise one of them
let inLibrary = new Set();
let canLoadMore = true;
let announced = null; // { date, new, cross, replace } from the feed, or { estimated: true }
let apiOffset = 0; // how far "Load more" has read the API listing
const aiBar = document.getElementById("today-ai");
let sortMode = "newest"; // or "relevance"
let levelChoice = "all"; // in relevance order: "all", "medium" (and above) or "high" only
try {
  levelChoice = ["medium", "high"].includes(localStorage.getItem("todayLevel")) ? localStorage.getItem("todayLevel") : "all";
} catch (e) {}
try {
  sortMode = localStorage.getItem("todaySort") === "relevance" ? "relevance" : "newest";
} catch (e) {}
let ai = null; // with AI on: { settings, form, dir, profile, needsAccess, stamp, scores }
let ranking = null; // the running rank request (it can be cancelled)
let asking = null; // the running "Why recommended" or translation request: { id, job, since, kind: "reason" | "translate" }
let translations = {}; // kept translated abstracts: id -> language -> translation (translate.js)
const shownTranslations = new Set(); // papers whose translated abstract is open
let reasons = {}; // kept reasons: id -> language -> reason (reason.js)
const shownReasons = new Set(); // papers whose reason is open
const viewedLang = new Map(); // paper id -> the language version picked with the chips
const adding = new Set(); // papers being saved through "Add to library"
// A paper saved in another tab (e.g. by "Add to library" below) is marked at once.
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("papurr") : null;
if (channel) {
  channel.onmessage = (e) => {
    const m = e.data || {};
    if (m.type !== "added") return;
    inLibrary.add(m.id);
    adding.delete(m.id);
    render();
  };
}

// The author's cat-and-ring mark (fixed markup); its ring spins while the list is being fetched.
const MARK_SVG = '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><path class="ring" d="M2.8 20.8 A14 5 -20 0 1 29.2 11.2" stroke-width="2.6"/><path class="head" d="M8.6 12 L9 3.5 L14.5 8 Z M23.4 12 L23 3.5 L17.5 8 Z" stroke-width="1.5" stroke-linejoin="round"/><circle class="head" cx="16" cy="16" r="9" stroke-width="0"/><path class="ring" d="M29.2 11.2 A14 5 -20 0 1 2.8 20.8" stroke-width="2.6"/></svg>';

// Show the spinning mark with a short text: in place of the list (first load, Refresh) or below it (Load more).
function showLoading(below) {
  const box = node("div", "loading" + (below ? " more" : ""));
  box.innerHTML = MARK_SVG; // fixed markup defined above
  box.append(node("p", "", tr("busy.fetching")));
  if (below) {
    listEl.querySelector(".show-more")?.remove();
    listEl.append(box);
  } else {
    listEl.textContent = "";
    listEl.append(box);
  }
  return box;
}

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

const locale = () => dateLocale();
const clock = (time) => new Date(time).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
const sameCats = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function get(url) {
  const res = await arxivApiFetch(url); // (paced for all of Papurr, see common.js)
  if (!res.ok) throw arxivError(res.status);
  const text = await res.text();
  if (!/<(rss|feed)[\s>]/.test(text)) throw new Error(tr("arxiv.badanswer")); // (a web page, or nothing: not an empty list)
  return text;
}

const request = async (start, count) => parseArxivListing(await get(arxivListingUrl(categories, start, count)));
const newestFirst = (list) => list.slice().sort((a, b) => (b.published || "").localeCompare(a.published || ""));
const addUnseen = (list, more) => {
  const seen = new Set(list.map((p) => p.id));
  return list.concat(more.filter((p) => !seen.has(p.id) && seen.add(p.id)));
};

// Load the list (from the cache if it is recent, unless `force`).
async function load(force) {
  viewing = null;
  msgEl.textContent = "";
  const loading = showLoading(false);
  try {
    const { todayCache } = await chrome.storage.local.get("todayCache");
    if (!force && todayCache && sameCats(todayCache.categories, categories) && cacheIsFresh(todayCache, Date.now())) {
      ({ papers, more: canLoadMore, announced, apiOffset } = todayCache);
      updatedEl.textContent = tr("today.updated", { time: clock(todayCache.time) });
    } else {
      ({ papers, more: canLoadMore, announced, apiOffset } = await withBusy(tr("busy.fetching"), fetchToday));
      const time = Date.now();
      await keepQuietly(() => chrome.storage.local.set({ todayCache: { v: 3, categories, time, papers, more: canLoadMore, announced, apiOffset } }));
      await keepQuietly(rememberAnnouncement);
      updatedEl.textContent = tr("today.updated", { time: clock(time) });
    }
    // (a list from submission times has no date from arXiv: the clock gives the day after the last announcement made,
    // so that the row of earlier days starts with that announcement)
    latestDate = (announced && announced.date) || nextWeekday(lastAnnouncedDate(Date.now()));
    render();
    await renderDays();
  } catch (e) {
    loading.remove();
    msgEl.textContent = tr("today.failed", { msg: e.message });
  }
}

// ---- Earlier announcements ----
async function getHistory() {
  try {
    const { todayHistory } = await chrome.storage.local.get("todayHistory");
    return Array.isArray(todayHistory) ? todayHistory : [];
  } catch (e) {
    return [];
  }
}

// Saving for later is a convenience: when it fails (e.g. the storage is full) the list is still shown.
async function keepQuietly(fn) {
  try {
    await fn();
  } catch (e) {}
}

// Keep the latest announcement (only one that arXiv dated: from the feed), and drop what is too old.
async function rememberAnnouncement() {
  if (!announced || !announced.date) return;
  await keepEntry({ date: announced.date, categories, announced, papers: papers.filter((p) => p.latest) });
}

async function keepEntry(entry) {
  const others = (await getHistory()).filter((h) => !(h.date === entry.date && sameCats(h.categories, categories)));
  const all = [entry, ...others].sort((a, b) => b.date.localeCompare(a.date));
  const mine = all.filter((h) => sameCats(h.categories, categories)).slice(0, HISTORY_DAYS);
  const rest = all.filter((h) => !sameCats(h.categories, categories));
  const entries = [...mine, ...rest].sort((a, b) => b.date.localeCompare(a.date));
  // (storage is limited, 10 MB: when a write fails, keep fewer and older days go first; never an error for the user)
  for (const keep of [HISTORY_KEEP, 5, 2, 0]) {
    try {
      await chrome.storage.local.set({ todayHistory: entries.slice(0, keep) });
      return;
    } catch (e) {}
  }
}

const dayLabel = (date) => new Date(date + "T12:00:00Z").toLocaleDateString(locale(), { month: "short", day: "numeric", weekday: "short" });

// The announcement days before `date` ("YYYY-MM-DD"): arXiv announces on weekdays. (A holiday without an announcement
// shows as an empty day.)
function earlierWeekdays(date, n) {
  const days = [];
  for (let t = Date.parse(date + "T12:00:00Z") - 86400000; days.length < n; t -= 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// "Announcements: Latest | Thu, Oct 8 | ...": the latest announcement and the HISTORY_DAYS - 1 days before it.
async function renderDays() {
  const kept = (await getHistory()).filter((h) => sameCats(h.categories, categories));
  daysEl.textContent = "";
  daysEl.hidden = !latestDate;
  if (daysEl.hidden) return;
  const group = node("div", "group");
  group.title = tr("today.days.tip");
  group.append(node("span", "status", tr("today.days")));
  const latest = node("span", "tag" + (!viewing ? " selected" : ""), tr("today.days.latest"));
  latest.onclick = () => viewing && load(false);
  group.append(latest);
  for (const date of earlierWeekdays(latestDate, HISTORY_DAYS - 1)) {
    const h = kept.find((k) => k.date === date);
    const chip = node("span", "tag" + (viewing && viewing.date === date ? " selected" : ""), dayLabel(date));
    chip.onclick = () => (h ? showKept(h) : fetchDay(date)); // (a day not kept yet is fetched once)
    group.append(chip);
  }
  daysEl.append(group);
}

// The moment of a given hour (US Eastern time) on a date "YYYY-MM-DD".
function easternMoment(date, hour) {
  const [y, m, d] = date.split("-").map(Number);
  for (const offset of [4, 5]) { // summer or winter time
    const t = Date.UTC(y, m - 1, d, hour + offset);
    if (arxivEastern(t).h === hour) return t;
  }
  return Date.UTC(y, m - 1, d, hour + 5);
}
// The moment of arXiv's deadline (14:00 US Eastern time) on a date.
const deadlineOn = (date) => easternMoment(date, ARXIV_DEADLINE_HOUR);

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const isWeekday = (date) => ![0, 6].includes(new Date(date + "T12:00:00Z").getUTCDay());
const addDays = (date, n) => isoDay(Date.parse(date + "T12:00:00Z") + n * 86400000);
const nextWeekday = (date) => { let d = addDays(date, 1); while (!isWeekday(d)) d = addDays(d, 1); return d; };

// The announcement dated `date` (a weekday) is made at 20:00 Eastern time on the day before.
const announcedAt = (date) => easternMoment(addDays(date, -1), ANNOUNCE_HOUR);

// The date of the latest announcement that has been made by `now` (ms), by the clock: it needs no feed.
function lastAnnouncedDate(now) {
  const e = arxivEastern(now);
  const today = `${e.y}-${String(e.m).padStart(2, "0")}-${String(e.d).padStart(2, "0")}`;
  for (let k = 1; k >= -8; k--) {
    const date = addDays(today, k);
    if (isWeekday(date) && announcedAt(date) <= now) return date;
  }
  return today; // (not reached)
}

// A kept list is fresh until the next announcement has been made and the feed has had time to show it.
function cacheIsFresh(cache, now) {
  if (!cache || cache.v !== 3 || !(cache.time <= now)) return false; // (a clock set back: fetch again)
  if (cache.announced && cache.announced.estimated && now - cache.time >= ESTIMATE_CACHE_MS) return false;
  return cache.time >= announcedAt(lastAnnouncedDate(now - FEED_MARGIN_MS)) + FEED_MARGIN_MS;
}

// The submission window of the announcement dated `date`: from the deadline two weekdays before to the deadline on the
// weekday before (e.g. Tuesday's announcement: Friday 14:00 to Monday 14:00 US Eastern time).
function announcementWindow(date) {
  const [before] = earlierWeekdays(date, 1);
  const [beforeThat] = earlierWeekdays(before, 1);
  return { from: deadlineOn(beforeThat), to: deadlineOn(before) };
}

// An earlier announcement day that is not kept: asked from the API by submission time (no other kind of request), then
// kept like the others. A paper whose primary category is followed counts as new, others as cross-lists.
let fetchingDay = false;
async function fetchDay(date) {
  if (fetchingDay) return;
  fetchingDay = true;
  const loading = showLoading(false);
  loading.querySelector("p").textContent = tr("today.days.fetching", { date: dayLabel(date) });
  try {
    const { from, to } = announcementWindow(date);
    let list = [];
    await withBusy(tr("busy.fetching"), async () => {
      for (let page = 0; page < DAY_MAX_PAGES; page++) {
        const got = parseArxivListing(await get(arxivSubmittedUrl(categories, from, to, page * DAY_PAGE, DAY_PAGE)));
        list = addUnseen(list, got);
        if (got.length < DAY_PAGE) break;
      }
    });
    const followed = (c) => categories.some((f) => c === f || (ARXIV_ARCHIVES_WITH_SUBJECTS.includes(f) && c.startsWith(f + ".")));
    const items = list.filter((p) => Date.parse(p.published) >= from && Date.parse(p.published) < to)
      .map((p) => ({ ...p, published: date + "T00:00:00Z", latest: true, announce: followed(p.primary) ? "new" : "cross" }))
      .sort((a, b) => (a.announce === "cross") - (b.announce === "cross"));
    const entry = {
      date, categories,
      announced: { date, new: items.filter((p) => p.announce === "new").length, cross: items.filter((p) => p.announce === "cross").length, replace: 0, approx: true },
      papers: items,
    };
    await keepEntry(entry);
    await showKept(entry);
  } catch (e) {
    loading.remove();
    render();
    msgEl.textContent = tr("today.failed", { msg: e.message });
  } finally {
    fetchingDay = false;
  }
}

// Show a kept list (no request to arXiv).
async function showKept(entry) {
  viewing = entry;
  ({ papers, announced } = entry);
  canLoadMore = false;
  apiOffset = 0;
  filter = "";
  updatedEl.textContent = "";
  await renderDays();
  render();
  listEl.scrollTop = 0;
}

// The latest announcement: from the feed if it lists anything, otherwise from submission times.
async function fetchToday() {
  let feed = null;
  try {
    feed = parseArxivFeed(await get(arxivFeedUrl(categories)));
  } catch (e) {} // (the API below still works)
  const announced = feed ? feed.items.filter((i) => i.type === "new" || i.type === "cross") : [];
  const ids = [...new Set(announced.map((i) => i.id))];
  const count = (type) => feed.items.filter((i) => i.type === type).length;
  if (ids.length && announced.every((i) => i.title && i.abstract)) {
    // Everything from the feed (arXiv's own order: new submissions, then cross-lists). The feed has no submission time:
    // the announcement date stands in for it.
    const published = (feed.date || new Date().toISOString().slice(0, 10)) + "T00:00:00Z";
    const seen = new Set();
    const list = announced.filter((i) => !seen.has(i.id) && seen.add(i.id)).sort((a, b) => (a.type === "cross") - (b.type === "cross")).map((i) => ({
      id: i.id, version: i.version, title: i.title, authors: i.authors, authorCount: i.authorCount, abstract: i.abstract,
      published, categories: i.categories, primary: i.categories[0] || "", latest: true, announce: i.type,
    }));
    return { papers: list, more: true, apiOffset: 0, announced: { date: feed.date, new: count("new"), cross: count("cross"), replace: count("replace") + count("replace-cross") } };
  }
  if (ids.length) {
    let list = [];
    for (let i = 0; i < ids.length; i += FEED_DETAILS_PER_REQUEST) list = addUnseen(list, parseArxivListing(await get(arxivIdListUrl(ids.slice(i, i + FEED_DETAILS_PER_REQUEST)))));
    return { papers: newestFirst(list).map((p) => ({ ...p, latest: true })), more: true, apiOffset: 0, announced: { date: feed.date, new: count("new"), cross: count("cross"), replace: count("replace") + count("replace-cross") } };
  }
  return { ...(await fetchBySubmissionTimes()), announced: { estimated: true } };
}

// Pages of the API listing until the whole latest announcement is in (or arXiv has no more, or MAX_FIRST_PAGES is reached).
async function fetchBySubmissionTimes() {
  let list = [];
  let more = true;
  for (let page = 0; page < MAX_FIRST_PAGES; page++) {
    const got = await request(list.length, PAGE_SIZE);
    list = addUnseen(list, got);
    if (got.length < PAGE_SIZE) {
      more = false;
      break;
    }
    if (latestAnnouncement(list).complete) break;
  }
  const latest = new Set(latestAnnouncement(list).papers.map((p) => p.id));
  return { papers: list.map((p) => (latest.has(p.id) ? { ...p, latest: true } : p)), more, apiOffset: list.length };
}

async function loadMore() {
  const loading = showLoading(true);
  try {
    await withBusy(tr("busy.fetching"), async () => {
      // (the newest submissions are mostly the announced papers already listed: read on until something is added)
      for (let page = 0, before = papers.length; page < MAX_FIRST_PAGES && papers.length === before && canLoadMore; page++) {
        const more = await request(apiOffset, PAGE_SIZE);
        apiOffset += more.length;
        papers = newestFirst(addUnseen(papers, more));
        canLoadMore = more.length >= PAGE_SIZE;
      }
    });
    render();
  } catch (e) {
    render(); // (puts the list and its "Load more" button back, so the user can try again)
    msgEl.textContent = tr("today.failed", { msg: e.message });
  }
}

// Which of the listed papers are already saved in the library (only if the folder can be read without asking).
async function loadLibrary() {
  try {
    const dir = await loadDir();
    if (dir && (await dir.queryPermission({ mode: "readwrite" })) === "granted") inLibrary = new Set(Object.entries(await readIndex(dir)).filter(([, e]) => hasPdf(e)).map(([id]) => id)); // (a paper with only a note is not saved)
  } catch (e) {} // not essential
}

// ---- ordering by relevance (AI) ----
// Read what is needed to show the AI controls. Reading the profile needs the folder; the page never asks for access by itself.
async function loadAi() {
  ai = null;
  try {
    const settings = await getAiSettings();
    const os = await aiPlatform();
    if (!settings.enabled || !aiConsentGiven(settings) || (os !== "mac" && os !== "linux")) return; // AI off: nothing is shown
    const form = await getProfileSettings();
    const dir = await loadDir();
    ai = { settings, form, dir, profile: null, needsAccess: false, stamp: "", scores: {} };
    if (!dir) return;
    if ((await dir.queryPermission({ mode: "readwrite" })) !== "granted") {
      ai.needsAccess = true;
      return;
    }
    ai.profile = await readProfile(dir); // reading only
    ai.stamp = rankStamp(ai.profile, form.levelRank);
    if (ai.profile) ai.scores = await getScores(ai.stamp);
    reasons = await getReasons();
    translations = await getTranslations();
  } catch (e) {
    ai = null; // not essential: the list works without it
  }
}

function renderAiBar(shown) {
  aiBar.textContent = "";
  aiBar.hidden = !ai;
  if (!ai) return;
  if (!ai.dir) return aiBar.append(node("span", "status", tr("today.rank.nofolder")));
  if (ai.needsAccess) {
    const allow = node("button", "mini", tr("today.rank.allow"));
    allow.onclick = async () => {
      if ((await ai.dir.requestPermission({ mode: "readwrite" })) !== "granted") return;
      await loadAi();
      render();
    };
    return aiBar.append(node("span", "status", tr("today.rank.access") + " "), allow);
  }
  if (!ai.profile) {
    const link = node("a", "", tr("lib.settings"));
    link.href = "options.html";
    return aiBar.append(node("span", "status", tr("today.rank.noprofile") + " "), link);
  }
  const order = node("div", "group");
  order.append(node("span", "status", tr("today.order")));
  for (const [mode, key] of [["newest", "today.order.newest"], ["relevance", "today.order.relevance"]]) {
    const chip = node("span", "tag" + (sortMode === mode ? " selected" : ""), tr(key));
    chip.onclick = () => {
      sortMode = mode;
      try {
        localStorage.setItem("todaySort", mode);
      } catch (e) {}
      render();
    };
    order.append(chip);
  }
  if (sortMode === "relevance") { // which levels of relevance to show
    order.append(node("span", "status level-label", tr("today.level")));
    for (const [choice, key] of [["all", "today.level.all"], ["medium", "today.level.medium"], ["high", "today.level.high"]]) {
      const chip = node("span", "tag" + (levelChoice === choice ? " selected" : ""), tr(key));
      chip.onclick = () => {
        levelChoice = choice;
        try {
          localStorage.setItem("todayLevel", choice);
        } catch (e) {}
        render();
      };
      order.append(chip);
    }
  }
  const right = node("div", "group");
  if (sortMode === "relevance") {
    if (ranking) {
      const cancel = node("button", "", tr("common.cancel"));
      cancel.onclick = () => ranking.cancel();
      right.append(cancel); // (what is running, and for how long, is said once, in the status line under the header)
    } else {
      const todo = papersToRank(papers, ai.scores); // (the whole latest announcement, whatever the filter shows)
      if (todo.length) {
        // The button says what it costs before it is pressed; pressing it is the consent.
        const prompt = buildRankPrompt({ profile: ai.profile, papers: todo, level: ai.form.levelRank });
        const estimate = estimateRun(prompt, rankOutputTokens(todo.length), aiCommandOf(ai.settings));
        const est = ai.settings.showEstimate;
        const btn = node("button", "rank-btn", est ? tr("today.rank.button", { n: todo.length, tokens: shortTokens(estimate.total) }) : tr("today.rank.button.plain", { n: todo.length }));
        btn.title = est ? tr("today.rank.tip", { n: todo.length, tokens: estimate.total.toLocaleString() }) : tr("today.rank.tip.plain", { n: todo.length }); // (the details: nothing is sent before the click)
        btn.addEventListener("click", (event) => rankClick(event, todo, prompt));
        right.append(btn);
      } else {
        // Everything is scored: offer to score again, with the model chosen now, what another model scored.
        const again = papersToRerank(papers, ai.scores, ai.settings.model || "");
        if (again.length) {
          const prompt = buildRankPrompt({ profile: ai.profile, papers: again, level: ai.form.levelRank });
          const estimate = estimateRun(prompt, rankOutputTokens(again.length), aiCommandOf(ai.settings));
          const est = ai.settings.showEstimate;
          const vars = { n: again.length, tokens: estimate.total.toLocaleString(), model: modelAndEffort().model };
          const btn = node("button", "rank-btn", est ? tr("today.rerank.button", { n: again.length, tokens: shortTokens(estimate.total) }) : tr("today.rerank.button.plain", { n: again.length }));
          btn.title = tr(est ? "today.rerank.tip" : "today.rerank.tip.plain", vars);
          btn.addEventListener("click", (event) => rankClick(event, again, prompt));
          right.append(btn);
        }
      }
    }
  }
  aiBar.append(order, right);
}

// The model (by its name from the last check of the command, when known) and the effort, for "Ranking with the AI (...)".
function modelAndEffort() {
  const s = ai.settings;
  const known = ((s.status && s.status.models) || []).find((m) => m.id === s.model);
  return { model: s.model ? (known && known.name) || s.model : tr("today.rank.default.model"), effort: s.effort || tr("today.rank.default.effort") };
}
const rankingLabel = () => tr("today.rank.working.with", modelAndEffort());

// One of the two places on this page that spend quota: a click on the rank button.
async function rankClick(event, todo, prompt) {
  if (ranking || asking) return;
  const job = aiRun(aiClick(event), { kind: "rank", items: todo.length, prompt, schema: RANK_ANSWER_SCHEMA, timeout: 240 });
  ranking = job;
  job.since = Date.now();
  render();
  const busy = startBusy(rankingLabel());
  let note = "";
  try {
    const reply = await job.promise;
    const scores = parseRankAnswer(reply.result, todo.map((p) => p.id));
    ai.scores = await saveScores(ai.stamp, scores, Date.now(), ai.settings.model || "");
    const missing = todo.length - scores.size;
    note = tr("today.rank.done", { n: scores.size, tokens: reply.tokens.toLocaleString() }) + (missing ? tr("today.rank.missing", { n: missing }) : "");
  } catch (e) {
    note = e.message;
  } finally {
    endBusy(busy);
    ranking = null;
    render();
    msgEl.textContent = note;
  }
}

// The other place that spends quota: a click on a paper's "Why recommended" button (or "Make it in <language>").
async function reasonClick(event, paper, lang, prompt) {
  if (ranking || asking) return;
  const job = aiRun(aiClick(event), { kind: "reason", items: 1, prompt, schema: REASON_ANSWER_SCHEMA, timeout: 120 });
  asking = { id: paper.id, job, since: Date.now(), kind: "reason" };
  render();
  const busy = startBusy(tr("reason.working", modelAndEffort()));
  let note = "";
  try {
    const reply = await job.promise;
    const text = parseReasonAnswer(reply.result);
    if (!text) note = tr("reason.empty");
    else {
      const reason = { text, at: new Date().toISOString(), model: (reply.models || [])[0] || ai.settings.model || aiCommandOf(ai.settings) };
      reasons = await saveReason(paper.id, lang, reason); // (other languages are kept)
      shownReasons.add(paper.id);
      viewedLang.set(paper.id, lang);
      try {
        await writeReasonsToNote(ai.dir, paper.id, { [lang]: reason }); // (only if the paper has a note)
      } catch (e) {} // the reason is kept in the browser anyway
      note = tr("reason.done", { tokens: reply.tokens.toLocaleString() });
    }
  } catch (e) {
    note = e.message;
  } finally {
    endBusy(busy);
    asking = null;
    render();
    msgEl.textContent = note;
  }
}

// A button that asks the AI for the reason of `p` in `lang`: its label and tooltip say that it uses quota (with the
// estimate when estimates are on).
function askReasonButton(p, lang, key, keyEst) {
  const prompt = buildReasonPrompt({ profile: ai.profile, paper: p, lang });
  const tokens = estimateRun(prompt, REASON_OUTPUT_TOKENS, aiCommandOf(ai.settings)).total;
  const vars = { tokens: shortTokens(tokens), lang: languageLabel(lang) };
  const b = node("button", "mini reason-btn", tr(ai.settings.showEstimate ? keyEst : key, vars));
  b.title = ai.settings.showEstimate ? tr("today.reason.tip", { tokens: tokens.toLocaleString() }) : tr("today.reason.tip.plain");
  b.disabled = !!(asking || ranking);
  b.addEventListener("click", (event) => reasonClick(event, p, lang, prompt));
  return b;
}

// The kept version to show: the language picked with the chips, else the output language, else the newest one.
function shownVersion(p) {
  const kept = reasons[p.id] || {};
  const langs = Object.keys(kept).sort();
  const out = aiOutputLang(ai.settings);
  const picked = viewedLang.get(p.id);
  const lang = kept[picked] ? picked : kept[out] ? out : langs.slice().sort((a, b) => kept[b].at.localeCompare(kept[a].at))[0];
  return { lang, reason: kept[lang], langs };
}

// The "Why recommended" button of one paper: shows / hides the kept reasons (free), or asks the AI.
function reasonButton(p) {
  if (reasons[p.id]) {
    const open = shownReasons.has(p.id);
    const b = node("button", "mini" + (open ? " selected" : ""), tr(open ? "today.reason.hide" : "today.reason.button"));
    b.onclick = () => {
      open ? shownReasons.delete(p.id) : shownReasons.add(p.id);
      render();
    };
    return b;
  }
  return askReasonButton(p, aiOutputLang(ai.settings), "today.reason.button", "today.reason.button.est");
}

// The reason under the abstract (with the cat mark), or "asking..." with the seconds and Cancel while it is being
// asked. With several languages kept: chips to switch (free); without the chosen output language: "Make it in ...".
function reasonBox(p) {
  const box = node("div", "reason");
  box.innerHTML = MARK_SVG; // fixed markup defined above
  if (asking && asking.id === p.id && asking.kind === "reason") {
    const cancel = node("button", "mini", tr("common.cancel"));
    cancel.onclick = () => asking && asking.job.cancel();
    const status = node("p", "status", tr("reason.working", modelAndEffort()));
    status.append(elapsedSpan(asking.since));
    box.append(status, cancel);
    return box;
  }
  const v = shownVersion(p);
  const out = aiOutputLang(ai.settings);
  const body = node("div", "reason-text");
  const text = node("p");
  text.append(textWithMath(v.reason.text));
  body.append(text);
  if (v.langs.length > 1 || !reasons[p.id][out]) {
    const langs = node("div", "reason-langs");
    if (v.langs.length > 1) {
      for (const lang of v.langs) {
        const chip = node("span", "tag" + (lang === v.lang ? " selected" : ""), languageLabel(lang));
        chip.onclick = () => {
          viewedLang.set(p.id, lang);
          render();
        };
        langs.append(chip);
      }
    }
    if (!reasons[p.id][out]) langs.append(askReasonButton(p, out, "today.reason.make", "today.reason.make.est"));
    body.append(langs);
  }
  box.append(body);
  return box;
}

// ---- Translating an abstract (into the language of the AI's texts) ----
// A click on "Translate": the third place on this page that spends quota.
async function translateClick(event, paper, lang, prompt) {
  if (ranking || asking) return;
  const job = aiRun(aiClick(event), { kind: "translation", items: 1, prompt, schema: TRANSLATE_ANSWER_SCHEMA, timeout: 120 });
  asking = { id: paper.id, job, since: Date.now(), kind: "translate" };
  render();
  const busy = startBusy(tr("translate.working", modelAndEffort()));
  let note = "";
  try {
    const reply = await job.promise;
    const text = parseTranslateAnswer(reply.result);
    if (!text) note = tr("reason.empty");
    else {
      const t = { text, at: new Date().toISOString(), model: (reply.models || [])[0] || ai.settings.model || aiCommandOf(ai.settings) };
      translations = await saveTranslation(paper.id, lang, t);
      shownTranslations.add(paper.id);
      try {
        if (ai.dir) await writeTranslationsToNote(ai.dir, paper.id, { [lang]: t }); // (only if the paper has a note)
      } catch (e) {} // kept in the browser anyway
      note = tr("reason.done", { tokens: reply.tokens.toLocaleString() });
    }
  } catch (e) {
    note = e.message;
  } finally {
    endBusy(busy);
    asking = null;
    render();
    msgEl.textContent = note;
  }
}

// "Translate (日本語) · ~0.6k": shows / hides a kept translation (free), or asks the AI.
function translateButton(p) {
  const lang = aiOutputLang(ai.settings);
  const vars = { lang: languageLabel(lang) };
  if (translations[p.id] && translations[p.id][lang]) {
    const open = shownTranslations.has(p.id);
    const b = node("button", "mini" + (open ? " selected" : ""), tr(open ? "today.translate.hide" : "today.translate.show", vars));
    b.onclick = () => {
      open ? shownTranslations.delete(p.id) : shownTranslations.add(p.id);
      render();
    };
    return b;
  }
  const prompt = buildTranslatePrompt({ text: p.abstract, lang });
  const tokens = estimateRun(prompt, translateOutputTokens(p.abstract), aiCommandOf(ai.settings)).total;
  const b = node("button", "mini", tr(ai.settings.showEstimate ? "today.translate.button.est" : "today.translate.button", { ...vars, tokens: shortTokens(tokens) }));
  b.title = ai.settings.showEstimate ? tr("today.translate.tip", { tokens: tokens.toLocaleString() }) : tr("today.translate.tip.plain");
  b.disabled = !!(asking || ranking);
  b.addEventListener("click", (event) => translateClick(event, p, lang, prompt));
  return b;
}

// The translated abstract under the original, or "translating..." with the seconds and Cancel.
function translationBox(p) {
  const box = node("div", "translation");
  if (asking && asking.id === p.id && asking.kind === "translate") {
    const cancel = node("button", "mini", tr("common.cancel"));
    cancel.onclick = () => asking && asking.job.cancel();
    const status = node("p", "status", tr("translate.working", modelAndEffort()));
    status.append(elapsedSpan(asking.since));
    box.append(status, cancel);
    return box;
  }
  const lang = aiOutputLang(ai.settings);
  const text = node("p");
  text.append(textWithMath(translations[p.id][lang].text));
  box.append(node("span", "translation-label", tr("today.translate.label", { lang: languageLabel(lang) })), text);
  return box;
}

// "In library", or the "Add to library" button (for every paper, with or without AI).
function libraryButton(p) {
  if (inLibrary.has(p.id)) {
    const saved = node("button", "mini done", "\u2713 " + tr("today.inlibrary"));
    saved.title = tr("today.inlibrary.tip");
    saved.onclick = () => showInLibrary(p.id);
    return saved;
  }
  const add = node("button", "mini", tr(adding.has(p.id) ? "today.adding" : "today.add"));
  add.title = tr("today.add.tip");
  add.disabled = adding.has(p.id);
  add.onclick = () => addToLibrary(p);
  return add;
}

// "In library": bring the library tab forward with the paper highlighted (or open the library on it).
async function showInLibrary(id) {
  if (!(await askLibraryToShow(id))) await chrome.tabs.create({ url: "library.html?highlight=" + encodeURIComponent(id), active: true });
}

// "Add to library": the paper is saved in a background tab (not opened); the library tab then shows it highlighted.
// If the folder still needs a permission prompt, the tab is opened in front so that the prompt can be answered.
async function addToLibrary(p) {
  let granted = false;
  try {
    const dir = await loadDir();
    granted = !!dir && (await dir.queryPermission({ mode: "readwrite" })) === "granted";
  } catch (e) {}
  adding.add(p.id);
  render();
  // (title and authors go along: if arXiv's API does not answer at that moment, the entry still gets them)
  const about = "&title=" + encodeURIComponent(p.title || "") + "&authors=" + encodeURIComponent(JSON.stringify(p.authors || [])) + "&n=" + (p.authorCount || 0);
  await chrome.tabs.create({ url: "open.html?id=" + encodeURIComponent(p.id) + (p.version ? "&v=" + p.version : "") + "&save=1" + about, active: !granted });
}

// "Interested" / "Not interested": saved in the profile file (shared by all computers, read by the next profile update).
async function react(paper, value) {
  try {
    if ((await ai.dir.requestPermission({ mode: "readwrite" })) !== "granted") return (msgEl.textContent = tr("err.noaccess"));
    const feedback = await setReaction(ai.dir, paper, value);
    if (feedback) ai.profile = { ...ai.profile, feedback };
    render();
  } catch (e) {
    msgEl.textContent = e.message;
  }
}

function renderCategoryBar() {
  catsEl.textContent = "";
  for (const cat of ["", ...categories]) {
    const el = node("span", "tag" + (filter === cat ? " selected" : ""), cat || tr("today.all"));
    el.onclick = () => {
      filter = cat;
      render();
    };
    catsEl.append(el);
  }
  catsEl.hidden = categories.length < 2;
}

function authorLine(p) {
  return p.authors.join(", ") + (p.authorCount > p.authors.length ? ", et al." : "");
}

// What the list holds: the size of the latest announcement as arXiv counts it, and the older papers loaded on top.
function countLine() {
  const latest = papers.filter((p) => p.latest).length;
  const older = papers.length - latest;
  let line;
  if (announced && announced.date) {
    const date = new Date(announced.date + "T12:00:00Z").toLocaleDateString(locale(), { year: "numeric", month: "short", day: "numeric", weekday: "short" });
    line = tr("today.count.announced", { n: latest, date, new: announced.new, cross: announced.cross }) + (announced.replace ? tr("today.count.replace", { n: announced.replace }) : "");
    if (announced.approx) line += tr("today.count.approx");
  } else line = tr("today.count.estimated", { n: latest });
  return line + (older ? tr("today.count.older", { n: older }) : "");
}

// "Relevance ●●○": the level of a ranked paper (no number).
function levelBadge(level) {
  const dots = { high: "\u25cf\u25cf\u25cf", medium: "\u25cf\u25cf\u25cb", low: "\u25cf\u25cb\u25cb" }[level];
  const badge = node("span", "level level-" + level, tr("today.level.badge") + " " + dots);
  badge.title = tr({ high: "today.level.high.tip", medium: "today.level.medium.tip", low: "today.level.low.tip" }[level]);
  return badge;
}

function render() {
  renderCategoryBar();
  const shown = papers.filter((p) => !filter || p.categories.includes(filter) || (filter.indexOf(".") < 0 && p.categories.some((c) => c.startsWith(filter + "."))));
  renderAiBar(shown);
  const byRelevance = sortMode === "relevance" && ai && ai.profile;
  const ordered = byRelevance ? orderByRelevance(papersAtLevel(shown, ai.scores, levelChoice), ai.scores, ai.profile.feedback) : shown;
  const hidden = shown.length - ordered.length; // (papers below the chosen level, or not ranked yet)
  const scrollTop = listEl.scrollTop;
  listEl.textContent = "";
  let day = "";
  for (const p of ordered) {
    const date = p.published.slice(0, 10);
    // Headings: the latest announcement as on arXiv's page (new submissions, cross-lists), older papers by submission date.
    const heading = p.announce ? tr(p.announce === "cross" ? "today.heading.cross" : "today.heading.new") : tr("today.submitted", { date: new Date(date + "T12:00:00Z").toLocaleDateString(locale(), { year: "numeric", month: "short", day: "numeric" }) });
    if (!byRelevance && heading !== day) { // (in relevance order the date is shown with each paper instead)
      day = heading;
      listEl.append(node("div", "day", heading));
    }
    const item = node("div", "paper");
    const title = node("a", "title", p.title);
    title.href = "open.html?id=" + encodeURIComponent(p.id) + (p.version ? "&v=" + p.version : "");
    title.target = "_blank";
    title.title = tr("today.open.tip");
    const meta = node("div", "meta", [authorLine(p), "arXiv:" + p.id + (p.version || ""), p.categories.join(" "), byRelevance ? date : ""].filter(Boolean).join(" — "));
    if (byRelevance && ai.scores[p.id]) meta.append(levelBadge(relevanceLevel(ai.scores[p.id].s)));
    const abstract = node("p", "abstract clamped", p.abstract);
    const row = node("div", "paper-row");
    const more = node("button", "mini", tr("today.more"));
    more.onclick = () => {
      const open = abstract.classList.toggle("clamped");
      more.textContent = open ? tr("today.more") : tr("today.less");
    };
    const links = node("span", "dbs");
    links.append(libraryButton(p));
    const abs = node("a", "mini", tr("today.abs"));
    abs.href = "https://arxiv.org/abs/" + p.id;
    abs.target = "_blank";
    links.append(abs);
    const reactions = node("span", "reactions");
    if (ai && ai.profile) {
      const mine = ai.profile.feedback[p.id];
      for (const [value, key] of [["interested", "today.react.yes"], ["not", "today.react.no"]]) {
        const on = !!(mine && mine.v === value);
        const b = node("button", "mini" + (on ? " selected" : ""), tr(key));
        b.setAttribute("aria-pressed", String(on));
        b.title = tr("today.react.tip");
        b.onclick = () => react(p, on ? null : value);
        reactions.append(b);
      }
    }
    if (ai && p.abstract && aiOutputLang(ai.settings) !== "en") reactions.append(translateButton(p)); // (abstracts are in English)
    if (ai && ai.profile) reactions.append(reasonButton(p));
    if (ai) reactions.append(summaryLink(p.id)); // (opens the note page: no quota until its own button)
    row.append(more, reactions, links);
    item.append(title, meta, abstract);
    if (ai && ((asking && asking.id === p.id && asking.kind === "translate") || (translations[p.id] && translations[p.id][aiOutputLang(ai.settings)] && shownTranslations.has(p.id)))) item.append(translationBox(p));
    if (ai && ai.profile && ((asking && asking.id === p.id && asking.kind === "reason") || (reasons[p.id] && shownReasons.has(p.id)))) item.append(reasonBox(p));
    item.append(row);
    listEl.append(item);
    more.hidden = abstract.scrollHeight <= abstract.clientHeight + 1; // a short abstract has nothing more to show
  }
  if (canLoadMore && !filter) {
    const more = node("button", "show-more", tr("today.loadmore"));
    more.onclick = loadMore;
    listEl.append(more);
  }
  listEl.scrollTop = scrollTop;
  msgEl.textContent = !shown.length ? tr("today.none") : byRelevance ? (hidden ? tr("today.count.level", { n: ordered.length, hidden }) : tr("today.count.relevance", { n: shown.length })) : filter ? tr("today.count", { n: shown.length }) : countLine();
  refreshBtn.hidden = false;
}

async function main() {
  await i18nReady;
  msgEl.textContent = tr("busy.loading");
  categories = await getArxivCategories();
  if (!categories.length) {
    msgEl.textContent = "";
    const empty = node("div", "empty");
    empty.append(node("p", "", tr("today.nocats")));
    const link = node("a", "", tr("lib.settings"));
    link.href = "options.html";
    empty.append(link);
    listEl.append(empty);
    return;
  }
  await loadLibrary();
  await loadAi();
  await load(false);
}

refreshBtn.addEventListener("click", () => load(true));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.language) location.reload();
  if (changes.arxivCategories) location.reload(); // changed in Settings
  if (changes.ai || changes.profileSettings) loadAi().then(render); // (e.g. another model chosen in Settings)
});
main();
