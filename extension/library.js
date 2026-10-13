// Show the papers recorded in index.json of the papers folder, with search.
const msgEl = document.getElementById("msg");
const grantBtn = document.getElementById("grant");
const grantHint = document.getElementById("grant-hint");
const listEl = document.getElementById("list");
const searchEl = document.getElementById("search");
const rebuildBtn = document.getElementById("rebuild");
const sortKeyEl = document.getElementById("sort-key");
const sortDirBtn = document.getElementById("sort-dir");
const tagBarEl = document.getElementById("tagbar");
const tagListEl = document.getElementById("tag-list");
const managerEl = document.getElementById("tag-manager");
const manageBtn = document.getElementById("manage-tags");
const tagFilterEl = document.getElementById("tag-filter");
const recoveryEl = document.getElementById("recovery");
const cancelBtn = document.getElementById("cancel-rebuild");
const importBannerEl = document.getElementById("import-banner");
const scopeEl = document.getElementById("search-scope");
const noteFilterEl = document.getElementById("note-filter");
let managerOpen = false;
let tagsExpanded = false;
let tagFilter = "";
// The author's cat-and-ring mark (fixed markup), shown quietly when the library is empty.
const MARK_SVG = '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><path class="ring" d="M2.8 20.8 A14 5 -20 0 1 29.2 11.2" stroke-width="2.6"/><path class="head" d="M8.6 12 L9 3.5 L14.5 8 Z M23.4 12 L23 3.5 L17.5 8 Z" stroke-width="1.5" stroke-linejoin="round"/><circle class="head" cx="16" cy="16" r="9" stroke-width="0"/><path class="ring" d="M29.2 11.2 A14 5 -20 0 1 2.8 20.8" stroke-width="2.6"/></svg>';
const PAGE = 100; // papers drawn at first; "Show more" adds more
let limit = PAGE;
const selectedTags = new Set(); // tags currently used as a filter (a paper must have all of them)
let sortDesc = true;
let papers = [];
let currentDir = null;
let aiReady = false; // AI switched on and agreed to, on Mac/Linux: papers offer "Summarize the full text..."

async function readPapers(dir) {
  try {
    const settings = await getAiSettings();
    const os = await aiPlatform();
    aiReady = settings.enabled && aiConsentGiven(settings) && (os === "mac" || os === "linux");
  } catch (e) {
    aiReady = false;
  }
  const [index, opened] = await Promise.all([readIndex(dir), getOpenedMap()]);
  const list = Object.entries(index)
    .map(([id, entry]) => ({ ...entry, id, lastOpened: opened[id] || entry.lastOpened }))
    .filter((p) => hasPdf(p) || p.note) // (a paper may have only a note)
    .sort((a, b) => (b.added || "").localeCompare(a.added || "")); // newest first
  await loadNotes(dir, list);
  return list;
}

// ---- Notes ----
// What the list shows about a note (has a summary, ...) is kept in the browser by file name and modification time, so
// only notes that changed since the last visit are read again. Their full text is read only to search the notes.
const NOTE_CACHE = "noteInfo";
const noteTexts = new Map(); // file name -> { m: modification time, text }

async function noteFileOf(dir, name) {
  return (await dir.getFileHandle(name)).getFile();
}

async function loadNotes(dir, list) {
  const files = new Set((await listFiles(dir)).filter((n) => /\.md$/i.test(n)));
  let cache = {};
  try {
    cache = (await chrome.storage.local.get(NOTE_CACHE))[NOTE_CACHE] || {};
  } catch (e) {}
  const next = {};
  for (const p of list) {
    const name = p.note || noteFileName(p.id, p); // (also finds a note whose flag was lost, e.g. made on another computer)
    if (!files.has(name)) continue;
    try {
      const file = await noteFileOf(dir, name);
      let info = cache[name];
      if (!info || info.m !== file.lastModified) {
        const text = await file.text();
        const note = parseNote(text);
        const has = (name) => Object.keys(note.blocks).some((k) => noteBlockName(k) === name); // (in any language)
        info = { m: file.lastModified, s: has("summary"), r: has("reason"), u: !!noteUserBody(note.user).trim() };
        noteTexts.set(name, { m: file.lastModified, text });
      }
      next[name] = info;
      p.noteFile = name;
      p.noteInfo = info;
    } catch (e) {} // unreadable right now (e.g. still syncing): shown without its note
  }
  try {
    if (JSON.stringify(next) !== JSON.stringify(cache)) await chrome.storage.local.set({ [NOTE_CACHE]: next });
  } catch (e) {}
}

// The full text of every note, for searching in the notes (read again only if the file changed).
async function loadNoteTexts() {
  for (const p of papers) {
    if (!p.noteFile || (noteTexts.get(p.noteFile) || {}).m === p.noteInfo.m) continue;
    try {
      const file = await noteFileOf(currentDir, p.noteFile);
      noteTexts.set(p.noteFile, { m: file.lastModified, text: await file.text() });
    } catch (e) {}
  }
}

