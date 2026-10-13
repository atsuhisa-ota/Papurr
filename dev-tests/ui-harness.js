// Fake browser environment shared by the UI tests: an in-memory folder and a minimal `chrome` object.
class NotFound extends Error { constructor(n) { super(n + " not found"); this.name = "NotFoundError"; } }
class FakeDir {
  constructor() { this.files = new Map(); this.name = "Papers"; }
  put(name, text) { this.files.set(name, { text, lastModified: Date.now() }); }
  text(name) { return this.files.has(name) ? this.files.get(name).text : null; }
  async queryPermission() { return "granted"; }
  async requestPermission() { return "granted"; }
  async getFileHandle(name, opts = {}) {
    if (!this.files.has(name)) { if (!opts.create) throw new NotFound(name); this.files.set(name, { text: "", lastModified: Date.now() }); }
    const dir = this;
    return { kind: "file", name,
      // (Text is kept as a string; for PDFs each character is one byte.)
      getFile: async () => { const t = dir.files.get(name).text; return { __text: t, size: t.length, text: async () => t, lastModified: dir.files.get(name).lastModified, slice: (a, b) => ({ text: async () => t.slice(a, b) }), arrayBuffer: async () => Uint8Array.from(t, (c) => c.charCodeAt(0)).buffer }; },
      createWritable: async () => { let buf = ""; return { write: async (d) => { buf += d && d.__text !== undefined ? d.__text : d; }, close: async () => { dir.files.set(name, { text: buf, lastModified: Date.now() }); } }; } };
  }
  async removeEntry(name) { if (!this.files.delete(name)) throw new NotFound(name); }
  async *entries() { for (const name of [...this.files.keys()]) yield [name, { kind: "file" }]; }
}
const __store = {};
const __listeners = [];
const __changed = (changes) => __listeners.forEach((f) => f(changes, "local"));
const __lang = new URLSearchParams(location.search).get("lang");
if (__lang) __store.language = __lang;
window.chrome = {
  storage: { local: { get: async (k) => (typeof k === "string" ? { [k]: __store[k] } : Array.isArray(k) ? Object.fromEntries(k.map((x) => [x, __store[x]])) : {}), set: async (o) => { Object.assign(__store, o); __changed(Object.fromEntries(Object.keys(o).map((k) => [k, { newValue: o[k] }]))); }, remove: async (k) => { delete __store[k]; __changed({ [k]: { newValue: undefined } }); } }, onChanged: { addListener: (f) => __listeners.push(f) } },
  runtime: { getManifest: () => ({ version: "9.8.7" }), getPlatformInfo: async () => ({ os: new URLSearchParams(location.search).get("os") || "mac" }), connectNative: (host) => (window.fakeConnect ? window.fakeConnect(host) : (() => { throw new Error("no helper"); })()), sendNativeMessage: async (host, msg) => { (window.helperCalls = window.helperCalls || []).push(msg); return window.helperReply ? window.helperReply(msg) : { ok: true }; } },
  tabs: { getCurrent: async () => null },
};
window.fakeDir = new FakeDir();
window.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
window.results = [];
window.check = (name, cond, extra) => results.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  -> " + (extra || "")));
window.press = (input, text) => { input.value = text; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); };
window.seed = (papers) => fakeDir.put("index.json", JSON.stringify({ schemaVersion: 2, papers }));
window.idx = () => JSON.parse(fakeDir.text("index.json")).papers;
window.entry = (title, extra = {}) => ({ title, authors: ["Ann Smith"], authorCount: 1, added: "2026-01-0" + (1 + (title.length % 8)) + "T00:00:00Z", versions: { v1: title.replace(/\W/g, "") + "v1.pdf" }, ...extra });
// The real navigator.locks needs messages to the browser process, which do not fit the test's virtual clock.
// A plain in-page lock with the same behavior (one holder at a time) is used instead.
(() => {
  const chains = {}; // one queue per lock name, like navigator.locks
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: (name, a, b) => { const fn = b || a; const r = (chains[name] || Promise.resolve()).then(fn); chains[name] = r.catch(() => {}); return r; } } });
})();
// BroadcastChannel goes through the browser process too, and its messages may arrive after the virtual clock has run on.
// An in-page channel with the same behavior (every other open channel of the same name hears a message) is used instead.
(() => {
  const open = [];
  window.BroadcastChannel = class {
    constructor(name) { this.name = name; this.onmessage = null; this.closed = false; open.push(this); }
    postMessage(data) { for (const c of open) if (c !== this && !c.closed && c.name === this.name) setTimeout(() => c.onmessage && c.onmessage({ data }), 0); }
    close() { this.closed = true; }
  };
})();
