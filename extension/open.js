// Open a paper from the papers folder; if it is not saved yet, save it first. Three kinds of request:
//   ?id=2301.12345[&v=v2]   an arXiv paper (no version = the latest one)
//   ?id=<key>&local=1       the newest saved copy, without going online (used by the library)
//   ?id=<key>&journal=1     the saved journal version (used by the library)
//   ?doi=...&pdf=...        a journal PDF link that was clicked on a publisher site
//   ?ads=<bibcode>&pdf=...  a scanned article of NASA ADS (old papers, often without a DOI), with &title= and &authors=
//                           (JSON) as the ADS page declared them
//   ?id=...[&v=v2]&save=1   save an arXiv paper without opening it ("Add to library" in Today's arXiv), then hand
//                           over to the library tab, which highlights it; &title=, &authors= (JSON) and &n= (author
//                           count) as Today's arXiv knows them, used if arXiv's API does not answer
const msgEl = document.getElementById("msg");
const grantBtn = document.getElementById("grant");
const grantHint = document.getElementById("grant-hint");
const fallbackEl = document.getElementById("fallback");
const inChromeBtn = document.getElementById("inchrome");
let workDir = null; // the papers folder
const params = new URLSearchParams(location.search);
const arxivId = params.get("id");
const localOnly = params.get("local") === "1"; // open the newest saved version; never go online
const journalOnly = params.get("journal") === "1"; // open the saved journal version
const saveOnly = params.get("save") === "1"; // save, do not open
const quietSave = params.get("quiet") === "1"; // with save: tell the library tab only to read its list again (no jump, no highlight), then close
const wantedVersion = params.get("v"); // e.g. "v2"; null means "the latest version"
const journalDoiParam = params.get("doi");
const journalPdfUrl = params.get("pdf");
const adsBibcode = params.get("ads");
const sourceTab = Number(params.get("src")) || null; // the publisher tab where the PDF link was clicked
const manualEl = document.getElementById("manual");

// Strip characters not allowed in file names (also replaces the "/" in old-style IDs like hep-th/9901001)
const safe = (s) => s.replace(/[\\/:*?"<>|\s]+/g, "_");

// Find the saved file to open: the given version, or the newest saved one if version is null.
async function findExisting(dir, id, version) {
  const entry = (await readIndex(dir))[id];
  if (!entry) return null;
  const key = version || sortedVersions(entry).pop();
  const file = entry.versions[key];
  if (!file) return null;
  try {
    return await dir.getFileHandle(file);
  } catch (e) {
    return null; // file was deleted by hand
  }
}

async function findJournal(dir, id) {
  const entry = (await readIndex(dir))[id];
  if (!entry || !entry.journal) return null;
  try {
    return await dir.getFileHandle(entry.journal.file);
  } catch (e) {
    return null;
  }
}

async function writeFile(dir, name, blob) {
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return fileHandle;
}

// A PDF already in the folder under the name Papurr would give the download (put there by hand, or by another program,
// and not in the library yet): it is used as it is and never overwritten (it may carry the user's annotations).
// Returns its handle, null if there is no such file; a file of that name that is not a PDF is left alone (error).
async function existingPdf(dir, name) {
  let handle;
  try {
    handle = await dir.getFileHandle(name);
  } catch (e) {
    if (e.name === "NotFoundError") return null;
    throw e;
  }
  if ((await (await handle.getFile()).slice(0, 5).text()) !== "%PDF-") throw new Error(tr("dl.exists", { name }));
  msgEl.textContent = tr("dl.adopted", { name });
  return handle;
}

async function download(dir, id, version, known) {
  msgEl.textContent = tr("dl.arxiv", { id, ver: version || "" });
  const { latestVersion, ...meta } = known || (await fetchMetadata(id)); // (`known`: already asked in this same action)
  const target = version || latestVersion; // may be null if arXiv's API was unreachable
  if (!meta.title) Object.assign(meta, givenMetadata());
  const name = safe(id) + (target || "") + ".pdf";
  let fileHandle = await existingPdf(dir, name);
  if (!fileHandle) {
    const res = await fetch("https://arxiv.org/pdf/" + id + (target || ""));
    if (!res.ok) throw new Error(tr("dl.failed", { status: res.status }));
    fileHandle = await writeFile(dir, name, await res.blob());
  }

  await updateIndex(dir, async (index) => {
    const entry = (index[id] = index[id] || { ...meta, added: new Date().toISOString(), versions: {} });
    if (!entry.title && meta.title) Object.assign(entry, meta);
    entry.versions[target || UNVERSIONED] = name;
    // A journal-only entry for the same DOI (saved earlier) now belongs to this arXiv entry (with its tags and note).
    await absorbDoiEntry(dir, index, id, meta.doi);
    touch(entry);
  });
  return fileHandle;
}

// Title and authors handed over in the URL (by Today's arXiv), for when arXiv's API does not answer.
function givenMetadata() {
  let authors = [];
  try {
    authors = JSON.parse(params.get("authors") || "[]").filter((a) => typeof a === "string");
  } catch (e) {}
  const title = (params.get("title") || "").trim();
  return title ? { title, authors: authors.slice(0, MAX_AUTHORS), authorCount: Math.max(Number(params.get("n")) || 0, authors.length) } : {};
}

// Save a journal PDF under its DOI and link it to the arXiv entry of the same paper, if there is one.
// ---- When the publisher refuses the extension's own request ----
// Some publishers (bot protection, cookies) refuse a request that comes from the extension's page, although the same
// PDF opens when the link is followed on their site. Then the publisher's own page (the tab where the user clicked)
// is asked to fetch exactly that PDF, once: as a request of that site it carries the site's own cookies, like
// "open the PDF the normal way". Nothing else of the page is read or changed, and only a PDF of the same site is fetched.
const PAGE_FETCH_MAX = 40 * 1024 * 1024; // bytes

// Runs inside the publisher's page, in Chrome's separate world for extensions (it does not see the page's scripts).
async function pagePdfFetch(url, max) {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return { ok: false, status: res.status };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > max) return { ok: false, status: "toolarge" };
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") return { ok: false, status: "notpdf" };
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { ok: true, data: btoa(text) };
  } catch (e) {
    return { ok: false, status: "error" };
  }
}