const noteUrl = (p) => "note.html?id=" + encodeURIComponent(p.id);
// Notes open in this tab (author's choice); Back, or "Library" on the note page, returns here.
function openNote(p) {
  location.href = noteUrl(p);
}

// The "Note" button of a paper that has a note (in the place of "Add note"): the note icon, and a tooltip saying what it holds.
function noteButton(p) {
  const NS = "http://www.w3.org/2000/svg";
  const a = document.createElement("button");
  a.className = "mini note-btn";
  a.onclick = () => openNote(p);
  const parts = [p.noteInfo.s && tr("note.part.summary"), p.noteInfo.r && tr("note.part.reason"), p.noteInfo.u && tr("note.part.notes")].filter(Boolean);
  a.title = tr("paper.note.tip", { parts: parts.length ? parts.join(", ") : tr("note.part.empty") });
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3 M5.5 8h5 M5.5 10.5h5 M5.5 13h3");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.2");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  a.append(svg, tr("paper.note.open"));
  return a;
}

function openUrl(id, version) {
  return "open.html?id=" + encodeURIComponent(id) + (version === UNVERSIONED ? "" : "&v=" + version);
}

// Links to the databases for a paper, each shown as a small colored badge icon.
const JOURNAL = "@journal"; // pseudo version name for the journal version in delete requests
let dbLinks = [];

const DOI_LINK = { name: "DOI", label: "DOI", color: "#c9731a", template: "https://doi.org/{id}" };
const ADS_LINK = { name: "NASA ADS", label: "ADS", color: "#3b4a6b" }; // (for papers known by their bibcode)

function dbIcon(db, id) {
  const NS = "http://www.w3.org/2000/svg";
  const w = db.label.length > 5 ? 54 : db.label.length > 2 ? 34 : 22; // (INSPIRE needs the widest badge)
  const a = document.createElement("a");
  a.className = "db-icon";
  a.href = db.template.replace("{id}", id);
  a.target = "_blank";
  a.title = tr("db.open", { name: db.name });
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", w);
  svg.setAttribute("height", 18);
  const rect = document.createElementNS(NS, "rect");
  rect.setAttribute("width", w);
  rect.setAttribute("height", 18);
  rect.setAttribute("rx", 9);
  rect.setAttribute("fill", db.color);
  const text = document.createElementNS(NS, "text");
  text.setAttribute("x", w / 2);
  text.setAttribute("y", 12.5);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-family", "sans-serif");
  text.setAttribute("font-size", 9);
  text.setAttribute("font-weight", "bold");
  text.setAttribute("fill", "#fff");
  text.textContent = db.label;
  svg.append(rect, text);
  a.append(svg);
  return a;
}

function authorText(p) {
  const names = (p.authors || []).join(", ");
  return p.authorCount > (p.authors || []).length ? names + ", et al." : names;
}

// The value each sort option compares; empty values always go last.
const SORT_VALUES = {
  added: (p) => p.added || "",
  opened: (p) => p.lastOpened || "",
  title: (p) => (p.title || "").toLowerCase(),
  author: (p) => ((p.authors || [])[0] || "").split(" ").pop().toLowerCase(),
  arxiv: (p) => arxivSortKey(p.id),
  note: (p) => (p.noteInfo ? new Date(p.noteInfo.m).toISOString() : ""),
};

function sortPapers(list) {
  const value = SORT_VALUES[sortKeyEl.value];
  const dir = sortDesc ? -1 : 1;
  return list.sort((a, b) => {
    const x = value(a), y = value(b);
    if (x === y) return (b.added || "").localeCompare(a.added || ""); // tie: newest saved first
    if (!x) return 1;
    if (!y) return -1;
    return dir * x.localeCompare(y);
  });
}

function loadSortSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("sort") || "null");
    if (saved && SORT_VALUES[saved.key]) {
      sortKeyEl.value = saved.key;
      sortDesc = !!saved.desc;
    }
  } catch (e) {}
}

// The search and the filters (search text, where to search, which papers, selected tags) are remembered too, on this
// computer only (like the sort order): the next visit starts where the last one ended.
function saveViewSettings() {
  try {
    localStorage.setItem("libraryView", JSON.stringify({ q: searchEl.value, scope: scopeEl.value, filter: noteFilterEl.value, tags: [...selectedTags] }));
  } catch (e) {}
}

function loadViewSettings() {
  try {
    const v = JSON.parse(localStorage.getItem("libraryView") || "null");
    if (!v || typeof v !== "object") return;
    if (typeof v.q === "string") searchEl.value = v.q;
    if (SEARCH_SCOPES[v.scope]) scopeEl.value = v.scope;
    if (NOTE_FILTERS[v.filter]) noteFilterEl.value = v.filter;
    if (Array.isArray(v.tags)) for (const t of v.tags) if (typeof t === "string" && t) selectedTags.add(t);
    showPlaceholder();
  } catch (e) {}
}

function saveSortSettings() {
  try {
    localStorage.setItem("sort", JSON.stringify({ key: sortKeyEl.value, desc: sortDesc }));
  } catch (e) {}
}

