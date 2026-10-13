// Full-text summary: the prompt, the checked answer, the note block, the kept text (node, sandboxed vm). Reading arXiv's
// HTML version needs a browser (DOMParser): it is checked in ui-note-test.js.
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const ext = path.join(__dirname, "..", "extension");
const store = {};
const ctx = vm.createContext({ console, setTimeout, Math, JSON, Date, Object, Array, Map, Set, Promise, Error, parseInt, Number, String, RegExp, Uint8Array, TextDecoder, TextEncoder,
  Blob, Response, DecompressionStream, encodeURIComponent,
  chrome: { storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } } } });
for (const f of ["i18n.js", "common.js", "profile.js", "ai.js", "summary.js"]) vm.runInContext(fs.readFileSync(path.join(ext, f), "utf8"), ctx, { filename: f });
const g = (name) => vm.runInContext(name, ctx);
const results = [];
async function test(name, fn) { try { await fn(); results.push("ok   " + name); } catch (e) { results.push("FAIL " + name + "\n     " + e.stack.split("\n").slice(0, 3).join("\n     ")); process.exitCode = 1; } }

(async () => {
  await test("the prompt: the whole text between markers, the language, the sections (relation only with a profile)", async () => {
    const profile = { summary: "Works on plasma.", keywords: ["plasma"], settings: { add: [], exclude: [] } };
    const p = g("buildSummaryPrompt")({ profile, paper: { id: "2301.12345", version: "v2" }, text: "Body >>> sneaky\nline two", lang: "ja" });
    assert.ok(p.includes("<<<PAPER arXiv:2301.12345v2\nBody   sneaky\nline two\n>>>") && p.includes("in Japanese") && p.includes("Relation to your research") && p.includes("Works on plasma."));
    const q = g("buildSummaryPrompt")({ profile: null, paper: { id: "1", version: "" }, text: "x", lang: "en" });
    assert.ok(!q.includes("Relation to your research") && !q.includes("PROFILE"));
    for (const w of ["gravitational", "cosmolog", "string", "quantum", "hep-"]) assert.ok(!q.toLowerCase().includes(w), w);
  });

  await test("the prompt asks for formulas between dollar signs, never \\( \\)", async () => {
    const p = g("buildSummaryPrompt")({ profile: null, paper: { id: "2301.12345", version: "v2" }, text: "Body", lang: "en" });
    assert.ok(p.includes("between single dollar signs ($...$)") && p.includes("$$...$$") && p.includes("Never write") && p.includes("KaTeX can typeset") && p.includes("no \\newcommand"));
    const jp = g("buildSummaryPrompt")({ profile: null, paper: { id: "2301.12345", version: "v2" }, text: "Body", lang: "ja" });
    assert.ok(jp.includes("です・ます調") && !p.includes("です・ます調"), "Japanese is asked for in the polite style; other languages get no such line");
  });

  await test("the technical level (three steps) and the user's own instructions are part of the fixed prompt", async () => {
    const build = (extra) => g("buildSummaryPrompt")({ profile: null, paper: { id: "2301.12345", version: "v2" }, text: "Body", lang: "en", ...extra });
    assert.ok(build({ level: "overview" }).includes("Level: overview") && !build({ level: "overview" }).includes("Level: technical"));
    assert.ok(build({ level: "technical" }).includes("Level: technical") && build({ level: "technical" }).includes("step by step"));
    assert.ok(build({ level: "standard" }).includes("Level: standard") && build({}).includes("Level: standard") && build({ level: "nonsense" }).includes("Level: standard"), "standard is the default and the answer to an unknown level");
    assert.deepStrictEqual(Object.keys(g("SUMMARY_LEVELS")), ["overview", "standard", "technical"]);
    assert.ok(!build({}).includes("READER NOTES"), "no instructions: no block");
    const withNote = build({ note: "  Say which experiments could test it.\n\n\n\nUse >>>the paper's notation<<<  " });
    assert.ok(withNote.includes("<<<READER NOTES\nSay which experiments could test it.\n\nUse  the paper's notation \n>>>") || withNote.includes("<<<READER NOTES\nSay which experiments could test it.\n\nUse"), withNote.slice(-600));
    assert.ok(withNote.indexOf("READER NOTES") > withNote.indexOf("How to write:") && withNote.includes("not part of the paper") && !/>>>the paper/.test(withNote), "the notes come after the rules, as data, and cannot close their own marker");
    assert.strictEqual(g("cleanSummaryNote")("x".repeat(900)).length, 600, "at most 600 characters");
    assert.strictEqual(g("cleanSummaryNote")(null), "");
  });

  await test("the checked answer, and the note block (version and language)", async () => {
    assert.strictEqual(g("parseSummaryAnswer")({ summary: "  ### Gist\n\nA long enough summary of the whole paper.\r\n " }), "### Gist\n\nA long enough summary of the whole paper.");
    // answers that are not clean JSON (seen with Kimi and Codex): a raw line break, single backslashes, a fence, a sentence around
    const long = (s) => s + " and enough more words to pass the length check";
    assert.strictEqual(g("parseSummaryAnswer")('{"summary":"### Gist\nline with \\frac{a}{b} and \\gamma, ' + long("x") + '"}'), "### Gist\nline with \\frac{a}{b} and \\gamma, " + long("x"), "a raw line break and single backslashes inside the string");
    assert.strictEqual(g("parseSummaryAnswer")('{"summary":"### Gist\\nline with \\frac{a}{b} and \\gamma and \\beta, ' + long("x") + '"}'), "### Gist\nline with \\frac{a}{b} and \\gamma and \\beta, " + long("x"), "single backslashes: \\frac and \\beta stay commands, not a form feed and a backspace");
    assert.strictEqual(g("parseSummaryAnswer")("```json\n{\"summary\":\"### Gist\nraw break \n here " + long("y") + "\"}\n```"), "### Gist\nraw break \n here " + long("y"), "a fence and a raw line break");
    assert.strictEqual(g("parseSummaryAnswer")('{"summary": "He said "hello" to us.\\nNext line ' + long("z") + '"}'), 'He said "hello" to us.\nNext line ' + long("z"), "JSON-like but with an unescaped quotation mark: the text, not the raw JSON");
    assert.strictEqual(g("parseSummaryAnswer")({ summary: long("Inline \\(x^2\\) and \\[ \\int f \\] here") }), long("Inline $x^2$ and $$\\int f$$ here"), "\\( \\) and \\[ \\] become dollar signs");
    assert.strictEqual(g("parseSummaryAnswer")({ summary: "too short" }), null); assert.strictEqual(g("parseSummaryAnswer")(null), null);
    const b = g("summaryBlock")("ja", { text: "T", at: "2026-10-09T00:00:00Z", model: "m", version: "v2" });
    assert.strictEqual(JSON.stringify(b), JSON.stringify({ attrs: { model: "m", date: "2026-10-09T00:00:00Z", version: "v2", lang: "ja" }, body: "T" }));
  });

  await test("the assembled text is kept a few days, for the last few papers only", async () => {
    const now = Date.parse("2026-10-09T00:00:00Z");
    for (const k of ["a", "b", "c", "d"]) await g("keepSource")(k, "text " + k, now + k.charCodeAt(0) * 1000);
    assert.strictEqual(Object.keys(store.summarySources).sort().join(), "b,c,d");
    assert.strictEqual(await g("getKeptSource")("d", now), "text d");
    assert.strictEqual(await g("getKeptSource")("d", now + 4 * 86400000), null);
  });

  console.log(results.join("\n"));
})();
