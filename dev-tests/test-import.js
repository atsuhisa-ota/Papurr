// Importing PDFs added by hand: reading PDFs, deciding what they are, planning and renaming (node, sandboxed vm, fake folder).
const fs = require("fs"), vm = require("vm"), assert = require("assert"), zlib = require("zlib"), path = require("path");
const ext = path.join(__dirname, "..", "extension");
let common = fs.readFileSync(path.join(ext, "common.js"), "utf8");
const waitLine = "const wait = (ms) => new Promise((r) => setTimeout(r, ms));";
assert(common.includes(waitLine));
common = common.replace(waitLine, "const wait = (ms) => Promise.resolve(); // tests: no real pauses");

// ---- fake folder holding bytes ----
class NotFound extends Error { constructor(n) { super(n + " not found"); this.name = "NotFoundError"; } }
class FakeDir {
  constructor(supportsMove = false) { this.files = new Map(); this.supportsMove = supportsMove; this.moves = 0; }
  put(name, data) { this.files.set(name, Buffer.from(data)); }
  has(name) { return this.files.has(name); }
  text(name) { return this.files.has(name) ? this.files.get(name).toString("utf8") : null; }
  async getFileHandle(name, opts = {}) {
    if (!this.files.has(name)) { if (!opts.create) throw new NotFound(name); this.files.set(name, Buffer.alloc(0)); }
    const dir = this;
    const handle = {
      kind: "file", name,
      getFile: async () => { const buf = dir.files.get(name); return { _buf: buf, size: buf.length, lastModified: 0, text: async () => buf.toString("utf8"), slice: (a, b) => ({ text: async () => buf.subarray(a, b).toString("latin1") }), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) }; },
      createWritable: async () => { let buf = Buffer.alloc(0); return { write: async (d) => { buf = Buffer.concat([buf, d && d._buf ? d._buf : Buffer.from(d)]); }, close: async () => { dir.files.set(name, buf); } }; },
    };
    if (this.supportsMove) handle.move = async (to) => { dir.files.set(to, dir.files.get(name)); dir.files.delete(name); dir.moves++; };
    return handle;
  }
  async removeEntry(name) { if (!this.files.delete(name)) throw new NotFound(name); }
  async *entries() { for (const name of [...this.files.keys()]) yield [name, { kind: "file" }]; }
}
// A folder that treats A.pdf and a.pdf as the same file (Macs and Windows), without move() (copy and delete instead).
class CaseInsensitiveDir extends FakeDir {
  constructor() { super(false); this.display = new Map(); }
  k(name) { return name.toLowerCase(); }
  put(name, data) { this.files.set(this.k(name), Buffer.from(data)); this.display.set(this.k(name), name); }
  has(name) { return this.files.has(this.k(name)); }
  text(name) { return super.text(this.k(name)); }
  async getFileHandle(name, opts = {}) { const h = await super.getFileHandle(this.k(name), opts); if (!this.display.has(this.k(name))) this.display.set(this.k(name), name); return { ...h, name: this.display.get(this.k(name)) }; }
  async removeEntry(name) { await super.removeEntry(this.k(name)); this.display.delete(this.k(name)); }
  async *entries() { for (const key of [...this.files.keys()]) yield [this.display.get(key), { kind: "file" }]; }
  names() { return [...this.files.keys()].map((k) => this.display.get(k)); }
}
const chains = {}; // a simple lock per name: one holder at a time, like navigator.locks
const ctx = vm.createContext({
  console, setTimeout, clearTimeout, AbortController, Math, JSON, Date, Object, Array, Map, Set, Promise, TextEncoder, TextDecoder, Error, parseInt, parseFloat, String, RegExp,
  Blob, Response, DecompressionStream, Uint8Array,
  navigator: { locks: { request: (name, a, b) => { const fn = b || a; const r = (chains[name] || Promise.resolve()).then(fn); chains[name] = r.catch(() => {}); return r; } } },
  chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
});
vm.runInContext(fs.readFileSync(path.join(ext, "i18n.js"), "utf8"), ctx);
vm.runInContext(common, ctx);
vm.runInContext(fs.readFileSync(path.join(ext, "import.js"), "utf8"), ctx);
const g = (name) => vm.runInContext(name, ctx);
const results = [];
async function test(name, fn) { try { await fn(); results.push("ok   " + name); } catch (e) { results.push("FAIL " + name + "\n     " + e.stack.split("\n").slice(0, 3).join("\n     ")); process.exitCode = 1; } }
const same = (a, b, msg) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((msg ? msg + ": " : "") + "got " + x + ", expected " + y); };

