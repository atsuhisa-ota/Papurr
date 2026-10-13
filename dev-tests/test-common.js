const fs = require("fs"), vm = require("vm"), assert = require("assert");
let src = fs.readFileSync(require("path").join(__dirname, "..", "extension", "common.js"), "utf8");
const waitLine = "const wait = (ms) => new Promise((r) => setTimeout(r, ms));";
assert(src.includes(waitLine));
src = src.replace(waitLine, "const wait = (ms) => Promise.resolve(); // tests: no real pauses");

// ---- fakes ----
class NotFound extends Error { constructor(n) { super(n + " not found"); this.name = "NotFoundError"; } }
class FakeDir {
  constructor() { this.files = new Map(); this.writes = []; }
  put(name, text, lastModified = Date.now()) { this.files.set(name, { text, lastModified }); }
  text(name) { return this.files.has(name) ? this.files.get(name).text : null; }
  async getFileHandle(name, opts = {}) {
    if (!this.files.has(name)) { if (!opts.create) throw new NotFound(name); this.files.set(name, { text: "", lastModified: Date.now() }); }
    const dir = this;
    return {
      kind: "file", name,
      getFile: async () => ({ text: async () => dir.files.get(name).text, lastModified: dir.files.get(name).lastModified }),
      createWritable: async () => { let buf = ""; return { write: async (d) => { buf += d; }, close: async () => { dir.files.set(name, { text: buf, lastModified: Date.now() }); dir.writes.push(name); } }; },
    };
  }
  async removeEntry(name) { if (!this.files.delete(name)) throw new NotFound(name); }
  async *entries() { for (const name of [...this.files.keys()]) yield [name, { kind: "file" }]; }
}
const chains = {}; // a simple lock per name: one holder at a time, like navigator.locks
const store = {};
const ctx = vm.createContext({
  console, setTimeout, clearTimeout, AbortController, Math, JSON, Date, Object, Array, Map, Set, Promise, TextEncoder, Error, parseInt, String, RegExp,
  navigator: { locks: { request: (name, a, b) => { const fn = b || a; const r = (chains[name] || Promise.resolve()).then(fn); chains[name] = r.catch(() => {}); return r; } } },
  chrome: { storage: { local: { get: async (k) => (typeof k === "string" ? { [k]: store[k] } : {}), set: async (o) => Object.assign(store, o) } } },
});
vm.runInContext(require("fs").readFileSync(require("path").join(__dirname, "..", "extension", "i18n.js"), "utf8"), ctx);
vm.runInContext(src, ctx);
const run = (code) => vm.runInContext(code, ctx);
const g = (name) => run(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
assert.deepStrictEqual = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b)); // data from the sandbox has other prototypes
async function test(name, fn) { try { await fn(); results.push("ok   " + name); } catch (e) { results.push("FAIL " + name + "\n     " + e.stack.split("\n").slice(0, 3).join("\n     ")); process.exitCode = 1; } }
const E = (extra = {}) => ({ title: "T", authors: ["A B"], authorCount: 1, added: "2026-01-01T00:00:00Z", versions: { v1: "2301.00001v1.pdf" }, ...extra });

