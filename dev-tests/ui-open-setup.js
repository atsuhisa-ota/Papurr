// Stubs for the network and the scenario's starting state.
const S = new URLSearchParams(location.search).get("s");
const BASE = S.replace(/_ja$/, ""); // "X_ja" runs scenario X with ?lang=ja
window.fetchCalls = [];
window.nativeCalls = [];
const atom = (id, ver, doi) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>http://arxiv.org/abs/${id}${ver}</id><title>Some   Title</title>${["A","B","C","D","E","F","G"].map((n) => `<author><name>Ann ${n}</name></author>`).join("")}${doi ? `<arxiv:doi>${doi}</arxiv:doi>` : ""}</entry></feed>`;
const pdfBlob = () => new Blob(["%PDF-1.4 fake"], { type: "application/pdf" });
window.fetch = async (url) => {
  url = String(url);
  fetchCalls.push(url);
  const ok = (body, type) => ({ ok: true, status: 200, blob: async () => (typeof body === "string" ? new Blob([body]) : body), text: async () => (typeof body === "string" ? body : "%PDF-"), json: async () => JSON.parse(body) });
  if (url.includes("export.arxiv.org")) {
    if (BASE === "Y_save_busy") return { ok: false, status: 429, text: async () => "Rate exceeded." }; // arXiv's API refuses for a moment
    if (url.includes("hep-th%2F9901001")) return ok(atom("hep-th/9901001", "v3", ""));
    if (S === "K_merge_doi_entry") return ok(atom("2301.12345", "v2", "10.1/x"));
    return ok(atom(S.startsWith("G") ? "2301.00001" : "2301.12345", "v2", ""));
  }
  if (url.startsWith("https://arxiv.org/pdf/")) return ok(pdfBlob());
  if (url.includes("articles.adsabs.harvard.edu")) return ok(pdfBlob());
  if (url.includes("publisher.example")) {
    if (["P_page_retry", "Q_page_fails", "R_other_site", "S_no_tab"].includes(BASE)) return { ok: false, status: 403 }; // the extension's own request is refused
    return BASE === "J_journal_html" ? ok("<html>login</html>") : ok(pdfBlob());
  }
  if (url.includes("api.crossref.org")) return ok(JSON.stringify({ message: { title: ["Crossref <i>Title</i>"], author: [{ given: "Ann", family: "Smith" }], "container-title": ["Physical Review D"], issued: { "date-parts": [[2023, 5]] } } }));
  if (url.includes("inspirehep.net")) return S === "G_journal_new_with_arxiv" ? ok(JSON.stringify({ metadata: { arxiv_eprints: [{ value: "2301.00001" }] } })) : { ok: false, status: 404 };
  if (url.includes("openalex")) return { ok: false, status: 404 };
  throw new Error("unexpected fetch " + url);
};
chrome.runtime.sendNativeMessage = async (host, msg) => { nativeCalls.push(msg); if (BASE === "N_external_fails") throw new Error("Specified native messaging host not found."); return { ok: true }; };
chrome.tabs.getCurrent = async () => null;
// The publisher tab where the link was clicked, and Chrome's way to run a small function in it.
window.scriptCalls = [];
chrome.tabs.get = async (id) => ({ id, url: BASE === "R_other_site" ? "https://evil.example.net/article/1" : "https://publisher.example/article/1" });
chrome.scripting = { executeScript: async (o) => { scriptCalls.push(o); return [{ result: BASE === "Q_page_fails" ? { ok: false, status: 403 } : { ok: true, data: btoa("%PDF-1.4 fetched by the page") } }]; } };
const E_ = (extra = {}) => ({ title: "T", authors: ["A"], authorCount: 1, added: "2026-01-01T00:00:00Z", versions: {}, ...extra });
const put = (...names) => names.forEach((n) => fakeDir.put(n, "%PDF-"));
const state = {
  A_new_arxiv: () => {},
  B_saved_latest: () => { put("2301.12345v2.pdf"); seed({ "2301.12345": E_({ versions: { v2: "2301.12345v2.pdf" } }) }); },
  C_v1_saved_latest_v2: () => { put("2301.12345v1.pdf"); seed({ "2301.12345": E_({ versions: { v1: "2301.12345v1.pdf" }, tags: ["keep"] }) }); },
  D_explicit_v1: () => { put("2301.12345v1.pdf", "2301.12345v2.pdf"); seed({ "2301.12345": E_({ versions: { v1: "2301.12345v1.pdf", v2: "2301.12345v2.pdf" } }) }); },
  E_local: () => { put("2301.12345v1.pdf", "2301.12345v2.pdf"); seed({ "2301.12345": E_({ versions: { v1: "2301.12345v1.pdf", v2: "2301.12345v2.pdf" } }) }); },
  E2_local_journal_only: () => { put("j.pdf"); seed({ "doi:10.1/x": E_({ doi: "10.1/x", journal: { file: "j.pdf", doi: "10.1/x" } }) }); },
  F_journal_chip: () => { put("j.pdf"); seed({ "2301.12345": E_({ versions: {}, doi: "10.1/x", journal: { file: "j.pdf", doi: "10.1/x" } }) }); },
  G_journal_new_with_arxiv: () => {},
  H_journal_only: () => {},
  I_journal_saved: () => { put("j.pdf"); seed({ "2301.12345": E_({ doi: "10.1103/physrevd.108.045001", journal: { file: "j.pdf", doi: "10.1103/physrevd.108.045001" } }) }); },
  J_journal_html: () => {},
  K_merge_doi_entry: () => { put("10.1_x.pdf"); fakeDir.put("10.1_x.md", "## Notes\n\nwritten while journal-only\n"); seed({ "doi:10.1/x": E_({ doi: "10.1/x", tags: ["j"], note: "10.1_x.md", journal: { file: "10.1_x.pdf", doi: "10.1/x" } }) }); },
  L_damaged: () => { fakeDir.put("index.json", "{{{"); },
  M_external: () => { __store.openMode = "external"; __store.viewer = "evince"; },
  N_external_fails: () => { __store.openMode = "external"; },
  O_sanitize: () => {},
  P_page_retry: () => {},
  Q_page_fails: () => {},
  R_other_site: () => {},
  S_no_tab: () => {},
  // "Add to library" (save without opening): a library tab answers / no library tab / already saved
  T_save_new: () => { libraryTab(); },
  AG_save_quiet: () => { libraryTab(); },
  Y_save_busy: () => { libraryTab(); },
  Z_bad_request: () => {},
  // A PDF of that name is in the folder but not in the library (put there by hand, maybe with the user's annotations).
  AA_existing_arxiv: () => { fakeDir.put("2301.12345v2.pdf", "%PDF- my annotated copy"); },
  AB_existing_journal: () => { fakeDir.put("10.1103_physrevd.108.045001.pdf", "%PDF- my annotated journal copy"); },
  AC_existing_ads: () => { fakeDir.put("1970A&A.....5...84Z.pdf", "%PDF- my annotated scan"); },
  AD_existing_notpdf: () => { fakeDir.put("2301.12345v2.pdf", "my own notes, not a PDF"); },
  U_save_nolib: () => {},
  W_ads: () => {},
  X_ads_saved: () => { put("1970A&A.....5...84Z.pdf"); seed({ "ads:1970A&A.....5...84Z": E_({ title: "Old", journal: { file: "1970A&A.....5...84Z.pdf", bibcode: "1970A&A.....5...84Z" } }) }); },
  V_save_saved: () => { put("2301.12345v2.pdf"); seed({ "2301.12345": E_({ versions: { v2: "2301.12345v2.pdf" } }) }); libraryTab(); },
};
// A library tab in another page: it hears "added" and answers "shown".
function libraryTab() {
  const lib = new BroadcastChannel("papurr");
  lib.onmessage = (e) => { window.libraryHeard = e.data; lib.postMessage({ type: "shown", id: e.data.id }); };
}
state[BASE]();
window.loadDir = async () => { await sleep(150); return fakeDir; }; // lets the test hook be installed before open.js continues
window.__shownHook = true;
