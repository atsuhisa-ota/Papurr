// The INSPIRE page: a library with one saved paper (2610.10001, so that its result says "In library"), a recording tabs.create and a
// clipboard, and the fake INSPIRE API below.
window.loadDir = async () => {
  seed({ "2610.10001": entry("Saved already", { versions: { v1: "x.pdf" } }) });
  fakeDir.put("x.pdf", "%PDF-");
  return fakeDir;
};
window.__tabs = [];
chrome.tabs.create = async (o) => { __tabs.push(o); return {}; };
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (x) => { window.__clip = x; } } });
// ?results: a search is made a moment after the page opened (for the layout test)
if (new URLSearchParams(location.search).has("results")) {
  document.addEventListener("DOMContentLoaded", () => setTimeout(() => {
    const box = document.getElementById("search");
    box.value = "a fake";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }, 800));
}

// A fake INSPIRE API for the "INSPIRE" search scope: "a fake" has 30 results (pages of 25), "nothing" none, "bad" answers 400,
// "busy" 429, "garbage" an unreadable body, "boom" a network failure. Every request is recorded.
window.inspireRequests = [];
const __realFetch = window.fetch;
window.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.startsWith("https://inspirehep.net/api/literature")) return __realFetch ? __realFetch(url, opts) : Promise.reject(new Error("no network in the tests"));
  inspireRequests.push(u);
  if (u.includes("format=bibtex")) return /literature\/1001\?/.test(u) ? { ok: true, status: 200, text: async () => "@article{Fake:2026ab,\n    title = \"Fake result 2\"\n}" } : { ok: false, status: 404, text: async () => "" };
  const q = decodeURIComponent(/[?&]q=([^&]*)/.exec(u)[1]);
  const page = Number(/[?&]page=(\d+)/.exec(u)[1]);
  if (q === "boom") throw new TypeError("network");
  if (q === "bad") return { ok: false, status: 400, json: async () => ({}) };
  if (q === "busy") return { ok: false, status: 429, json: async () => ({}) };
  if (q === "garbage") return { ok: true, status: 200, json: async () => { throw new Error("not json"); } };
  const total = q === "nothing" ? 0 : q.startsWith("refersto:") ? 3 : 30;
  const recent = !u.includes("sort=leastrecent");
  const hits = [];
  for (let i = (page - 1) * 25; i < Math.min(total, page * 25); i++) {
    hits.push({ metadata: { control_number: 1000 + i, titles: [{ title: (q.startsWith("refersto:") ? "Citing paper " : "Fake result ") + (i + 1) + (i === 0 ? " <b>bold</b>" : "") + (recent ? "" : " (oldest first)") }],
      authors: (i === 0 ? ["Ann Smith", "Bo Chen", "Cy Dee", "Di Eve", "Ed Fox", "Fay Gu", "Gil Ho"] : ["Ann Smith", "Bo Chen", "Cy Dee", "Di Eve"]).map((n) => ({ full_name: n })), arxiv_eprints: i % 5 === 4 ? [] : [{ value: "2610." + String(10000 + i) }],
      dois: i === 0 ? [{ value: "10.1/x" }] : [], citation_count: i * 3, earliest_date: "2026-10-0" + (1 + (i % 9)), publication_info: [{ journal_title: "JHEP", journal_volume: "10" }] } });
  }
  return { ok: true, status: 200, json: async () => ({ hits: { total, hits } }) };
};