const siteOf = (host) => host.split(".").slice(-2).join(".");

// The PDF as a Blob, fetched through the publisher's tab, or null (no tab, another site, refused, not a PDF, ...).
async function fetchThroughPage(tabId, pdfUrl) {
  if (!tabId || !chrome.scripting) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    const page = new URL(tab.url), pdf = new URL(pdfUrl);
    if (page.protocol !== "https:" || pdf.protocol !== "https:" || siteOf(page.hostname) !== siteOf(pdf.hostname)) return null;
    const [first] = await chrome.scripting.executeScript({ target: { tabId }, func: pagePdfFetch, args: [pdfUrl, PAGE_FETCH_MAX] });
    const r = first && first.result;
    if (!r || !r.ok || typeof r.data !== "string") return null;
    return new Blob([Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0))], { type: "application/pdf" });
  } catch (e) {
    return null; // the tab was closed, moved on, or the script could not run there
  }
}

// The PDF at `pdfUrl` as a Blob: the extension's own request, else (refused, or not a PDF) through the page where the link
// was clicked. Throws with the reason if neither works.
async function fetchPdf(pdfUrl) {
  let blob = null, refusal = "";
  try {
    const res = await fetch(pdfUrl, { credentials: "include" });
    if (!res.ok) refusal = tr("dl.refused", { status: res.status });
    else {
      const b = await res.blob();
      if ((await b.slice(0, 5).text()) === "%PDF-") blob = b;
      else refusal = tr("dl.notpdf");
    }
  } catch (e) {
    refusal = e.message;
  }
  if (!blob) {
    msgEl.textContent = tr("dl.viapage");
    blob = await fetchThroughPage(sourceTab, pdfUrl);
    if (!blob) throw new Error(refusal);
  }
  return blob;
}

