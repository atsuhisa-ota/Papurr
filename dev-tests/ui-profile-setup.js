// Settings -> My research: AI switched on and agreed to, a fake INSPIRE, and a fake AI connection.
window.__papurrTest = true; // (page tests cannot make trusted clicks)
chrome.storage.local.set({ ai: { enabled: true, consent: { version: AI_CONSENT_VERSION, at: "2026-10-08T00:00:00Z" } } });
window.inspirePapers = [
  { n: 101, date: "2026-08-10", title: "Qubit coherence from damping", abstract: "We compute the decay of qubit coherence." },
  { n: 102, date: "2026-06-15", title: "Real-time gravitational wave response", abstract: "We study the response of thermal fields." },
  { n: 103, date: "2025-04-08", title: "Graviton stimulated emission", abstract: "Squeezed states emit gravitons." },
  { n: 104, date: "2019-01-01", title: "An old paper", abstract: "Very old." },
];
window.inspireRequests = [];
window.fetch = async (url) => {
  url = String(url);
  inspireRequests.push(url);
  if (url.includes("/api/authors/")) return { ok: true, status: 200, json: async () => ({ metadata: { name: { value: "Doe, Jane" } } }) };
  const hits = inspirePapers.map((p) => ({ id: String(p.n), metadata: { control_number: p.n, titles: [{ title: p.title }], abstracts: [{ source: "arXiv", value: p.abstract }], arxiv_eprints: [{ value: "26" + (p.n % 100) + ".0" + p.n }], earliest_date: p.date } }));
  return { ok: true, status: 200, json: async () => ({ hits: { hits } }) };
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
window.GOOD = (text) => ({ ok: true, result: { summary: text, keywords: ["qubit coherence", "error correction", "thermal field theory"] }, usage: { input_tokens: 2, cache_creation_input_tokens: 2400, cache_read_input_tokens: 0, output_tokens: 300 }, durationMs: 5000, models: ["claude-opus-5-5"] });
