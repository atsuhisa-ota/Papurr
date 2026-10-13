// Importing PDFs that were put into the papers folder by hand.
//
// People who already keep a collection of papers do not want to download everything again. This file
//  1. finds PDFs in the folder that are not in index.json,
//  2. works out what each one is by reading the PDF itself (no library, no network for this step):
//       - an arXiv paper carries a stamp "arXiv:2301.12345v2 [hep-th] 5 Jan 2023" on its first page -> number + version,
//       - a journal paper carries its DOI in the metadata or in the text,
//     with the file name as a last resort,
//  3. looks the paper up (arXiv / Crossref / INSPIRE / OpenAlex) to get title and authors,
//  4. proposes new names in Papurr's naming scheme (planImport) - nothing is changed yet,
//  5. renames the files the user approved and records them in the index (applyImport).
// Files are never renamed without the user's approval, and never overwritten.

const MAX_SCAN_BYTES = 200 * 1024 * 1024; // larger files are not read
const MAX_STREAM_BYTES = 5 * 1024 * 1024; // larger PDF streams are pictures or fonts, not page text
const MAX_TEXT_CHARS = 400000; // page text kept per file (for the DOI count and the title check)
const APPLY_BATCH = 50; // renamed files recorded in the index at a time
const latin1 = new TextDecoder("latin1"); // one byte = one character, so positions match the bytes

const ARXIV_NEW_ID = "\\d{4}\\.\\d{4,5}";
const ARXIV_OLD_ID = "[a-z]+(?:-[a-z]+)*(?:\\.[A-Za-z]{2})?\\/\\d{7}";
// The whole text object must be the stamp. A reference list that mentions "arXiv:2105.01234v2 [hep-th]" never matches.
const ARXIV_STAMP = new RegExp("^\\s*arXiv:\\s*(" + ARXIV_NEW_ID + "|" + ARXIV_OLD_ID + ")v(\\d+)\\s*(?:\\[[^\\]]+\\]\\s*)?\\d{1,2}\\s+[A-Z][a-z]{2}\\s+\\d{4}\\s*$");
// The same with every space removed, for PDFs that place the letters one by one. Only with the [category]:
// without it "v3 22 Jan" and "v32 2 Jan" could not be told apart.
const ARXIV_STAMP_COMPACT = new RegExp("^arXiv:(" + ARXIV_NEW_ID + "|" + ARXIV_OLD_ID + ")v(\\d+)\\[[^\\]]+\\]\\d{1,2}[A-Z][a-z]{2}\\d{4}$");
const DOI_PATTERN = "10\\.\\d{4,9}\\/[^\\s<>\"'\\[\\]{}\\\\^`|]+";
// A DOI in a place that is meant to hold metadata (XMP / document info fields).
const META_DOI = new RegExp("(?:prism:doi|pdfx:doi|dc:identifier|dc:source|dc:relation|\\/doi|\\/DOI|\\/Subject|\\/Keywords|WPS-ARTICLEDOI)[^]{0,60}?(" + DOI_PATTERN + ")", "g");
const ANY_DOI = new RegExp(DOI_PATTERN, "g");
const INFO_TITLE = /\/Title\s*\(((?:\\[\s\S]|[^\\()])*)\)/; // document info: /Title (...)
const XMP_TITLE = /<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]+)<\/rdf:li>/;
const LINK_DOI = new RegExp("\\/URI\\s*\\(([^)]*?)(" + DOI_PATTERN + ")", "g");

// ---- Reading a PDF ----

// "10.1103/physrevd.108.045001." -> "10.1103/physrevd.108.045001" (lower case, no trailing punctuation)
function cleanDoi(text) {
  let doi = text.replace(/[.,;:]+$/, "");
  while (doi.endsWith(")") && (doi.match(/\)/g) || []).length > (doi.match(/\(/g) || []).length) doi = doi.slice(0, -1).replace(/[.,;:]+$/, "");
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi.toLowerCase() : null;
}