async function downloadJournal(dir, doi, pdfUrl) {
  msgEl.textContent = tr("dl.journal", { doi });
  let name = journalFileName(doi);
  // Two different DOIs must never share a file name: add a short code if the name is taken by another paper.
  const taken = Object.values(await readIndex(dir)).some((e) => e.journal && e.journal.file === name && (e.journal.doi || e.doi || "").toLowerCase() !== doi);
  if (taken) name = name.replace(/\.pdf$/, "-" + shortHash(doi) + ".pdf");
  const fileHandle = (await existingPdf(dir, name)) || (await writeFile(dir, name, await fetchPdf(pdfUrl)));

  msgEl.textContent = tr("open.lookup");
  const [cr, arxiv] = await Promise.all([fetchJournalMetadata(doi), findArxivIdForDoi(doi)]);
  const key = arxiv || "doi:" + doi;

  // New paper: use arXiv's title/authors when the arXiv ID is known, otherwise Crossref's.
  let base = { title: cr.title, authors: cr.authors, authorCount: cr.authorCount };
  if (arxiv) {
    const { latestVersion, doi: _doi, ...meta } = await fetchMetadata(arxiv);
    if (meta.title) base = meta;
  }
  await updateIndex(dir, async (index) => {
    const entry = (index[key] = index[key] || { ...base, added: new Date().toISOString(), versions: {} });
    entry.doi = doi;
    entry.journal = { file: name, doi, name: cr.journalName, year: cr.year };
    if (arxiv) await absorbDoiEntry(dir, index, key, doi); // merge with an earlier journal-only entry (or a note-only one)
    touch(entry);
  });
  return { fileHandle, key };
}

// Show a PDF, in a Chrome tab or in the external PDF app, depending on the setting.
async function show(fileHandle) {
  const { openMode, viewer } = await getOpenSettings();
  if (openMode === "external") {
    try {
      msgEl.textContent = tr("ext.opening");
      await openExternally(workDir, fileHandle.name, viewer);
      msgEl.textContent = tr("ext.opened");
      const tab = await chrome.tabs.getCurrent();
      if (tab) setTimeout(() => chrome.tabs.remove(tab.id), 300); // this helper tab is no longer needed
      return;
    } catch (e) {
      msgEl.textContent = tr("ext.failed", { msg: e.message });
      inChromeBtn.hidden = false;
      inChromeBtn.onclick = () => showInChrome(fileHandle);
      return;
    }
  }
  await showInChrome(fileHandle);
}

async function showInChrome(fileHandle) {
  const file = await fileHandle.getFile();
  const url = URL.createObjectURL(new Blob([file], { type: "application/pdf" }));
  location.replace(url);
}

async function runJournalLink(dir) {
  const doi = journalDoiParam.toLowerCase();
  const index = await readIndex(dir);
  for (const [key, entry] of Object.entries(index)) {
    if (entry.journal && (entry.journal.doi || entry.doi || "").toLowerCase() === doi) {
      const handle = await findJournal(dir, key);
      if (handle) {
        msgEl.textContent = tr("open.saved");
        await markOpened(key);
        await show(handle);
        return;
      }
    }
  }
  const { fileHandle, key } = await downloadJournal(dir, doi, journalPdfUrl);
  await markOpened(key);
  await show(fileHandle);
}

// "Add to library": save the paper (unless it is saved already), then let the library show it.
async function saveToLibrary(dir) {
  let version = wantedVersion, known = null;
  if (!version) {
    msgEl.textContent = tr("open.checking");
    known = await fetchMetadata(arxivId);
    version = known.latestVersion;
  }
  if (!(await findExisting(dir, arxivId, version))) await download(dir, arxivId, version, known && known.title ? known : null);
  msgEl.textContent = tr("save.done");
  await handOverToLibrary(arxivId);
}

// Tell an open library tab (it answers "shown", comes to the front and highlights the paper) and close this tab;
// with no library tab, this tab becomes the library.
async function handOverToLibrary(id) {
  if (quietSave) { // (saved from a list inside the library itself, e.g. an INSPIRE result: the library stays as it is)
    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel("papurr");
      channel.postMessage({ type: "added", id, quiet: true });
      channel.close();
    }
    const tab = await chrome.tabs.getCurrent();
    if (tab) await chrome.tabs.remove(tab.id);
    return;
  }
  const shown = await askLibraryToShow(id, "added");
  const tab = await chrome.tabs.getCurrent();
  if (shown) {
    if (tab) await chrome.tabs.remove(tab.id);
    return;
  }
  if (tab) await chrome.tabs.update(tab.id, { active: true });
  goTo("library.html?highlight=" + encodeURIComponent(id));
}

function goTo(url) {
  location.replace(url);
}

