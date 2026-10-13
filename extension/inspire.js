// Searching INSPIRE from the Library (scope "INSPIRE"): the query goes to INSPIRE's API after Enter, and a page of results
// comes back as small JSON. No DOM and no AI here; library.js draws the list. Only a click or Enter starts a request (never
// typing, never opening the page), one search at a time; INSPIRE's own limit (about 15 requests in 5 s) is far away.
// The website sends a program of about a megabyte before it asks the same API; asking the API directly is why this is
// quicker where the connection is slow. A list shows at most 5 authors (as the library does), then "et al."; the answer holds
// every name (a paper of a big collaboration has a thousand: about 30 KB for one result before compression, usually a small
// part of that), so "all authors" needs no further request. A search with many such papers is the only heavy case.
const INSPIRE_PAGE_SIZE = 25;
const INSPIRE_SEARCH_FIELDS = "control_number,titles,authors.full_name,arxiv_eprints,dois,earliest_date,publication_info";
const INSPIRE_LIST_AUTHORS = 5; // names shown in a list (the library keeps 5 too)
const INSPIRE_AUTHORS_CAP = 3000; // names kept per result
const INSPIRE_TIMEOUT_MS = 60000;
const INSPIRE_SORTS = ["mostrecent", "leastrecent"];

function inspireSearchUrl(query, page, sort) {
  return "https://inspirehep.net/api/literature?q=" + encodeURIComponent(query) + "&size=" + INSPIRE_PAGE_SIZE + "&page=" + (page || 1) +
    "&sort=" + (INSPIRE_SORTS.includes(sort) ? sort : "mostrecent") + "&fields=" + INSPIRE_SEARCH_FIELDS;
}

// The searches behind "Cited by" and "References" of a record.
const inspireRecid = (recid) => Math.floor(Number(recid)) || 0; // (only a number ever goes into an address or a query)
const inspireCitedByQuery = (recid) => "refersto:recid:" + inspireRecid(recid);
const inspireReferencesQuery = (recid) => "citedby:recid:" + inspireRecid(recid);
// A click on an author: INSPIRE's exact-author search (`ea`: the papers INSPIRE itself ties to this author, so a common name does
// not bring in other people: "Wang, Wei" gives 1,708 papers with `ea` and 5,585 with `a`; characters with a meaning in the query
// language are dropped).
const inspireAuthorQuery = (name) => "ea " + String(name).replace(/[\"():]/g, " ").replace(/\s+/g, " ").trim();

// The answer of the API as a plain list: { total, hits: [{ recid, title, authors (all, as text), year, journal, arxiv, doi }] }.
// Nothing in the answer is trusted: every value is checked, odd ones are left out (the list is drawn as text).
function parseInspireHits(json) {
  const text = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const outer = json && typeof json === "object" ? json.hits : null;
  const rows = outer && Array.isArray(outer.hits) ? outer.hits : [];
  const hits = [];
  for (const row of rows) {
    const m = row && typeof row === "object" && row.metadata && typeof row.metadata === "object" ? row.metadata : null;
    if (!m) continue;
    const recid = Number(m.control_number || row.id) || 0;
    const title = text(Array.isArray(m.titles) && m.titles[0] ? m.titles[0].title : "");
    const authors = (Array.isArray(m.authors) ? m.authors : []).map((a) => text(a && a.full_name)).filter(Boolean).slice(0, INSPIRE_AUTHORS_CAP);
    const arxivRaw = text(Array.isArray(m.arxiv_eprints) && m.arxiv_eprints[0] ? m.arxiv_eprints[0].value : "");
    const arxiv = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/.test(arxivRaw) ? arxivRaw : "";
    const doi = text(Array.isArray(m.dois) && m.dois[0] ? m.dois[0].value : "");
    const info = Array.isArray(m.publication_info) && m.publication_info[0] && typeof m.publication_info[0] === "object" ? m.publication_info[0] : {};
    const year = /^\d{4}/.test(text(m.earliest_date)) ? text(m.earliest_date).slice(0, 4) : "";
    if (!recid && !arxiv && !title) continue;
    hits.push({
      recid, title: title || (arxiv ? "arXiv:" + arxiv : "INSPIRE " + recid), authors, year,
      journal: [text(info.journal_title), text(info.journal_volume)].filter(Boolean).join(" "), arxiv, doi,
    });
  }
  const total = outer && Number.isFinite(Number(outer.total)) ? Number(outer.total) : hits.length;
  return { total, hits };
}

// One request to INSPIRE; `read` turns the answer into what the caller wants. Errors are plain sentences in the interface language.
async function inspireGet(url, read) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller && setTimeout(() => controller.abort(), INSPIRE_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, controller ? { signal: controller.signal } : undefined);
  } catch (e) {
    throw new Error(tr(e && e.name === "AbortError" ? "inspire.err.timeout" : "inspire.err.network"));
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 429) throw new Error(tr("prof.err.ratelimit"));
  if (!res.ok) throw new Error(tr("inspire.err.status", { status: res.status }));
  try {
    return await read(res);
  } catch (e) {
    throw new Error(tr("inspire.err.format"));
  }
}

// One page of results for a query.
const fetchInspireSearch = (query, page, sort) => inspireGet(inspireSearchUrl(query, page, sort), async (res) => parseInspireHits(await res.json()));

// The BibTeX entry of a record (to copy).
const fetchInspireBibtex = (recid) => inspireGet("https://inspirehep.net/api/literature/" + inspireRecid(recid) + "?format=bibtex", async (res) => {
  const text = (await res.text()).trim();
  if (!text.startsWith("@")) throw new Error("not BibTeX");
  return text;
});
