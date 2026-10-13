// Irregular data and layout: an index.json with odd values (edited by hand, written by another program or an older
// version), very long titles, hundreds of authors, many tags; every colour theme, a wide and a narrow window.
// The page must show every paper, throw nothing, never need sideways scrolling, and keep its text readable.
(async () => {
  const errors = [];
  window.addEventListener("error", (e) => errors.push(e.message));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason && e.reason.stack || e.reason)));
  try {
    await sleep(300);
    const many = Array.from({ length: 300 }, (_, i) => "Author Number" + i);
    const odd = {
      "2301.10001": { title: 12345, authors: "Single Author", authorCount: "1", tags: "loose", added: "2026-01-01T00:00:00Z", versions: { v1: "o1.pdf" } },
      "2301.10002": { title: "W".repeat(400), authors: many.slice(0, 10), authorCount: 300, tags: Array.from({ length: 40 }, (_, i) => "a-rather-long-tag-name-number-" + i), added: "2026-01-02T00:00:00Z", versions: { v1: "o2.pdf", v2: "o2b.pdf", v3: "o2c.pdf" }, journal: { file: "o2j.pdf", name: "Journal of Extraordinarily Long Names in Theoretical Physics", year: 2024 }, doi: "10.1000/" + "x".repeat(120) },
      "2301.10003": { title: "Null fields", authors: null, authorCount: null, tags: null, added: null, versions: { v1: "o3.pdf" }, note: 7 },
      "2301.10004": { title: "Odd versions", authors: [42, null, "Real Name"], authorCount: 3, added: "not a date", versions: { v1: "o4.pdf", v2: 99 } },
      "doi:10.1/odd": { title: "", authors: [], authorCount: 0, added: "2026-01-03T00:00:00Z", versions: {}, journal: { file: "odd.pdf" } },
      "ads:1970A&A.....5...84Z": { title: "", authors: [], authorCount: 0, added: "2026-01-04T00:00:00Z", versions: {}, bibcode: "1970A&A.....5...84Z", journal: { file: "1970A&A.....5...84Z.pdf", bibcode: "1970A&A.....5...84Z", name: "A&A", year: 1970 } },
      "hep-th/9901001": { title: "Old style <b>not bold</b> & \"quotes\"", authors: ["Ann <i>Smith</i>"], authorCount: 1, added: "2026-01-05T00:00:00Z", versions: { v1: "hep-th_9901001v1.pdf" } },
      "2301.10008": { title: "Long word authors", authors: ["Wolfeschlegelsteinhausenbergerdorffvortrailmmlerstangensteinhausenbergerdorff Hubert"], authorCount: 1, added: "2026-01-06T00:00:00Z", versions: { v1: "o8.pdf" }, tags: ["ü-tag", "日本語のタグ", "emoji 🐈"] },
    };
    seed(odd);
    ["o1.pdf", "o2.pdf", "o2b.pdf", "o2c.pdf", "o2j.pdf", "o3.pdf", "o4.pdf", "odd.pdf", "1970A&A.....5...84Z.pdf", "hep-th_9901001v1.pdf", "o8.pdf"].forEach((f) => fakeDir.put(f, "%PDF-"));
    document.getElementById("rebuild").click(); await sleep(4000); // (Update index pauses between lookups)
    const shown = [...document.querySelectorAll(".paper")];
    check("every paper of an index with odd values is shown", shown.length === Object.keys(odd).length, shown.length + " | " + document.getElementById("msg").textContent);
    check("no script error while showing them", errors.length === 0, errors.join(" | "));
    check("HTML in a title or author name is shown as text, never as markup", !document.querySelector("#list b, #list i") && document.getElementById("list").textContent.includes("<b>not bold</b>"));
    const titleOf = (id) => (document.querySelector('.paper[data-id="' + CSS.escape(id) + '"] a') || {}).textContent || "";
    check("a paper without a title is shown by its label", titleOf("ads:1970A&A.....5...84Z").includes("1970A&A") && titleOf("doi:10.1/odd").length > 0, titleOf("ads:1970A&A.....5...84Z") + " | " + titleOf("doi:10.1/odd"));

    // Searching, sorting and filtering through odd values do not break the page.
    const search = document.getElementById("search"), scope = document.getElementById("search-scope"), sortKey = document.getElementById("sort-key"), filter = document.getElementById("note-filter");
    for (const sc of ["authors", "title", "number", "tag"]) {
      scope.value = sc; scope.dispatchEvent(new Event("change"));
      search.value = "a"; search.dispatchEvent(new Event("input")); await sleep(80);
    }
    search.value = ""; search.dispatchEvent(new Event("input"));
    scope.value = "authors"; scope.dispatchEvent(new Event("change"));
    for (const k of [...sortKey.options].map((o) => o.value)) { sortKey.value = k; sortKey.dispatchEvent(new Event("change")); await sleep(60); }
    for (const f of ["note", "summary", "all"]) { filter.value = f; filter.dispatchEvent(new Event("change")); await sleep(60); }
    sortKey.value = "added"; sortKey.dispatchEvent(new Event("change")); await sleep(100);
    check("searching in every scope, every sort order and every filter work with odd values", errors.length === 0 && document.querySelectorAll(".paper").length === Object.keys(odd).length, errors.join(" | "));

    { const st = document.createElement("style"); st.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }"; document.head.append(st); } // (colours are measured right after a theme change, not in the middle of a fade)
    // Layout: no sideways scrolling and nothing sticking out of its card, wide and narrow, in every theme.
    const contrast = (fg, bg) => {
      const lum = (c) => { const v = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    };
    // The colour behind an element: its background and its ancestors' ones, see-through ones blended over what is below.
    const rgba = (c) => { const v = (c.match(/[\d.]+/g) || [0, 0, 0, 0]).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
    const bgOf = (el) => {
      const layers = [];
      for (; el; el = el.parentElement) { const c = rgba(getComputedStyle(el).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; }
      let out = layers.length && layers[layers.length - 1][3] >= 1 ? layers.pop() : [255, 255, 255, 1];
      while (layers.length) { const [r, g, b, a] = layers.pop(); out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a), 1]; }
      return "rgb(" + out.slice(0, 3).join(",") + ")";
    };
    const overflow = [], low = [];
    for (const theme of THEMES) {
      if (theme === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", theme);
      for (const width of ["1000px", "520px"]) {
        document.body.style.width = width; await sleep(30);
        const page = document.documentElement;
        if (page.scrollWidth > page.clientWidth + 1) overflow.push(theme + "@" + width + ": page " + page.scrollWidth);
        for (const card of document.querySelectorAll(".paper")) {
          const box = card.getBoundingClientRect();
          for (const el of card.querySelectorAll("*")) {
            const r = el.getBoundingClientRect();
            if (r.width && (r.right > box.right + 1 || r.left < box.left - 1)) { overflow.push(theme + "@" + width + ": " + card.dataset.id + " " + el.tagName + "." + el.className + " " + Math.round(r.right - box.right)); break; }
          }
        }
      }
      document.body.style.width = "";
      // Readable text: the main text 4.5:1 or better, secondary (muted) text 3:1 or better (WCAG).
      const samples = [["title", document.querySelector(".paper a"), 4.5], ["authors", document.querySelector(".paper .meta, .paper .authors") || document.querySelector(".paper div"), 3], ["count line", document.getElementById("msg"), 3], ["button", document.getElementById("rebuild"), 4.5], ["tag", document.querySelector(".paper .tag, .paper .chip"), 3], ["search box", document.getElementById("search"), 4.5], ["header link", document.querySelector(".header-actions a"), 3]];
      for (const [name, el, min] of samples) {
        if (!el) continue;
        const ratio = contrast(getComputedStyle(el).color, bgOf(el));
        if (ratio < min) low.push(theme + " " + name + " " + ratio.toFixed(2));
      }
    }
    document.documentElement.removeAttribute("data-theme");
    check("no sideways scrolling and nothing sticks out of a paper's card (7 themes, 1000px and 520px)", overflow.length === 0, overflow.slice(0, 8).join(" | "));
    check("text is readable in every theme (contrast: main text 4.5:1, secondary text 3:1)", low.length === 0, low.join(" | "));
    check("still no script error", errors.length === 0, errors.join(" | "));
  } catch (e) { results.push("EXCEPTION " + e.stack); }
  document.getElementById("test-out").textContent = results.join("\n");
})();