const sameTag = (a, b) => a.toLowerCase() === b.toLowerCase();
const dedupeTags = (tags) => tags.filter((t, i) => tags.findIndex((u) => sameTag(u, t)) === i);
const tagsOf = (p) => p.tags || [];

// Change a paper's tags. `change` receives the tags as they are in index.json right now (not the ones on screen,
// which may be out of date after a quick series of edits) and returns the new list.
async function editTags(p, change) {
  const busy = startBusy(tr("busy.saving"));
  try {
    if ((await currentDir.requestPermission({ mode: "readwrite" })) !== "granted") {
      msgEl.textContent = tr("err.noaccess");
      return;
    }
    const saved = await updateIndex(currentDir, (index) => {
      const entry = index[p.id];
      if (!entry) return null;
      const tags = dedupeTags(change(entry.tags || []));
      if (tags.length) entry.tags = tags;
      else delete entry.tags;
      touch(entry);
      return tags;
    });
    if (saved === null) {
      msgEl.textContent = tr("tags.notinindex");
      return;
    }
    if (saved.length) p.tags = saved;
    else delete p.tags;
    render();
  } catch (e) {
    showError(e);
  } finally {
    endBusy(busy);
  }
}

function addTag(p, text) {
  const tag = text.trim().replace(/\s+/g, " ");
  if (!tag) return;
  // Reuse the spelling of an existing tag if there is one (e.g. "SUSY" vs "susy").
  const spelled = papers.flatMap(tagsOf).find((t) => sameTag(t, tag)) || tag;
  editTags(p, (tags) => (tags.some((t) => sameTag(t, spelled)) ? tags : [...tags, spelled]));
}

const TAGS_SHOWN = 12; // tags in the bar before "Show all"

function tagCounts() {
  const counts = new Map();
  for (const p of papers) for (const t of tagsOf(p)) counts.set(t, (counts.get(t) || 0) + 1);
  return counts;
}

// Most used first, then alphabetical.
const byUse = (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]);
const matchesTagFilter = (tag) => !tagFilter || tag.toLowerCase().includes(tagFilter.toLowerCase());

// The list of all tags (with counts) above the papers; clicking one toggles the filter.
function renderTagBar() {
  const counts = tagCounts();
  for (const t of [...selectedTags]) if (!counts.has(t)) selectedTags.delete(t);

  tagBarEl.textContent = "";
  tagListEl.textContent = "";
  const all = [...counts].sort(byUse);
  for (const [tag] of all) {
    const opt = document.createElement("option");
    opt.value = tag;
    tagListEl.append(opt);
  }
  const showAll = tagsExpanded || all.length <= TAGS_SHOWN;
  const visible = all.filter(([tag], i) => selectedTags.has(tag) || ((showAll || i < TAGS_SHOWN) && matchesTagFilter(tag)));
  for (const [tag, n] of visible) {
    const el = document.createElement("span");
    el.className = "tag" + (selectedTags.has(tag) ? " selected" : "");
    el.textContent = tag + " (" + n + ")";
    el.onclick = () => {
      selectedTags.has(tag) ? selectedTags.delete(tag) : selectedTags.add(tag);
      refresh();
    };
    tagBarEl.append(el);
  }
  if (all.length > TAGS_SHOWN) {
    const more = document.createElement("button");
    more.textContent = tagsExpanded ? tr("tags.showfewer") : tr("tags.showall", { n: all.length });
    more.onclick = () => {
      tagsExpanded = !tagsExpanded;
      if (!tagsExpanded) tagFilter = tagFilterEl.value = "";
      renderTagBar();
    };
    tagBarEl.append(more);
  }
  if (selectedTags.size) {
    const clear = document.createElement("button");
    clear.textContent = tr("tags.clearfilter");
    clear.onclick = () => {
      selectedTags.clear();
      refresh();
    };
    tagBarEl.append(clear);
  }
  // The filter box is a fixed element (so typing in it is not interrupted); show it only when it is useful.
  tagFilterEl.hidden = !(tagsExpanded || managerOpen) || all.length <= TAGS_SHOWN;
}

// Apply a change to the tag list of every paper at once and save index.json once.
async function updateAllTags(transform) {
  const busy = startBusy(tr("busy.saving"));
  try {
    if ((await currentDir.requestPermission({ mode: "readwrite" })) !== "granted") {
      msgEl.textContent = tr("err.noaccess");
      return;
    }
    await updateIndex(currentDir, (index) => {
      for (const entry of Object.values(index)) {
        if (!entry.tags) continue;
        const tags = dedupeTags(transform(entry.tags));
        if (JSON.stringify(tags) === JSON.stringify(entry.tags)) continue;
        if (tags.length) entry.tags = tags;
        else delete entry.tags;
        touch(entry);
      }
    });
    papers = await readPapers(currentDir);
    refresh();
  } catch (e) {
    showError(e);
  } finally {
    endBusy(busy);
  }
}

