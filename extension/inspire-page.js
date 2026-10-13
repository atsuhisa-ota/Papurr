// The INSPIRE page: a search of INSPIRE's database through its API (inspire.js), with its own box, so that it never meets the
// library's search and filters. Enter (or the Search button) sends the query; the results are a list of cards. Nothing is asked
// when the page opens or while typing. A click on a result's button (BibTeX, Cited by, References), on an author, or on the
// order is a request of its own. "Add to library" saves the PDF in a background tab; "In library" marks what is saved already.
const listEl = document.getElementById("list");
const msgEl = document.getElementById("msg");
const searchEl = document.getElementById("search");
let state = null; // { query, page, total, hits, error } of the last search
let busy = false;
let sort = "mostrecent"; // or "leastrecent" (kept on this computer)
try {
  if (INSPIRE_SORTS.includes(localStorage.getItem("inspireSort"))) sort = localStorage.getItem("inspireSort");
} catch (e) {}
let savedIds = new Set(); // library keys of papers with a PDF
let savedDois = new Map(); // lowercase DOI -> library key
const adding = new Set(); // arXiv numbers being saved by "Add to library"
const allAuthors = new Set(); // record numbers whose full author list is open
const copied = new Set(); // record numbers whose BibTeX was just copied
let note = ""; // a short line from the last click on a card (BibTeX copied, or why not); shown instead of the count for a moment

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

const inspireUrl = (hit) => (hit.recid ? "https://inspirehep.net/literature/" + hit.recid : "https://inspirehep.net/");

// Which results are already in the library (only if the folder can be read without asking; a paper with only a note is not saved).
async function loadLibrary() {
  try {
    const dir = await loadDir();
    if (!dir || (await dir.queryPermission({ mode: "readwrite" })) !== "granted") return;
    const index = await readIndex(dir);
    savedIds = new Set();
    savedDois = new Map();
    for (const [id, entry] of Object.entries(index)) {
      if (!hasPdf(entry)) continue;
      savedIds.add(id);
      if (entry.doi) savedDois.set(String(entry.doi).toLowerCase(), id);
    }
  } catch (e) {} // not essential
}
const libraryKey = (hit) => (hit.arxiv && savedIds.has(hit.arxiv) ? hit.arxiv : hit.doi ? savedDois.get(hit.doi.toLowerCase()) || "" : "");

// A paper saved in another tab (by "Add to library" here, or from Today's arXiv) is marked at once.
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("papurr") : null;
if (channel) {
  channel.onmessage = (e) => {
    const m = e.data || {};
    if (m.type !== "added") return;
    savedIds.add(m.id);
    adding.delete(m.id);
    render();
  };
}

// At most 5 names, as the library shows them, then "et al."; all of them when the card is opened. Each name is a link:
// a click searches INSPIRE for that author's papers.
function authorNodes(hit) {
  const open = allAuthors.has(hit.recid);
  const names = open ? hit.authors : hit.authors.slice(0, INSPIRE_LIST_AUTHORS);
  const out = [];
  names.forEach((name, i) => {
    const a = node("a", "author", name);
    a.href = "#";
    a.title = tr("inspire.author.tip", { name });
    a.onclick = (e) => {
      e.preventDefault();
      searchFor(inspireAuthorQuery(name));
    };
    out.push(a, document.createTextNode(i < names.length - 1 ? ", " : ""));
  });
  if (!open && hit.authors.length > names.length) out.push(document.createTextNode(", et al."));
  return out;
}

const link = (label, href, tip) => {
  const a = node("a", "mini", label);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  if (tip) a.title = tip;
  return a;
};

