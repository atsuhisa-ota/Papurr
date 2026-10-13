// When a PDF link for an arXiv paper or a journal article is clicked, cancel the normal navigation
// and hand the paper to the extension (which opens the saved copy, or saves it first).

// arXiv. Examples: https://arxiv.org/pdf/2301.12345  /  .../2301.12345v2.pdf  /  .../hep-th/9901001
const PDF_LINK = /^https?:\/\/(?:www\.)?arxiv\.org\/pdf\/(.+?)(?:(v\d+))?(?:\.pdf)?\/?(?:[?#].*)?$/i;

// Journals. A DOI looks like 10.1103/PhysRevD.108.045001
const DOI_IN_PATH = /(10\.\d{4,9}\/[^\s?#]+)/;

function metaContent(name) {
  const el = document.querySelector('meta[name="' + name + '" i]');
  return el ? el.content.trim() : "";
}

const samePage = (a, b) => {
  try {
    const x = new URL(a), y = new URL(b);
    return x.origin + x.pathname === y.origin + y.pathname;
  } catch (e) {
    return false;
  }
};

// NASA ADS's scanned articles: https://articles.adsabs.harvard.edu/pdf/<bibcode> (old papers, often without a DOI).
const ADS_PDF = /^https?:\/\/articles\.adsabs\.harvard\.edu\/pdf\/([^?#/]+)/i;
const BIBCODE_ONLY = /^\d{4}[A-Za-z&][A-Za-z&.]{4}[.\d]{4}[A-Za-z.][.\d]{4}[A-Z.]$/; // (as BIBCODE in common.js)

// The title and authors the page declares (ADS pages carry citation_* tags), to name a paper that has no DOI.
function pageCitation() {
  const metas = (name) => [...document.querySelectorAll('meta[name="' + name + '"]')].map((m) => m.content.trim()).filter(Boolean);
  const title = metas("citation_title")[0] || document.title.replace(/\s*-\s*NASA\/ADS\s*$/i, "").trim();
  return { title, authors: metas("citation_author").slice(0, 50) };
}

// Returns the DOI if the link is the PDF of a journal article, otherwise null.
function journalDoi(link) {
  // 1. Article pages declare their DOI and PDF address in <meta> tags; if the link is that PDF, we know the DOI.
  const doi = metaContent("citation_doi");
  const pdf = metaContent("citation_pdf_url");
  if (doi && pdf && samePage(link.href, pdf)) return doi.toLowerCase();
  // 2. Many publishers put the DOI in the PDF address itself (e.g. .../pdf/10.1103/PhysRevD.108.045001).
  if (/\/pdf|\.pdf/i.test(link.pathname)) {
    const m = DOI_IN_PATH.exec(decodeURIComponent(link.pathname));
    if (m) return m[1].replace(/\.pdf$/i, "").replace(/\/pdf$/i, "").toLowerCase();
  }
  return null;
}

// The on/off switch lives in the extension's settings. The click handler cannot wait for storage,
// so the current value is kept here and updated when it changes.
let enabled = true;
try {
  chrome.storage.local.get("captureEnabled").then((r) => (enabled = r.captureEnabled !== false));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.captureEnabled) enabled = changes.captureEnabled.newValue !== false;
  });
} catch (e) {} // dead copy of the script after an extension reload: nothing to do

document.addEventListener(
  "click",
  (event) => {
    if (event.button !== 0) return; // left click only
    if (!enabled) return; // switched off: links work as usual
    // (No bypass with Ctrl, Shift, Alt or Cmd: the switch in the header is the one way to let links work as usual. Author's decision, 2026-10-13.)
    // After the extension is reloaded, old tabs keep a dead copy of this script; leave links alone then.
    if (!chrome.runtime || !chrome.runtime.id) return;
    const link = event.target.closest && event.target.closest("a[href]");
    if (!link) return;

    let message = null;
    const match = PDF_LINK.exec(link.href);
    if (match) {
      message = { type: "open-paper", id: match[1], version: match[2] || null };
    } else if (ADS_PDF.test(link.href) && BIBCODE_ONLY.test(decodeURIComponent(ADS_PDF.exec(link.href)[1]))) {
      message = { type: "open-ads", bibcode: decodeURIComponent(ADS_PDF.exec(link.href)[1]), pdf: link.href, ...pageCitation() };
    } else {
      const doi = journalDoi(link);
      if (doi) message = { type: "open-journal", doi, pdf: link.href };
    }
    if (!message) return;

    try {
      chrome.runtime.sendMessage(message);
    } catch (e) {
      return; // extension unavailable: fall back to the normal link behavior
    }
    event.preventDefault();
    event.stopPropagation();
  },
  true
);