async function renameTag(oldTag) {
  const input = prompt(tr("tag.rename.prompt", { tag: oldTag }), oldTag);
  const name = input && input.trim().replace(/\s+/g, " ");
  if (!name || name === oldTag) return;
  // Reuse the spelling of an existing tag with the same name (ignoring case).
  const target = papers.flatMap(tagsOf).find((t) => t !== oldTag && sameTag(t, name)) || name;
  if (selectedTags.delete(oldTag)) selectedTags.add(target);
  saveViewSettings();
  await updateAllTags((tags) => tags.map((t) => (t === oldTag ? target : t)));
}

async function deleteTag(tag, count) {
  if (!confirm(tr("tag.delete.confirm", { tag, n: count }))) return;
  selectedTags.delete(tag);
  saveViewSettings();
  await updateAllTags((tags) => tags.filter((t) => t !== tag));
}

// The tag management panel: every tag with its paper count, plus Rename and Delete buttons.
function renderTagManager() {
  managerEl.hidden = !managerOpen;
  if (!managerOpen) return;
  const counts = tagCounts();
  const rows = [...counts].sort(byUse).filter(([tag]) => matchesTagFilter(tag));
  managerEl.textContent = rows.length ? "" : counts.size ? tr("tags.nomatch") : tr("tags.none");
  for (const [tag, n] of rows) {
    const row = document.createElement("div");
    row.className = "tag-row";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = tag + " (" + n + ")";
    const rename = document.createElement("button");
    rename.textContent = tr("tag.rename");
    rename.onclick = () => renameTag(tag);
    const del = document.createElement("button");
    del.textContent = tr("tag.delete");
    del.onclick = () => deleteTag(tag, n);
    row.append(name, rename, del);
    managerEl.append(row);
  }
}

// What each search scope looks at (Authors by default; notes are searched only when asked for, so that searching for an
// author never finds a name mentioned inside a note).
const SEARCH_SCOPES = {
  authors: (p) => authorText(p),
  title: (p) => p.title || "",
  number: (p) => p.id + " " + (p.doi || ""),
  tag: (p) => tagsOf(p).join(" "),
  notes: (p) => (p.noteFile && (noteTexts.get(p.noteFile) || {}).text) || "",
};
const NOTE_FILTERS = {
  all: () => true,
  note: (p) => !!p.noteInfo,
  summary: (p) => !!(p.noteInfo && p.noteInfo.s),
  mine: (p) => !!myPapers && (myPapers.ids.has(p.id) || (!!p.doi && myPapers.dois.has(p.doi.toLowerCase()))),
};