// ---- synthetic PDFs ----
// A PDF made of the given streams: { data, flate = true, dict = "" }. Only what the reader looks at is real PDF syntax.
function makePdf(streams, extraRaw = "") {
  const parts = [Buffer.from("%PDF-1.5\n")];
  streams.forEach((s, i) => {
    const body = s.flate === false ? Buffer.from(s.data, "latin1") : zlib.deflateSync(Buffer.from(s.data, "latin1"));
    parts.push(Buffer.from(`${i + 1} 0 obj\n<< ${s.flate === false ? "" : "/Filter /FlateDecode"} ${s.dict || ""} /Length ${body.length} >>\nstream\n`), body, Buffer.from("\nendstream\nendobj\n"));
  });
  parts.push(Buffer.from(extraRaw + "\n%%EOF\n", "latin1"));
  return Buffer.concat(parts);
}
const page = (...lines) => ({ data: "BT\n/F1 10 Tf\n" + lines.map((l) => `1 0 0 1 72 700 Tm ${l}`).join("\n") + "\nET\n" });
const stampStream = (text) => ({ data: `q 0.5 G BT /arXivStAmP 20 Tf 0 1 -1 0 32 237 Tm (${text})Tj ET Q` });
const tj = (text) => "[" + text.split(" ").map((w) => `(${w})-250`).join("") + "]TJ"; // words separated by kerning, like TeX output

const arxivPdf = makePdf([
  page(tj("We study the model of [12]."), "(A. Author, arXiv:2105.01234v2 [hep-th].)Tj", tj("See https://doi.org/10.1016/j.other.2020.1")),
  stampStream("arXiv:2301.12345v2  [hep-th]  5 Jan 2023"),
]);
const oldPdf = makePdf([{ data: "q BT /R8 20 Tf 0 1 -1 0 32 274 Tm (arXiv:hep-th/9711200v3  22 Jan 1998)Tj ET Q BT (Some text)Tj ET" }]);
const xmpPdf = makePdf([{ flate: false, dict: "/Type /Metadata /Subtype /XML", data: "<x:xmpmeta><rdf:Description><prism:doi>10.1103/PhysRevD.108.045001</prism:doi></rdf:Description></x:xmpmeta>" }, page("(Hello)Tj")]);
const attrPdf = makePdf([page("(Hello)Tj")], 'dc:identifier="doi:10.1371/journal.pone.0200000"');
const objStmPdf = makePdf([{ dict: "/Type /ObjStm /N 1 /First 5", data: "5 0 <</Title(x)/Subject(Journal, doi:10.1007/JHEP01(2024)001.)>>" }]);
const textDoiPdf = makePdf([ // the paper's own DOI on three pages, one reference DOI once
  page(tj("https://doi.org/10.1088/1475-7516/2023/05/001"), tj("Introduction text")),
  page(tj("JCAP05(2023)001 https://doi.org/10.1088/1475-7516/2023/05/001")),
  page(tj("Page three https://doi.org/10.1088/1475-7516/2023/05/001"), tj("References [1] https://doi.org/10.1103/PhysRevLett.9.9")),
]);
const weakDoiPdf = makePdf([page(tj("Title of the paper"), tj("References [1] https://doi.org/10.1103/PhysRevLett.9.9"))]);
const linkPdf = makePdf([page("(Hello)Tj")], "<</S/URI/URI(https://crossmark.crossref.org/dialog/?doi=10.1103/PhysRevD.108.045001&domain=pdf&date_stamp=2023-08-02)>>");
const blankPdf = makePdf([page("(Just some words)Tj")]);
const titledPdf = makePdf([page("(Just some words)Tj")], "<</Title(Quantum fields in curved spacetime \\(a review\\)) /Producer(x)>>");
const utf16 = (text) => "\xfe\xff" + [...text].map((c) => "\x00" + c).join("");
const titled16Pdf = makePdf([page("(Just some words)Tj")], "<</Title(" + utf16("Holographic entanglement entropy in AdS") + ")>>");
const shortTitlePdf = makePdf([page("(Just some words)Tj")], "<</Title(Untitled)>>");

