// Shared helpers for remembering the chosen papers folder inside the browser.
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("papers", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDir(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(handle, "dir");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function loadDir() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("kv").objectStore("kv").get("dir");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// ---- Sites watched for arXiv PDF links ----
const PUBLISHER_SITES = [
  "journals.aps.org", // APS (Physical Review)
  "link.springer.com", // Springer (JHEP, EPJC, Space Science Reviews, CMP, ...)
  "iopscience.iop.org", // IOP (JCAP, ApJ, ApJS, AJ, PASP, CQG, ...)
  "www.sciencedirect.com", // Elsevier (PLB, NPB, Icarus, Astroparticle Physics, ...)
  "academic.oup.com", // Oxford UP (PTEP, MNRAS, PASJ, ...)
  "www.aanda.org", // Astronomy & Astrophysics
  "www.nature.com", // Nature, Nature Astronomy, Nature Physics, ...
  "www.science.org", // Science
  "www.annualreviews.org", // Annual Review of Astronomy and Astrophysics, ...
  "onlinelibrary.wiley.com", // Wiley (Astronomische Nachrichten, Fortschritte der Physik, ...)
  "www.mdpi.com", // MDPI (Universe, Galaxies, Particles, ...)
  "scipost.org", // SciPost
];
// The publisher sites that earlier versions of the extension already offered (see addPublisherSites in background.js).
const FIRST_PUBLISHER_SITES = PUBLISHER_SITES.slice(0, 5);
const DEFAULT_SITES = ["arxiv.org", "inspirehep.net", "ui.adsabs.harvard.edu", ...PUBLISHER_SITES];

// Link icons shown for each paper. "template" is the link address; {id} is replaced by the arXiv ID.
const DEFAULT_DB_LINKS = [
  { host: "arxiv.org", name: "arXiv", label: "arXiv", color: "#b31b1b", template: "https://arxiv.org/abs/{id}" },
  { host: "inspirehep.net", name: "INSPIRE", label: "INSPIRE", color: "#1f5fa8", template: "https://inspirehep.net/arxiv/{id}" },
  { host: "ui.adsabs.harvard.edu", name: "NASA ADS", label: "ADS", color: "#3b4a6b", template: "https://ui.adsabs.harvard.edu/abs/arXiv:{id}/abstract" },
];

async function getDbLinks() {
  const { dbLinks } = await chrome.storage.local.get("dbLinks");
  // (An earlier version labelled the INSPIRE icon "iN"; a saved copy of the list is updated on the fly.)
  return dbLinks ? dbLinks.map((l) => (l.host === "inspirehep.net" && l.label === "iN" ? { ...l, label: "INSPIRE" } : l)) : DEFAULT_DB_LINKS;
}

async function getSites() {
  const { sites } = await chrome.storage.local.get("sites");
  return sites || DEFAULT_SITES;
}

// ---- Index (index.json in the papers folder) ----
//
// File format: { "schemaVersion": 3, "papers": { "<key>": entry, ... } }, where <key> is the arXiv ID
// (or "doi:<doi>" for a journal-only paper) and an entry looks like
//   { title, authors, authorCount, added, modified, doi?, tags?, versions: { v1: "2301.12345v1.pdf" }, journal?, note? }
// `note` is the file name of the paper's note ("2301.12345.md"). An entry may have a note and no PDF at all
// (schema 3; an older Papurr would drop such entries, so it must refuse the file - hence the version bump).
// Files from older versions of the extension (just the papers map, no schemaVersion) are read as well.
//
// Because the folder may live in a cloud-synced directory shared by several computers:
//  - every change goes through updateIndex(), which reads, changes and writes under a lock and skips
//    the write if nothing changed;
//  - an index that cannot be read is never overwritten (IndexError) - see the repair options in the library;
//  - the only per-computer data ("last opened") is kept in the browser, not in the shared file;
//  - sync conflict copies of the index (index (conflicted copy).json, ...) are merged entry by entry.
const INDEX_NAME = "index.json";
const BACKUP_NAME = "index.json.bak"; // one rolling backup, refreshed at most once a day
const DAMAGED_NAME = "index.damaged.json"; // the unreadable index, kept aside before it is replaced
const SCHEMA_VERSION = 3; // 3: entries may have a note and no PDF
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_AUTHORS = 5;
const UNVERSIONED = "unversioned";

class IndexError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = "IndexError";
    this.kind = kind; // "damaged" or "newer"
  }
}

// Turn the text of an index file into the papers map (throws IndexError if it cannot be used).
function parseIndexText(text) {
  const damaged = () => new IndexError(tr("index.damaged"), "damaged");
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw damaged();
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw damaged();
  let papers = data; // legacy format: the file is the papers map itself
  if (typeof data.schemaVersion === "number") {
    if (data.schemaVersion > SCHEMA_VERSION) {
      throw new IndexError(tr("index.newer"), "newer");
    }
    papers = data.papers;
    if (!papers || typeof papers !== "object" || Array.isArray(papers)) throw damaged();
  }
  for (const entry of Object.values(papers)) {
    if (!entry || typeof entry !== "object") throw damaged();
    if (!entry.versions) {
      const parsed = parseFileName(entry.file || "");
      entry.versions = entry.file ? { [(parsed && parsed.version) || UNVERSIONED]: entry.file } : {};
      delete entry.file;
    }
    tidyEntry(entry);
  }
  return papers;
}