function render() {
  renderTagBar();
  renderTagManager();
  sortDirBtn.textContent = sortDesc ? "\u2193" : "\u2191";
  sortDirBtn.title = sortDesc ? tr("sort.desc.tip") : tr("sort.asc.tip");
  const words = searchEl.value.toLowerCase().split(/\s+/).filter(Boolean);
  const searched = SEARCH_SCOPES[scopeEl.value] || SEARCH_SCOPES.authors;
  const filter = NOTE_FILTERS[noteFilterEl.value] || NOTE_FILTERS.all;
  const shown = papers.filter((p) => {
    const text = searched(p).toLowerCase();
    return words.every((w) => text.includes(w)) && [...selectedTags].every((t) => tagsOf(p).includes(t)) && filter(p) &&
      !(sortKeyEl.value === "arxiv" && !isArxivKey(p.id)) && !(sortKeyEl.value === "note" && !p.noteInfo); // journal-only papers have no arXiv number; papers without a note have no note date
  });
  const scrollTop = listEl.scrollTop;
  listEl.textContent = "";
  const sorted = sortPapers(shown);
  for (const p of sorted.slice(0, limit)) {
    const div = document.createElement("div");
    div.className = "paper";
    const a = document.createElement("a");
    a.className = "title";
    const versions = sortedVersions(p);
    const newest = versions[versions.length - 1]; // may be undefined for journal-only papers
    a.href = hasPdf(p) ? "open.html?id=" + encodeURIComponent(p.id) + "&local=1" : noteUrl(p); // newest saved version (or the note)
    if (hasPdf(p)) a.target = "_blank"; // (a PDF opens in a new tab; the note in this one)
    a.textContent = p.title || p.id;
    const meta = document.createElement("div");
    meta.className = "meta";
    const idLabel = paperLabel(p.id, p);
    const journalLabel = p.journal ? [p.journal.name, p.journal.year].filter(Boolean).join(" ") : "";
    meta.textContent = [authorText(p), idLabel, journalLabel].filter(Boolean).join(" \u2014 ");
    const vers = document.createElement("span");
    vers.className = "versions";
    for (const v of versions) {
      const group = document.createElement("span");
      group.className = "chip-group";
      const chip = document.createElement("a");
      chip.className = "chip";
      chip.href = openUrl(p.id, v);
      chip.target = "_blank";
      chip.textContent = v === UNVERSIONED ? "PDF" : v;
      const x = document.createElement("button");
      x.className = "chip-delete";
      x.textContent = "\u00d7";
      x.title = tr("chip.delete.tip", { name: chip.textContent });
      x.onclick = () => deletePaper(p, [v]);
      group.append(chip, x);
      vers.append(group);
    }
    if (!hasPdf(p)) { // only a note: say so, and offer to get the PDF
      const get = document.createElement("a");
      get.className = "chip";
      get.target = "_blank";
      if (p.id.startsWith("doi:")) {
        get.href = "https://doi.org/" + p.doi;
        get.title = tr("paper.getpdf.doi.tip");
      } else if (paperKind(p.id) === "ads") {
        get.href = adsAbstractUrl(p.id.slice(4));
        get.title = tr("paper.getpdf.ads.tip");
      } else {
        get.href = "open.html?id=" + encodeURIComponent(p.id);
        get.title = tr("paper.getpdf.tip");
      }
      get.textContent = tr("paper.getpdf");
      vers.append(node("span", "nopdf", tr("paper.nopdf")), get);
    }
    if (p.journal) {
      const group = document.createElement("span");
      group.className = "chip-group";
      const chip = document.createElement("a");
      chip.className = "chip";
      chip.href = "open.html?id=" + encodeURIComponent(p.id) + "&journal=1";
      chip.target = "_blank";
      chip.textContent = tr("journal");
      chip.title = [p.journal.name, p.journal.year].filter(Boolean).join(" ");
      const x = document.createElement("button");
      x.className = "chip-delete";
      x.textContent = "\u00d7";
      x.title = tr("journal.delete.tip");
      x.onclick = () => deletePaper(p, [JOURNAL]);
      group.append(chip, x);
      vers.append(group);
    }
    const tagRow = document.createElement("div");
    tagRow.className = "paper-tags";
    for (const t of tagsOf(p)) {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = t;
      const x = document.createElement("button");
      x.className = "tag-x";
      x.textContent = "\u00d7";
      x.title = tr("tag.remove.tip");
      x.onclick = () => editTags(p, (tags) => tags.filter((u) => u !== t));
      chip.append(x);
      tagRow.append(chip);
    }
    const input = document.createElement("input");
    input.className = "tag-input";
    input.placeholder = tr("tag.add.placeholder");
    input.setAttribute("list", "tag-list");
    input.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return; // Enter that only confirms an IME conversion (e.g. Japanese input)
      if (e.key === "Enter") addTag(p, input.value);
    });
    tagRow.append(input);
    const dbs = document.createElement("span");
    dbs.className = "dbs";
    const icons = document.createElement("span"); // the database links, on the tag row (the row above has the buttons)
    icons.className = "dbs";
    const reveal = document.createElement("button");
    reveal.className = "mini";
    reveal.textContent = tr("paper.reveal");
    reveal.title = tr(hasPdf(p) ? "paper.reveal.tip" : "note.reveal.tip");
    reveal.onclick = () => revealPaper(p);
    dbs.append(reveal);
    if (p.noteInfo) dbs.append(noteButton(p));
    else {
      const add = document.createElement("button");
      add.className = "mini";
      add.textContent = tr("paper.note.add");
      add.title = tr("paper.note.add.tip");
      add.onclick = () => openNote(p);
      dbs.append(add);
    }
    if (aiReady && isArxivKey(p.id) && !(p.noteInfo && p.noteInfo.s)) dbs.append(summaryLink(p.id));
    if (isArxivKey(p.id)) for (const db of dbLinks) icons.append(dbIcon(db, p.id));
    if (paperKind(p.id) === "ads") icons.append(dbIcon({ ...ADS_LINK, template: adsAbstractUrl(p.id.slice(4)) }, ""));
    if (p.doi) icons.append(dbIcon(DOI_LINK, p.doi));
    tagRow.append(icons);
    const row = document.createElement("div");
    row.className = "paper-row";
    row.append(vers, dbs);
    div.dataset.id = p.id;
    div.append(a, meta, row, tagRow);
    listEl.append(div);
  }
  if (sorted.length > limit) {
    const more = document.createElement("button");
    more.className = "show-more";
    more.textContent = tr("list.showmore", { n: sorted.length - limit });
    more.onclick = () => {
      limit += 200;
      render();
    };
    listEl.append(more);
  }
  listEl.scrollTop = scrollTop; // stay where we were when only the list changed
  if (papers.length) {
    msgEl.textContent = noteFilterEl.value === "mine" && !myPapers ? tr("filter.mine.noauthor") : tr("list.count", { shown: shown.length, total: papers.length });
  } else {
    msgEl.textContent = "";
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = MARK_SVG; // fixed markup defined above
    for (const [text, cls] of [[tr("empty.title"), ""], [tr("empty.hint"), "status"]]) {
      const p = document.createElement("p");
      p.textContent = text;
      if (cls) p.className = cls;
      empty.append(p);
    }
    listEl.append(empty);
  }
}

// Redraw from the top: used when the user changes the search, sort or tag filter.
function refresh() {
  limit = PAGE;
  listEl.scrollTop = 0;
  saveViewSettings(); // (every change of the search or the filters ends here)
  render();
}