// A scanned article of NASA ADS: kept under its bibcode ("ads:<bibcode>"), the PDF recorded like a journal version.
async function runAdsLink(dir) {
  const key = "ads:" + adsBibcode;
  const handle = await findJournal(dir, key);
  if (handle) {
    msgEl.textContent = tr("open.saved");
    await markOpened(key);
    return show(handle);
  }
  msgEl.textContent = tr("dl.ads", { bibcode: adsBibcode });
  const name = bibcodeFileName(adsBibcode);
  const fileHandle = (await existingPdf(dir, name)) || (await writeFile(dir, name, await fetchPdf(journalPdfUrl)));
  let authors = [];
  try {
    authors = JSON.parse(params.get("authors") || "[]").filter((a) => typeof a === "string");
  } catch (e) {}
  await updateIndex(dir, (index) => {
    const entry = (index[key] = index[key] || { title: params.get("title") || "", authors: authors.slice(0, MAX_AUTHORS), authorCount: authors.length, added: new Date().toISOString(), versions: {}, bibcode: adsBibcode });
    if (!entry.title && params.get("title")) entry.title = params.get("title");
    entry.journal = { file: name, bibcode: adsBibcode, ...bibcodeJournal(adsBibcode) };
    touch(entry);
  });
  await markOpened(key);
  return show(fileHandle);
}

async function run(dir) {
  if (saveOnly && arxivId) return saveToLibrary(dir);
  if (adsBibcode && journalPdfUrl) return runAdsLink(dir);
  if (journalDoiParam) return runJournalLink(dir);
  if (journalOnly) {
    const handle = await findJournal(dir, arxivId);
    if (!handle) throw new Error(tr("err.nojournal"));
    await markOpened(arxivId);
    return show(handle);
  }
  if (localOnly) {
    const handle = (await findExisting(dir, arxivId, null)) || (await findJournal(dir, arxivId));
    if (!handle) throw new Error(tr("err.nofile"));
    msgEl.textContent = tr("open.saved");
    await markOpened(arxivId);
    return show(handle);
  }
  let version = wantedVersion, known = null;
  if (!version) {
    // A link without a version means "the latest version": ask arXiv which one that is (the answer is used again
    // below if the paper has to be saved: one request, not two).
    msgEl.textContent = tr("open.checking");
    known = await fetchMetadata(arxivId);
    version = known.latestVersion; // null if arXiv was unreachable
  }
  // If the latest version is unknown, fall back to the newest saved version.
  let handle = await findExisting(dir, arxivId, version);
  if (handle) {
    msgEl.textContent = tr("open.saved");
  } else {
    handle = await download(dir, arxivId, version, known && known.title ? known : null);
  }
  await markOpened(arxivId);
  await show(handle);
}

function fail(e) {
  msgEl.textContent = tr("err.generic", { msg: e.message });
  if (e instanceof IndexError && e.kind === "damaged") msgEl.textContent += tr("err.repair");
  if (e.name === "NotFoundError") msgEl.textContent = tr("folder.notfound");
  if (journalPdfUrl) {
    fallbackEl.href = journalPdfUrl; // so the click is never a dead end
    fallbackEl.hidden = false;
    manualEl.textContent = tr("dl.manual", { folder: (workDir && workDir.name) || tr("dl.manual.folder") });
    manualEl.hidden = false;
  }
}

async function main() {
  await i18nReady; // texts below depend on the language
  msgEl.textContent = tr("open.preparing");
  // (only Papurr's own pages open this page; a malformed request is still refused rather than half done)
  const malformed = (arxivId && !localOnly && !journalOnly && !/^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/.test(arxivId)) ||
    (wantedVersion && !/^v\d+$/.test(wantedVersion)) || (adsBibcode && !isBibcode(adsBibcode));
  if ((!arxivId && !journalDoiParam && !adsBibcode) || malformed) {
    msgEl.textContent = tr("open.nopaper");
    return;
  }
  const dir = await loadDir();
  workDir = dir;
  if (!dir) {
    msgEl.textContent = tr("open.nofolder");
    return;
  }
  try {
    if ((await dir.queryPermission({ mode: "readwrite" })) !== "granted") {
      msgEl.textContent = tr("grant.msg", { name: dir.name });
      grantBtn.hidden = false;
      grantHint.hidden = false;
      grantBtn.onclick = async () => {
        if ((await dir.requestPermission({ mode: "readwrite" })) === "granted") {
          grantBtn.hidden = true;
          grantHint.hidden = true;
          withBusy("", () => run(dir)).catch(fail);
        }
      };
      return;
    }
    await withBusy("", () => run(dir));
  } catch (e) {
    fail(e);
  }
}

main();