// Values of the wrong type (an index edited by hand, or written by another program) are put right, so that one odd
// entry cannot stop the whole library: a number becomes text, a single author or tag a list of one, and values that
// cannot mean anything (a version file that is not a name, a note that is not a file name) are left out.
function tidyEntry(entry) {
  const text = (v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
  const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(text).filter((x) => x !== null && x !== "");
  if (typeof entry.title !== "string") entry.title = text(entry.title) || "";
  if (!Array.isArray(entry.authors) || entry.authors.some((a) => typeof a !== "string")) entry.authors = list(entry.authors);
  if (typeof entry.authorCount !== "number" || !(entry.authorCount >= entry.authors.length)) entry.authorCount = Math.max(Number(entry.authorCount) || 0, entry.authors.length);
  if ("tags" in entry && (!Array.isArray(entry.tags) || entry.tags.some((t) => typeof t !== "string"))) {
    entry.tags = list(entry.tags);
    if (!entry.tags.length) delete entry.tags;
  }
  if (typeof entry.versions !== "object" || Array.isArray(entry.versions)) entry.versions = {};
  for (const [v, file] of Object.entries(entry.versions)) if (typeof file !== "string" || !file) delete entry.versions[v];
  if ("journal" in entry && (!entry.journal || typeof entry.journal !== "object" || typeof entry.journal.file !== "string" || !entry.journal.file)) delete entry.journal;
  for (const key of ["note", "doi", "added", "modified", "bibcode"]) if (key in entry && typeof entry[key] !== "string") delete entry[key];
}

// The text of a file in the papers folder, or null if there is no such file.
async function readFileText(dir, name) {
  try {
    return await (await (await dir.getFileHandle(name)).getFile()).text();
  } catch (e) {
    if (e.name === "NotFoundError") return null;
    throw e;
  }
}

async function writeFileText(dir, name, text) {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writable.write(text);
  await writable.close(); // the new content replaces the old one in a single step
}

const serializeIndex = (papers) => JSON.stringify({ schemaVersion: SCHEMA_VERSION, papers }, null, 2);

async function readIndex(dir) {
  const text = await readFileText(dir, INDEX_NAME);
  return text === null ? {} : parseIndexText(text);
}

const withIndexLock = (fn) => withLock("paper-folder-index", fn);

function withLock(name, fn) {
  if (typeof navigator === "undefined" || !navigator.locks) return fn();
  // The lock is shared by all pages of the extension, so two tabs never change the same file at the same moment.
  // If it cannot be had for a long time (another tab is stuck), give up with a clear message instead of hanging.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  return navigator.locks
    .request(name, { signal: controller.signal }, async () => {
      clearTimeout(timer);
      return fn();
    })
    .catch((e) => {
      if (e.name === "AbortError") throw new Error(tr("lock.busy"));
      throw e;
    })
    .finally(() => clearTimeout(timer));
}

// Keep a copy of the last readable index, but only once a day so a synced folder is not flooded with writes.
async function refreshBackup(dir, goodText) {
  try {
    const existing = await (await dir.getFileHandle(BACKUP_NAME)).getFile();
    if (Date.now() - existing.lastModified < BACKUP_INTERVAL_MS) return;
  } catch (e) {
    if (e.name !== "NotFoundError") return;
  }
  try {
    await writeFileText(dir, BACKUP_NAME, goodText);
  } catch (e) {} // a failed backup must never block the real change
}

// Read the index, let mutate(papers) change it, and write it back if anything changed.
// Returns whatever mutate returns.
async function updateIndex(dir, mutate) {
  return withIndexLock(async () => {
    const text = await readFileText(dir, INDEX_NAME);
    const papers = text === null ? {} : parseIndexText(text);
    const before = JSON.stringify(papers);
    const result = await mutate(papers);
    if (JSON.stringify(papers) !== before) {
      if (text !== null) await refreshBackup(dir, text);
      await writeFileText(dir, INDEX_NAME, serializeIndex(papers));
    }
    return result;
  });
}

const touch = (entry) => {
  entry.modified = new Date().toISOString(); // used to decide which side wins when two copies are merged
};

// ---- Repairing an unreadable index ----
// Replace the unreadable index.json with the backup. The unreadable file is kept as index.damaged.json.
async function restoreIndexBackup(dir) {
  return withIndexLock(async () => {
    const backup = await readFileText(dir, BACKUP_NAME);
    if (backup === null) throw new Error(tr("backup.none"));
    const papers = parseIndexText(backup);
    const current = await readFileText(dir, INDEX_NAME);
    if (current !== null) await writeFileText(dir, DAMAGED_NAME, current);
    await writeFileText(dir, INDEX_NAME, serializeIndex(papers));
    return Object.keys(papers).length;
  });
}

// Replace the unreadable index.json with an empty one (tags are lost; the PDFs are not touched).
async function resetIndex(dir) {
  return withIndexLock(async () => {
    const current = await readFileText(dir, INDEX_NAME);
    if (current !== null) await writeFileText(dir, DAMAGED_NAME, current);
    await writeFileText(dir, INDEX_NAME, serializeIndex({}));
  });
}

async function hasBackup(dir) {
  return (await readFileText(dir, BACKUP_NAME)) !== null;
}

// ---- Merging sync conflict copies ----
// Cloud services create files like "index (conflicted copy 2026-10-08).json", "index (1).json" or
// "index.sync-conflict-....json" when two computers changed index.json at the same time.
function isConflictCopyName(name) {
  return /^index.+\.json$/i.test(name) && name.toLowerCase() !== DAMAGED_NAME;
}

// Combine two entries for the same paper: the more recently modified one wins field by field,
// but saved files (versions, journal) from both sides are kept.
function mergeEntries(a, b) {
  const stamp = (e) => e.modified || e.added || "";
  const [older, newer] = stamp(a) <= stamp(b) ? [a, b] : [b, a];
  const merged = { ...older, ...newer, versions: { ...older.versions, ...newer.versions } };
  const journal = newer.journal || older.journal;
  if (journal) merged.journal = journal;
  else delete merged.journal;
  if (newer.tags) merged.tags = newer.tags;
  else delete merged.tags; // the newer side removed all tags: keep it that way
  return merged;
}

function mergePapers(into, other) {
  for (const [id, entry] of Object.entries(other)) into[id] = into[id] ? mergeEntries(into[id], entry) : entry;
}

// Merge every readable conflict copy of the index into index.json and delete the merged copies.
// Returns how many copies were merged.
async function mergeConflictCopies(dir) {
  return withIndexLock(async () => {
    const names = [];
    for await (const [name, handle] of dir.entries()) if (handle.kind === "file" && isConflictCopyName(name)) names.push(name);
    if (!names.length) return 0;

    const text = await readFileText(dir, INDEX_NAME);
    const papers = text === null ? {} : parseIndexText(text);
    const merged = [];
    for (const name of names) {
      try {
        mergePapers(papers, parseIndexText(await readFileText(dir, name)));
        merged.push(name);
      } catch (e) {} // not an index file: leave it alone
    }
    if (!merged.length) return 0;
    if (text !== null) await refreshBackup(dir, text);
    await writeFileText(dir, INDEX_NAME, serializeIndex(papers));
    for (const name of merged) await dir.removeEntry(name); // only after the merged index is safely written
    return merged.length;
  });
}

// Version keys sorted oldest to newest (v2 < v10; unversioned first).
function sortedVersions(entry) {
  const num = (v) => (v === UNVERSIONED ? 0 : parseInt(v.slice(1), 10));
  return Object.keys(entry.versions).sort((a, b) => num(a) - num(b));
}

// ---- Per-computer data: when each paper was last opened ----
// Kept in the browser, not in index.json: it differs between computers, and writing it into the
// shared index would make every open a change that has to be synced (and can conflict).
async function markOpened(id) {
  try {
    const { opened = {} } = await chrome.storage.local.get("opened");
    opened[id] = new Date().toISOString();
    await chrome.storage.local.set({ opened });
  } catch (e) {} // not essential: never block opening the paper
}

async function getOpenedMap() {
  const { opened = {} } = await chrome.storage.local.get("opened");
  return opened;
}

// ---- "Today's arXiv": the arXiv categories the user follows ----
// Categories offered as buttons in Settings (any other category can be typed in).
const ARXIV_PRESETS = ["hep-th", "hep-ph", "hep-ex", "hep-lat", "gr-qc", "astro-ph", "astro-ph.CO", "astro-ph.HE", "astro-ph.GA", "astro-ph.SR", "astro-ph.EP", "astro-ph.IM", "cond-mat", "quant-ph", "math-ph", "nucl-th", "nucl-ex", "physics", "math", "cs", "stat"];
const ARXIV_ARCHIVES_WITH_SUBJECTS = ["astro-ph", "cond-mat", "physics", "math", "cs", "stat", "q-bio", "q-fin", "nlin", "eess", "econ"]; // "math" means math.* (but not math-ph)
const isArxivCategory = (c) => /^[a-z]+(?:-[a-z]+)*(?:\.[A-Za-z]+(?:-[A-Za-z]+)*)?$/.test(c);

async function getArxivCategories() {
  const { arxivCategories } = await chrome.storage.local.get("arxivCategories");
  return Array.isArray(arxivCategories) ? arxivCategories.filter(isArxivCategory) : [];
}

// The arXiv API query for the latest papers of the given categories (cross-lists included).
function arxivListingUrl(categories, start, count) {
  const terms = categories.map((c) => "cat:" + c + (ARXIV_ARCHIVES_WITH_SUBJECTS.includes(c) ? ".*" : ""));
  return "https://export.arxiv.org/api/query?search_query=" + terms.map(encodeURIComponent).join("+OR+") +
    "&sortBy=submittedDate&sortOrder=descending&start=" + start + "&max_results=" + count;
}

// arXiv's feed of the latest announcement of the given categories (served by export.arxiv.org as well as rss.arxiv.org).
// It lists exactly what arXiv announced: new submissions, cross-lists and replacements, as on arXiv's "new" pages.
const arxivFeedUrl = (categories) => "https://export.arxiv.org/rss/" + categories.map(encodeURIComponent).join("+");

// The API query for given arXiv ids (the feed has no submission times; the API gives the same fields as the listing).
const arxivIdListUrl = (ids) => "https://export.arxiv.org/api/query?id_list=" + ids.map(encodeURIComponent).join(",") + "&max_results=" + ids.length;

// Read the feed: { date: "YYYY-MM-DD" of the announcement (or ""), items: [{ id, type, version, title, abstract,
// categories, authors, authorCount }] } with type "new", "cross", "replace" or "replace-cross". The feed carries
// everything Today's arXiv shows except the submission time, so the API is not needed for the latest announcement.
function parseArxivFeed(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const pub = (xml.querySelector("channel > pubDate") || {}).textContent || "";
  const m = /(\d{1,2}) (\w{3}) (\d{4})/.exec(pub);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = m && months.includes(m[2]) ? m[3] + "-" + String(months.indexOf(m[2]) + 1).padStart(2, "0") + "-" + m[1].padStart(2, "0") : "";
  const items = [];
  for (const item of xml.querySelectorAll("item")) {
    const id = /abs\/(.+?)(?:v\d+)?$/.exec(((item.querySelector("link") || {}).textContent || "").trim());
    const type = ((item.getElementsByTagName("arxiv:announce_type")[0] || {}).textContent || "").trim();
    if (!id || !type) continue;
    const text = (sel) => ((item.querySelector(sel) || {}).textContent || "").replace(/\s+/g, " ").trim();
    const description = text("description");
    const version = /^arXiv:\S+?(v\d+)\b/.exec(description);
    const creators = [...item.getElementsByTagName("dc:creator")].map((c) => c.textContent).join(", ");
    const authors = creators.split(/\s*,\s*/).map((a) => a.trim()).filter(Boolean);
    items.push({ id: id[1], type, version: version ? version[1] : null, title: text("title"),
      abstract: /Abstract:/.test(description) ? description.replace(/^[\s\S]*?Abstract:\s*/, "") : "", categories: [...item.querySelectorAll("category")].map((c) => c.textContent.trim()),
      authors: authors.slice(0, 6), authorCount: authors.length });
  }
  return { date, items };
}

// Read an arXiv API answer into a list of { id, version, title, authors, authorCount, abstract, published, categories, primary }.
function parseArxivListing(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const papers = [];
  for (const entry of xml.querySelectorAll("entry")) {
    const idMatch = /abs\/(.+?)(?:v(\d+))?$/.exec((entry.querySelector("id") || {}).textContent || "");
    const title = ((entry.querySelector("title") || {}).textContent || "").replace(/\s+/g, " ").trim();
    if (!idMatch || title === "Error") continue;
    const names = [...entry.querySelectorAll("author > name")].map((n) => n.textContent.trim());
    const primary = entry.getElementsByTagName("arxiv:primary_category")[0];
    papers.push({
      id: idMatch[1],
      version: idMatch[2] ? "v" + idMatch[2] : null,
      title,
      authors: names.slice(0, 6),
      authorCount: names.length,
      abstract: ((entry.querySelector("summary") || {}).textContent || "").replace(/\s+/g, " ").trim(),
      published: ((entry.querySelector("published") || {}).textContent || "").trim(),
      categories: [...entry.querySelectorAll("category")].map((c) => c.getAttribute("term")),
      primary: primary ? primary.getAttribute("term") : "",
    });
  }
  return papers;
}

// The API query for the papers of the given categories submitted between two moments (ms): one announcement day,
// reconstructed from submission times (see earlierAnnouncement in today.js).
function arxivSubmittedUrl(categories, fromMs, toMs, start, count) {
  const stamp = (ms) => new Date(ms).toISOString().replace(/[-T:]/g, "").slice(0, 12); // YYYYMMDDHHMM (GMT)
  const terms = categories.map((c) => "cat:" + c + (ARXIV_ARCHIVES_WITH_SUBJECTS.includes(c) ? ".*" : ""));
  return "https://export.arxiv.org/api/query?search_query=" + encodeURIComponent("(" + terms.join(" OR ") + ") AND submittedDate:[" + stamp(fromMs) + " TO " + stamp(toMs - 60000) + "]").replace(/%20/g, "+") +
    "&sortBy=submittedDate&sortOrder=descending&start=" + start + "&max_results=" + count;
}

// An error for a failed arXiv request; 429 / 503 mean that arXiv asks to slow down for a while.
// arXiv's API terms: at most one request every three seconds, and one connection at a time, for the whole of Papurr
// (every page and tab together). A lock shared by all pages gives "one at a time"; the time of the last request is kept
// in the browser's storage, so a request from another tab waits too. Every call to export.arxiv.org goes through here.
const ARXIV_API_GAP_MS = 3000;
function arxivPause(ms) {
  return wait(ms);
}
async function arxivApiFetch(url) {
  const go = async () => {
    let last = 0;
    try {
      last = Number((await chrome.storage.local.get("arxivLastRequest")).arxivLastRequest) || 0;
    } catch (e) {}
    const gap = Math.min(last + ARXIV_API_GAP_MS - Date.now(), ARXIV_API_GAP_MS); // (a clock set back cannot make it wait long)
    if (gap > 0) await arxivPause(gap);
    try {
      await chrome.storage.local.set({ arxivLastRequest: Date.now() });
    } catch (e) {}
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller && setTimeout(() => controller.abort(), 60000); // (a stuck connection must not block every later request)
    try {
      return await fetch(url, controller ? { signal: controller.signal } : undefined);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  if (typeof navigator === "undefined" || !navigator.locks) return go();
  return navigator.locks.request("papurr-arxiv-api", go);
}

const arxivError = (status) => new Error(tr(status === 429 || status === 503 ? "arxiv.busy" : "arxiv.reqfail", { status }));

// ---- Whether PDF links are handled by the extension at all (the on/off switch) ----
async function isCaptureEnabled() {
  const { captureEnabled } = await chrome.storage.local.get("captureEnabled");
  return captureEnabled !== false;
}

// ---- arXiv metadata ----
// Read one <entry> of an arXiv API answer.
function parseArxivEntry(entry) {
  const title = entry.querySelector("title").textContent.replace(/\s+/g, " ").trim();
  const names = [...entry.querySelectorAll("author > name")].map((n) => n.textContent.trim());
  const doi = entry.getElementsByTagName("arxiv:doi")[0];
  const idMatch = /abs\/(.+?)(?:v(\d+))?$/.exec(entry.querySelector("id").textContent.trim());
  return {
    id: idMatch ? idMatch[1] : null,
    meta: {
      title,
      authors: names.slice(0, MAX_AUTHORS),
      authorCount: names.length,
      doi: doi ? doi.textContent.trim().toLowerCase() : "",
      latestVersion: idMatch && idMatch[2] ? "v" + idMatch[2] : null,
    },
  };
}

async function fetchMetadata(id) {
  try {
    const res = await arxivApiFetch("https://export.arxiv.org/api/query?id_list=" + encodeURIComponent(id));
    const xml = new DOMParser().parseFromString(await res.text(), "application/xml");
    return parseArxivEntry(xml.querySelector("entry")).meta;
  } catch (e) {
    return { title: "", authors: [], authorCount: 0, doi: "", latestVersion: null };
  }
}

// Metadata for many arXiv IDs with one request (arXiv allows up to a few hundred; we use batches of 50).
// Returns a Map from arXiv ID to metadata. Throws if the request fails.
async function fetchMetadataBatch(ids) {
  const url = "https://export.arxiv.org/api/query?max_results=" + ids.length + "&id_list=" + ids.map(encodeURIComponent).join(",");
  const res = await arxivApiFetch(url);
  if (!res.ok) throw arxivError(res.status);
  const xml = new DOMParser().parseFromString(await res.text(), "application/xml");
  // (arXiv answers every asked ID, with an "Error" entry for unknown ones: a page without any entry, or no feed at all,
  // is an overloaded or refusing server, and counts as a failed request so that the user is told to try again)
  if (!xml.querySelector("feed") || (ids.length && !xml.querySelector("entry"))) throw arxivError(res.status);
  const found = new Map();
  for (const entry of xml.querySelectorAll("entry")) {
    const { id, meta } = parseArxivEntry(entry);
    if (id && meta.title !== "Error") found.set(id, meta);
  }
  return found;
}

// Guess the arXiv ID and version from a file name such as 2301.12345v2.pdf or hep-th_9901001v1.pdf.
// Returns { id, version } (version is null if the name has none), or null if unrecognized.
function parseFileName(name) {
  let m = /^(?:arXiv-)?(\d{4}\.\d{4,5})(v\d+)?(?:_.*)?\.pdf$/.exec(name);
  if (m) return { id: m[1], version: m[2] || null };
  m = /^([a-z-]+(?:\.[A-Za-z]{2})?)_(\d{7})(v\d+)?\.pdf$/.exec(name);
  return m ? { id: m[1] + "/" + m[2], version: m[3] || null } : null;
}

// ---- File names of journal PDFs ----
function shortHash(text) {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

// A safe file name for a DOI: no characters that some systems forbid, and short enough for all of them.
function journalFileName(doi) {
  let base = doi.replace(/[\\/:*?"<>|\s\x00-\x1f]+/g, "_").replace(/[. ]+$/, "");
  if (base.length > 100) base = base.slice(0, 90) + "-" + shortHash(doi);
  return base + ".pdf";
}

// ---- Notes: one Markdown file per paper in the papers folder ----
// The file belongs to the user. Papurr owns only the blocks between its markers
//   <!-- papurr:<name> key=value ... -->
//   ...
//   <!-- /papurr:<name> -->
// ("head": title and links; "reason": why the paper was recommended; "summary") and never changes the text outside
// them (the user's own notes). It always re-reads the file right before writing (cloud sync, external editors).
const NOTE_BLOCKS = ["head", "abstract", "reason", "summary"]; // Papurr's blocks in the order they are written ("abstract": a translated abstract)
// A reason or summary is kept per language: one block per name and language (`lang=ja`), keyed "reason@ja" in parseNote.
// (A block without `lang`, written before languages were kept, is keyed by its name alone: "an earlier version".)
const noteBlockKey = (name, lang) => (lang ? name + "@" + lang : name);
const noteBlockName = (key) => key.split("@")[0];
const noteBlockLang = (key) => key.split("@")[1] || "";

// The languages the AI can write in (code: [name for the prompt, name in that language]).
const AI_OUTPUT_LANGUAGES = {
  en: ["English", "English"], ja: ["Japanese", "日本語"], zh: ["Simplified Chinese", "简体中文"], ko: ["Korean", "한국어"],
  de: ["German", "Deutsch"], fr: ["French", "Français"], es: ["Spanish", "Español"], it: ["Italian", "Italiano"],
  pt: ["Portuguese", "Português"], ru: ["Russian", "Русский"],
};
// A sentence on the style of a language, for the prompts that ask for text (one for all: summary, reason, translation).
// Japanese is always written in the polite form (author's decision).
const AI_LANGUAGE_STYLE = { ja: "Write in the polite style (です・ます調) throughout; never in the plain style (だ・である調 or 常体)." };
const languageStyleLines = (lang) => (AI_LANGUAGE_STYLE[lang] ? ["- " + AI_LANGUAGE_STYLE[lang]] : []);
// The language chosen in Settings (`outputLang`), or else the interface language.
const aiOutputLang = (settings) => (AI_OUTPUT_LANGUAGES[settings && settings.outputLang] ? settings.outputLang : typeof currentLang !== "undefined" && AI_OUTPUT_LANGUAGES[currentLang] ? currentLang : "en");
const languageLabel = (code) => (AI_OUTPUT_LANGUAGES[code] ? AI_OUTPUT_LANGUAGES[code][1] : code || tr("note.lang.earlier"));
const NOTES_HEADING = /^##[ \t]+(Notes|メモ)[ \t]*$/; // the heading of the user's section (written in the UI language)

// The note file of a paper: "2301.12345.md" (old-style IDs: "/" -> "_"), or a DOI-based name for journal-only papers.
function noteFileName(key, entry) {
  if (key.startsWith("doi:")) return journalFileName((entry && entry.doi) || key.slice(4)).replace(/\.pdf$/, ".md");
  if (key.startsWith("ads:")) return bibcodeFileName(key.slice(4)).replace(/\.pdf$/, ".md");
  return key.replace(/[\\/:*?"<>|\s]+/g, "_") + ".md";
}

// The arXiv ID of a note named after it ("2301.12345.md", "hep-th_9901001.md"), or null.
function noteNameToId(name) {
  let m = /^(\d{4}\.\d{4,5})\.md$/.exec(name);
  if (m) return m[1];
  m = /^([a-z-]+(?:\.[A-Za-z]{2})?)_(\d{7})\.md$/.exec(name);
  return m ? m[1] + "/" + m[2] : null;
}

// Read a note into { blocks: { name: { attrs, body } }, user: "the user's text" }. A marker without its end marker, or a
// second block of the same name, is left as user text: Papurr never takes text it is not sure is its own.
function parseNote(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = {}, user = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^<!-- papurr:([a-z]+)((?:[ \t]+[\w-]+=\S*)*)[ \t]*-->$/.exec(lines[i].trim());
    const attrs = {};
    if (m) for (const [, k, v] of m[2].matchAll(/([\w-]+)=(\S*)/g)) attrs[k] = v;
    const key = m && noteBlockKey(m[1], attrs.lang);
    const end = m && !blocks[key] ? lines.findIndex((l, j) => j > i && l.trim() === "<!-- /papurr:" + m[1] + " -->") : -1;
    if (end < 0) {
      user.push(lines[i]);
      continue;
    }
    blocks[key] = { attrs, body: lines.slice(i + 1, end).join("\n") };
    i = end;
  }
  return { blocks, user: user.join("\n").replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "") };
}

// The text of a note: Papurr's blocks first (in a fixed order), then the user's text.
function buildNote(note) {
  const value = (v) => String(v).replace(/[^\w.:+\/@-]/g, "_"); // (no spaces, no "-->")
  const rank = (key) => (NOTE_BLOCKS.includes(noteBlockName(key)) ? NOTE_BLOCKS.indexOf(noteBlockName(key)) : NOTE_BLOCKS.length);
  const keys = Object.keys(note.blocks).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  const block = (key) => {
    const b = note.blocks[key];
    const name = noteBlockName(key), lang = noteBlockLang(key);
    const attrs = Object.entries({ ...(b.attrs || {}), ...(lang ? { lang } : {}) }).map(([k, v]) => " " + k + "=" + value(v)).join("");
    return ["<!-- papurr:" + name + attrs + " -->", ...(b.body ? [b.body.replace(/\s+$/, "")] : []), "<!-- /papurr:" + name + " -->"].join("\n");
  };
  // The head first, then the sections in the order the user chose (noteOrder), each block of a section in all its languages.
  const parts = keys.filter((k) => noteBlockName(k) === "head").map(block);
  for (const section of noteOrder(note)) {
    if (section === "notes") {
      if (note.user) parts.push(note.user);
    } else parts.push(...keys.filter((k) => noteBlockName(k) === section).map(block));
  }
  return parts.join("\n\n") + "\n";
}

// The order of a note's sections: the user's own notes ("notes") and Papurr's sections, as chosen on the note page
// (kept in the head block as order=a+b+c); anything not named there follows in the usual order (Papurr's sections first,
// then the user's notes; block names from a newer Papurr after the known ones).
function noteOrder(note) {
  const present = [...new Set(Object.keys(note.blocks).map(noteBlockName))].filter((n) => n !== "head");
  const usual = [...NOTE_BLOCKS.filter((n) => n !== "head" && present.includes(n)), ...present.filter((n) => !NOTE_BLOCKS.includes(n)).sort(), "notes"];
  const head = note.blocks.head;
  const chosen = ((head && head.attrs && head.attrs.order) || "").split("+").filter((n) => usual.includes(n));
  return [...new Set([...chosen, ...usual])];
}

// The user's section without its "## Notes" heading, and the section with new text under the same heading.
function noteUserBody(user) {
  const lines = (user || "").split("\n");
  return NOTES_HEADING.test(lines[0]) ? lines.slice(1).join("\n").replace(/^(?:[ \t]*\n)+/, "") : user || "";
}
function withNoteBody(user, body) {
  const first = (user || "").split("\n")[0];
  const heading = NOTES_HEADING.test(first) ? first : "## " + tr("note.heading");
  body = body.replace(/\s+$/, "");
  return body ? heading + "\n\n" + body : heading;
}

// The head block: title, authors and links, so the file explains itself when opened outside Papurr.
function noteHead(key, entry) {
  const names = (entry.authors || []).join(", ") + (entry.authorCount > (entry.authors || []).length ? ", et al." : "");
  const kind = paperKind(key);
  const link = kind === "doi" ? "[DOI:" + entry.doi + "](https://doi.org/" + entry.doi + ")" : kind === "ads" ? "[ADS:" + key.slice(4) + "](" + adsAbstractUrl(key.slice(4)) + ")" : "[arXiv:" + key + "](https://arxiv.org/abs/" + key + ")";
  return "# " + (entry.title || key) + "\n\n" + [names, link].filter(Boolean).join(" · ");
}

const newNote = (key, entry) => ({ blocks: { head: { attrs: {}, body: noteHead(key, entry) } }, user: withNoteBody("", "") });

// Two notes of the same paper (e.g. one made while it was journal-only, one made on another computer under its arXiv
// name): the user's texts are both kept, and of Papurr's blocks the newer one wins.
function mergeNotes(a, b) {
  const blocks = { ...a.blocks };
  for (const [name, block] of Object.entries(b.blocks)) {
    if (name === "head" && blocks.head) continue;
    if (!blocks[name] || (block.attrs.date || "") > (blocks[name].attrs.date || "")) blocks[name] = block;
  }
  const ua = noteUserBody(a.user).trim(), ub = noteUserBody(b.user).trim();
  const body = !ub || ua.includes(ub) ? ua : !ua || ub.includes(ua) ? ub : ua + "\n\n" + ub;
  return { blocks, user: withNoteBody(a.user || b.user, body) };
}

const withNoteLock = (fn) => withLock("papurr-notes", fn);

// Change a note: `change(note)` gets the note as it is in the file right now and changes it; written only if it changed.
// Returns the new text, or null if the file does not exist (then nothing is written).
async function editNote(dir, name, change) {
  return withNoteLock(async () => {
    const text = await readFileText(dir, name);
    if (text === null) return null;
    const note = parseNote(text);
    await change(note);
    const out = buildNote(note);
    if (out !== text) await writeFileText(dir, name, out);
    return out;
  });
}

// Conflict copies of a note made by cloud services when two computers changed it at the same time: "X (conflicted copy
// ...).md" (Dropbox), "X (1).md" (Google Drive), "X 2.md" (iCloud), "X.sync-conflict-....md" (Syncthing), "X-Name.md"
// (OneDrive). Papurr does not merge them (they hold the user's own text); the note page points them out.
function noteConflictCopies(name, files) {
  const base = name.replace(/\.md$/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^" + base + "(?: \\(.*\\)| \\d+|\\.sync-conflict-[^.]*|-[^.]+)\\.md$", "i");
  return files.filter((f) => f !== name && re.test(f)).sort();
}

// Make sure the paper `key` has a note file and that the index knows it. Returns the file name, or null if the paper
// is not in the library. (Order of locks: the index, then the notes; never the other way round.)
async function ensureNote(dir, key) {
  return updateIndex(dir, async (papers) => {
    const entry = papers[key];
    if (!entry) return null;
    const name = entry.note || noteFileName(key, entry);
    await withNoteLock(async () => {
      if ((await readFileText(dir, name)) === null) await writeFileText(dir, name, buildNote(newNote(key, entry)));
    });
    if (entry.note !== name) {
      entry.note = name;
      touch(entry);
    }
    return name;
  });
}

// Move a note to another name (a journal-only paper became an arXiv paper). If the target exists, the two are merged.
// Returns the name that holds the note afterwards (the old one if moving failed: nothing is ever lost), or null if neither exists.
async function moveNote(dir, from, to, key, entry) {
  if (from === to) return to;
  return withNoteLock(async () => {
    const [fromText, toText] = [await readFileText(dir, from), await readFileText(dir, to)];
    if (fromText === null) return toText === null ? null : to;
    const note = toText === null ? parseNote(fromText) : mergeNotes(parseNote(toText), parseNote(fromText));
    note.blocks.head = { attrs: {}, body: noteHead(key, entry) };
    try {
      await writeFileText(dir, to, buildNote(note));
    } catch (e) {
      return from;
    }
    try {
      await dir.removeEntry(from); // only after the note was written under its new name
    } catch (e) {}
    return to;
  });
}

// A journal-only entry ("doi:<doi>", saved earlier) belongs to the arXiv entry `key`: take over its journal PDF, tags
// and note, and remove it. Called inside updateIndex.
async function absorbDoiEntry(dir, papers, key, doi) {
  const doiKey = doi && "doi:" + doi;
  const from = doiKey && papers[doiKey], entry = papers[key];
  if (!from || !entry || doiKey === key) return;
  if (from.journal && !entry.journal) entry.journal = from.journal;
  if (from.tags) entry.tags = [...new Set([...(entry.tags || []), ...from.tags])];
  delete papers[doiKey];
  if (from.note) {
    const name = await moveNote(dir, from.note, entry.note || noteFileName(key, entry), key, entry);
    if (name) entry.note = name;
  }
  touch(entry);
}

// ---- Papers known only by their ADS bibcode (old scanned articles, often without a DOI) ----
// Key "ads:<bibcode>" (a third kind, next to arXiv IDs and "doi:<doi>"); the PDF is recorded like a journal version
// (entry.journal), so opening, deleting and "Show in folder" work as for journal papers. Not a schema change: an older
// Papurr shows such a paper oddly (as an arXiv number) but keeps it.
// A bibcode has 19 characters: year, journal (5), volume (4), section (1), page (4), first author's initial,
// e.g. 1984ApJ...279..499F, 1970A&A.....5...84Z, 1971MNRAS.152...75H.
const BIBCODE = "\\d{4}[A-Za-z&][A-Za-z&.]{4}[.\\d]{4}[A-Za-z.][.\\d]{4}[A-Z.]";
const isBibcode = (text) => new RegExp("^" + BIBCODE + "$").test(text || "");
const paperKind = (key) => (key.startsWith("doi:") ? "doi" : key.startsWith("ads:") ? "ads" : "arxiv");
const isArxivKey = (key) => paperKind(key) === "arxiv";
const bibcodeFileName = (bibcode) => bibcode.replace(/[\\/:*?"<>|\s]+/g, "_") + ".pdf";
const bibcodeJournal = (bibcode) => ({ name: bibcode.slice(4, 9).replace(/\.+$/, ""), year: Number(bibcode.slice(0, 4)) });
// Title, authors and DOI of a bibcode's paper, from Crossref (ADS itself does not answer programs without a key):
// searched by journal (ISSN), year, volume and page, and accepted only if volume, first page and the first author's
// initial all match the bibcode. Returns null if Crossref has no such paper (common for very old volumes).
const BIBCODE_ISSNS = {
  ApJ: ["0004-637X", "2041-8205"], ApJS: ["0067-0049"], AJ: ["0004-6256"], MNRAS: ["0035-8711"], "A&A": ["0004-6361"],
  PASP: ["0004-6280"], ARA_A: ["0066-4146"], PhRv: ["0031-899X"], PhRvL: ["0031-9007"], PhRvD: ["0556-2821", "1550-7998", "2470-0010"],
  NuPhB: ["0550-3213"], PhLB: ["0370-2693"], Natur: ["0028-0836"], Sci: ["0036-8075"], CQGra: ["0264-9381"], JCAP: ["1475-7516"],
  JHEP: ["1029-8479"], GReGr: ["0001-7701"], RvMP: ["0034-6861"], CMaPh: ["0010-3616"], AnPhy: ["0003-4916"], PhR: ["0370-1573"],
  PThPh: ["0033-068X"],
};
function parseBibcode(bibcode) {
  const strip = (s) => s.replace(/\./g, "");
  return { year: Number(bibcode.slice(0, 4)), journal: strip(bibcode.slice(4, 9)), volume: strip(bibcode.slice(9, 13)).replace(/^0+/, ""),
    section: bibcode[13] === "." ? "" : bibcode[13], page: strip(bibcode.slice(14, 18)).replace(/^0+/, ""), initial: bibcode[18] === "." ? "" : bibcode[18] };
}
function crossrefMatchesBibcode(work, b) {
  const first = String(work.page || "").split(/[-–]/)[0].trim();
  const pageOk = !!b.page && (first === b.page || (b.section && /[A-Z]/.test(b.section) && first === b.section + b.page) ||
    (b.section && /[a-z]/.test(b.section) && /^\d+$/.test(first) && first.endsWith(b.page.padStart(4, "0"))));
  const family = String(((work.author || [])[0] || {}).family || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return String(work.volume || "") === b.volume && pageOk && (!b.initial || family.toUpperCase().startsWith(b.initial));
}
async function fetchBibcodeMetadata(bibcode) {
  const b = parseBibcode(bibcode);
  const issns = BIBCODE_ISSNS[b.journal.replace("&", "_")] || BIBCODE_ISSNS[b.journal];
  const filter = ["from-pub-date:" + b.year, "until-pub-date:" + b.year, ...(issns || []).map((i) => "issn:" + i)].join(",");
  const query = (issns ? "" : b.journal + " ") + b.volume + " " + (b.section && /[A-Z]/.test(b.section) ? b.section : "") + b.page;
  const res = await fetch("https://api.crossref.org/works?rows=20&select=DOI,title,volume,page,author,container-title&filter=" + encodeURIComponent(filter) + "&query.bibliographic=" + encodeURIComponent(query));
  if (!res.ok) throw new Error("Crossref: HTTP " + res.status);
  const work = ((await res.json()).message.items || []).find((w) => crossrefMatchesBibcode(w, b));
  if (!work) return null;
  const names = (work.author || []).map((a) => [a.given, a.family].filter(Boolean).join(" "));
  return { title: ((work.title || [""])[0] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(), authors: names.slice(0, MAX_AUTHORS),
    authorCount: names.length, doi: work.DOI || "", journalName: (work["container-title"] || [""])[0] || "" };
}
const adsAbstractUrl = (bibcode) => "https://ui.adsabs.harvard.edu/abs/" + encodeURIComponent(bibcode) + "/abstract";
// What a paper is called in the list: "arXiv:…", "DOI:…" or "ADS:…".
const paperLabel = (key, entry) => ({ doi: "DOI:" + ((entry && entry.doi) || key.slice(4)), ads: "ADS:" + key.slice(4), arxiv: "arXiv:" + key })[paperKind(key)];

const PAGE_BATCH = 50; // arXiv IDs per metadata request
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const listFiles = async (dir) => {
  const names = [];
  for await (const [name, handle] of dir.entries()) if (handle.kind === "file") names.push(name);
  return names;
};

const entryFiles = (entry) => [...Object.values(entry.versions), ...(entry.journal ? [entry.journal.file] : []), ...(entry.note ? [entry.note] : [])];
const hasPdf = (entry) => Object.keys(entry.versions).length > 0 || !!entry.journal;

// Bring index.json in line with the folder:
//  - drop entries whose files are gone (asks first if many are missing, e.g. a cloud folder still syncing),
//  - add arXiv PDFs that are not in the index yet (only those whose name carries a version; see import.js for the rest),
//    and notes named after an arXiv ID ("2301.12345.md"); an entry with only a note is kept,
//  - fill in titles that are still empty because an earlier lookup failed (ADS papers: from Crossref, see fetchBibcodeMetadata).
// Options: report(text) shows progress, confirmRemoval(count, total) -> boolean, isCancelled() -> boolean.
async function rebuildIndex(dir, { report = () => {}, confirmRemoval = () => true, isCancelled = () => false } = {}) {
  await mergeConflictCopies(dir);

  // 1. Look at what is there and decide what has to be looked up online.
  const files = await listFiles(dir);
  const present = new Set(files);
  const snapshot = await readIndex(dir);
  const known = new Set(Object.values(snapshot).flatMap(entryFiles));
  const lookupIds = new Set();
  for (const name of files) {
    const parsed = known.has(name) ? null : parseFileName(name);
    if (parsed && parsed.version && !snapshot[parsed.id]) lookupIds.add(parsed.id); // (names without a version are left to the import: it can read the version from the PDF)
    const noteId = known.has(name) ? null : noteNameToId(name);
    if (noteId && !snapshot[noteId]) lookupIds.add(noteId);
  }
  for (const [id, entry] of Object.entries(snapshot)) if (!entry.title && isArxivKey(id)) lookupIds.add(id);
  const emptyDois = Object.entries(snapshot).filter(([id, e]) => !e.title && id.startsWith("doi:") && e.doi).map(([id, e]) => e.doi);
  const emptyBibcodes = Object.keys(snapshot).filter((id) => !snapshot[id].title && id.startsWith("ads:")).map((id) => id.slice(4));

  const missing = Object.values(snapshot).reduce((n, e) => n + entryFiles(e).filter((f) => !present.has(f)).length, 0);
  const totalFiles = Object.values(snapshot).reduce((n, e) => n + entryFiles(e).length, 0);
  let removeMissing = true;
  if (missing > 3 && missing > totalFiles * 0.1) removeMissing = await confirmRemoval(missing, totalFiles);

  // 2. Ask arXiv (in batches, politely) and Crossref.
  const metaById = new Map();
  const attempted = new Set();
  const ids = [...lookupIds];
  let failedBatches = 0;
  for (let i = 0; i < ids.length && !isCancelled(); i += PAGE_BATCH) {
    report(tr("rebuild.reading", { a: Math.min(i + PAGE_BATCH, ids.length), b: ids.length }));
    const batch = ids.slice(i, i + PAGE_BATCH);
    try {
      for (const [id, meta] of await fetchMetadataBatch(batch)) metaById.set(id, meta);
      batch.forEach((id) => attempted.add(id));
    } catch (e) {
      failedBatches++;
    }
  }
  const metaByDoi = new Map();
  for (const doi of emptyDois) {
    if (isCancelled()) break;
    try {
      metaByDoi.set(doi, await fetchJournalMetadata(doi));
    } catch (e) {}
    await wait(1000);
  }
  const metaByBibcode = new Map();
  for (const bibcode of emptyBibcodes) {
    if (isCancelled()) break;
    try {
      const meta = await fetchBibcodeMetadata(bibcode);
      if (meta) metaByBibcode.set(bibcode, meta);
    } catch (e) {}
    await wait(1000);
  }

  // 3. Apply the result to the current index (which may have changed in the meantime).
  const result = await updateIndex(dir, async (papers) => {
    const nowPresent = new Set(await listFiles(dir));
    let added = 0, removed = 0, refreshed = 0;

    if (removeMissing) {
      for (const [id, entry] of Object.entries(papers)) {
        let changed = false;
        for (const [version, file] of Object.entries(entry.versions)) {
          if (!nowPresent.has(file)) {
            delete entry.versions[version];
            removed++;
            changed = true;
          }
        }
        if (entry.journal && !nowPresent.has(entry.journal.file)) {
          delete entry.journal;
          removed++;
          changed = true;
        }
        if (entry.note && !nowPresent.has(entry.note)) {
          delete entry.note;
          removed++;
          changed = true;
        }
        if (!hasPdf(entry) && !entry.note) delete papers[id];
        else if (changed) touch(entry);
      }
    }

    const knownNow = new Set(Object.values(papers).flatMap(entryFiles));
    for (const name of nowPresent) {
      if (knownNow.has(name)) continue;
      const noteId = noteNameToId(name);
      if (noteId) {
        let entry = papers[noteId];
        if (entry && entry.note) continue; // (the paper's note has another name, e.g. made before it was linked to arXiv)
        if (!entry) {
          if (!attempted.has(noteId)) continue;
          const { latestVersion, ...meta } = metaById.get(noteId) || { title: "", authors: [], authorCount: 0, doi: "" };
          const now = new Date().toISOString();
          entry = papers[noteId] = { ...meta, added: now, modified: now, versions: {} };
        }
        entry.note = name;
        touch(entry);
        added++;
        continue;
      }
      const parsed = parseFileName(name);
      if (!parsed || !parsed.version) continue;
      let entry = papers[parsed.id];
      if (!entry) {
        if (!attempted.has(parsed.id)) continue; // lookup was cancelled or failed: it will be picked up next time
        const { latestVersion, ...meta } = metaById.get(parsed.id) || { title: "", authors: [], authorCount: 0, doi: "" };
        const now = new Date().toISOString();
        entry = papers[parsed.id] = { ...meta, added: now, modified: now, versions: {} };
      }
      entry.versions[parsed.version] = name;
      touch(entry);
      added++;
    }

    for (const [id, entry] of Object.entries(papers)) {
      if (entry.title) continue;
      const found = id.startsWith("doi:") ? metaByDoi.get(entry.doi) : id.startsWith("ads:") ? metaByBibcode.get(id.slice(4)) : isArxivKey(id) ? metaById.get(id) : null;
      if (found && found.title) {
        entry.title = found.title;
        entry.authors = found.authors;
        entry.authorCount = found.authorCount;
        if (!entry.doi && found.doi) entry.doi = found.doi;
        touch(entry);
        refreshed++;
      }
    }
    return { added, removed, refreshed, total: Object.keys(papers).length };
  });
  return { ...result, failedBatches, cancelled: isCancelled() };
}

// Sort key that orders arXiv IDs by submission month and then by serial number.
// New style "2301.12345" -> "202301" + serial; old style "hep-th/9901001" -> "199901" + serial.
function arxivSortKey(id) {
  let m = /^(\d{2})(\d{2})\.(\d+)$/.exec(id);
  if (m) return "20" + m[1] + m[2] + m[3].padStart(7, "0");
  m = /\/(\d{2})(\d{2})(\d{3})$/.exec(id);
  if (m) return (+m[1] >= 90 ? "19" : "20") + m[1] + m[2] + m[3].padStart(7, "0");
  return id;
}

// ---- Journal versions ----
// Title, authors, journal name and year of a DOI, from Crossref (covers almost every DOI).
async function fetchJournalMetadata(doi) {
  const res = await fetch("https://api.crossref.org/works/" + encodeURIComponent(doi));
  if (!res.ok) throw new Error(tr("crossref.none", { doi, status: res.status }));
  const work = (await res.json()).message;
  const names = (work.author || []).map((a) => [a.given, a.family].filter(Boolean).join(" "));
  const issued = work.issued && work.issued["date-parts"] && work.issued["date-parts"][0];
  return {
    title: ((work.title || [""])[0] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    authors: names.slice(0, MAX_AUTHORS),
    authorCount: names.length,
    journalName: (work["container-title"] || [""])[0] || "",
    year: issued && issued[0] ? issued[0] : null,
  };
}

// The arXiv ID belonging to a DOI: ask INSPIRE first, then OpenAlex. Returns null if neither knows one.
async function findArxivIdForDoi(doi) {
  try {
    const res = await fetch("https://inspirehep.net/api/doi/" + doi + "?fields=arxiv_eprints");
    if (res.ok) {
      const eprints = (await res.json()).metadata.arxiv_eprints;
      if (eprints && eprints[0]) return eprints[0].value;
    }
  } catch (e) {}
  try {
    const res = await fetch("https://api.openalex.org/works/doi:" + doi);
    if (res.ok) {
      const m = /arxiv\.org\/(?:abs|pdf)\/([^"?#]+?)(?:v\d+)?(?:\.pdf)?["?#]/i.exec(await res.text());
      if (m) return m[1];
    }
  } catch (e) {}
  return null;
}

// The link that starts a full-text summary: it only opens the paper's note page (in the same tab), which shows the
// estimate first.
function summaryLink(id, version) {
  const a = document.createElement("a");
  a.className = "mini";
  a.href = "note.html?id=" + encodeURIComponent(id) + (version ? "&v=" + version : "") + "&summarize=1";
  a.textContent = tr("summary.start");
  a.title = tr("summary.start.tip");
  return a;
}

// ---- Formulas ----
// A formula typeset with KaTeX (bundled in vendor/katex; pages that show notes load it) or, when the page has no KaTeX
// or KaTeX cannot read the formula, its LaTeX text. `tex` is without the $ signs.
function mathElement(tex, display, tag) {
  const el = document.createElement(tag || (display ? "div" : "span"));
  el.className = "math" + (display ? " display" : "");
  if (typeof katex !== "undefined") {
    try {
      katex.render(tex, el, { displayMode: !!display, throwOnError: true, strict: "ignore", trust: false });
      el.title = tex;
      return el;
    } catch (e) {} // (not something KaTeX can read: shown as text)
  }
  el.textContent = display ? "$$" + tex + "$$" : "$" + tex + "$";
  return el;
}

// Plain text with $...$ and $$...$$ formulas, as nodes (the text itself is never read as HTML).
function textWithMath(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of String(text).matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g)) {
    frag.append(text.slice(last, m.index));
    frag.append(m[1] !== undefined ? mathElement(m[1], true, "span") : mathElement(m[2], false));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

// ---- Showing a paper in the library tab ----
// Pages talk to an open library tab on the BroadcastChannel "papurr": { type: "added" | "show", id }. The library answers
// { type: "shown", id }, comes to the front and highlights the paper. Returns true if a library tab answered within 1 s.
// ("added" also tells Today's arXiv that the paper is now saved.)
async function askLibraryToShow(id, type = "show") {
  if (typeof BroadcastChannel !== "function") return false;
  const channel = new BroadcastChannel("papurr");
  const answered = new Promise((resolve) => {
    channel.onmessage = (e) => e.data && e.data.type === "shown" && e.data.id === id && resolve(true);
    setTimeout(() => resolve(false), 1000);
  });
  channel.postMessage({ type, id });
  const shown = await answered;
  channel.close();
  return shown;
}

// ---- Opening papers: in a Chrome tab, or in an external PDF app via the native helper ----
const NATIVE_HOST = "com.paper_folder_manager.opener";

async function getOpenSettings() {
  const { openMode, viewer } = await chrome.storage.local.get(["openMode", "viewer"]);
  return { openMode: openMode || "chrome", viewer: viewer || "" };
}

// The marker file lets the helper find the papers folder on disk by itself.
async function ensureMarker(dir) {
  const handle = await dir.getFileHandle(".paper-folder-id", { create: true });
  let token = (await (await handle.getFile()).text()).trim();
  if (!token) {
    token = crypto.randomUUID();
    const writable = await handle.createWritable();
    await writable.write(token);
    await writable.close();
  }
  return token;
}

// Send a request about one file of the papers folder to the helper. Throws with a readable message on failure.
async function askHelper(dir, action, fileName, extra = {}) {
  const token = await ensureMarker(dir);
  let reply;
  try {
    reply = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { action, token, file: fileName, ...extra });
  } catch (e) {
    throw new Error(tr("helper.unreachable", { msg: e.message }));
  }
  if (!reply || !reply.ok) throw new Error((reply && reply.error) || tr("helper.noanswer"));
}

// Open a file of the papers folder in the external app.
const openExternally = (dir, fileName, viewer) => askHelper(dir, "open", fileName, { viewer });

// Show a file of the papers folder in the system's file manager (Finder on a Mac).
const revealInFolder = (dir, fileName) => askHelper(dir, "reveal", fileName);

// ---- Reading what an AI answered (the helper already tries; this is the second net) ----
// The JSON value in an AI's answer, or null. Models sometimes wrap it in a code fence or a sentence, write a raw line break
// inside a string, or write a LaTeX backslash without doubling it (\gamma is not valid JSON; \frac and \beta are valid but
// mean a form feed and a backspace there). A backslash before a letter that starts a LaTeX command stays a backslash
// (not before "n": a line break is far more likely than \nu).
function parseLooseJson(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [t];
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) candidates.push(t.slice(a, b + 1));
  const rawControls = (s) => { // line breaks and tabs written inside a string value
    let out = "", inString = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inString && c === "\\") { out += c + (s[i + 1] || ""); i++; continue; }
      if (c === '"') inString = !inString;
      out += inString && c < " " ? (c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) : c;
    }
    return out;
  };
  const broken = (v) => (typeof v === "string" ? /[\f\b]/.test(v) : v && typeof v === "object" ? Object.values(v).some(broken) : false);
  for (const c of candidates) {
    const fixed = rawControls(c).replace(/\\(?!["\\/bfnrtu])|\\(?=[bfrt][A-Za-z])/g, "\\\\");
    let first = null;
    try { first = JSON.parse(rawControls(c)); } catch (e) {}
    if (first !== null && !broken(first)) return first;
    try { return JSON.parse(fixed); } catch (e) { if (first !== null) return first; }
  }
  return null;
}

// An AI's text for a note: formulas between dollar signs, as the note view and KaTeX read them. Some models write
// \( ... \) and \[ ... \] although they were asked not to; a form feed or a backspace is a LaTeX command (\frac, \beta)
// that was read as a JSON escape.
function normalizeAiText(text) {
  return String(text)
    .replace(/\f/g, "\\f").replace(/\x08/g, "\\b")
    .replace(/\\\[([\s\S]+?)\\\]/g, (m, x) => "$$" + x.trim() + "$$")
    .replace(/\\\(([\s\S]+?)\\\)/g, (m, x) => "$" + x.trim() + "$");
}

// The text of one field of an answer that is JSON-like but cannot be parsed even leniently (e.g. a quotation mark inside the
// text that was not escaped): everything between `"key": "` and the last `"` before the closing brace. null if it does not
// look like that. (Without this the raw `{"summary": "..."}` would be shown as the text.)
function jsonLikeField(text, key) {
  const m = new RegExp('^\\s*(?:```(?:json)?\\s*)?\\{\\s*"' + key + '"\\s*:\\s*"([\\s\\S]*)"\\s*\\}\\s*(?:```)?\\s*$').exec(String(text));
  return m ? m[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\") : null;
}
