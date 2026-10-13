// Today's arXiv with AI: AI on and agreed to (unless ?off), a research profile in the folder (unless ?noprofile),
// folder access (or ?access: not yet granted), and a fake AI connection.
(() => {
  const q = new URLSearchParams(location.search);
  if (q.has("relevance")) try { localStorage.setItem("todaySort", "relevance"); } catch (e) {} // (layout tests: the rank button is on the page)
  if (q.has("rerank")) { // every paper is scored, by other models (one by an unknown one): the current model is Haiku
    const at = new Date().toISOString();
    chrome.storage.local.set({ aiScores: { stamp: "1234567|2026-10-02T00:00:00Z|abstract", scores: {
      "2610.00002": { s: 90, at, model: "claude-opus-5-5" }, "2610.00003": { s: 50, at }, "2610.00001": { s: 10, at, model: "claude-haiku-5-5" } } } });
    try { localStorage.setItem("todaySort", "relevance"); } catch (e) {}
  }
  window.__papurrTest = true; // (page tests cannot make trusted clicks)
  chrome.storage.local.set({ ai: { enabled: !q.has("off"), consent: { version: AI_CONSENT_VERSION, at: "2026-10-08T00:00:00Z" }, showEstimate: !q.has("noest"), model: "claude-haiku-5-5", effort: "medium", status: { command: "claude", models: [{ id: "claude-haiku-5-5", name: "Haiku 5.5", main: true }] } }, profileSettings: { levelRank: "abstract" } });
  window.PROFILE = { schema: 1, inspireId: 1234567, authorName: "Doe, Jane", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z",
    settings: { months: 24, level: "abstract", add: [], exclude: [] }, covered: ["1"], coveredUntil: "2026-09-01",
    summary: "Works on superconducting qubits and on quantum error correction.", keywords: ["error correction", "qubits"], model: "m", feedback: {}, feedbackUsed: [] };
  if (!q.has("noprofile")) fakeDir.put("papurr-profile.json", JSON.stringify(PROFILE));
  if (q.has("access")) {
    let granted = false;
    fakeDir.queryPermission = async () => (granted ? "granted" : "prompt");
    fakeDir.requestPermission = async () => { granted = true; return "granted"; };
  }
  window.connects = 0; window.lastPort = null; window.nextReply = null; window.hang = false;
  window.fakeConnect = () => {
    connects++;
    const l = { msg: [], disc: [] };
    const p = { sent: null, closed: false, onMessage: { addListener: (f) => l.msg.push(f) }, onDisconnect: { addListener: (f) => l.disc.push(f) },
      postMessage(m) { p.sent = m; if (!hang) setTimeout(() => l.msg.forEach((f) => f(nextReply)), 20); },
      disconnect() { p.closed = true; l.disc.forEach((f) => f()); } };
    return (lastPort = p);
  };
  fakeDir.put("2610.00002.md", "## Notes\n\nmy note\n"); // a paper with a note: a reason is written into it
  window.reasonReply = (text) => ({ ok: true, result: { reason: text }, usage: { input_tokens: 3000, output_tokens: 120 }, durationMs: 3000, models: ["claude-haiku-5-5"] });
  window.scoresReply = (pairs) => ({ ok: true, result: { scores: pairs.map(([id, score]) => ({ id, score })) }, usage: { input_tokens: 2, cache_creation_input_tokens: 3000, cache_read_input_tokens: 0, output_tokens: 60 }, durationMs: 4000, models: ["claude-haiku-5-5"] });
})();
