// Every file the extension refers to exists (pages' scripts and stylesheets, the manifest, the service worker's
// importScripts, KaTeX's fonts). The page tests load files from the repository directly, so a wrong path inside the
// extension would otherwise only show up when it is loaded in Chrome (which a test cannot do: Chrome no longer accepts
// --load-extension).
const fs = require("fs"), path = require("path");
const ext = path.join(__dirname, "..", "extension");
const exists = (rel) => fs.existsSync(path.join(ext, rel));
const results = []; let failed = 0;
const t = (name, ok, extra) => { results.push((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " -> " + extra)); if (!ok) failed++; };

const pages = fs.readdirSync(ext).filter((f) => f.endsWith(".html"));
const missing = [];
for (const page of pages) for (const m of fs.readFileSync(path.join(ext, page), "utf8").matchAll(/(?:src|href)="([^"#:]+)"/g)) if (!exists(m[1])) missing.push(page + ": " + m[1]);
t("every script, stylesheet and icon a page refers to exists", missing.length === 0, missing.join(", "));

const manifest = JSON.parse(fs.readFileSync(path.join(ext, "manifest.json"), "utf8"));
const inManifest = [];
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === "object") Object.values(o).forEach(walk);
  else if (typeof o === "string" && /\.(js|html|png|svg|css)$/.test(o)) inManifest.push(o);
})(manifest);
t("the version is three numbers (Chrome takes digits and dots only) and starts with 0 while Papurr is in its 0.x phase", /^0\.\d+\.\d+$/.test(manifest.version), manifest.version);
t("every file named in the manifest exists", inManifest.length > 3 && inManifest.every(exists), inManifest.filter((f) => !exists(f)).join(", "));

const bg = fs.readFileSync(path.join(ext, "background.js"), "utf8");
const imported = [...bg.matchAll(/importScripts\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
t("the service worker's importScripts files exist", imported.length > 0 && imported.every(exists), imported.join(", "));

const css = fs.readFileSync(path.join(ext, "vendor/katex/katex.min.css"), "utf8");
const fonts = [...new Set([...css.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)].map((m) => m[1]))];
t("KaTeX's woff2 fonts are all there, with its licence", fonts.length >= 15 && fonts.every((f) => exists("vendor/katex/" + f)) && exists("vendor/katex/LICENSE"), fonts.filter((f) => !exists("vendor/katex/" + f)).join(", "));
t("pages that show formulas load KaTeX before common.js", ["note.html", "today.html"].every((p) => { const s = fs.readFileSync(path.join(ext, p), "utf8"); return s.indexOf("vendor/katex/katex.min.js") > 0 && s.indexOf("vendor/katex/katex.min.js") < s.indexOf('src="common.js"') && s.includes("vendor/katex/katex.min.css"); }));

const styles = fs.readFileSync(path.join(ext, "style.css"), "utf8");
const media = styles.slice(styles.indexOf("@media (prefers-color-scheme: dark)"));
t("the system's dark mode applies only to the automatic theme (a chosen theme is never overridden)", /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme\]\)/.test(media) && !/:not\(\[data-theme="light"\]\)/.test(styles));
const themes = [...fs.readFileSync(path.join(ext, "theme.js"), "utf8").match(/const THEMES = \[([^\]]+)\]/)[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]).filter((t) => t !== "auto" && t !== "light"); // (light is the stylesheet's base colours)
t("every theme offered has its colours in the stylesheet", themes.length === 5 && themes.every((th) => styles.includes(':root[data-theme="' + th + '"]')), themes.filter((th) => !styles.includes(':root[data-theme="' + th + '"]')).join());
// arXiv's API is asked only through arxivApiFetch (one request at a time, 3 s apart, for all pages together).
const direct = fs.readdirSync(ext).filter((f) => f.endsWith(".js")).flatMap((f) => fs.readFileSync(path.join(ext, f), "utf8").split("\n").map((line, i) => [f + ":" + (i + 1), line]))
  .filter(([, line]) => /(^|[^A-Za-z])fetch\(/.test(line) && /export\.arxiv\.org|arxiv(Listing|IdList|Feed|Day)Url|id_list|api\/query/.test(line));
t("no page asks arXiv's API directly (everything goes through arxivApiFetch)", direct.length === 0, direct.map((d) => d[0]).join(", "));
// Help: every page links to it, and every "?" in Settings points to a section that exists.
const helpIds = [...fs.readFileSync(path.join(ext, "help.js"), "utf8").matchAll(/^\s+\["([a-z]+)", "help\./gm)].map((m) => m[1]);
const withHeader = ["library.html", "today.html", "note.html", "options.html", "help.html"];
t("every page with the header links to Help", withHeader.every((f) => fs.readFileSync(path.join(ext, f), "utf8").includes('href="help.html" data-i18n="lib.help"')), withHeader.filter((f) => !fs.readFileSync(path.join(ext, f), "utf8").includes('href="help.html"')).join());
const anchors = [...fs.readFileSync(path.join(ext, "options.html"), "utf8").matchAll(/href="help\.html#([a-z]+)"/g)].map((m) => m[1]);
t("every \"?\" link in Settings opens a Help section that exists (7 sections)", anchors.length === 7 && anchors.every((a) => helpIds.includes(a)), anchors.filter((a) => !helpIds.includes(a)).join() + " / " + helpIds.join());
console.log(results.join("\n"));
process.exitCode = failed ? 1 : 0;