// Show the paper's PDF in the system's file manager (the newest arXiv version, or the journal version; or its note).
async function revealPaper(p) {
  const versions = sortedVersions(p);
  const file = versions.length ? p.versions[versions[versions.length - 1]] : p.journal ? p.journal.file : p.noteFile;
  const before = msgEl.textContent;
  msgEl.textContent = tr("reveal.working");
  try {
    await withBusy("", () => revealInFolder(currentDir, file));
    msgEl.textContent = before;
  } catch (e) {
    msgEl.textContent = tr("reveal.failed", { msg: e.message });
  }
}

// Delete the given saved versions of a paper from the papers folder and update the index.
async function deletePaper(p, versions) {
  const files = versions.map((v) => (v === JOURNAL ? p.journal.file : p.versions[v]));
  const keepsNote = (p.noteFile || p.note) && versions.length === Object.keys(p.versions).length + (p.journal ? 1 : 0);
  if (!confirm(tr("paper.delete.confirm", { title: p.title || p.id, files: files.join("\n") }) + (keepsNote ? tr("paper.delete.keepnote") : ""))) return;
  const busy = startBusy(tr("busy.saving"));
  try {
    if ((await currentDir.requestPermission({ mode: "readwrite" })) !== "granted") {
      msgEl.textContent = tr("err.noaccess");
      return;
    }
    for (const file of files) {
      try {
        await currentDir.removeEntry(file);
      } catch (e) {
        if (e.name !== "NotFoundError") throw e; // already gone: just drop the index entry
      }
    }
    await updateIndex(currentDir, (index) => {
      const entry = index[p.id];
      if (!entry) return;
      for (const v of versions) {
        if (v === JOURNAL) delete entry.journal;
        else delete entry.versions[v];
      }
      if (!hasPdf(entry) && !entry.note) delete index[p.id]; // (a paper with a note stays, with its note)
      else touch(entry);
    });
    papers = await readPapers(currentDir);
    render();
  } catch (e) {
    showError(e);
  } finally {
    endBusy(busy);
  }
}

// A text with a link to the settings page (the dictionary text is fixed; the link markup is built here).
function withSettingsLink(key) {
  return tr(key, { settings: '<a href="options.html">' + tr("lib.settings") + "</a>" });
}

function showError(e) {
  recoveryEl.hidden = true;
  if (e.name === "NotFoundError") {
    msgEl.innerHTML = withSettingsLink("folder.notfound.link");
  } else {
    msgEl.textContent = tr("err.generic", { msg: e.message });
  }
}

// Update index: merge sync conflict copies, drop entries of deleted files, add new files, fill empty titles.
let rebuilding = false;
async function runRebuild(dir) {
  if (rebuilding) return;
  rebuilding = true;
  const busy = startBusy(tr("busy.updating"));
  let cancelled = false;
  rebuildBtn.disabled = true;
  cancelBtn.hidden = false;
  cancelBtn.onclick = () => {
    cancelled = true;
    cancelBtn.disabled = true;
  };
  try {
    if ((await dir.requestPermission({ mode: "readwrite" })) !== "granted") {
      msgEl.textContent = tr("err.noaccess");
      return;
    }
    msgEl.textContent = tr("rebuild.scanning");
    const r = await rebuildIndex(dir, {
      report: (text) => (msgEl.textContent = text),
      isCancelled: () => cancelled,
      confirmRemoval: (count, total) =>
        confirm(tr("rebuild.confirm", { count, total })),
    });
    papers = await readPapers(dir);
    render();
    await showIndexTime();
    let note = " " + (r.refreshed ? tr("rebuild.summary.updated", { added: r.added, removed: r.removed, updated: r.refreshed }) : tr("rebuild.summary", { added: r.added, removed: r.removed }));
    if (r.cancelled) note += tr("rebuild.stopped");
    if (r.failedBatches) note += tr("rebuild.failed");
    msgEl.textContent += note;
    await updateImportBanner();
  } catch (e) {
    if (e instanceof IndexError) await showRecovery(dir, e);
    else showError(e);
  } finally {
    endBusy(busy);
    rebuilding = false;
    rebuildBtn.disabled = false;
    cancelBtn.hidden = true;
    cancelBtn.disabled = false;
  }
}

