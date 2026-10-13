// Checks the dictionaries: same keys in both languages, same {placeholders}, every key used by the code exists.
const fs = require("fs"), path = require("path"), vm = require("vm");
const ext = path.join(__dirname, "..", "extension");
const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(ext, "i18n.js"), "utf8") + "\nthis.__I18N = I18N; this.__tr = tr; this.__setLang = (l) => { currentLang = l; };", ctx);
const { __I18N: D, __tr: tr, __setLang: setLang } = ctx;
const results = []; let failed = 0;
const t = (name, ok, extra) => { results.push((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " -> " + extra)); if (!ok) failed++; };

const en = Object.keys(D.en), ja = Object.keys(D.ja);
t("same keys in English and Japanese", JSON.stringify([...en].sort()) === JSON.stringify([...ja].sort()),
  "only EN: " + en.filter((k) => !(k in D.ja)) + " | only JA: " + ja.filter((k) => !(k in D.en)));
const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
const badPh = en.filter((k) => k in D.ja && ph(D.en[k]) !== ph(D.ja[k]));
t("same {placeholders} in both languages", !badPh.length, badPh.join());
// Simplified Chinese: the same keys and placeholders as English, and the same markup in the help texts.
const zhKeys = Object.keys(D.zh);
t("same keys in English and Chinese", JSON.stringify([...en].sort()) === JSON.stringify([...zhKeys].sort()),
  "only EN: " + en.filter((k) => !(k in D.zh)) + " | only ZH: " + zhKeys.filter((k) => !(k in D.en)));
const badPhZh = en.filter((k) => k in D.zh && ph(D.en[k]) !== ph(D.zh[k]));
t("same {placeholders} in English and Chinese", !badPhZh.length, badPhZh.join());
const marks = (s) => [(s.match(/\*\*/g) || []).length, (s.match(/`/g) || []).length, (s.match(/\n/g) || []).length].join();
const badMarks = en.filter((k) => k in D.zh && marks(D.en[k]) !== marks(D.zh[k]));
t("same **bold**, `code` and line breaks in English and Chinese", !badMarks.length, badMarks.join());
t("no empty Chinese texts", zhKeys.every((k) => D.zh[k] !== ""), "");
t("no Japanese kana left in the Chinese texts", !zhKeys.filter((k) => /[\u3040-\u30ff]/.test(D.zh[k])).length, zhKeys.filter((k) => /[\u3040-\u30ff]/.test(D.zh[k])).join());
t("no empty texts", en.every((k) => D.en[k] !== "" || k === "x") && ja.every((k) => D.ja[k] !== ""), "");

// keys used in the code and pages
const used = new Set();
for (const f of fs.readdirSync(ext)) {
  const text = fs.existsSync(path.join(ext, f)) && /\.(js|html)$/.test(f) ? fs.readFileSync(path.join(ext, f), "utf8") : "";
  for (const m of text.matchAll(/\b(?:tr|withSettingsLink)\("([\w.]+)"/g)) used.add(m[1]);
  for (const m of text.matchAll(/data-i18n(?:-title|-placeholder)?="([\w.]+)"/g)) used.add(m[1]);
}
used.delete("key");
// Keys chosen at run time (tr(cond ? "a.b" : "c.d"), lists of keys) are found as quoted strings that name a dictionary key.
const allSource = fs.readdirSync(ext).filter((f) => /\.(js|html)$/.test(f) && f !== "i18n.js").map((f) => fs.readFileSync(path.join(ext, f), "utf8")).join("\n");
for (const k of Object.keys(D.en)) if (allSource.includes('"' + k + '"')) used.add(k);
for (const k of [...used]) if (k.endsWith(".")) used.delete(k); // prefixes such as "theme." + mode are checked separately
t("every key used by the code exists", [...used].every((k) => k in D.en), [...used].filter((k) => !(k in D.en)).join());
const unused = en.filter((k) => !used.has(k) && !k.startsWith("theme.") && !["sort.desc.tip", "sort.asc.tip"].includes(k));
t("every dictionary key is used somewhere (no leftovers)", unused.length === 0, unused.join());
// theme.* keys are built as "theme." + mode
t("theme keys exist", ["auto", "light", "dark"].every((m) => ("theme." + m) in D.en && ("theme." + m) in D.ja));

// The text function is called tr(); a leftover call to t() would fail silently in the browser.
const strayT = fs.readdirSync(ext).filter((f) => f.endsWith(".js") && /[^\w.]t\(/.test(fs.readFileSync(path.join(ext, f), "utf8")));
t("no leftover calls to t()", strayT.length === 0, strayT.join());

// behavior of tr()
setLang("ja");
t("tr uses the chosen language", tr("lib.settings") === "設定");
t("tr fills placeholders", tr("db.open", { name: "arXiv" }) === "arXivで開く");
t("unknown placeholder is left as is", tr("site.note").includes("{id}"));
setLang("en");
setLang("zh");
t("tr Chinese", tr("lib.settings") === "设置" && tr("db.open", { name: "arXiv" }) === "在 arXiv 中打开");
setLang("en");
t("tr English", tr("lib.settings") === "Settings" && tr("no.such.key") === "no.such.key");
console.log(results.join("\n"));
process.exitCode = failed ? 1 : 0;