function unescapePdfString(text) {
  return text.replace(/\\(?:([0-7]{1,3})|([\s\S]))/g, (all, octal, ch) => {
    if (octal) return String.fromCharCode(parseInt(octal, 8) & 255);
    return { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[ch] ?? (ch === "\n" || ch === "\r" ? "" : ch);
  });
}

// A document info string: plain text, or UTF-16 with a byte order mark.
function infoString(text) {
  const s = unescapePdfString(text);
  if (s.startsWith("\xfe\xff")) return s.slice(2).replace(/[\s\S]{2}/g, (pair) => String.fromCharCode(pair.charCodeAt(0) * 256 + pair.charCodeAt(1)));
  return s;
}

function hexToText(hex) {
  const digits = hex.replace(/\s+/g, "");
  const bytes = (digits.match(/../g) || []).map((h) => parseInt(h, 16));
  if (bytes.length >= 2 && bytes.length % 2 === 0 && bytes.filter((b, i) => i % 2 === 0).every((b) => b === 0)) {
    return String.fromCharCode(...bytes.filter((b, i) => i % 2 === 1)); // two-byte text such as <00410042>
  }
  return String.fromCharCode(...bytes.filter((b) => b >= 32 && b < 127));
}

// The text of each text object (BT ... ET) of a page content stream. Gaps between words in TJ arrays become spaces.
function pdfTextObjects(content) {
  const objects = [];
  const token = /\(((?:\\[\s\S]|[^\\()])*)\)|<([0-9A-Fa-f\s]*)>|(\[)|(\])|(-?\d*\.?\d+)|(T[dDm*]|'|")/g;
  for (const block of content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
    let out = "", inArray = false;
    for (const m of block[1].matchAll(token)) {
      if (m[1] !== undefined) out += unescapePdfString(m[1]);
      else if (m[2] !== undefined) out += hexToText(m[2]);
      else if (m[3]) inArray = true;
      else if (m[4]) inArray = false;
      else if (m[5] !== undefined) { if (inArray && parseFloat(m[5]) <= -200) out += " "; }
      else if (m[6]) out += " ";
    }
    objects.push(out);
  }
  return objects;
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return latin1.decode(await new Response(stream).arrayBuffer());
}

// The streams of a PDF that can hold text or metadata, decoded: { dict, data }. Pictures and fonts are skipped.
async function* pdfStreams(bytes, raw) {
  const marker = /(?<!end)stream\r?\n/g;
  let m;
  while ((m = marker.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) return;
    marker.lastIndex = end;
    const before = raw.slice(Math.max(0, m.index - 1000), m.index);
    const objects = [...before.matchAll(/\d+ \d+ obj/g)];
    const last = objects[objects.length - 1];
    const dict = last ? before.slice(last.index + last[0].length) : before;
    if (/\/Image|\/Length1|\/Length2|Type1C|CIDFontType0C|OpenType|\/XRef/.test(dict) || end - start > MAX_STREAM_BYTES) continue;
    const filtered = /\/Filter\s*\[?\s*\/(?:FlateDecode|Fl)\b/.test(dict);
    if (/\/Filter/.test(dict) && !filtered) continue; // some other encoding: not worth decoding
    if (!filtered) {
      yield { dict, data: raw.slice(start, end) };
      continue;
    }
    // The compressed data ends where /Length says (a decompressor refuses anything after the end of the data),
    // or, if /Length is missing or an indirect reference, before the line break in front of "endstream".
    const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    const ends = [length && start + parseInt(length[1], 10), end - (raw[end - 2] === "\r" && raw[end - 1] === "\n" ? 2 : /[\r\n]/.test(raw[end - 1]) ? 1 : 0), end];
    for (const stop of ends.filter((e, i) => e && e <= end && ends.indexOf(e) === i)) {
      try {
        yield { dict, data: await inflate(bytes.subarray(start, stop)) };
        break;
      } catch (e) {} // try the next guess; a damaged stream is skipped
    }
  }
}

function addCount(map, doi) {
  if (doi) map.set(doi, (map.get(doi) || 0) + 1);
}

// Look inside a PDF file. Returns { stamp: {id, version} | null, metaDois: [...], textDois: Map(doi -> count), text }.
async function scanPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const raw = latin1.decode(bytes);
  const found = { stamp: null, metaDois: [], textDois: new Map(), text: "", title: "", bibcodes: new Map() };
  const lookInMetadata = (pool) => {
    if (!found.title) {
      const info = INFO_TITLE.exec(pool), xmp = XMP_TITLE.exec(pool);
      if (info) found.title = infoString(info[1]).trim();
      if (!found.title && xmp) found.title = xmp[1].trim();
    }
    for (const m of pool.matchAll(META_DOI)) {
      const doi = cleanDoi(m[1]);
      if (doi) found.metaDois.push(doi);
    }
    for (const m of pool.matchAll(LINK_DOI)) addCount(found.textDois, cleanDoi(m[2].split(/[?&#]/)[0])); // links such as https://doi.org/10....
  };
  lookInMetadata(raw);
  for await (const { dict, data } of pdfStreams(bytes, raw)) {
    if (/\/ObjStm/.test(dict)) {
      lookInMetadata(data);
    } else if (/\bBT\b/.test(data) && /T[jJ]/.test(data)) {
      for (const text of pdfTextObjects(data)) {
        const stamp = ARXIV_STAMP.exec(text) || ARXIV_STAMP_COMPACT.exec(text.replace(/\s+/g, ""));
        if (stamp && !found.stamp) found.stamp = { id: stamp[1], version: "v" + stamp[2] };
        if (found.text.length < MAX_TEXT_CHARS) {
          found.text += text + "\n";
          for (const m of text.matchAll(ANY_DOI)) addCount(found.textDois, cleanDoi(m[0]));
        }
      }
    } else if (/\/Subtype\s*\/XML|\/Type\s*\/Metadata/.test(dict)) {
      lookInMetadata(data);
    }
  }
  // A bibcode printed on the pages (NASA ADS stamps scanned articles; its text layer can space it out:
  // "198 4ApJ. . .279. .499F"), counted on the text without blanks.
  for (const m of found.text.replace(/\s+/g, "").matchAll(new RegExp(BIBCODE, "g"))) addCount(found.bibcodes, m[0]);
  return found;
}

// The DOI of the journal paper whose title is exactly this one (asks Crossref), or null.
async function findDoiByTitle(title) {
  const res = await fetch("https://api.crossref.org/works?rows=3&select=DOI,title&query.bibliographic=" + encodeURIComponent(title));
  if (!res.ok) return null;
  const wanted = normalizeForSearch(title);
  for (const item of (await res.json()).message.items || []) {
    if ((item.title || []).some((t) => normalizeForSearch(t.replace(/<[^>]+>/g, "")) === wanted)) return item.DOI.toLowerCase();
  }
  return null;
}

// ---- Deciding what a file is ----

// What the file name alone suggests: { id, version } for an arXiv paper, { doi } for a name made from a DOI,
// { bibcode } for a name that is an ADS bibcode (ADS's own names use "_" for "." and may carry a prefix), or null.
function guessFromName(name) {
  const base = name.replace(/\.pdf$/i, "");
  const bib = new RegExp(BIBCODE).exec(base.replace(/%26/gi, "&").replace(/_/g, "."));
  if (bib) return { bibcode: bib[0] };
  let m = /^(10\.\d{4,9})[_/](.+)$/.exec(base);
  if (m) return { doi: (m[1] + "/" + m[2]).toLowerCase() };
  m = /(?:^|[^\d.])(\d{4}\.\d{4,5})(v\d+)?(?![\d])/.exec(base);
  if (m) return { id: m[1], version: m[2] || null };
  m = /(?:^|[^a-z])([a-z]+(?:-[a-z]+)*(?:\.[A-Za-z]{2})?)[_/\-]?(\d{7})(v\d+)?(?!\d)/.exec(base);
  if (m) return { id: m[1] + "/" + m[2], version: m[3] || null };
  return null;
}

// Combine what was found in the PDF with the file name. `sure` is false when the user should look twice.
// Order: arXiv stamp > DOI in the metadata > ADS bibcode printed on the pages (twice or more) > DOI repeated in the text
// > the file name (arXiv number, bibcode, DOI).
function identify(name, scan) {
  if (scan && scan.stamp) return { kind: "arxiv", id: scan.stamp.id, version: scan.stamp.version, source: "stamp", sure: true };
  const guess = guessFromName(name);
  if (scan && !scan.metaDois.length && scan.bibcodes && scan.bibcodes.size) {
    const [bibcode, count] = [...scan.bibcodes].sort((a, b) => b[1] - a[1])[0];
    if (count >= 2) return { kind: "ads", bibcode, source: "stamp", sure: true };
  }
  let doi = null, source = "", sure = false;
  if (scan) {
    const meta = new Map();
    scan.metaDois.forEach((d) => addCount(meta, d));
    const pick = (counts) => [...counts].sort((a, b) => b[1] - a[1])[0]; // most frequent; the first seen wins a tie
    if (meta.size) {
      doi = pick(meta)[0];
      source = "meta";
      sure = true;
    } else if (scan.textDois.size) {
      const [found, count] = pick(scan.textDois);
      doi = found;
      source = "text";
      sure = count >= 3; // a paper's own DOI is repeated on several pages; a reference's is not
    }
  }
  if (doi && !(source === "text" && !sure && guess && guess.id)) return { kind: "journal", doi, source, sure };
  if (guess && guess.id) return { kind: "arxiv", id: guess.id, version: guess.version, source: "name", sure: false };
  if (guess && guess.bibcode) return { kind: "ads", bibcode: guess.bibcode, source: "name", sure: false };
  if (guess && guess.doi) return { kind: "journal", doi: guess.doi, source: "name", sure: false };
  return null;
}

const arxivFileName = (id, version) => id.replace(/[\\/:*?"<>|\s]+/g, "_") + (version || "") + ".pdf";
const normalizeForSearch = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

// PDF files in the folder that the index does not mention.
async function findUnmanagedPdfs(dir) {
  const known = new Set(Object.values(await readIndex(dir)).flatMap(entryFiles));
  return (await listFiles(dir)).filter((n) => /\.pdf$/i.test(n) && !n.startsWith(".") && !known.has(n)).sort();
}

// arXiv PDFs that are in the library without a version (shown as "PDF" instead of v1, v2...), e.g. because they were
// indexed by their file name alone. The version can usually be read from the PDF. Files that were already checked
// and have no readable version are remembered on this computer, so the note does not come back every time.
const CHECKED_KEY = "unversionedChecked";
async function findUnversionedFiles(dir) {
  const index = await readIndex(dir);
  const present = new Set(await listFiles(dir));
  const skip = new Set(((await chrome.storage.local.get(CHECKED_KEY))[CHECKED_KEY]) || []);
  return Object.entries(index)
    .filter(([id]) => isArxivKey(id))
    .map(([, entry]) => entry.versions[UNVERSIONED])
    .filter((file) => file && present.has(file) && !skip.has(file))
    .sort();
}

async function rememberUnversionedChecked(names) {
  if (!names.length) return;
  const known = ((await chrome.storage.local.get(CHECKED_KEY))[CHECKED_KEY]) || [];
  await chrome.storage.local.set({ [CHECKED_KEY]: [...new Set([...known, ...names])] });
}

// ---- Planning (nothing is changed) ----
// Returns { items, cancelled, unresolved }. (unresolved: library files without a version whose PDF does not say.) Each item describes one file:
//   name, status: "rename" (needs approval) | "same" (already named right: only recorded) | "duplicate" | "unknown",
//   kind ("arxiv" | "journal"), id, version, doi, arxivId (journal papers that also exist on arXiv), newName,
//   title, authors, authorCount, journal: { name, year }, sure, notes: [translation keys], why: text for duplicate/unknown.
async function planImport(dir, { report = () => {}, isCancelled = () => false } = {}) {
  const index = await readIndex(dir);
  const unversioned = await findUnversionedFiles(dir); // already in the library, but without a version
  const owner = new Map(Object.entries(index).filter(([, e]) => e.versions[UNVERSIONED]).map(([id, e]) => [e.versions[UNVERSIONED], id]));
  const names = [...(await findUnmanagedPdfs(dir)), ...unversioned];
  const lower = (n) => n.toLowerCase(); // Macs and Windows treat A.pdf and a.pdf as the same file
  const existing = new Set((await listFiles(dir)).map(lower));
  const items = [];

  // 1. Read every file.
  for (let i = 0; i < names.length && !isCancelled(); i++) {
    report(tr("import.scanning", { a: i + 1, b: names.length }));
    const item = { name: names[i], notes: [] };
    items.push(item);
    try {
      const file = await (await dir.getFileHandle(names[i])).getFile();
      let scan = null;
      if (file.size <= MAX_SCAN_BYTES) scan = await scanPdf(file);
      Object.assign(item, identify(names[i], scan));
      // A PDF ends with "%%EOF" (possibly followed by blanks); one that does not was cut off, e.g. an unfinished download.
      if (!/%%EOF\s*$/.test(await file.slice(Math.max(0, file.size - 1024)).text())) item.incomplete = true;
      if (item.kind === "journal" && !item.sure && scan) item.pageText = scan.text.slice(0, 200000); // to check the title later
      if (!item.kind) {
        item.why = tr(file.size > MAX_SCAN_BYTES ? "import.why.toolarge" : "import.why.none");
        if (scan && normalizeForSearch(scan.title).length >= 20) item.titleGuess = scan.title; // searched for below
      }
    } catch (e) {
      item.why = tr("import.why.read", { msg: e.message });
    }
  }

  // Files that are in the library already are only touched if the PDF states the version of that very paper.
  const unresolved = items.filter((it) => owner.has(it.name) && !(it.kind === "arxiv" && it.source === "stamp" && it.id === owner.get(it.name))).map((it) => it.name);
  if (!isCancelled()) items.splice(0, items.length, ...items.filter((it) => !unresolved.includes(it.name)));

  // 2. Ask arXiv for the arXiv papers (in batches, politely).
  const arxivMeta = new Map();
  const wanted = new Set();
  const needMeta = (id) => {
    if (id && !index[id]) wanted.add(id);
  };
  items.filter((it) => it.kind === "arxiv").forEach((it) => needMeta(it.id));
  const lookUpArxiv = async () => {
    const ids = [...wanted].filter((id) => !arxivMeta.has(id));
    for (let i = 0; i < ids.length && !isCancelled(); i += PAGE_BATCH) {
      report(tr("import.lookup", { a: Math.min(i + PAGE_BATCH, ids.length), b: ids.length }));
      try {
        for (const [id, meta] of await fetchMetadataBatch(ids.slice(i, i + PAGE_BATCH))) arxivMeta.set(id, meta);
      } catch (e) {
        ids.slice(i, i + PAGE_BATCH).forEach((id) => arxivMeta.set(id, { failed: e.message }));
      }
    }
  };
  await lookUpArxiv();
  if (isCancelled()) return { items: [], cancelled: true, unresolved: [] };

  // 3. Ask Crossref (and INSPIRE / OpenAlex for the arXiv number) for the journal papers.
  //    Files without any DOI are searched for by the title written in the PDF; only an exact match is accepted.
  for (const it of items.filter((x) => !x.kind && x.titleGuess)) {
    if (isCancelled()) break;
    try {
      const doi = await findDoiByTitle(it.titleGuess);
      if (doi) Object.assign(it, { kind: "journal", doi, source: "title", sure: false, why: "" });
    } catch (e) {} // offline or refused: the file simply stays unrecognised
    await wait(400);
  }
  const journalItems = items.filter((it) => it.kind === "journal");
  for (let i = 0; i < journalItems.length && !isCancelled(); i++) {
    const it = journalItems[i];
    report(tr("import.lookup", { a: i + 1, b: journalItems.length }));
    try {
      const cr = await fetchJournalMetadata(it.doi);
      it.crossref = cr;
      it.arxivId = await findArxivIdForDoi(it.doi);
      if (!it.sure && it.pageText && cr.title && normalizeForSearch(it.pageText).includes(normalizeForSearch(cr.title))) it.sure = true; // the title is on the first page
    } catch (e) {
      it.why = tr("import.why.lookup", { msg: e.message });
      it.kind = null;
    }
    await wait(400);
  }
  // ADS papers not yet in the index: title and authors from Crossref, if it knows the paper.
  for (const it of items.filter((x) => x.kind === "ads" && !(index["ads:" + x.bibcode] && index["ads:" + x.bibcode].title))) {
    if (isCancelled()) break;
    try {
      it.crossref = await fetchBibcodeMetadata(it.bibcode);
    } catch (e) {} // (offline or refused: the title stays empty; "Update index" tries again)
    await wait(400);
  }
  journalItems.filter((it) => it.arxivId).forEach((it) => needMeta(it.arxivId));
  await lookUpArxiv();
  if (isCancelled()) return { items: [], cancelled: true, unresolved: [] };

  // 4. Decide the new names and what can be done.
  const taken = new Map(); // new name -> the file that will get it
  // (complete files first: of two copies of a paper, a cut-off one becomes the duplicate)
  for (const it of [...items].sort((a, b) => !!a.incomplete - !!b.incomplete)) {
    if (it.incomplete) it.notes.push("import.note.incomplete");
    if (!it.kind) {
      it.status = "unknown";
      continue;
    }
    if (it.kind === "ads") { // (title from the index or from Crossref; may stay empty)
      const key = "ads:" + it.bibcode;
      const known = (index[key] && index[key].title ? index[key] : it.crossref) || {};
      Object.assign(it, { title: known.title || "", authors: known.authors || [], authorCount: known.authorCount || 0, doi: (it.crossref && it.crossref.doi) || "", journal: bibcodeJournal(it.bibcode) });
      it.newName = bibcodeFileName(it.bibcode);
      const saved = index[key] && index[key].journal && index[key].journal.file;
      if (saved && saved !== it.name && existing.has(lower(saved))) {
        it.status = "duplicate";
        it.why = tr("import.why.dupjournal", { name: saved });
        continue;
      }
    } else if (it.kind === "arxiv") {
      const meta = arxivMeta.get(it.id) || (index[it.id] && { title: index[it.id].title, authors: index[it.id].authors, authorCount: index[it.id].authorCount, doi: index[it.id].doi });
      if (!meta || meta.failed || meta.title === undefined) {
        it.status = "unknown";
        it.why = meta && meta.failed ? tr("import.why.lookup", { msg: meta.failed }) : tr("import.why.noarxiv");
        continue;
      }
      Object.assign(it, { title: meta.title, authors: meta.authors || [], authorCount: meta.authorCount || 0, metaDoi: meta.doi || "" });
      if (!it.version) it.notes.push("import.note.nover");
      it.newName = arxivFileName(it.id, it.version);
      const saved = index[it.id] && index[it.id].versions[it.version || UNVERSIONED];
      if (saved && saved !== it.name && existing.has(lower(saved))) { // (a record of a file that is gone does not count)
        it.status = "duplicate";
        it.why = tr("import.why.dupversion", { name: saved });
        continue;
      }
    } else {
      const cr = it.crossref;
      const key = it.arxivId || "doi:" + it.doi;
      const meta = it.arxivId && (arxivMeta.get(it.arxivId) || index[it.arxivId]);
      const base = meta && meta.title ? meta : cr;
      Object.assign(it, { title: base.title, authors: base.authors || [], authorCount: base.authorCount || 0, journal: { name: cr.journalName, year: cr.year } });
      if (!meta || !meta.title) it.arxivId = null; // the arXiv entry could not be read: record it as a journal-only paper
      it.newName = journalFileName(it.doi);
      const saved = index[key] && index[key].journal && index[key].journal.file;
      if (saved && saved !== it.name && existing.has(lower(saved))) {
        it.status = "duplicate";
        it.why = tr("import.why.dupjournal", { name: saved });
        continue;
      }
      if (it.source === "text") it.notes.push("import.note.text");
      if (it.source === "title") it.notes.push("import.note.title");
    }
    if (it.source === "name") it.notes.push("import.note.name");
    if (it.newName === it.name) {
      it.status = "same";
    } else if (existing.has(lower(it.newName)) && lower(it.newName) !== lower(it.name)) {
      it.status = "duplicate";
      it.why = tr("import.why.exists", { name: it.newName });
    } else if (taken.has(lower(it.newName))) {
      it.status = "duplicate";
      it.why = tr("import.why.dupplan", { name: taken.get(lower(it.newName)) });
    } else {
      it.status = "rename";
    }
    if (it.status === "rename" || it.status === "same") taken.set(lower(it.newName), it.name);
  }
  items.forEach((it) => {
    delete it.crossref;
    delete it.pageText;
    delete it.titleGuess;
  });
  unresolved.push(...items.filter((it) => owner.has(it.name) && it.status !== "rename").map((it) => it.name)); // nothing to offer for these
  return { items, cancelled: isCancelled(), unresolved };
}

// ---- Renaming ----

// Give a file a new name without ever overwriting another file. The content is checked before the old file is removed.
async function renameFile(dir, oldName, newName) {
  const caseOnly = oldName.toLowerCase() === newName.toLowerCase(); // (Macs and Windows: the same file under both names)
  if (!caseOnly) {
    let taken = true;
    try {
      await dir.getFileHandle(newName);
    } catch (e) {
      if (e.name !== "NotFoundError") throw e;
      taken = false;
    }
    if (taken) throw new Error(tr("import.why.exists", { name: newName }));
  }
  const handle = await dir.getFileHandle(oldName);
  if (typeof handle.move === "function") {
    try {
      await handle.move(newName);
      return;
    } catch (e) {} // not supported for this folder: copy instead
  }
  if (caseOnly) {
    // Copying "A.pdf" onto "a.pdf" and then deleting "A.pdf" would delete the only file. Go through a temporary name,
    // so that at every moment one complete copy exists (if a step fails, the file is left under one of the names).
    const tmp = newName.replace(/\.pdf$/i, "") + ".papurr-renaming.pdf";
    await copyFile(dir, oldName, tmp);
    await dir.removeEntry(oldName);
    await copyFile(dir, tmp, newName);
    await dir.removeEntry(tmp);
    return;
  }
  await copyFile(dir, oldName, newName);
  await dir.removeEntry(oldName);
}

// Copy a file to a new name (that is not the same file) and check the size; a half-written copy is removed.
async function copyFile(dir, from, to) {
  const file = await (await dir.getFileHandle(from)).getFile();
  const target = await dir.getFileHandle(to, { create: true });
  try {
    const writable = await target.createWritable();
    await writable.write(file);
    await writable.close();
    if ((await target.getFile()).size !== file.size) throw new Error("size mismatch");
  } catch (e) {
    try { await dir.removeEntry(to); } catch (e2) {} // never leave a half-written copy behind
    throw e;
  }
}

// Record one imported file in the index (called inside updateIndex).
async function addImportedToIndex(dir, papers, it) {
  const now = new Date().toISOString();
  if (it.kind === "ads") {
    const key = "ads:" + it.bibcode;
    const entry = papers[key] || (papers[key] = { title: it.title || "", authors: it.authors || [], authorCount: it.authorCount || 0, added: now, versions: {}, bibcode: it.bibcode });
    entry.journal = { file: it.newName, bibcode: it.bibcode, ...bibcodeJournal(it.bibcode) };
    if (!entry.title && it.title) Object.assign(entry, { title: it.title, authors: it.authors, authorCount: it.authorCount });
    if (!entry.doi && it.doi) entry.doi = it.doi;
    touch(entry);
    return;
  }
  if (it.kind === "arxiv") {
    const entry = papers[it.id] || (papers[it.id] = { title: it.title, authors: it.authors, authorCount: it.authorCount, added: now, versions: {} });
    if (!entry.title && it.title) Object.assign(entry, { title: it.title, authors: it.authors, authorCount: it.authorCount });
    if (!entry.doi && it.metaDoi) entry.doi = it.metaDoi;
    for (const [key, file] of Object.entries(entry.versions)) if (file === it.name && file !== it.newName) delete entry.versions[key]; // (the same file recorded without a version)
    entry.versions[it.version || UNVERSIONED] = it.newName;
    await absorbDoiEntry(dir, papers, it.id, entry.doi); // a journal-only entry saved earlier belongs to this paper
    touch(entry);
  } else {
    const key = it.arxivId || "doi:" + it.doi;
    const entry = papers[key] || (papers[key] = { title: it.title, authors: it.authors, authorCount: it.authorCount, added: now, versions: {} });
    entry.doi = it.doi;
    entry.journal = { file: it.newName, doi: it.doi, name: it.journal.name, year: it.journal.year };
    if (it.arxivId) await absorbDoiEntry(dir, papers, key, it.doi);
    touch(entry);
  }
}

// Rename the approved files and record them (and the files that already have the right name) in the index.
// Returns { renamed, added, failed: [{ name, error }], cancelled }.
async function applyImport(dir, items, { report = () => {}, isCancelled = () => false } = {}) {
  const result = { renamed: 0, added: 0, failed: [], cancelled: false };
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    await updateIndex(dir, async (papers) => {
      for (const it of batch) await addImportedToIndex(dir, papers, it);
    });
    result.added += batch.length;
  };
  for (let i = 0; i < items.length; i++) {
    if (isCancelled()) {
      result.cancelled = true;
      break;
    }
    const it = items[i];
    report(tr("import.applying", { a: i + 1, b: items.length }));
    try {
      if (it.status === "rename") {
        await renameFile(dir, it.name, it.newName);
        result.renamed++;
      }
      pending.push(it);
      if (pending.length >= APPLY_BATCH) await flush();
    } catch (e) {
      result.failed.push({ name: it.name, error: e.message });
    }
  }
  await flush();
  return result;
}