// ---- PDFs that were added to the folder by hand: only a note here; the work is done in Settings (import-ui.js) ----
// Shown only after a rename run in Settings that left files behind (the flag `importNotice`), until the user closes it with
// the cross; the next rename run in Settings can bring it back.
async function updateImportBanner() {
  let count = 0;
  try {
    if ((await chrome.storage.local.get("importNotice")).importNotice) {
      count = (await findUnmanagedPdfs(currentDir)).length + (await findUnversionedFiles(currentDir)).length;
      if (!count) await chrome.storage.local.set({ importNotice: false }); // everything was dealt with
    }
  } catch (e) {} // not essential
  importBannerEl.textContent = "";
  importBannerEl.hidden = !count;
  if (!count) return;
  const link = node("a", "", tr("lib.settings"));
  link.href = "options.html";
  const close = node("button", "banner-x", "\u00d7");
  close.title = tr("import.close");
  close.onclick = async () => {
    await chrome.storage.local.set({ importNotice: false });
    importBannerEl.hidden = true;
  };
  importBannerEl.append(node("span", "", tr("import.banner.lib", { n: count })), link, close);
}

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// The index file cannot be read: offer the ways out instead of ever overwriting it.
async function showRecovery(dir, err) {
  importBannerEl.hidden = true;
  listEl.textContent = "";
  recoveryEl.hidden = false;
  recoveryEl.textContent = "";
  const text = document.createElement("p");
  text.textContent = err.message;
  recoveryEl.append(text);
  msgEl.textContent = "";
  if (err.kind !== "damaged") return;

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = tr("recovery.note", { name: DAMAGED_NAME });
  recoveryEl.append(note);

  const restore = document.createElement("button");
  restore.textContent = tr("recovery.restore");
  restore.disabled = !(await hasBackup(dir));
  restore.title = restore.disabled ? tr("recovery.restore.none") : tr("recovery.restore.tip");
  restore.onclick = async () => {
    try {
      await restoreIndexBackup(dir);
      recoveryEl.hidden = true;
      await show(dir);
    } catch (e) {
      text.textContent = tr("err.generic", { msg: e.message });
    }
  };
  const reset = document.createElement("button");
  reset.textContent = tr("recovery.reset");
  reset.title = tr("recovery.reset.tip");
  reset.onclick = async () => {
    if (!confirm(tr("recovery.reset.confirm"))) return;
    try {
      await resetIndex(dir);
      recoveryEl.hidden = true;
      await show(dir);
      await runRebuild(dir);
    } catch (e) {
      text.textContent = tr("err.generic", { msg: e.message });
    }
  };
  recoveryEl.append(restore, " ", reset);
}

const show = (dir) => withBusy(tr("busy.loading"), () => showLibrary(dir));

// ---- A paper added from another tab ("Add to library" in Today's arXiv), or asked for ("In library" there) ----
// The page that saved it says so on this channel; the library answers, comes to the front, and highlights the paper for
// a few seconds (showing it even if the search or a filter would hide it). Opened as library.html?highlight=<id> when no
// library tab was open.
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("papurr") : null;
if (channel) {
  channel.onmessage = async (e) => {
    const m = e.data || {};
    if ((m.type !== "added" && m.type !== "show") || !currentDir) return;
    if (m.quiet) { // a paper saved from the INSPIRE page: read the list again, nothing else moves (no jump, no highlight)
      await reloadQuietly();
      return;
    }
    channel.postMessage({ type: "shown", id: m.id });
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab) {
        await chrome.tabs.update(tab.id, { active: true });
        if (chrome.windows) await chrome.windows.update(tab.windowId, { focused: true });
      }
    } catch (err) {} // (only bringing the tab forward failed)
    await reloadQuietly();
    highlight(m.id);
  };
}

function highlight(id) {
  const find = () => listEl.querySelector('.paper[data-id="' + CSS.escape(id) + '"]');
  if (!find() && papers.some((p) => p.id === id)) {
    searchEl.value = "";
    scopeEl.value = "authors";
    showPlaceholder();
    noteFilterEl.value = "all";
    selectedTags.clear();
    saveViewSettings();
    if (sortKeyEl.value === "note" || sortKeyEl.value === "arxiv") sortKeyEl.value = "added";
    render();
  }
  if (!find() && papers.some((p) => p.id === id)) {
    limit = papers.length; // (it is further down than the papers drawn so far)
    render();
  }
  const el = find();
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 4000);
}

// Read the list again without changing the search, filters or scroll position.
async function reloadQuietly() {
  try {
    papers = await readPapers(currentDir);
    if (scopeEl.value === "notes") await loadNoteTexts();
    render();
    await showIndexTime();
  } catch (e) {} // the next full load shows any problem
}

async function showLibrary(dir) {
  currentDir = dir;
  dbLinks = await getDbLinks();
  try {
    await mergeConflictCopies(dir); // pick up changes made on another computer
    papers = await readPapers(dir);
  } catch (e) {
    if (e instanceof IndexError) return showRecovery(dir, e);
    throw e;
  }
  recoveryEl.hidden = true;
  limit = PAGE;
  if (noteFilterEl.value === "mine" && !myPapers) await loadMyPapers().catch(() => {});
  if (scopeEl.value === "notes" && searchEl.value.trim()) await loadNoteTexts().catch(() => {}); // (a remembered search in the notes)
  render();
  await showIndexTime();
  rebuildBtn.hidden = false;
  rebuildBtn.onclick = () => runRebuild(dir);
  await updateImportBanner();
}

