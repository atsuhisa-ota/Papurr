// The note page: a library with a saved paper (no note yet), a paper with only a note, and a journal-only paper.
window.loadDir = async () => {
  if (!fakeDir.files.has("index.json")) {
    fakeDir.put("2301.00001v2.pdf", "%PDF-");
    fakeDir.put("2301.00007 (conflicted copy 2026-10-08).md", "## Notes\n\nwritten on the laptop at the same time\n");
    fakeDir.put("2301.00007.md", "<!-- papurr:head -->\n# Only a note\n<!-- /papurr:head -->\n\n<!-- papurr:reason model=m date=2026-10-01T00:00:00Z -->\nAn old reason.\n<!-- /papurr:reason -->\n\n## Notes\n\nwritten earlier\n");
    fakeDir.put("2301.00009.md", "<!-- papurr:reason model=old-model date=2026-10-01T00:00:00Z -->\nAn old reason.\n<!-- /papurr:reason -->\n\n## Notes\n\nkeep me\n");
    seed({
      "2301.00001": entry("Alpha strings", { versions: { v2: "2301.00001v2.pdf" } }),
      "2301.00007": entry("Only a note", { versions: {}, note: "2301.00007.md" }),
      "doi:10.1/zz": entry("Journal paper", { doi: "10.1/zz", versions: {}, note: "10.1_zz.md" }),
      "2301.00009": entry("Reason paper", { versions: {}, note: "2301.00009.md" }),
      "2301.00011": entry("Summary paper", { versions: { v1: "s1.pdf", v2: "s2.pdf" } }),
    });
    fakeDir.put("10.1_zz.md", "## Notes\n\njournal note\n");
  }
  return fakeDir;
};

// ?ai: AI on and agreed to, a research profile, a reason kept in the browser for 2301.00001, arXiv and the AI faked.
(() => {
  const q = new URLSearchParams(location.search);
  if (!q.has("ai")) return;
  window.__papurrTest = true; // (page tests cannot make trusted clicks)
  chrome.storage.local.set({ ai: { enabled: true, consent: { version: AI_CONSENT_VERSION, at: "2026-10-08T00:00:00Z" }, showEstimate: true, ...(q.has("level") ? { summaryLevel: q.get("level"), summaryNote: "Mention the observational constraints." } : {}), model: "claude-haiku-5-5", effort: "medium", status: { command: "claude", models: [{ id: "claude-haiku-5-5", name: "Haiku 5.5" }] } },
    aiReasons: { "2301.00001": { text: "Asked earlier in Today's arXiv.", at: new Date().toISOString(), model: "claude-haiku-5-5" } } });
  fakeDir.put("papurr-profile.json", JSON.stringify({ schema: 1, inspireId: 1, authorName: "A", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z",
    settings: { months: 24, level: "abstract", add: [], exclude: [] }, covered: [], coveredUntil: "", summary: "Works on quantum devices.", keywords: ["plasma"], model: "m", feedback: {}, feedbackUsed: [] }));
  window.arxivCalls = 0;
  window.htmlCalls = [];
  // arXiv's HTML version, written as arXiv writes it (LaTeXML: formulas with their LaTeX in alttext, figures with captions,
  // a bibliography section); ?nohtml: the paper has none (404); ?long: a long paper.
  const page = `<!DOCTYPE html><html><body><nav class="ltx_page_navbar">Menu</nav><article class="ltx_document">
    <h1 class="ltx_title ltx_title_document">Summary paper</h1><div class="ltx_authors">Ann Smith</div>
    <div class="ltx_abstract"><h6>Abstract</h6><p class="ltx_p">We compute the plasma damping rate <math alttext="\\gamma" display="inline"><mi>γ</mi></math>.</p></div>
    <section class="ltx_section"><h2 class="ltx_title">1 Introduction</h2><div class="ltx_para"><p class="ltx_p">The rate is
    <math alttext="\\gamma=\\omega^{2}" display="block"><mrow>γ=ω2</mrow></math> as shown.</p></div>
    <figure class="ltx_figure"><img src="x1.png"><figcaption class="ltx_caption">Figure 1: The rate <math alttext="\\gamma(k)" display="inline"><mi>γ</mi></math>.</figcaption></figure>
    <div class="ltx_para"><p class="ltx_p">${q.has("long") ? "More words about the computation. ".repeat(6000) : "Words. ".repeat(60)}</p></div></section>
    <section class="ltx_bibliography"><h2>References</h2><ul><li>A. Author, Some reference.</li></ul></section></article></body></html>`;
  window.fetch = async (url) => {
    if (String(url).includes("arxiv.org/html/")) {
      htmlCalls.push(String(url));
      return q.has("nohtml") ? { ok: false, status: 404, text: async () => "" } : { ok: true, status: 200, text: async () => page };
    }
    arxivCalls++;
    const id = decodeURIComponent(/id_list=([^&]*)/.exec(url)[1]);
    return { ok: true, status: 200, text: async () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/${id}v1</id><published>2026-10-01T00:00:00Z</published><title>Reason paper</title><summary>We study plasma waves.</summary><author><name>Ann</name></author></entry></feed>` };
  };
  window.connects = 0; window.lastPort = null; window.nextReply = null; window.hang = false;
  window.fakeConnect = () => {
    connects++;
    const l = { msg: [], disc: [] };
    const p = { sent: null, closed: false, onMessage: { addListener: (f) => l.msg.push(f) }, onDisconnect: { addListener: (f) => l.disc.push(f) },
      postMessage(m) { p.sent = m; if (!hang) setTimeout(() => l.msg.forEach((f) => f(nextReply)), 20); },
      disconnect() { p.closed = true; l.disc.forEach((f) => f()); } };
    return (lastPort = p);
  };
})();
