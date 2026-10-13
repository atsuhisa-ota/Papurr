// Searching INSPIRE from the Library (inspire.js; node, sandboxed vm): the address, the checked answer, the errors in words.
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const ext = path.join(__dirname, "..", "extension");
let nextFetch = null;
const ctx = vm.createContext({ console, encodeURIComponent, Number, String, Array, Object, Math, Promise, Error, TypeError, AbortController, setTimeout, clearTimeout,
  tr: (key, vars) => key + (vars ? JSON.stringify(vars) : ""), fetch: (url, opts) => nextFetch(url, opts) });
vm.runInContext(fs.readFileSync(path.join(ext, "inspire.js"), "utf8"), ctx, { filename: "inspire.js" });
const g = (name) => vm.runInContext(name, ctx);
const results = [];
async function test(name, fn) { try { await fn(); results.push("ok   " + name); } catch (e) { results.push("FAIL " + name + "\n     " + e.stack.split("\n").slice(0, 3).join("\n     ")); process.exitCode = 1; } }

(async () => {
  await test("the address: the query is encoded, a page of 25, the newest first, only the fields a list needs", async () => {
    const u = g("inspireSearchUrl")("a ota & t \"x y\"", 2);
    assert.ok(u.startsWith("https://inspirehep.net/api/literature?q=a%20ota%20%26%20t%20%22x%20y%22&size=25&page=2&sort=mostrecent&fields="), u);
    assert.ok(u.includes("arxiv_eprints") && !u.includes("citation_count") && u.includes("authors.full_name") && !u.includes("abstracts"));
    assert.ok(g("inspireSearchUrl")("x").includes("page=1"));
    assert.ok(g("inspireSearchUrl")("x", 1, "leastrecent").includes("sort=leastrecent"));
    assert.ok(g("inspireSearchUrl")("x", 1, "nonsense").includes("sort=mostrecent"), "an unknown order is the default");
    assert.strictEqual(g("inspireCitedByQuery")(1632064), "refersto:recid:1632064");
    assert.strictEqual(g("inspireReferencesQuery")("1632064"), "citedby:recid:1632064");
    assert.strictEqual(g("inspireCitedByQuery")("1; drop"), "refersto:recid:0", "only a number goes into the query");
    assert.strictEqual(g("inspireAuthorQuery")("Tachikawa, Yuji"), "ea Tachikawa, Yuji");
    assert.strictEqual(g("inspireAuthorQuery")(' O\'Brien, "Pat" (Jr.): x '), "ea O'Brien, Pat Jr. x", "quotes, brackets and colons (query syntax) are dropped");
  });

  await test("the checked answer: values are cleaned, odd ones left out, nothing is trusted", async () => {
    const parse = g("parseInspireHits");
    const good = { metadata: { control_number: 7, titles: [{ title: "  A \n B " }], authors: [{ full_name: "Ota, A" }, { full_name: "Chen" }, { full_name: "Dee" }, { full_name: "Eve" }],
      arxiv_eprints: [{ value: "2301.12345" }], dois: [{ value: "10.1/x" }], citation_count: 5, earliest_date: "2023-01-02", publication_info: [{ journal_title: "JHEP", journal_volume: "01" }] } };
    const r = parse({ hits: { total: 99, hits: [good, null, "x", { metadata: {} }, { metadata: { control_number: 9, arxiv_eprints: [{ value: "<script>" }] } }, { metadata: { control_number: 11, titles: [], authors: "no", citation_count: "many" } }] } });
    assert.strictEqual(r.total, 99);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.hits[0])), { recid: 7, title: "A B", authors: ["Ota, A", "Chen", "Dee", "Eve"], year: "2023", journal: "JHEP 01", arxiv: "2301.12345", doi: "10.1/x" });
    assert.strictEqual(r.hits.length, 3, "an empty object, null and a string are dropped");
    assert.strictEqual(r.hits[1].arxiv, "", "an arXiv value that is not an arXiv number is dropped");
    assert.strictEqual(r.hits[1].title, "INSPIRE 9", "a missing title gets a plain stand-in");
    assert.strictEqual(r.hits[2].authors.length, 0);
    for (const bad of [null, undefined, 5, "x", {}, { hits: null }, { hits: { hits: "no" } }]) assert.deepStrictEqual(JSON.parse(JSON.stringify(parse(bad))), { total: 0, hits: [] });
    assert.strictEqual(parse({ hits: { hits: [good] } }).total, 1, "no total: the number of hits");
    assert.strictEqual(parse({ hits: { total: "x", hits: [good] } }).total, 1);
    assert.strictEqual(parse({ hits: { hits: [{ metadata: { control_number: 1, arxiv_eprints: [{ value: "hep-th/9901001" }] } }] } }).hits[0].arxiv, "hep-th/9901001", "old-style numbers are kept");
  });

  await test("the BibTeX entry: only text that starts like BibTeX is taken, the address names the format", async () => {
    let asked = "";
    nextFetch = async (url) => { asked = url; return { ok: true, status: 200, text: async () => "\n@article{A:2023,\n title = {x}\n}\n" }; };
    assert.ok((await g("fetchInspireBibtex")(1632064)).startsWith("@article{A:2023"));
    assert.strictEqual(asked, "https://inspirehep.net/api/literature/1632064?format=bibtex");
    nextFetch = async () => ({ ok: true, status: 200, text: async () => "{\"message\": \"nothing\"}" });
    await assert.rejects(() => g("fetchInspireBibtex")(1), /inspire\.err\.format/);
    nextFetch = async () => ({ ok: false, status: 404, text: async () => "" });
    await assert.rejects(() => g("fetchInspireBibtex")(1), /inspire\.err\.status/);
  });

  await test("the request: errors are plain sentences, a good answer is parsed", async () => {
    const fetchInspire = g("fetchInspireSearch");
    nextFetch = async () => ({ ok: true, status: 200, json: async () => ({ hits: { total: 1, hits: [{ metadata: { control_number: 1, titles: [{ title: "T" }] } }] } }) });
    assert.strictEqual((await fetchInspire("q", 1)).hits[0].title, "T");
    const expect = async (answer, text) => { nextFetch = answer; await assert.rejects(() => fetchInspire("q", 1), (e) => e.message.startsWith(text) || (assert.fail(e.message), false)); };
    await expect(async () => ({ ok: false, status: 429, json: async () => ({}) }), "prof.err.ratelimit");
    await expect(async () => ({ ok: false, status: 400, json: async () => ({}) }), "inspire.err.status{\"status\":400}");
    await expect(async () => ({ ok: false, status: 503, json: async () => ({}) }), "inspire.err.status{\"status\":503}");
    await expect(async () => ({ ok: true, status: 200, json: async () => { throw new Error("x"); } }), "inspire.err.format");
    await expect(async () => { throw new TypeError("Failed to fetch"); }, "inspire.err.network");
    await expect(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }, "inspire.err.timeout");
  });

  console.log(results.join("\n"));
})();
