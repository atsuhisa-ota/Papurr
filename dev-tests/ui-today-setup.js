// "Today's arXiv" page: the chosen categories, a library with one saved paper, and a fake arXiv: the feed of the latest
// announcement with the papers' details, as arXiv's feed has them (2 new, 1 cross-list, 1 replacement; ?nofeed: an empty
// feed as on weekends; ?bare: a feed without details, so the API is asked by id), the API by id, and the listing.
// "Yesterday's lattice" was submitted before the last deadline but announced now (as arXiv does with papers it held back).
const __q = new URLSearchParams(location.search);
if (!__q.has("nocats")) chrome.storage.local.set({ arxivCategories: ["hep-th", "astro-ph.CO"] });
window.TODAY_PAGE_SIZE = 3;
// ?history: lists of earlier announcements kept from other days (one of them too old to be kept, one for other categories)
if (__q.has("history")) {
  const kept = (date, title, cats = ["hep-th", "astro-ph.CO"]) => ({ date, categories: cats, announced: { date, new: 1, cross: 0, replace: 0 },
    papers: [{ id: "2610.9" + date.slice(-2), version: "v1", title, authors: ["Ann Smith"], authorCount: 1, abstract: "Kept.", published: date + "T00:00:00Z", categories: ["hep-th"], primary: "hep-th", latest: true, announce: "new" }] });
  chrome.storage.local.set({ todayHistory: [kept("2026-10-07", "Kept from Oct 7"), kept("2026-10-06", "Kept from Oct 6"), // (Oct 5 is missing: fetched on a click)
    kept("2026-10-02", "Kept from Oct 2"), kept("2026-10-01", "Kept from Oct 1"), kept("2026-09-30", "Too old to keep"), kept("2026-10-07", "Other categories", ["math.AG"])] });
}
// ?cached: a list fetched just now is kept (no request must be made); ?quota: the storage refuses to keep the list (full)
if (__q.has("cached")) {
  const p = (id, title) => ({ id, version: "v1", title, authors: ["Ann Smith"], authorCount: 1, abstract: "Kept abstract.", published: "2026-10-07T00:00:00Z", categories: ["hep-th"], primary: "hep-th", latest: true, announce: "new" });
  chrome.storage.local.set({ todayCache: { v: 3, categories: ["hep-th", "astro-ph.CO"], time: Date.now(), papers: [p("2610.00077", "From the kept list")], more: false, announced: { date: "2026-10-07", new: 1, cross: 0, replace: 0 }, apiOffset: 0 } });
}
if (__q.has("quota")) {
  const set = chrome.storage.local.set.bind(chrome.storage.local);
  chrome.storage.local.set = async (items) => { if ("todayCache" in items || "todayHistory" in items) throw new Error("QUOTA_BYTES quota exceeded"); return set(items); };
}
window.requests = [];
window.fetchDelay = __q.has("slow") ? 700 : 0;
const atom = (id, title, published, cats, summary) => `<entry><id>http://arxiv.org/abs/${id}</id><published>${published}</published><title>${title}</title><summary>  ${summary}\n more text</summary>
  <author><name>Ann Smith</name></author><author><name>Bo Chen</name></author><arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="${cats[0]}"/>${cats.map((c) => `<category term="${c}"/>`).join("")}</entry>`;