(async () => {
  const scan = async (buf) => g("scanPdf")({ arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });
  const ident = async (name, buf) => { const s = await scan(buf); vm.runInContext("var __scan", ctx); ctx.__scan = s; ctx.__name = name; return vm.runInContext("identify(__name, __scan)", ctx); };

  await test("arXiv stamp gives number and version; a reference to another arXiv paper is ignored", async () => {
    const s = await scan(arxivPdf);
    same(s.stamp, { id: "2301.12345", version: "v2" });
    same(await ident("whatever.pdf", arxivPdf), { kind: "arxiv", id: "2301.12345", version: "v2", source: "stamp", sure: true });
  });
  await test("old-style arXiv stamp", async () => {
    same((await scan(oldPdf)).stamp, { id: "hep-th/9711200", version: "v3" });
  });
  await test("a reference list entry alone is not mistaken for a stamp", async () => {
    const s = await scan(makePdf([page("(arXiv:2105.01234v2 [hep-th] 5 Jan 2023 and more text here)Tj")]));
    assert.strictEqual(s.stamp, null);
    const s2 = await scan(makePdf([page("(arXiv:2105.01234v2)Tj"), page("([hep-th] 5 Jan 2023)Tj")]));
    assert.strictEqual(s2.stamp, null);
  });
  await test("DOI from XMP metadata (element and attribute forms) and from the document info inside an object stream", async () => {
    same((await ident("x.pdf", xmpPdf)), { kind: "journal", doi: "10.1103/physrevd.108.045001", source: "meta", sure: true });
    same((await ident("x.pdf", attrPdf)).doi, "10.1371/journal.pone.0200000");
    same((await ident("x.pdf", objStmPdf)).doi, "10.1007/jhep01(2024)001", "parentheses are part of the DOI, the final full stop is not");
  });
  await test("DOI from link annotations stops before URL parameters", async () => {
    same((await ident("x.pdf", linkPdf)).doi, "10.1103/physrevd.108.045001");
  });
  await test("DOI repeated in the text wins over a reference DOI, and is trusted", async () => {
    const id = await ident("x.pdf", textDoiPdf);
    same([id.kind, id.doi, id.source, id.sure], ["journal", "10.1088/1475-7516/2023/05/001", "text", true]);
  });
  await test("a DOI seen once in the text is not trusted", async () => {
    const id = await ident("x.pdf", weakDoiPdf);
    same([id.doi, id.source, id.sure], ["10.1103/physrevlett.9.9", "text", false]);
  });
  await test("a weak text DOI loses against an arXiv number in the file name", async () => {
    const id = await ident("2301.00077.pdf", weakDoiPdf);
    same([id.kind, id.id, id.version, id.source, id.sure], ["arxiv", "2301.00077", null, "name", false]);
  });
  await test("nothing found in the file: file name decides, otherwise unknown", async () => {
    assert.strictEqual(await ident("my notes.pdf", blankPdf), null);
    same(await ident("arXiv-2301.12345v2_Some Title.pdf", blankPdf), { kind: "arxiv", id: "2301.12345", version: "v2", source: "name", sure: false });
    same(await ident("hep-th9901001.pdf", blankPdf), { kind: "arxiv", id: "hep-th/9901001", version: null, source: "name", sure: false });
    same((await ident("10.1103_physrevd.108.045001.pdf", blankPdf)).doi, "10.1103/physrevd.108.045001");
  });
  await test("damaged or odd PDFs do not stop the reader", async () => {
    const s = await scan(Buffer.concat([Buffer.from("%PDF-1.5\n1 0 obj\n<< /Filter /FlateDecode /Length 9 >>\nstream\n"), Buffer.from("not deflate"), Buffer.from("\nendstream\n")]));
    assert.strictEqual(s.stamp, null);
    await scan(Buffer.from("not a pdf at all"));
    await scan(Buffer.alloc(0));
  });

  await test("the title in the document info is read (plain, escaped parentheses, UTF-16)", async () => {
    same((await scan(titledPdf)).title, "Quantum fields in curved spacetime (a review)");
    same((await scan(titled16Pdf)).title, "Holographic entanglement entropy in AdS");
    same((await scan(blankPdf)).title, "");
  });

  await test("stamp whose letters are placed one by one is still read (with the category)", async () => {
    const chars = [..."arXiv:2301.12345v2  [hep-th]  5 Jan 2023"].map((c) => `1 0 0 1 10 10 Tm (${c === "(" || c === ")" ? "\\" + c : c})Tj`).join("\n");
    same((await scan(makePdf([{ data: "BT\n" + chars + "\nET" }]))).stamp, { id: "2301.12345", version: "v2" });
  });

  await test("file names", async () => {
    same([g("arxivFileName")("2301.12345", "v2"), g("arxivFileName")("hep-th/9711200", "v3"), g("arxivFileName")("2301.12345", null)], ["2301.12345v2.pdf", "hep-th_9711200v3.pdf", "2301.12345.pdf"]);
  });

  // ---- planning and applying ----
  const meta = (title, extra = {}) => ({ title, authors: ["Ann Smith"], authorCount: 1, doi: "", latestVersion: null, ...extra });
  function stubNetwork() {
    ctx.fetchMetadataBatch = async (ids) => new Map(ids.filter((id) => id !== "2301.00077").map((id) => [id, meta("Paper " + id, id === "2301.12345" ? { doi: "10.1007/jhep01(2024)001" } : {})]));
    ctx.fetchJournalMetadata = async (doi) => {
      if (doi === "10.9999/nonexistent") throw new Error("Crossref has no record");
      return { title: doi === "10.1088/1475-7516/2023/05/001" ? "A Title" : "Journal paper " + doi, authors: ["Bo Chen"], authorCount: 1, journalName: "JHEP", year: 2024 };
    };
    ctx.findDoiByTitle = async () => null;
    ctx.fetchBibcodeMetadata = async () => null;
    ctx.findArxivIdForDoi = async (doi) => (doi === "10.1103/physrevd.108.045001" ? "2308.00001" : null);
  }
  const folder = (supportsMove) => {
    const d = new FakeDir(supportsMove);
    d.put("Maldacena large N.pdf", oldPdf);
    d.put("scan001.pdf", arxivPdf);
    d.put("prd paper.pdf", xmpPdf);
    d.put("jcap.pdf", textDoiPdf);
    d.put("2301.00077.pdf", blankPdf); // arXiv does not know this number
    d.put("mystery.pdf", blankPdf);
    d.put("2401.00002v1.pdf", makePdf([stampStream("arXiv:2401.00002v1  [hep-th]  1 Jan 2024")])); // already well named
    d.put("10.9999_nonexistent.pdf", blankPdf);
    d.put("notes.txt", "not a pdf");
    return d;
  };
  const byName = (items) => Object.fromEntries(items.map((it) => [it.name, it]));

  await test("plan: what each file is, the new names, and nothing is changed", async () => {
    stubNetwork();
    const d = folder(false);
    const before = [...d.files.keys()].sort();
    const { items, cancelled } = await g("planImport")(d, {});
    assert.strictEqual(cancelled, false);
    same([...d.files.keys()].sort(), before, "planning must not touch the folder");
    const b = byName(items);
    assert.strictEqual(Object.keys(b).length, 8, "only PDFs are looked at");
    same([b["Maldacena large N.pdf"].status, b["Maldacena large N.pdf"].newName, b["Maldacena large N.pdf"].version], ["rename", "hep-th_9711200v3.pdf", "v3"]);
    same([b["scan001.pdf"].status, b["scan001.pdf"].newName, b["scan001.pdf"].title], ["rename", "2301.12345v2.pdf", "Paper 2301.12345"]);
    same([b["prd paper.pdf"].status, b["prd paper.pdf"].newName, b["prd paper.pdf"].arxivId], ["rename", "10.1103_physrevd.108.045001.pdf", "2308.00001"]);
    same([b["prd paper.pdf"].title, b["prd paper.pdf"].journal], ["Paper 2308.00001", { name: "JHEP", year: 2024 }], "arXiv's title is preferred when the paper is also on arXiv");
    same([b["jcap.pdf"].status, b["jcap.pdf"].newName, b["jcap.pdf"].sure, b["jcap.pdf"].arxivId], ["rename", "10.1088_1475-7516_2023_05_001.pdf", true, null]);
    assert.strictEqual(b["2301.00077.pdf"].status, "unknown");
    assert.ok(b["2301.00077.pdf"].why.includes("arXiv"), b["2301.00077.pdf"].why);
    assert.strictEqual(b["mystery.pdf"].status, "unknown");
    assert.strictEqual(b["10.9999_nonexistent.pdf"].status, "unknown");
    assert.ok(b["10.9999_nonexistent.pdf"].why.includes("Crossref"), b["10.9999_nonexistent.pdf"].why);
    same([b["2401.00002v1.pdf"].status, b["2401.00002v1.pdf"].newName], ["same", "2401.00002v1.pdf"]);
  });

  await test("plan: a PDF without any DOI is searched for by its title; an exact match is offered but needs a check", async () => {
    stubNetwork();
    const asked = [];
    ctx.findDoiByTitle = async (title) => { asked.push(title); return title.startsWith("Quantum") ? "10.1016/j.nuclphysb.2020.1" : null; };
    const d = new FakeDir();
    d.put("a.pdf", titledPdf);
    d.put("b.pdf", titled16Pdf);
    d.put("c.pdf", shortTitlePdf);
    const { items } = await g("planImport")(d, {});
    const b = byName(items);
    same(asked, ["Quantum fields in curved spacetime (a review)", "Holographic entanglement entropy in AdS"], "short titles are not searched");
    same([b["a.pdf"].status, b["a.pdf"].newName, b["a.pdf"].sure, b["a.pdf"].source, b["a.pdf"].notes], ["rename", "10.1016_j.nuclphysb.2020.1.pdf", false, "title", ["import.note.title"]]);
    assert.strictEqual(b["b.pdf"].status, "unknown");
    assert.strictEqual(b["c.pdf"].status, "unknown");
    delete ctx.findDoiByTitle;
    ctx.findDoiByTitle = vm.runInContext("(" + "async () => null" + ")", ctx); // (offline: nothing found)
  });

  await test("plan: names that are taken, versions already saved, two files for one paper", async () => {
    stubNetwork();
    const d = new FakeDir();
    d.put("a.pdf", arxivPdf);
    d.put("b.pdf", arxivPdf); // same paper and version twice
    d.put("c.pdf", oldPdf);
    d.put("hep-th_9711200v3.pdf", Buffer.from("something else")); // the target name is already used (not in the index)
    d.put("index.json", JSON.stringify({ schemaVersion: 2, papers: {
      "2301.12345": { title: "T", authors: [], authorCount: 0, added: "2026-01-01T00:00:00Z", versions: { v2: "other-name.pdf" } },
    } }));
    d.put("other-name.pdf", Buffer.from("%PDF-"));
    const { items } = await g("planImport")(d, {});
    const b = byName(items);
    assert.strictEqual(b["a.pdf"].status, "duplicate");
    assert.ok(b["a.pdf"].why.includes("other-name.pdf"), b["a.pdf"].why);
    assert.strictEqual(b["b.pdf"].status, "duplicate");
    assert.strictEqual(b["c.pdf"].status, "duplicate");
    assert.ok(b["c.pdf"].why.includes("hep-th_9711200v3.pdf"), b["c.pdf"].why);
    assert.strictEqual(b["hep-th_9711200v3.pdf"].status, "same", "a file that is already named correctly is taken at its word");
  });

  await test("plan: an index record of a file that no longer exists does not block the import", async () => {
    stubNetwork();
    const d = new FakeDir();
    d.put("a.pdf", arxivPdf);
    d.put("index.json", JSON.stringify({ schemaVersion: 2, papers: {
      "2301.12345": { title: "T", authors: [], authorCount: 0, added: "2026-01-01T00:00:00Z", versions: { v2: "ghost.pdf" }, tags: ["x"] },
    } }));
    const { items } = await g("planImport")(d, {});
    assert.strictEqual(items[0].status, "rename");
    await g("applyImport")(d, items, {});
    const idx = JSON.parse(d.text("index.json")).papers;
    same(idx["2301.12345"].versions, { v2: "2301.12345v2.pdf" });
    same(idx["2301.12345"].tags, ["x"]);
  });

  await test("ADS scans: the bibcode printed on the pages (spaced out by the text layer) or in the file name", async () => {
    const stamped = makePdf([page("(198 4ApJ. . .279. .499F)Tj", "(THE GALAXY HIERARCHY)Tj"), page("(198 4ApJ. . .279. .499F)Tj")]);
    same(await ident("scan.pdf", stamped), { kind: "ads", bibcode: "1984ApJ...279..499F", source: "stamp", sure: true });
    const once = makePdf([page("(1984ApJ...279..499F)Tj")]);
    same((await ident("x.pdf", once)), null, "printed once is not enough (it could be a reference)");
    same(await ident("XBurPD-1975ApJ___201____1C.pdf", makePdf([page("(no stamp here)Tj")])), { kind: "ads", bibcode: "1975ApJ...201....1C", source: "name", sure: false });
    same(await ident("1970A%26A.....5...84Z.pdf", makePdf([page("(x)Tj")])), { kind: "ads", bibcode: "1970A&A.....5...84Z", source: "name", sure: false });
    same((await ident("2301.12345v2.pdf", makePdf([page("(x)Tj")]))).kind, "arxiv", "an arXiv name is not a bibcode");
  });

  await test("ADS scans are renamed to their bibcode and recorded as 'ads:<bibcode>' (title from Crossref); a second copy is a duplicate", async () => {
    stubNetwork();
    const d = new FakeDir();
    d.put("1984ApJ___279__499F.pdf", makePdf([page("(198 4ApJ. . .279. .499F)Tj"), page("(198 4ApJ. . .279. .499F)Tj")]));
    d.put("XBurPD-1984ApJ___279__499F.pdf", makePdf([page("(x)Tj")]));
    ctx.fetchBibcodeMetadata = async (b) => (b === "1984ApJ...279..499F" ? { title: "The Galaxy correlation hierarchy", authors: ["J. N. Fry"], authorCount: 1, doi: "10.1086/161913" } : null);
    const { items } = await g("planImport")(d, {});
    const by = Object.fromEntries(items.map((i) => [i.name, i]));
    same([by["1984ApJ___279__499F.pdf"].status, by["1984ApJ___279__499F.pdf"].newName], ["rename", "1984ApJ...279..499F.pdf"]);
    same(by["XBurPD-1984ApJ___279__499F.pdf"].status, "duplicate");
    await g("applyImport")(d, items.filter((i) => i.status === "rename"), {});
    const e = JSON.parse(d.text("index.json")).papers["ads:1984ApJ...279..499F"];
    same([e.journal.file, e.journal.name, e.journal.year, e.bibcode, Object.keys(e.versions).length], ["1984ApJ...279..499F.pdf", "ApJ", 1984, "1984ApJ...279..499F", 0]);
    same([e.title, e.authors, e.doi], ["The Galaxy correlation hierarchy", ["J. N. Fry"], "10.1086/161913"], "title and DOI from Crossref");
    assert.ok(d.text("1984ApJ...279..499F.pdf") !== null && d.text("1984ApJ___279__499F.pdf") === null && d.text("XBurPD-1984ApJ___279__499F.pdf") !== null);
  });

  await test("a rename that only changes upper/lower case keeps the file on a folder that ignores case, without move()", async () => {
    const d = new CaseInsensitiveDir();
    d.put("2301.12345V2.pdf", "%PDF- the only copy");
    await g("renameFile")(d, "2301.12345V2.pdf", "2301.12345v2.pdf");
    same(d.names(), ["2301.12345v2.pdf"], "one file, under the new name");
    same(d.text("2301.12345v2.pdf"), "%PDF- the only copy");
    const d2 = new CaseInsensitiveDir();
    d2.put("a.pdf", "%PDF- x");
    await g("renameFile")(d2, "a.pdf", "b.pdf");
    same([d2.names(), d2.text("b.pdf")], [["b.pdf"], "%PDF- x"], "an ordinary rename still works");
  });

  await test("of two copies of a paper, a cut-off one (no %%EOF at the end) becomes the duplicate and is marked", async () => {
    stubNetwork();
    const d = new FakeDir();
    const full = makePdf([page("(x)Tj")]);
    d.put("1975ApJ___201____1C.pdf", full.subarray(0, full.length - 20)); // the download stopped early
    d.put("XBurPD-1975ApJ___201____1C.pdf", full);
    const by = Object.fromEntries((await g("planImport")(d, {})).items.map((i) => [i.name, i]));
    same([by["XBurPD-1975ApJ___201____1C.pdf"].status, by["1975ApJ___201____1C.pdf"].status], ["rename", "duplicate"]);
    assert.ok(by["1975ApJ___201____1C.pdf"].notes.includes("import.note.incomplete") && !by["XBurPD-1975ApJ___201____1C.pdf"].notes.includes("import.note.incomplete"));
  });

  await test("a rebuild leaves names without a version to the import, which reads the version from the PDF", async () => {
    stubNetwork();
    const d = new FakeDir();
    d.put("2301.12345.pdf", arxivPdf); // new-style number, no version in the name; the PDF says v2
    d.put("2105.00001v1.pdf", Buffer.from("%PDF-"));
    await g("rebuildIndex")(d, {});
    same(Object.keys(JSON.parse(d.text("index.json")).papers), ["2105.00001"], "only the file whose name has a version is indexed by Update index");
    const left = await g("findUnmanagedPdfs")(d);
    same(left, ["2301.12345.pdf"]);
    const { items } = await g("planImport")(d, {});
    same([items[0].status, items[0].newName, items[0].version], ["rename", "2301.12345v2.pdf", "v2"]);
    await g("applyImport")(d, items, {});
    same(JSON.parse(d.text("index.json")).papers["2301.12345"].versions, { v2: "2301.12345v2.pdf" });
  });

  await test("papers already in the library without a version get one when the PDF says so; the others are remembered", async () => {
    stubNetwork();
    const store = {};
    ctx.chrome.storage.local.get = async (k) => ({ [k]: store[k] });
    ctx.chrome.storage.local.set = async (o) => Object.assign(store, o);
    const d = new FakeDir();
    d.put("2301.12345.pdf", arxivPdf); // recorded as "PDF"; the PDF says v2
    d.put("2301.99999.pdf", blankPdf); // recorded as "PDF"; the PDF says nothing
    d.put("2302.00001.pdf", makePdf([stampStream("arXiv:2302.00001v1  [hep-th]  1 Feb 2023")])); // the PDF is of another paper than the record
    d.put("index.json", JSON.stringify({ schemaVersion: 2, papers: {
      "2301.12345": { title: "A", authors: [], authorCount: 0, added: "2026-01-01T00:00:00Z", versions: { unversioned: "2301.12345.pdf" }, tags: ["x"] },
      "2301.99999": { title: "B", authors: [], authorCount: 0, added: "2026-01-01T00:00:00Z", versions: { unversioned: "2301.99999.pdf" } },
      "2209.00009": { title: "C", authors: [], authorCount: 0, added: "2026-01-01T00:00:00Z", versions: { unversioned: "2302.00001.pdf" } },
    } }));
    same(await g("findUnversionedFiles")(d), ["2301.12345.pdf", "2301.99999.pdf", "2302.00001.pdf"]);
    const plan = await g("planImport")(d, {});
    same(plan.items.map((i) => [i.name, i.status, i.newName]), [["2301.12345.pdf", "rename", "2301.12345v2.pdf"]]);
    same(plan.unresolved.sort(), ["2301.99999.pdf", "2302.00001.pdf"]);
    await g("rememberUnversionedChecked")(plan.unresolved);
    await g("applyImport")(d, plan.items, {});
    const papers = JSON.parse(d.text("index.json")).papers;
    same(papers["2301.12345"].versions, { v2: "2301.12345v2.pdf" }, "the version replaces the version-less record");
    same(papers["2301.12345"].tags, ["x"]);
    same(papers["2301.99999"].versions, { unversioned: "2301.99999.pdf" }, "untouched");
    same(await g("findUnversionedFiles")(d), [], "nothing left to nag about");
    ctx.chrome.storage.local.get = async () => ({});
  });

  await test("plan: two files for the same new name - only the first is offered", async () => {
    stubNetwork();
    const d = new FakeDir();
    d.put("a.pdf", arxivPdf);
    d.put("b.pdf", arxivPdf);
    const { items } = await g("planImport")(d, {});
    same(items.map((i) => i.status), ["rename", "duplicate"]);
  });

  await test("plan: can be cancelled; reports progress", async () => {
    stubNetwork();
    const d = folder(false);
    const seen = [];
    let n = 0;
    const r = await g("planImport")(d, { report: (t) => seen.push(t), isCancelled: () => ++n > 3 });
    assert.strictEqual(r.cancelled, true);
    same(r.items, []);
    assert.ok(seen.length >= 1 && seen[0].includes("1"), seen.join("|"));
  });

  for (const supportsMove of [false, true]) {
    await test("apply (" + (supportsMove ? "move" : "copy") + "): approved files are renamed and indexed, others are left alone", async () => {
      stubNetwork();
      const d = folder(supportsMove);
      d.put("index.json", JSON.stringify({ schemaVersion: 2, papers: {
        "2308.00001": { title: "Old", authors: [], authorCount: 0, added: "2026-01-01T00:00:00Z", versions: { v1: "2308.00001v1.pdf" }, tags: ["keep"] },
      } }));
      d.put("2308.00001v1.pdf", Buffer.from("%PDF-"));
      const { items } = await g("planImport")(d, {});
      const approved = items.filter((it) => (it.status === "rename" && it.name !== "jcap.pdf") || it.status === "same");
      const content = d.files.get("scan001.pdf");
      const r = await g("applyImport")(d, approved, {});
      same([r.renamed, r.added, r.failed.length, r.cancelled], [3, 4, 0, false]);
      assert.ok(!d.has("scan001.pdf") && d.files.get("2301.12345v2.pdf").equals(content), "renamed with identical content");
      assert.ok(d.has("jcap.pdf"), "not approved: untouched");
      assert.ok(d.has("mystery.pdf") && d.has("2301.00077.pdf"));
      assert.strictEqual(d.moves > 0, supportsMove);
      const idx = JSON.parse(d.text("index.json")).papers;
      same(idx["2301.12345"].versions, { v2: "2301.12345v2.pdf" });
      assert.strictEqual(idx["2301.12345"].title, "Paper 2301.12345");
      assert.strictEqual(idx["2301.12345"].doi, "10.1007/jhep01(2024)001");
      same(idx["hep-th/9711200"].versions, { v3: "hep-th_9711200v3.pdf" });
      same(idx["2401.00002"].versions, { v1: "2401.00002v1.pdf" });
      same(idx["2308.00001"].journal, { file: "10.1103_physrevd.108.045001.pdf", doi: "10.1103/physrevd.108.045001", name: "JHEP", year: 2024 });
      same(idx["2308.00001"].tags, ["keep"], "an existing entry keeps its tags and gets the journal version");
      assert.ok(!Object.keys(idx).some((k) => k.startsWith("doi:")));
      assert.ok(!Object.values(idx).some((e) => JSON.stringify(e).includes("jcap")), "the declined file is not indexed");
    });
  }

  await test("apply: a journal-only paper is recorded under its DOI; a target that appeared meanwhile is never overwritten", async () => {
    stubNetwork();
    const d = new FakeDir();
    d.put("jcap.pdf", textDoiPdf);
    d.put("a.pdf", arxivPdf);
    const { items } = await g("planImport")(d, {});
    d.put("2301.12345v2.pdf", Buffer.from("precious")); // appears after the plan
    const r = await g("applyImport")(d, items.filter((i) => i.status === "rename"), {});
    same([r.renamed, r.added, r.failed.length], [1, 1, 1]);
    assert.strictEqual(r.failed[0].name, "a.pdf");
    assert.strictEqual(d.text("2301.12345v2.pdf"), "precious");
    assert.ok(d.has("a.pdf"), "the original stays");
    const idx = JSON.parse(d.text("index.json")).papers;
    same(Object.keys(idx), ["doi:10.1088/1475-7516/2023/05/001"]);
    assert.strictEqual(idx["doi:10.1088/1475-7516/2023/05/001"].title, "A Title");
  });

  await test("apply: a failing copy leaves no half-written file; progress is reported; cancel stops", async () => {
    stubNetwork();
    const d = new FakeDir();
    d.put("a.pdf", arxivPdf);
    d.put("c.pdf", oldPdf);
    const { items } = await g("planImport")(d, {});
    const realGet = d.getFileHandle.bind(d);
    d.getFileHandle = async (name, opts) => {
      const h = await realGet(name, opts);
      if (name === "2301.12345v2.pdf") { const w = h.createWritable; h.createWritable = async () => { const x = await w(); x.close = async () => { throw new Error("disk full"); }; return x; }; }
      return h;
    };
    const seen = [];
    let calls = 0;
    const r = await g("applyImport")(d, items, { report: (t) => seen.push(t), isCancelled: () => calls++ > 0 && false });
    assert.strictEqual(r.failed.length, 1);
    assert.ok(d.has("a.pdf") && !d.has("2301.12345v2.pdf"), "original kept, no leftover");
    assert.ok(d.has("hep-th_9711200v3.pdf"));
    assert.ok(seen.length === 2 && seen[0].includes("1"));
    const d2 = new FakeDir();
    d2.put("a.pdf", arxivPdf);
    d2.put("c.pdf", oldPdf);
    const plan2 = await g("planImport")(d2, {});
    const r2 = await g("applyImport")(d2, plan2.items, { isCancelled: () => true });
    same([r2.cancelled, r2.renamed], [true, 0]);
  });

  await test("after an import nothing is left to import; Update index agrees with the result", async () => {
    stubNetwork();
    const d = folder(true);
    const { items } = await g("planImport")(d, {});
    await g("applyImport")(d, items.filter((i) => i.status === "rename" || i.status === "same"), {});
    const left = await g("findUnmanagedPdfs")(d);
    same(left, ["10.9999_nonexistent.pdf", "2301.00077.pdf", "mystery.pdf"]);
    const again = await g("planImport")(d, {});
    same(again.items.map((i) => i.status), ["unknown", "unknown", "unknown"]);
  });

  console.log(results.join("\n"));
})();