(async () => {
  await test("ADS bibcodes: title from Crossref, only when volume, page and initial match; Update index fills empty titles", async () => {
    const works = [
      { DOI: "10.1086/181927", volume: "201", page: "L1-L5", title: ["Ionized intracluster gas"], author: [{ given: "P.", family: "Crane" }] },
      { DOI: "10.1086/153900", volume: "201", page: "10-20", title: ["Wrong page"], author: [{ given: "X.", family: "Cole" }] },
      { DOI: "10.1086/153853", volume: "201", page: "1", title: ["The primordial <i>black hole</i> mass spectrum"], author: [{ given: "B. J.", family: "Carr" }], "container-title": ["The Astrophysical Journal"] },
    ];
    const urls = [];
    ctx.fetch = async (url) => { urls.push(url); return { ok: true, json: async () => ({ message: { items: works } }) }; };
    const m = await g("fetchBibcodeMetadata")("1975ApJ...201....1C");
    assert.deepStrictEqual([m.title, m.authors, m.doi, m.journalName], ["The primordial black hole mass spectrum", ["B. J. Carr"], "10.1086/153853", "The Astrophysical Journal"]);
    assert.ok(decodeURIComponent(urls[0]).includes("issn:0004-637X") && decodeURIComponent(urls[0]).includes("from-pub-date:1975"));
    assert.strictEqual((await g("fetchBibcodeMetadata")("1975ApJ...201L...1C")).doi, "10.1086/181927", "a letter: page L1");
    assert.strictEqual(await g("fetchBibcodeMetadata")("1975ApJ...201....1D"), null, "another first author");
    assert.strictEqual(await g("fetchBibcodeMetadata")("1975ApJ...202....1C"), null, "another volume");
    const d = await setup(["1975ApJ...201....1C.pdf"], { "ads:1975ApJ...201....1C": E({ title: "", authors: [], authorCount: 0, versions: {}, journal: { file: "1975ApJ...201....1C.pdf", bibcode: "1975ApJ...201....1C" } }) });
    ctx.fetchMetadataBatch = async () => new Map();
    const r = await g("rebuildIndex")(d, {});
    const e = (await g("readIndex")(d))["ads:1975ApJ...201....1C"];
    assert.deepStrictEqual([e.title, e.authors, e.doi, r.refreshed], ["The primordial black hole mass spectrum", ["B. J. Carr"], "10.1086/153853", 1]);
    delete ctx.fetch;
  });

  await test("arXiv batch lookup: an answer without entries, or not a feed, counts as a failed request", async () => {
    const real = ctx.fetchMetadataBatch;
    delete ctx.fetchMetadataBatch;
    vm.runInContext(src.slice(src.indexOf("async function fetchMetadataBatch"), src.indexOf("// Guess the arXiv ID and version")), ctx);
    for (const body of ["Rate exceeded.", '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>']) {
      ctx.fetch = async () => ({ ok: true, status: 200, text: async () => body });
      ctx.DOMParser = class { parseFromString(t) { return { querySelector: (s) => (s === "feed" ? (t.includes("<feed") ? {} : null) : null), querySelectorAll: () => [] }; } };
      await assert.rejects(g("fetchMetadataBatch")(["2610.10589"]));
    }
    delete ctx.fetch; delete ctx.DOMParser;
    ctx.fetchMetadataBatch = real;
  });

  await test("odd values in index.json are put right when read (one odd entry cannot stop the library); nothing usable is lost", async () => {
    const papers = g("parseIndexText")(JSON.stringify({ schemaVersion: 3, papers: {
      a: { title: 12345, authors: "Single Author", authorCount: "1", tags: "loose", added: "2026-01-01T00:00:00Z", versions: { v1: "a.pdf", v2: 99 } },
      b: { title: null, authors: [42, null, "Real Name"], authorCount: 1, tags: [null, "x"], versions: [], journal: { name: "J" }, note: 7, doi: false },
      c: { title: "Fine", authors: ["A B"], authorCount: 5, tags: ["t"], added: "2026-01-02T00:00:00Z", versions: { v1: "c.pdf" }, journal: { file: "j.pdf", name: "JHEP", year: 2024 }, note: "c.md", doi: "10.1/c" },
    } }));
    assert.deepStrictEqual(papers.a, { title: "12345", authors: ["Single Author"], authorCount: 1, tags: ["loose"], added: "2026-01-01T00:00:00Z", versions: { v1: "a.pdf" } });
    assert.deepStrictEqual(papers.b, { title: "", authors: ["42", "Real Name"], authorCount: 2, tags: ["x"], versions: {} });
    assert.deepStrictEqual(papers.c, { title: "Fine", authors: ["A B"], authorCount: 5, tags: ["t"], added: "2026-01-02T00:00:00Z", versions: { v1: "c.pdf" }, journal: { file: "j.pdf", name: "JHEP", year: 2024 }, note: "c.md", doi: "10.1/c" }, "a correct entry is left exactly as it is");
  });

  await test("arXiv API: one request at a time and three seconds apart, for all pages together (time shared through storage)", async () => {
    const log = [], pauses = [];
    let clock = 1000000;
    const realNow = Date.now;
    ctx.Date.now = () => clock;
    ctx.arxivPause = async (ms) => { pauses.push(ms); clock += ms; };
    let open = 0, most = 0;
    ctx.fetch = async (url) => { open++; most = Math.max(most, open); log.push([url, clock]); await sleep(5); clock += 100; open--; return { ok: true }; };
    delete store.arxivLastRequest;
    await Promise.all(["a", "b", "c"].map((u) => g("arxivApiFetch")(u)));
    assert.strictEqual(most, 1, "never two connections at once");
    assert.deepStrictEqual(log.map((l) => l[0]), ["a", "b", "c"]);
    assert.ok(log[1][1] - log[0][1] >= 3000 && log[2][1] - log[1][1] >= 3000, JSON.stringify(log));
    store.arxivLastRequest = clock - 1000; // another tab asked one second ago
    pauses.length = 0;
    await g("arxivApiFetch")("d");
    assert.deepStrictEqual(pauses, [2000], "waits for the rest of the three seconds");
    store.arxivLastRequest = clock + 3600000; // a clock set back: never waits longer than three seconds
    pauses.length = 0;
    await g("arxivApiFetch")("e");
    assert.ok(pauses[0] <= 3000);
    ctx.Date.now = realNow;
    delete ctx.arxivPause; delete ctx.fetch;
    vm.runInContext("function arxivPause(ms) { return wait(ms); }", ctx);
  });

  await test("INSPIRE badge: default label, and a saved copy of the list with the old label is updated", async () => {
    assert.strictEqual((await g("getDbLinks")()).find((l) => l.host === "inspirehep.net").label, "INSPIRE");
    store.dbLinks = [{ host: "inspirehep.net", name: "INSPIRE", label: "iN", color: "#1f5fa8", template: "x{id}" }, { host: "a.org", name: "A", label: "iN", color: "#000", template: "y{id}" }];
    const links = await g("getDbLinks")();
    assert.deepStrictEqual(links.map((l) => l.label), ["INSPIRE", "iN"]); // only INSPIRE's own icon is changed
    delete store.dbLinks;
  });

  await test("empty folder reads as empty index", async () => { assert.deepStrictEqual(await g("readIndex")(new FakeDir()), {}); });

  await test("legacy index (plain map, {file}) is read and migrated", async () => {
    const d = new FakeDir();
    d.put("index.json", JSON.stringify({ "2301.00001": { title: "X", file: "2301.00001v2.pdf" }, "hep-th/9901001": { title: "Y", file: "weird.pdf" } }));
    const idx = await g("readIndex")(d);
    assert.deepStrictEqual(idx["2301.00001"].versions, { v2: "2301.00001v2.pdf" });
    assert.deepStrictEqual(idx["hep-th/9901001"].versions, { unversioned: "weird.pdf" });
  });

  await test("updateIndex writes the new format, and skips writing when nothing changed", async () => {
    const d = new FakeDir();
    await g("updateIndex")(d, (p) => { p["1"] = E(); });
    const saved = JSON.parse(d.text("index.json"));
    assert.strictEqual(saved.schemaVersion, 3); assert.ok(saved.papers["1"]);
    const n = d.writes.length;
    await g("updateIndex")(d, () => {});
    assert.strictEqual(d.writes.length, n, "no write expected");
  });

  await test("damaged index is never overwritten and raises IndexError(damaged)", async () => {
    const d = new FakeDir(); d.put("index.json", "{ this is not json");
    await assert.rejects(g("updateIndex")(d, (p) => { p.x = E(); }), (e) => e.name === "IndexError" && e.kind === "damaged");
    assert.strictEqual(d.text("index.json"), "{ this is not json");
    d.put("index.json", ""); // empty file (e.g. interrupted sync)
    await assert.rejects(g("readIndex")(d), (e) => e.kind === "damaged");
    d.put("index.json", JSON.stringify({ schemaVersion: 2, papers: [] }));
    await assert.rejects(g("readIndex")(d), (e) => e.kind === "damaged");
  });

  await test("index from a newer extension version is refused", async () => {
    const d = new FakeDir(); d.put("index.json", JSON.stringify({ schemaVersion: 99, papers: {} }));
    await assert.rejects(g("updateIndex")(d, (p) => { p.x = E(); }), (e) => e.kind === "newer");
    assert.ok(d.text("index.json").includes("99"));
  });

  await test("backup: made from the readable index, refreshed at most once a day", async () => {
    const d = new FakeDir();
    await g("updateIndex")(d, (p) => { p["1"] = E(); });
    assert.strictEqual(d.text("index.json.bak"), null, "no backup of a file that did not exist");
    await g("updateIndex")(d, (p) => { p["2"] = E(); });
    const bak1 = d.text("index.json.bak");
    assert.ok(bak1 && !JSON.parse(bak1).papers["2"] && JSON.parse(bak1).papers["1"]);
    await g("updateIndex")(d, (p) => { p["3"] = E(); });
    assert.strictEqual(d.text("index.json.bak"), bak1, "not refreshed within a day");
    d.files.get("index.json.bak").lastModified = Date.now() - 25 * 3600 * 1000;
    await g("updateIndex")(d, (p) => { p["4"] = E(); });
    assert.ok(JSON.parse(d.text("index.json.bak")).papers["3"], "refreshed after a day");
  });

  await test("restore from backup keeps the damaged file aside; reset starts empty", async () => {
    const d = new FakeDir();
    await g("updateIndex")(d, (p) => { p["1"] = E(); });
    await g("updateIndex")(d, (p) => { p["2"] = E(); });
    d.put("index.json", "garbage");
    assert.strictEqual(await g("hasBackup")(d), true);
    await g("restoreIndexBackup")(d);
    assert.strictEqual(d.text("index.damaged.json"), "garbage");
    assert.deepStrictEqual(Object.keys(await g("readIndex")(d)), ["1"]);
    d.put("index.json", "garbage2");
    await g("resetIndex")(d);
    assert.deepStrictEqual(await g("readIndex")(d), {});
    assert.strictEqual(d.text("index.damaged.json"), "garbage2");
  });

  await test("20 simultaneous updates lose nothing", async () => {
    const d = new FakeDir();
    await Promise.all(Array.from({ length: 20 }, (_, i) => g("updateIndex")(d, async (p) => { await sleep(Math.random() * 5); p["k" + i] = E(); })));
    assert.strictEqual(Object.keys(await g("readIndex")(d)).length, 20);
  });

  await test("sync conflict copies are merged entry by entry and then removed", async () => {
    const d = new FakeDir();
    d.put("index.json", JSON.stringify({ schemaVersion: 2, papers: {
      A: E({ tags: ["old"], modified: "2026-02-01T00:00:00Z" }),
      B: E({ versions: { v1: "b1.pdf" }, modified: "2026-02-01T00:00:00Z" }),
    } }));
    d.put("index (conflicted copy 2026-10-08).json", JSON.stringify({ schemaVersion: 2, papers: {
      A: E({ tags: ["new", "x"], modified: "2026-03-01T00:00:00Z" }),
      B: E({ versions: { v2: "b2.pdf" }, modified: "2026-01-15T00:00:00Z" }),
      C: E(),
    } }));
    d.put("index.sync-conflict-20261008.json", JSON.stringify({ A: { title: "legacy", file: "a.pdf" } })); // legacy format copy
    d.put("index-notes.json", "my own notes, not an index");
    d.put("index.damaged.json", "x"); d.put("index.json.bak", "x");
    const n = await g("mergeConflictCopies")(d);
    assert.strictEqual(n, 2);
    const idx = await g("readIndex")(d);
    assert.deepStrictEqual(idx.A.tags, ["new", "x"]);
    assert.deepStrictEqual(Object.keys(idx.B.versions).sort(), ["v1", "v2"]);
    assert.ok(idx.C);
    assert.strictEqual(d.text("index (conflicted copy 2026-10-08).json"), null);
    assert.strictEqual(d.text("index.sync-conflict-20261008.json"), null);
    assert.strictEqual(d.text("index-notes.json"), "my own notes, not an index", "foreign file untouched");
    assert.ok(d.text("index.damaged.json") && d.text("index.json.bak"));
  });

  await test("merge: newer side removing all tags is respected", async () => {
    const me = g("mergeEntries");
    const m = me(E({ tags: ["a"], modified: "2026-01-01" }), E({ modified: "2026-02-01" }));
    assert.strictEqual(m.tags, undefined);
    const m2 = me(E({ tags: ["a"], modified: "2026-03-01" }), E({ modified: "2026-02-01" }));
    assert.deepStrictEqual(m2.tags, ["a"]);
  });

  await test("file name helpers", async () => {
    const pf = g("parseFileName");
    assert.deepStrictEqual(pf("2301.12345v2.pdf"), { id: "2301.12345", version: "v2" });
    assert.deepStrictEqual(pf("hep-th_9901001.pdf"), { id: "hep-th/9901001", version: null });
    assert.strictEqual(pf("10.1007_JHEP01(2023)001.pdf"), null);
    const jf = g("journalFileName");
    assert.strictEqual(jf("10.1007/jhep01(2023)001"), "10.1007_jhep01(2023)001.pdf");
    const long = jf("10.1000/" + "a".repeat(300));
    assert.ok(long.length < 120 && long.endsWith(".pdf"));
    assert.notStrictEqual(jf("10.1000/" + "a".repeat(300)), jf("10.1000/" + "a".repeat(299) + "b"));
    assert.ok(!/[\\/:*?"<>|]/.test(jf('10.1/a:b*c?"d<e>f|g')));
    const key = g("arxivSortKey");
    assert.ok(key("0704.0001") < key("2301.12345") && key("hep-th/9901001") < key("0704.0001"));
  });

  await test("last-opened is kept in browser storage, not in the index", async () => {
    await g("markOpened")("2301.00001");
    assert.ok((await g("getOpenedMap")())["2301.00001"]);
  });

  // ---- rebuild ----
  const mkMeta = (t) => ({ title: t, authors: ["Z"], authorCount: 1, doi: "", latestVersion: "v1" });
  async function setup(files, papers) {
    const d = new FakeDir();
    for (const f of files) d.put(f, "%PDF-");
    d.put("index.json", JSON.stringify({ schemaVersion: 2, papers }));
    return d;
  }

  await test("rebuild: adds new PDFs (batched lookup), removes few missing files without asking", async () => {
    const d = await setup(["2301.00001v1.pdf", "2301.00002v1.pdf", "2301.00002v2.pdf", "10.1_x.pdf", "random.pdf"], { "2301.00001": E(), "2301.99999": E({ versions: { v1: "gone.pdf" } }) });
    ctx.fetchMetadataBatch = async (ids) => new Map(ids.map((id) => [id, mkMeta("Title " + id)]));
    let asked = 0;
    const r = await g("rebuildIndex")(d, { confirmRemoval: () => { asked++; return true; } });
    assert.strictEqual(asked, 0);
    const idx = await g("readIndex")(d);
    assert.deepStrictEqual(Object.keys(idx).sort(), ["2301.00001", "2301.00002"]);
    assert.strictEqual(idx["2301.00002"].title, "Title 2301.00002");
    assert.deepStrictEqual(Object.keys(idx["2301.00002"].versions).sort(), ["v1", "v2"]);
    assert.strictEqual(r.added, 2); assert.strictEqual(r.removed, 1);
  });

  await test("rebuild: many missing files (cloud still syncing) -> asks, 'keep' keeps entries and tags", async () => {
    const papers = {}; for (let i = 0; i < 10; i++) papers["p" + i] = E({ versions: { v1: "f" + i + ".pdf" }, tags: ["keepme"] });
    const d = await setup([], papers);
    let asked = 0;
    await g("rebuildIndex")(d, { confirmRemoval: (n, t) => { asked++; assert.strictEqual(n, 10); return false; } });
    assert.strictEqual(asked, 1);
    const idx = await g("readIndex")(d);
    assert.strictEqual(Object.keys(idx).length, 10); assert.deepStrictEqual(idx.p0.tags, ["keepme"]);
    await g("rebuildIndex")(d, { confirmRemoval: () => true });
    assert.strictEqual(Object.keys(await g("readIndex")(d)).length, 0);
  });

  await test("rebuild: fills in empty titles; failed lookups add nothing; cancel adds nothing new", async () => {
    const d = await setup(["2301.00001v1.pdf", "2301.00005v1.pdf"], { "2301.00001": E({ title: "" }) });
    ctx.fetchMetadataBatch = async () => { throw new Error("offline"); };
    let r = await g("rebuildIndex")(d, {});
    let idx = await g("readIndex")(d);
    assert.strictEqual(idx["2301.00001"].title, ""); assert.ok(!idx["2301.00005"]); assert.strictEqual(r.failedBatches, 1);
    ctx.fetchMetadataBatch = async (ids) => new Map(ids.map((id) => [id, mkMeta("Got " + id)]));
    r = await g("rebuildIndex")(d, {});
    idx = await g("readIndex")(d);
    assert.strictEqual(idx["2301.00001"].title, "Got 2301.00001"); assert.strictEqual(idx["2301.00005"].title, "Got 2301.00005"); assert.strictEqual(r.refreshed, 1);
    const d2 = await setup(["2301.00007v1.pdf"], {});
    r = await g("rebuildIndex")(d2, { isCancelled: () => true });
    assert.strictEqual(r.cancelled, true); assert.deepStrictEqual(await g("readIndex")(d2), {});
  });

  await test("rebuild: more than 50 new papers use several batches", async () => {
    const files = Array.from({ length: 120 }, (_, i) => "2301." + String(i + 1).padStart(5, "0") + "v1.pdf");
    const d = await setup(files, {});
    const sizes = [];
    ctx.fetchMetadataBatch = async (ids) => { sizes.push(ids.length); return new Map(ids.map((id) => [id, mkMeta(id)])); };
    await g("rebuildIndex")(d, {});
    assert.deepStrictEqual(sizes, [50, 50, 20]);
    assert.strictEqual(Object.keys(await g("readIndex")(d)).length, 120);
  });

  await test("rebuild merges conflict copies first", async () => {
    const d = await setup([], {});
    d.put("index (1).json", JSON.stringify({ schemaVersion: 2, papers: { Q: E({ versions: { v1: "q.pdf" } }) } }));
    d.put("q.pdf", "%PDF-");
    ctx.fetchMetadataBatch = async () => new Map();
    await g("rebuildIndex")(d, {});
    assert.ok((await g("readIndex")(d)).Q);
    assert.strictEqual(d.text("index (1).json"), null);
  });

  // ---- schema 3 (notes) ----
  await test("schema: a version-2 index is read and written back as version 3", async () => {
    const d = new FakeDir();
    d.put("index.json", JSON.stringify({ schemaVersion: 2, papers: { "2301.00001": E() } }));
    await g("updateIndex")(d, (p) => { p["2301.00001"].tags = ["x"]; });
    const saved = JSON.parse(d.text("index.json"));
    assert.strictEqual(saved.schemaVersion, 3); assert.deepStrictEqual(saved.papers["2301.00001"].tags, ["x"]);
  });

  await test("schema: an older Papurr (schema 2) refuses a version-3 index and leaves it alone", async () => {
    const oldSrc = src.replace("const SCHEMA_VERSION = 3;", "const SCHEMA_VERSION = 2;");
    assert.notStrictEqual(oldSrc, src);
    const old = vm.createContext({ ...ctx });
    vm.runInContext(fs.readFileSync(require("path").join(__dirname, "..", "extension", "i18n.js"), "utf8"), old);
    vm.runInContext(oldSrc, old);
    const d = new FakeDir();
    const text = JSON.stringify({ schemaVersion: 3, papers: { "2301.00001": E({ versions: {}, note: "2301.00001.md" }) } });
    d.put("index.json", text);
    await assert.rejects(vm.runInContext("updateIndex", old)(d, (p) => { delete p["2301.00001"]; }), (e) => e.kind === "newer");
    assert.strictEqual(d.text("index.json"), text);
  });

  // ---- note files ----
  await test("note file names: arXiv number without version, old-style IDs, journal-only papers", async () => {
    const nf = g("noteFileName"), back = g("noteNameToId");
    assert.strictEqual(nf("2301.12345"), "2301.12345.md");
    assert.strictEqual(nf("hep-th/9901001"), "hep-th_9901001.md");
    assert.strictEqual(nf("doi:10.1007/jhep01(2023)001", { doi: "10.1007/jhep01(2023)001" }), "10.1007_jhep01(2023)001.md");
    assert.strictEqual(back("2301.12345.md"), "2301.12345");
    assert.strictEqual(back("hep-th_9901001.md"), "hep-th/9901001");
    assert.strictEqual(back("README.md"), null); assert.strictEqual(back("2301.12345v2.pdf"), null);
  });

  const NOTE = ["<!-- papurr:head -->", "# A title", "", "Ann · [arXiv:2301.00001](https://arxiv.org/abs/2301.00001)", "<!-- /papurr:head -->", "",
    "<!-- papurr:summary model=sonnet date=2026-10-09T10:00:00Z version=v2 -->", "## Summary", "", "It is *good*.", "<!-- /papurr:summary -->", "",
    "## Notes", "", "My thoughts.", "", "<!-- not papurr -->", "- point"].join("\n") + "\n";

  await test("notes: Papurr's blocks and the user's text are told apart, and written back unchanged", async () => {
    const n = g("parseNote")(NOTE);
    assert.deepStrictEqual(Object.keys(n.blocks), ["head", "summary"]);
    assert.deepStrictEqual(n.blocks.summary.attrs, { model: "sonnet", date: "2026-10-09T10:00:00Z", version: "v2" });
    assert.strictEqual(n.blocks.summary.body, "## Summary\n\nIt is *good*.");
    assert.strictEqual(g("noteUserBody")(n.user), "My thoughts.\n\n<!-- not papurr -->\n- point");
    assert.strictEqual(g("buildNote")(n), NOTE);
    assert.strictEqual(g("buildNote")(g("parseNote")(NOTE.replace(/\n/g, "\r\n"))), NOTE, "Windows line ends are read too");
  });

  await test("notes: text Papurr is not sure about stays the user's (marker without end, second block of a name)", async () => {
    const t = "<!-- papurr:summary -->\nhalf a block, end marker deleted by the user\n\n## Notes\n\nmine\n";
    const n = g("parseNote")(t);
    assert.deepStrictEqual(Object.keys(n.blocks), []);
    assert.ok(n.user.includes("half a block") && n.user.includes("<!-- papurr:summary -->"));
    const two = "<!-- papurr:reason -->\nA\n<!-- /papurr:reason -->\n<!-- papurr:reason -->\nB\n<!-- /papurr:reason -->\n";
    const m = g("parseNote")(two);
    assert.strictEqual(m.blocks.reason.body, "A"); assert.ok(m.user.includes("B"));
    // replacing a block keeps every character of the user's text
    const k = g("parseNote")(NOTE); k.blocks.summary = { attrs: { date: "2026-10-10" }, body: "New summary" };
    const out = g("buildNote")(k);
    assert.ok(out.includes("New summary") && !out.includes("It is *good*") && out.endsWith("## Notes\n\nMy thoughts.\n\n<!-- not papurr -->\n- point\n"));
  });

  await test("notes: the user's section keeps its heading; new notes get one in the UI language", async () => {
    assert.strictEqual(g("withNoteBody")("## メモ\n\nold", "new text\n\n"), "## メモ\n\nnew text");
    assert.strictEqual(g("withNoteBody")("", ""), "## Notes");
    assert.strictEqual(g("noteUserBody")("no heading here"), "no heading here");
    const fresh = g("buildNote")(g("newNote")("2301.00001", { title: "T", authors: ["A", "B"], authorCount: 9 }));
    assert.ok(fresh.startsWith("<!-- papurr:head -->\n# T\n\nA, B, et al. · [arXiv:2301.00001](https://arxiv.org/abs/2301.00001)\n<!-- /papurr:head -->\n\n## Notes\n"), fresh);
  });

  await test("notes: merging two notes keeps both user texts and the newer of Papurr's blocks", async () => {
    const P = (s) => g("parseNote")(s);
    const a = P("<!-- papurr:summary date=2026-01-01 -->\nold\n<!-- /papurr:summary -->\n\n## Notes\n\nfrom arXiv side");
    const b = P("<!-- papurr:summary date=2026-05-01 -->\nnew\n<!-- /papurr:summary -->\n<!-- papurr:reason date=2026-02-01 -->\nwhy\n<!-- /papurr:reason -->\n\n## Notes\n\nfrom DOI side");
    const m = g("mergeNotes")(a, b);
    assert.strictEqual(m.blocks.summary.body, "new"); assert.strictEqual(m.blocks.reason.body, "why");
    assert.strictEqual(g("noteUserBody")(m.user), "from arXiv side\n\nfrom DOI side");
    const same = g("mergeNotes")(P("## Notes\n\nsame"), P("## Notes\n\nsame"));
    assert.strictEqual(g("noteUserBody")(same.user), "same", "identical texts are not doubled");
  });

  await test("ensureNote: creates the note once, records it in the index, never overwrites; unknown paper -> null", async () => {
    const d = new FakeDir();
    d.put("index.json", JSON.stringify({ schemaVersion: 2, papers: { "2301.00001": E() } }));
    assert.strictEqual(await g("ensureNote")(d, "2301.00001"), "2301.00001.md");
    assert.ok(d.text("2301.00001.md").includes("# T"));
    assert.strictEqual((await g("readIndex")(d))["2301.00001"].note, "2301.00001.md");
    d.put("2301.00001.md", "## Notes\n\nkeep me\n");
    await g("ensureNote")(d, "2301.00001");
    assert.strictEqual(d.text("2301.00001.md"), "## Notes\n\nkeep me\n");
    assert.strictEqual(await g("ensureNote")(d, "9999.99999"), null);
    assert.strictEqual(d.text("9999.99999.md"), null);
  });

  await test("editNote: works on the file as it is now and leaves the user's text alone", async () => {
    const d = new FakeDir();
    d.put("n.md", NOTE.replace("My thoughts.", "Written on another computer."));
    await g("editNote")(d, "n.md", (n) => { n.blocks.reason = { attrs: { date: "2026-10-09" }, body: "Because." }; });
    const t = d.text("n.md");
    assert.ok(t.includes("Written on another computer.") && t.includes("Because.") && t.indexOf("papurr:reason") < t.indexOf("papurr:summary"));
    const writes = d.writes.length;
    await g("editNote")(d, "n.md", () => {});
    assert.strictEqual(d.writes.length, writes, "no change, no write");
    assert.strictEqual(await g("editNote")(d, "missing.md", () => {}), null);
  });

  await test("absorbDoiEntry: the journal-only paper's journal PDF, tags and note move to the arXiv entry", async () => {
    const d = new FakeDir();
    d.put("10.1_x.md", "<!-- papurr:summary date=2026-03-01 -->\nS\n<!-- /papurr:summary -->\n\n## Notes\n\njournal-era note\n");
    const papers = { "doi:10.1/x": E({ versions: {}, doi: "10.1/x", tags: ["a"], journal: { file: "10.1_x.pdf", doi: "10.1/x" }, note: "10.1_x.md" }), "2301.00001": E({ tags: ["b"], doi: "10.1/x" }) };
    await g("absorbDoiEntry")(d, papers, "2301.00001", "10.1/x");
    const e = papers["2301.00001"];
    assert.ok(!papers["doi:10.1/x"]); assert.strictEqual(e.journal.file, "10.1_x.pdf"); assert.deepStrictEqual(e.tags, ["b", "a"]);
    assert.strictEqual(e.note, "2301.00001.md"); assert.strictEqual(d.text("10.1_x.md"), null);
    assert.ok(d.text("2301.00001.md").includes("journal-era note") && d.text("2301.00001.md").includes("[arXiv:2301.00001]"));
    // an arXiv-named note exists already (e.g. made on another computer): merged, nothing lost
    const d2 = new FakeDir();
    d2.put("10.1_x.md", "## Notes\n\nfrom the DOI note\n");
    d2.put("2301.00001.md", "## Notes\n\nfrom the arXiv note\n");
    const p2 = { "doi:10.1/x": E({ versions: {}, doi: "10.1/x", note: "10.1_x.md" }), "2301.00001": E({ note: "2301.00001.md" }) };
    await g("absorbDoiEntry")(d2, p2, "2301.00001", "10.1/x");
    assert.ok(d2.text("2301.00001.md").includes("from the DOI note") && d2.text("2301.00001.md").includes("from the arXiv note"));
    assert.strictEqual(d2.text("10.1_x.md"), null);
    // writing fails: the note stays where it was, and the index says so
    const d3 = new FakeDir();
    d3.put("10.1_x.md", "## Notes\n\nprecious\n");
    const realGet = d3.getFileHandle.bind(d3);
    d3.getFileHandle = async (name, o) => { if (name === "2301.00001.md" && o && o.create) throw new Error("disk full"); return realGet(name, o); };
    const p3 = { "doi:10.1/x": E({ versions: {}, doi: "10.1/x", note: "10.1_x.md" }), "2301.00001": E() };
    await g("absorbDoiEntry")(d3, p3, "2301.00001", "10.1/x");
    assert.strictEqual(p3["2301.00001"].note, "10.1_x.md"); assert.strictEqual(d3.text("10.1_x.md"), "## Notes\n\nprecious\n");
  });

  await test("merge of index copies keeps the note name when only one side has it", async () => {
    const m = g("mergeEntries")(E({ note: "2301.00001.md", modified: "2026-01-01" }), E({ tags: ["t"], modified: "2026-02-01" }));
    assert.strictEqual(m.note, "2301.00001.md"); assert.deepStrictEqual(m.tags, ["t"]);
  });

  await test("rebuild: notes count as files (note-only papers stay; missing notes are dropped; arXiv-named notes are picked up)", async () => {
    const d = await setup(["2301.00001.md", "2301.00002.md", "2301.00004.md", "2301.00005.md", "README.md", "2301.00006v1.pdf"], {
      "2301.00001": E({ versions: {}, note: "2301.00001.md" }), // note only
      "2301.00002": E({ versions: { v1: "gone.pdf" }, note: "2301.00002.md", tags: ["keep"] }), // PDF deleted by hand, note left
      "2301.00003": E({ versions: {}, note: "2301.00003.md" }), // note deleted by hand, nothing left
      "2301.00004": E({ versions: { v1: "2301.00006v1.pdf" } }), // note made elsewhere, flag missing
    });
    ctx.fetchMetadataBatch = async (ids) => new Map(ids.map((id) => [id, mkMeta("Title " + id)]));
    await g("rebuildIndex")(d, {});
    const idx = await g("readIndex")(d);
    assert.deepStrictEqual(Object.keys(idx).sort(), ["2301.00001", "2301.00002", "2301.00004", "2301.00005"]);
    assert.deepStrictEqual(idx["2301.00002"].versions, {}); assert.deepStrictEqual(idx["2301.00002"].tags, ["keep"]);
    assert.strictEqual(idx["2301.00004"].note, "2301.00004.md");
    assert.strictEqual(idx["2301.00005"].note, "2301.00005.md"); assert.strictEqual(idx["2301.00005"].title, "Title 2301.00005");
    assert.ok(!JSON.stringify(idx).includes("README"));
  });

  await test("conflict copies of a note made by cloud services are recognized (and nothing else)", async () => {
    const files = ["2301.12345.md", "2301.12345 (conflicted copy 2026-10-08).md", "2301.12345 (1).md", "2301.12345 2.md", "2301.12345.sync-conflict-20261008-1200-ABC.md",
      "2301.12345-OfficeMac.md", "2301.123456.md", "2301.1234.md", "2301.12345v2.pdf", "README.md"];
    assert.deepStrictEqual(g("noteConflictCopies")("2301.12345.md", files), ["2301.12345 (1).md", "2301.12345 (conflicted copy 2026-10-08).md", "2301.12345 2.md", "2301.12345-OfficeMac.md", "2301.12345.sync-conflict-20261008-1200-ABC.md"]);
    assert.deepStrictEqual(g("noteConflictCopies")("10.1007_jhep01(2024)001.md", ["10.1007_jhep01(2024)001 (1).md", "10x1007_jhep01(2024)001 (1).md"]), ["10.1007_jhep01(2024)001 (1).md"]);
  });

  await test("the order of a note's sections can be chosen (the user's notes on top); Papurr's later writes keep it", async () => {
    const t = "<!-- papurr:head order=notes+summary+reason -->\n# T\n<!-- /papurr:head -->\n\n## Notes\n\nmine first\n\n<!-- papurr:summary lang=en -->\nS\n<!-- /papurr:summary -->\n\n<!-- papurr:reason lang=en -->\nR\n<!-- /papurr:reason -->\n";
    const n = g("parseNote")(t);
    assert.deepStrictEqual(g("noteOrder")(n), ["notes", "summary", "reason"]);
    assert.strictEqual(g("buildNote")(n), t, "written back unchanged");
    n.blocks["summary@ja"] = { attrs: { lang: "ja" }, body: "要約" }; // (a new summary in another language)
    n.blocks["reason@en"].body = "R2";
    const out = g("buildNote")(n);
    assert.ok(out.indexOf("mine first") < out.indexOf("papurr:summary lang=en") && out.indexOf("要約") < out.indexOf("papurr:reason") && out.includes("R2"), out);
    const plain = g("parseNote")("<!-- papurr:reason -->\nR\n<!-- /papurr:reason -->\n\n## Notes\n\nx\n");
    assert.deepStrictEqual(g("noteOrder")(plain), ["reason", "notes"], "without a choice: Papurr's sections first, as before");
    const odd = g("parseNote")("<!-- papurr:head order=bogus+notes -->\nH\n<!-- /papurr:head -->\n\n<!-- papurr:abstract -->\nA\n<!-- /papurr:abstract -->\n");
    assert.deepStrictEqual(g("noteOrder")(odd), ["notes", "abstract"], "unknown names are ignored, missing sections added");
  });

  await test("ADS bibcodes: recognised, file and note names, labels, and kept by Update index without asking arXiv", async () => {
    const ok = g("isBibcode");
    assert.ok(["1970A&A.....5...84Z", "1984ApJ...279..499F", "1971MNRAS.152...75H", "2016PhRvD..93l4033A"].every(ok));
    assert.ok(!["2301.12345", "2020arXiv200112345A", "1975ApJ...201IC4CAR", ""].some(ok));
    assert.strictEqual(g("bibcodeFileName")("1970A&A.....5...84Z"), "1970A&A.....5...84Z.pdf");
    assert.strictEqual(g("noteFileName")("ads:1970A&A.....5...84Z"), "1970A&A.....5...84Z.md");
    assert.strictEqual(g("paperLabel")("ads:1970A&A.....5...84Z"), "ADS:1970A&A.....5...84Z");
    assert.deepStrictEqual(g("bibcodeJournal")("1971MNRAS.152...75H"), { name: "MNRAS", year: 1971 });
    assert.ok(g("noteHead")("ads:1970A&A.....5...84Z", { title: "T", authors: [] }).includes("[ADS:1970A&A.....5...84Z](https://ui.adsabs.harvard.edu/abs/1970A%26A.....5...84Z/abstract)"));
    const d = await setup(["1970A&A.....5...84Z.pdf"], { "ads:1970A&A.....5...84Z": E({ title: "", versions: {}, journal: { file: "1970A&A.....5...84Z.pdf", bibcode: "1970A&A.....5...84Z" } }) });
    const asked = [];
    ctx.fetchMetadataBatch = async (ids) => { asked.push(...ids); return new Map(); };
    await g("rebuildIndex")(d, {});
    assert.deepStrictEqual(asked, []);
    assert.ok((await g("readIndex")(d))["ads:1970A&A.....5...84Z"]);
  });

  console.log(results.join("\n"));
})();
