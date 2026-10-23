// The Library's search scope "INSPIRE syntax": the words INSPIRE's search box understands (a ota, ea ota, atsuhisa, t "dark energy",
// eprint 2301, a weinberg and t cosmological constant, ... and/or/not and brackets), applied to the papers saved in the folder.
// Nothing is sent anywhere; no DOM here. A small part of INSPIRE's language: the fields the index holds (authors, title, arXiv
// number, DOI, journal, tags). Words INSPIRE knows but the index cannot answer (citation counts, dates, ...) are searched as plain words.

const INSPIRE_STYLE_FIELDS = {
  a: "author", au: "author", author: "author", fa: "author", f: "author", fin: "author",
  ea: "exact", exactauthor: "exact", "exact-author": "exact",
  t: "title", ti: "title", title: "title",
  eprint: "number", arxiv: "number", ar: "number", n: "number",
  doi: "doi",
  j: "journal", journal: "journal", s: "journal",
  k: "tag", kw: "tag", keyword: "tag", tag: "tag",
};
const INSPIRE_STYLE_OPERATORS = { and: "and", "&": "and", or: "or", "|": "or", not: "not", "-": "not" };

// Lower case, no accents, no dots: "Müller, J." and "muller j" compare equal.
const inspireStyleNorm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\./g, " ").replace(/\s+/g, " ").trim();

// The text as a list of tokens: words, "quoted phrases" (kept as one word), "(" and ")".
function inspireStyleTokens(text) {
  const tokens = [];
  const re = /"([^"]*)"|([()])|([^\s()"]+)/g;
  let m;
  while ((m = re.exec(String(text)))) {
    if (m[1] !== undefined) tokens.push({ type: "word", text: m[1], quoted: true });
    else if (m[2]) tokens.push({ type: m[2] });
    else if (m[3] && tokens.length && tokens[tokens.length - 1].type === "word" && /,$/.test(tokens[tokens.length - 1].text)) {
      tokens.push({ type: "word", text: m[3] }); // after "ota," a lone "a" is an initial, not the field "a"
    } else {
      const word = m[3];
      const colon = word.match(/^([A-Za-z-]+):(.*)$/);
      if (colon && INSPIRE_STYLE_FIELDS[colon[1].toLowerCase()]) {
        tokens.push({ type: "field", field: INSPIRE_STYLE_FIELDS[colon[1].toLowerCase()] });
        if (colon[2]) tokens.push({ type: "word", text: colon[2] });
      } else if (INSPIRE_STYLE_OPERATORS[word.toLowerCase()]) tokens.push({ type: "op", op: INSPIRE_STYLE_OPERATORS[word.toLowerCase()] });
      else if (INSPIRE_STYLE_FIELDS[word.toLowerCase()]) tokens.push({ type: "field", field: INSPIRE_STYLE_FIELDS[word.toLowerCase()] });
      else tokens.push({ type: "word", text: word });
    }
  }
  return tokens;
}

// The words of a search term, one list per author name: "ota, atsuhisa" -> ["ota", "atsuhisa"].
const inspireStyleWords = (term) => inspireStyleNorm(term.replace(/,/g, " ")).split(" ").filter(Boolean);

// One author name matches when every word of the term is found in that one name: as the beginning of a word (author) or as a
// whole word, a single letter being an initial (exact author). "a ota" also finds "Atsuhisa Ota"; "ea ota, a" finds "Atsuhisa Ota".
function inspireStyleAuthorMatches(authors, term, exact) {
  const words = inspireStyleWords(term);
  if (!words.length) return true;
  return authors.some((name) => {
    const have = inspireStyleNorm(name.replace(/,/g, " ")).split(" ").filter(Boolean);
    return words.every((w) => have.some((h) => (exact && w.length > 1 ? h === w : h.startsWith(w))));
  });
}

// What one field of a paper is compared with. `p` is a Library paper: { id, title, authors, doi, journal, tags }.
function inspireStyleFieldMatches(p, field, words) {
  const phrase = words.map((w) => w.text).join(" ");
  const norm = inspireStyleNorm(phrase);
  if (!norm) return true;
  const has = (text, ws) => ws.every((w) => inspireStyleNorm(text).includes(w));
  const each = words.map((w) => inspireStyleNorm(w.text)).filter(Boolean);
  const authors = p.authors || [];
  switch (field) {
    case "author": return inspireStyleAuthorMatches(authors, phrase, false);
    case "exact": return inspireStyleAuthorMatches(authors, phrase, true);
    case "title": return words.some((w) => w.quoted) ? inspireStyleNorm(p.title).includes(norm) : has(p.title, each);
    case "number": return inspireStyleNorm(p.id).replace(/\s/g, "").includes(norm.replace(/^arxiv /, "").replace(/\s/g, ""));
    case "doi": return inspireStyleNorm(p.doi).includes(norm.replace(/^doi /, ""));
    case "journal": return has((p.journal ? p.journal.name + " " + (p.journal.year || "") : ""), each);
    case "tag": return has((p.tags || []).join(" "), each);
    default: // no field: the words may be anywhere
      return each.every((w) => [p.title, authors.join(" "), p.id, p.doi, (p.tags || []).join(" "), p.journal ? p.journal.name : ""].some((t) => inspireStyleNorm(t).includes(w)));
  }
}

// text -> a function(paper) -> boolean. An empty text matches everything; text that cannot be read as a query (a bracket left
// open, an operator with nothing after it) is searched as plain words instead, so typing never shows an error.
function inspireStyleMatcher(text) {
  const tokens = inspireStyleTokens(String(text).replace(/^\s*(find|fin)\s+/i, ""));
  if (!tokens.length) return () => true;
  try {
    let i = 0;
    const peek = () => tokens[i];
    const parseOr = () => {
      const parts = [parseAnd()];
      while (peek() && peek().type === "op" && peek().op === "or") { i++; parts.push(parseAnd()); }
      return parts.length === 1 ? parts[0] : (p) => parts.some((f) => f(p));
    };
    const parseAnd = () => {
      const parts = [parseUnary()];
      for (;;) {
        const t = peek();
        if (t && t.type === "op" && t.op === "and") i++;
        else if (!t || t.type === ")" || (t.type === "op" && t.op === "or")) break;
        parts.push(parseUnary());
      }
      return parts.length === 1 ? parts[0] : (p) => parts.every((f) => f(p));
    };
    const parseUnary = () => {
      const t = peek();
      if (t && t.type === "op" && t.op === "not") { i++; const f = parseUnary(); return (p) => !f(p); }
      return parsePrimary();
    };
    const parsePrimary = () => {
      const t = peek();
      if (!t) throw new Error("end");
      if (t.type === "(") {
        i++;
        const f = parseOr();
        if (!peek() || peek().type !== ")") throw new Error("bracket");
        i++;
        return f;
      }
      let field = "";
      if (t.type === "field") { field = t.field; i++; }
      const words = [];
      while (peek() && peek().type === "word") words.push(tokens[i++]);
      if (!words.length) throw new Error("empty");
      return (p) => inspireStyleFieldMatches(p, field, words);
    };
    const f = parseOr();
    if (i < tokens.length) throw new Error("rest");
    return f;
  } catch (e) {
    const words = tokens.filter((t) => t.type === "word");
    return (p) => inspireStyleFieldMatches(p, "", words);
  }
}