window.fetch = async (url) => {
  requests.push(String(url));
  if (fetchDelay) await sleep(fetchDelay);
  if (__q.has("fail")) return { ok: false, status: 503, text: async () => "" };
  // ?garbage: every answer is a web page instead of XML (an overloaded server, a proxy, a login wall); ?emptybody: 200 with nothing in it
  if (__q.has("garbage")) return { ok: true, status: 200, text: async () => "<html><body><h1>Service unavailable</h1><p>Try later</p></body></html>" };
  if (__q.has("emptybody")) return { ok: true, status: 200, text: async () => "" };
  if (__q.has("busy")) return { ok: false, status: 429, text: async () => "" };
  const E = {
    "2610.00003": atom("2610.00003v1", "Newest on strings", "2026-10-07T17:00:00Z", ["hep-th", "gr-qc"], "We study strings."),
    "2610.00002": atom("2610.00002v2", "Dark energy sums", "2026-10-07T09:00:00Z", ["astro-ph.CO"], "A very long abstract. ".repeat(30)),
    "2610.00001": atom("2610.00001v1", "Yesterday's lattice", __q.has("bigday") ? "2026-10-06T20:00:00Z" : "2026-10-06T16:00:00Z", ["hep-th"], "Lattice."),
    "2610.00000": atom("2610.00000v1", "Older still", "2026-10-05T10:00:00Z", ["hep-th"], "Older."),
  };
  const ok = (body) => ({ ok: true, status: 200, text: async () => body });
  const feedOf = (entries) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries.join("")}</feed>`;
  if (String(url).includes("submittedDate%3A")) { // an earlier day, by submission time (Oct 5: submitted Thu Oct 1 18:00 to Fri Oct 2 18:00 UTC)
    return ok(feedOf([atom("2610.05001v1", "Fetched new one", "2026-10-02T12:00:00Z", ["hep-th"], "About it."), atom("2610.05002v2", "Fetched cosmology", "2026-10-02T09:00:00Z", ["astro-ph.CO"], "Cosmology."),
      atom("2610.05003v1", "Fetched cross one", "2026-10-01T20:00:00Z", ["gr-qc", "hep-th"], "Cross."), atom("2610.04999v1", "Outside the window", "2026-10-01T17:00:00Z", ["hep-th"], "Too early.")]));
  }
  if (String(url).includes("/rss/")) {
    const D = { // (title, version, categories, abstract) as in the API answers above
      "2610.00003": ["Newest on strings", "v1", ["hep-th", "gr-qc"], "We study strings.\n more text"],
      "2610.00002": ["Dark energy sums", "v2", ["astro-ph.CO"], "A very long abstract. ".repeat(30) + "\n more text"],
      "2610.00001": ["Yesterday's lattice", "v1", ["hep-th"], "Lattice.\n more text"],
      "2609.00500": ["A replacement", "v3", ["hep-th"], "Replaced."],
    };
    const item = (id, type) => __q.has("bare") ? `<item><title>t</title><link>https://arxiv.org/abs/${id}</link><description>arXiv:${id}v1 Announce Type: ${type}</description><arxiv:announce_type>${type}</arxiv:announce_type></item>`
      : `<item><title>${D[id][0]}</title><link>https://arxiv.org/abs/${id}</link><description>arXiv:${id}${D[id][1]} Announce Type: ${type} \nAbstract: ${D[id][3]}</description>${D[id][2].map((c) => `<category>${c}</category>`).join("")}<arxiv:announce_type>${type}</arxiv:announce_type><dc:creator>Ann Smith, Bo Chen</dc:creator></item>`;
    if (__q.has("huge")) { // 400 announced papers in one feed (a big choice of categories)
      let many = ""; for (let i = 1; i <= 400; i++) many += `<item><title>Paper number ${i}</title><link>https://arxiv.org/abs/2611.${String(i).padStart(5, "0")}</link><description>arXiv:2611.${String(i).padStart(5, "0")}v1 Announce Type: new \nAbstract: ${"Long abstract text. ".repeat(40)}</description><category>hep-th</category><arxiv:announce_type>new</arxiv:announce_type></item>`;
      return ok(`<?xml version="1.0"?><rss xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0"><channel><title>x</title><pubDate>Thu, 08 Oct 2026 00:00:00 -0400</pubDate>${many}</channel></rss>`);
    }
    const items = __q.has("nofeed") ? "" : item("2610.00003", "new") + item("2610.00001", "new") + item("2610.00002", "cross") + item("2609.00500", "replace");
    return ok(`<?xml version="1.0"?><rss xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0"><channel><title>x</title><pubDate>Thu, 08 Oct 2026 00:00:00 -0400</pubDate>${items}</channel></rss>`);
  }
  const idList = /id_list=([^&]*)/.exec(url);
  if (idList) return ok(feedOf(decodeURIComponent(idList[1]).split(",").map((id) => E[id]).filter(Boolean)));
  const start = Number(/start=(\d+)/.exec(url)[1]);
  return ok(feedOf(start === 0 ? [E["2610.00003"], E["2610.00002"], E["2610.00001"]] : [E["2610.00000"]]));
};
window.loadDir = async () => { fakeDir.put("index.json", JSON.stringify({ schemaVersion: 3, papers: { "2610.00002": { title: "Dark energy sums", authors: [], authorCount: 0, added: "2026-10-07T10:00:00Z", versions: { v2: "x.pdf" } },
  // a paper with only a note (no PDF) is not "In library"
  "2610.00003": { title: "Newest on strings", authors: [], authorCount: 0, added: "2026-10-07T10:00:00Z", versions: {}, note: "2610.00003.md" } } })); return fakeDir; };
