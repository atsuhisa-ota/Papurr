// The Library's "INSPIRE syntax" search (inspire-style.js; node, sandboxed vm): fields, exact author, and/or/not, brackets.
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const ctx = vm.createContext({ String, Array, Object, Error });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "extension", "inspire-style.js"), "utf8"), ctx, { filename: "inspire-style.js" });
const match = (q, p) => vm.runInContext("inspireStyleMatcher", ctx)(q)(p);
const results = [];
function test(name, fn) { try { fn(); results.push("ok   " + name); } catch (e) { results.push("FAIL " + name + "\n     " + e.stack.split("\n").slice(0, 3).join("\n     ")); process.exitCode = 1; } }

const ota = { id: "2401.00001", title: "Cosmological constant and dark energy", authors: ["Atsuhisa Ota", "Yi Wang"], doi: "10.1/x", tags: ["cosmology"], journal: { name: "JHEP", year: 2024 } };
const wein = { id: "hep-th/9901001", title: "The cosmological constant problem", authors: ["Steven Weinberg"], tags: [] };
const muller = { id: "2402.00002", title: "Strings", authors: ["Jürgen Müller", "Ana Ota"], tags: ["strings"] };

test("empty query matches everything", () => assert.ok(match("", ota) && match("   ", wein)));
test("a: the author, in any order, by the beginning of a name", () => {
  assert.ok(match("a ota", ota) && match("a atsuhisa ota", ota) && match("a ota, atsuhisa", ota) && match("au ota atsu", ota));
  assert.ok(!match("a ota", wein));
  assert.ok(!match("a wang ota", ota), "two names of two different authors");
});
test("ea: the exact author - whole words, a single letter is an initial, both names must be one person", () => {
  assert.ok(match("ea ota, atsuhisa", ota) && match("ea ota, a", ota) && match("ea Atsuhisa Ota", ota));
  assert.ok(!match("ea ota, atsuhisa", muller), "Ana Ota is another author");
  assert.ok(!match("ea ot", ota), "no half words");
  assert.ok(!match("ea wang, atsuhisa", ota), "two names of two different authors");
  assert.ok(match("ea muller, jurgen", muller), "accents do not matter");
});
test("t: title words, a quoted phrase must stay together", () => {
  assert.ok(match("t cosmological constant", ota) && match("t \"dark energy\"", ota));
  assert.ok(!match("t \"energy dark\"", ota) && match("t energy dark", ota));
});
test("and / or / not and the implicit and", () => {
  assert.ok(match("a weinberg and t cosmological constant", wein) && !match("a weinberg and t cosmological constant", ota));
  assert.ok(match("a weinberg or a ota", wein) && match("a weinberg or a ota", ota) && match("a weinberg or a ota", muller), "Ana Ota is an Ota too");
  assert.ok(match("t cosmological and not a weinberg", ota) && !match("t cosmological and not a weinberg", wein));
  assert.ok(match("a ota t strings", muller) && !match("a ota t strings", ota), "fields next to each other are joined by 'and'");
  assert.ok(match("find a ota", ota), "a leading 'find' is allowed");
});
test("brackets", () => {
  assert.ok(match("(a weinberg or a ota) and t constant", wein) && match("(a weinberg or a ota) and t constant", ota));
  assert.ok(!match("(a weinberg or a ota) and t strings", ota));
});
test("eprint, doi, journal, keyword and a:b spelling", () => {
  assert.ok(match("eprint 2401.00001", ota) && match("arxiv:2401", ota) && match("eprint 9901001", wein) && !match("eprint 9901002", wein));
  assert.ok(match("doi 10.1", ota) && !match("doi 10.1", wein));
  assert.ok(match("j jhep", ota) && match("k cosmology", ota) && match("a:ota", ota));
});
test("words without a field are looked for in the title, the authors, the number and the tags", () => {
  assert.ok(match("weinberg", wein) && match("cosmology", ota) && match("dark energy", ota) && !match("weinberg", ota));
});
test("a query that cannot be read becomes plain words (no error while typing)", () => {
  assert.ok(match("t (cosmological", ota) && match("t (cosmological", wein) && !match("t (cosmological", muller), "an open bracket: the words are searched");
  assert.doesNotThrow(() => match("a ota and", ota));
  assert.doesNotThrow(() => match(") (", ota));
  assert.doesNotThrow(() => match("not", ota));
});
console.log(results.join("\n"));