async function main() {
  await i18nReady; // texts below depend on the language
  msgEl.textContent = tr("loading");
  const dir = await loadDir();
  if (!dir) {
    msgEl.innerHTML = withSettingsLink("folder.none.link");
    return;
  }
  if ((await dir.queryPermission({ mode: "readwrite" })) !== "granted") {
    msgEl.textContent = tr("grant.msg", { name: dir.name });
    grantBtn.hidden = false;
    grantHint.hidden = false;
    grantBtn.onclick = async () => {
      if ((await dir.requestPermission({ mode: "readwrite" })) === "granted") {
        grantBtn.hidden = true;
        grantHint.hidden = true;
        show(dir).catch(showError);
      }
    };
    return;
  }
  await show(dir);
  const added = new URLSearchParams(location.search).get("highlight");
  if (added) highlight(added);
}

// The search box says what it searches (the scope chosen next to it).
const PLACEHOLDERS = { authors: "search.ph.authors", title: "search.ph.title", number: "search.ph.number", tag: "search.ph.tag", notes: "search.ph.notes" };
function showPlaceholder() {
  searchEl.placeholder = tr(PLACEHOLDERS[scopeEl.value] || PLACEHOLDERS.authors);
}
i18nReady.then(showPlaceholder);

// ---- "My papers" (filter): the user's papers from INSPIRE (the research profile's author page; no AI) ----
// Kept in the browser for a week (`myPapers`); asked again only when this filter is chosen and the list is older.
let myPapers = null; // { ids: Set of arXiv ids, dois: Set }
const MY_PAPERS_DAYS = 7;
async function loadMyPapers() {
  const { profileSettings, myPapers: kept } = await chrome.storage.local.get(["profileSettings", "myPapers"]);
  const author = parseInspireAuthorId((profileSettings && profileSettings.url) || "");
  if (!author) {
    myPapers = null;
    msgEl.textContent = tr("filter.mine.noauthor");
    return;
  }
  let list = kept && kept.author === author && Date.now() - Date.parse(kept.at) < MY_PAPERS_DAYS * 86400000 ? kept : null;
  if (!list) {
    list = { author, at: new Date().toISOString(), ids: [], dois: [] };
    await withBusy(tr("busy.fetching"), async () => {
      for (let page = 1; page <= 5; page++) {
        const url = "https://inspirehep.net/api/literature?q=" + encodeURIComponent("authors.recid:" + author) + "&size=200&page=" + page + "&fields=arxiv_eprints,dois";
        const hits = (await inspireJson(url)).hits.hits;
        for (const h of hits) {
          const m = h.metadata || {};
          for (const e of m.arxiv_eprints || []) if (e.value) list.ids.push(e.value);
          for (const d of m.dois || []) if (d.value) list.dois.push(d.value.toLowerCase());
        }
        if (hits.length < 200) break;
      }
    });
    await chrome.storage.local.set({ myPapers: list });
  }
  myPapers = { ids: new Set(list.ids), dois: new Set(list.dois) };
}

async function filterChanged() {
  if (noteFilterEl.value === "mine" && !myPapers) {
    try {
      await loadMyPapers();
    } catch (e) {
      msgEl.textContent = tr("err.generic", { msg: e.message });
      return;
    }
  }
  refresh();
}

// When index.json was last written (by any computer: the file's own time, as the cloud delivered it).
async function showIndexTime() {
  const el = document.getElementById("index-time");
  try {
    const file = await (await currentDir.getFileHandle(INDEX_NAME)).getFile();
    el.textContent = tr("lib.indextime", { time: new Date(file.lastModified).toLocaleString(dateLocale(), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) });
  } catch (e) {
    el.textContent = "";
  }
}

// Search is redrawn after a short pause so typing stays smooth with thousands of papers.
let searchTimer = null;
searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => (scopeEl.value === "notes" ? searchNotes() : refresh()), 150);
});
// Searching the notes needs their text: read the notes that are not read yet (or changed), then search.
async function searchNotes() {
  if (currentDir) await withBusy(tr("busy.notes"), loadNoteTexts).catch(() => {});
  refresh();
}
scopeEl.addEventListener("change", () => {
  showPlaceholder();
  scopeEl.value === "notes" ? searchNotes() : refresh();
});
noteFilterEl.addEventListener("change", filterChanged);
sortKeyEl.addEventListener("change", () => { saveSortSettings(); refresh(); });
sortDirBtn.addEventListener("click", () => { sortDesc = !sortDesc; saveSortSettings(); refresh(); });
manageBtn.addEventListener("click", () => { managerOpen = !managerOpen; renderTagBar(); renderTagManager(); });
tagFilterEl.addEventListener("input", () => {
  tagFilter = tagFilterEl.value.trim();
  renderTagBar();
  renderTagManager();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.language) location.reload(); // the language was changed in Settings
  if (changes.notesChanged && currentDir && !rebuilding) reloadQuietly(); // a note was written in a note tab
});

// Coming back from a note with Back: the page may be restored as it was; read the list again (the note may have changed).
window.addEventListener("pageshow", (e) => {
  if (e.persisted && currentDir) reloadQuietly();
});

loadSortSettings();
loadViewSettings();
main().catch(showError);