function render() {
  listEl.textContent = "";
  const s = state;
  // the order of the results (a click asks again, when there is a search)
  const order = node("div", "inspire-order");
  order.append(node("span", "status", tr("inspire.sort")));
  for (const [value, key] of [["mostrecent", "inspire.sort.recent"], ["leastrecent", "inspire.sort.oldest"]]) {
    const chip = node("span", "tag" + (sort === value ? " selected" : ""), tr(key));
    chip.onclick = () => {
      if (sort === value) return;
      sort = value;
      try {
        localStorage.setItem("inspireSort", value);
      } catch (e) {}
      if (s && s.query) run(s.query, 1);
      else render();
    };
    order.append(chip);
  }
  listEl.append(order);
  if (!s) {
    msgEl.textContent = note;
    const empty = node("div", "empty");
    empty.append(node("p", "status", tr("inspire.hint")));
    const site = node("p", "status");
    site.append(link("inspirehep.net", "https://inspirehep.net/"));
    empty.append(site);
    listEl.append(empty);
    return;
  }
  msgEl.textContent = note || s.error || (s.hits.length ? tr("inspire.count", { shown: s.hits.length, total: s.total.toLocaleString() }) : tr("inspire.none"));
  for (const hit of s.hits) {
    const div = node("div", "paper inspire-hit");
    const a = node("a", "title", hit.title);
    a.href = hit.arxiv ? "open.html?id=" + encodeURIComponent(hit.arxiv) : inspireUrl(hit); // (an arXiv paper opens, and is saved, through Papurr)
    a.target = "_blank";
    a.rel = "noopener";
    const rest = [hit.year, hit.journal, hit.arxiv ? "arXiv:" + hit.arxiv : ""].filter(Boolean);
    const meta = node("div", "meta");
    meta.append(...authorNodes(hit));
    if (rest.length) meta.append(document.createTextNode((hit.authors.length ? " — " : "") + rest.join(" — ")));
    const actions = node("div", "inspire-actions");
    const key = libraryKey(hit);
    if (key) {
      const here = node("button", "mini selected", tr("today.inlibrary"));
      here.title = tr("today.inlibrary.tip");
      here.onclick = () => showInLibrary(key);
      actions.append(here);
    } else if (hit.arxiv) {
      const add = node("button", "mini", tr(adding.has(hit.arxiv) ? "today.adding" : "today.add"));
      add.title = tr("today.add.tip");
      add.disabled = adding.has(hit.arxiv);
      add.onclick = () => addHit(hit);
      actions.append(add);
    }
    if (hit.recid) {
      const bib = node("button", "mini", tr(copied.has(hit.recid) ? "inspire.bibtex.copied" : "inspire.bibtex"));
      bib.title = tr("inspire.bibtex.tip");
      bib.onclick = () => copyBibtex(hit);
      const by = node("button", "mini", tr("inspire.citedby"));
      by.title = tr("inspire.citedby.tip");
      by.onclick = () => searchFor(inspireCitedByQuery(hit.recid));
      const refs = node("button", "mini", tr("inspire.refs"));
      refs.title = tr("inspire.refs.tip");
      refs.onclick = () => searchFor(inspireReferencesQuery(hit.recid));
      actions.append(bib, by, refs);
    }
    if (hit.authors.length > INSPIRE_LIST_AUTHORS) {
      const all = node("button", "mini", tr(allAuthors.has(hit.recid) ? "inspire.fewerauthors" : "inspire.allauthors", { n: hit.authors.length.toLocaleString() }));
      all.onclick = () => {
        allAuthors.has(hit.recid) ? allAuthors.delete(hit.recid) : allAuthors.add(hit.recid);
        render();
      };
      actions.append(all);
    }
    if (hit.arxiv) {
      actions.append(link(tr("inspire.pdf"), "open.html?id=" + encodeURIComponent(hit.arxiv), tr("today.open.tip")));
      actions.append(link(tr("inspire.arxiv"), "https://arxiv.org/abs/" + hit.arxiv));
    }
    if (hit.doi) actions.append(link(tr("inspire.doi"), "https://doi.org/" + hit.doi));
    actions.append(link(tr("inspire.page"), inspireUrl(hit)));
    div.append(a, meta, actions);
    listEl.append(div);
  }
  if (s.hits.length && s.hits.length < s.total) {
    const more = node("button", "show-more", tr("inspire.more"));
    more.onclick = () => run(s.query, s.page + 1);
    listEl.append(more);
  }
}

async function run(query, page) {
  if (busy) return;
  busy = true;
  note = "";
  const more = page > 1 && state && state.query === query;
  try {
    const result = await withBusy(tr("inspire.searching"), () => fetchInspireSearch(query, page, sort));
    const seen = new Set(more ? state.hits.map((h) => h.recid) : []);
    state = { query, page, total: result.total, hits: (more ? state.hits : []).concat(result.hits.filter((h) => !seen.has(h.recid))), error: "" };
  } catch (e) {
    state = more ? { ...state, error: e.message } : { query, page: 1, total: 0, hits: [], error: e.message };
  } finally {
    busy = false;
  }
  render();
}

// A search from a card ("Cited by", "References", an author): the INSPIRE query goes into the box and the list shows its results.
function searchFor(query) {
  searchEl.value = query;
  run(query, 1);
}

// "BibTeX": the entry is read from INSPIRE and copied; the button says "Copied" for two seconds. A failure is said in words.
async function copyBibtex(hit) {
  try {
    const text = await withBusy(tr("busy.fetching"), () => fetchInspireBibtex(hit.recid));
    await navigator.clipboard.writeText(text);
    copied.add(hit.recid);
    note = tr("inspire.bibtex.done");
  } catch (e) {
    note = e.message || tr("inspire.err.network");
    setTimeout(() => { note = ""; render(); }, 6000);
    render();
    return;
  }
  setTimeout(() => {
    copied.delete(hit.recid);
    note = "";
    render();
  }, 2000);
  render();
}

// "Add to library": the PDF is saved in a background tab (nothing is opened); this list stays as it is and marks the paper when
// the saving tab says it is done. If the folder needs a permission prompt, the tab comes to the front so that it can be answered.
async function addHit(hit) {
  if (!hit.arxiv || adding.has(hit.arxiv)) return;
  adding.add(hit.arxiv);
  setTimeout(() => { if (adding.delete(hit.arxiv)) render(); }, 120000); // (a saving that never answers frees the button)
  render();
  let granted = false;
  try {
    const dir = await loadDir();
    granted = !!dir && (await dir.queryPermission({ mode: "readwrite" })) === "granted";
  } catch (e) {}
  await chrome.tabs.create({ url: "open.html?id=" + encodeURIComponent(hit.arxiv) + "&save=1&quiet=1", active: !granted });
}

// "In library": bring the library tab forward with the paper highlighted (or open the library on it).
async function showInLibrary(key) {
  if (!(await askLibraryToShow(key))) await chrome.tabs.create({ url: "library.html?highlight=" + encodeURIComponent(key), active: true });
}

function submit() {
  const query = searchEl.value.trim();
  if (query) return run(query, 1);
  state = null;
  render();
}
searchEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return; // (an Enter that only confirms an IME conversion is not a search)
  submit();
});
document.getElementById("search-go").addEventListener("click", submit);

(async () => {
  await i18nReady;
  render();
  await loadLibrary();
  render();
})();
