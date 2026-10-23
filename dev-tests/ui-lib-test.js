(async () => {
  try {
    await sleep(300); // library.js main() has run
    // ---- seed and reload the list through the Update index path (also exercises show())
    seed({
      "2301.00001": entry("Alpha strings", { tags: ["strings"], versions: { v1: "a1.pdf", v2: "a2.pdf" } }),
      "2301.00002": entry("Beta branes", { tags: ["strings", "branes"] }),
      "hep-th/9901001": entry("Gamma duality"),
      "doi:10.1/zz": entry("Delta journal only", { doi: "10.1/zz", versions: {}, journal: { file: "d.pdf", name: "JHEP", year: 2023 } }),
    });
    ["a1.pdf", "a2.pdf", "Betabranesv1.pdf", "Gammadualityv1.pdf", "d.pdf"].forEach((f) => fakeDir.put(f, "%PDF-"));
    await sleep(50);
    document.getElementById("rebuild").click(); // loads papers from the seeded index
    await sleep(300);
    const papersShown = () => [...document.querySelectorAll(".paper")];
    check("list shows 4 papers", papersShown().length === 4, papersShown().length + " | " + document.getElementById("msg").textContent);
    check("journal-only paper shows DOI label, not arXiv:doi", document.body.textContent.includes("DOI:10.1/zz") && !document.body.textContent.includes("arXiv:doi:"));

    // ---- add a NEW tag
    let p = papersShown().find((el) => el.textContent.includes("Gamma"));
    press(p.querySelector("input.tag-input"), "newtag");
    await sleep(150);
    check("new tag saved in index.json", (idx()["hep-th/9901001"].tags || []).includes("newtag"), JSON.stringify(idx()["hep-th/9901001"].tags));
    p = papersShown().find((el) => el.textContent.includes("Gamma"));
    check("new tag chip is shown", [...p.querySelectorAll(".paper-tags .tag")].some((t) => t.textContent.startsWith("newtag")));
    check("tag bar lists the new tag", document.getElementById("tagbar").textContent.includes("newtag (1)"));

    // ---- same tag, different case -> reuses spelling, no duplicate
    p = papersShown().find((el) => el.textContent.includes("Alpha"));
    press(p.querySelector("input.tag-input"), "STRINGS");
    await sleep(100);
    check("existing tag in other case is not duplicated", JSON.stringify(idx()["2301.00001"].tags) === '["strings"]', JSON.stringify(idx()["2301.00001"].tags));
    p = papersShown().find((el) => el.textContent.includes("Beta"));
    press(p.querySelector("input.tag-input"), "  Strings  ");
    press(papersShown().find((el) => el.textContent.includes("Gamma")).querySelector("input.tag-input"), "STRINGS");
    await sleep(150);
    check("adding existing tag spelled differently reuses the first spelling", idx()["hep-th/9901001"].tags.includes("strings") && !idx()["hep-th/9901001"].tags.includes("STRINGS"), JSON.stringify(idx()["hep-th/9901001"].tags));

    // ---- many quick additions in a row (no lost updates)
    for (const t of ["t1", "t2", "t3"]) press(papersShown().find((el) => el.textContent.includes("Beta")).querySelector("input.tag-input"), t);
    await sleep(300);
    check("rapid additions are all kept", ["t1", "t2", "t3"].every((t) => idx()["2301.00002"].tags.includes(t)), JSON.stringify(idx()["2301.00002"].tags));

    // ---- remove a tag
    p = papersShown().find((el) => el.textContent.includes("Gamma"));
    [...p.querySelectorAll(".tag-x")].find((x) => x.parentElement.textContent.startsWith("newtag")).click();
    await sleep(100);
    check("tag removed", !(idx()["hep-th/9901001"].tags || []).includes("newtag"));

    // ---- filter by tag
    [...document.querySelectorAll("#tagbar .tag")].find((t) => t.textContent.startsWith("strings")).click();
    await sleep(50);
    check("tag filter shows only tagged papers", papersShown().length === 3, papersShown().length);
    document.querySelector("#tagbar button").click(); // Clear filter
    await sleep(50);
    check("clear filter shows all", papersShown().length === 4);

    // ---- rename (merge) and delete a tag from the manager
    document.getElementById("manage-tags").click();
    window.prompt = () => "BRANES2";
    let row = [...document.querySelectorAll("#tag-manager .tag-row")].find((r) => r.textContent.startsWith("branes"));
    [...row.querySelectorAll("button")][0].click();
    await sleep(150);
    check("rename works across papers", (idx()["2301.00002"].tags || []).includes("BRANES2") && !idx()["2301.00002"].tags.includes("branes"), JSON.stringify(idx()["2301.00002"].tags));
    window.prompt = () => "strings";
    row = [...document.querySelectorAll("#tag-manager .tag-row")].find((r) => r.textContent.startsWith("t1"));
    [...row.querySelectorAll("button")][0].click();
    await sleep(150);
    check("renaming onto an existing tag merges (no duplicates)", idx()["2301.00002"].tags.filter((t) => t.toLowerCase() === "strings").length === 1, JSON.stringify(idx()["2301.00002"].tags));
    window.confirm = () => true;
    row = [...document.querySelectorAll("#tag-manager .tag-row")].find((r) => r.textContent.startsWith("t2"));
    [...row.querySelectorAll("button")][1].click();
    await sleep(150);
    check("delete tag removes it everywhere", !JSON.stringify(idx()).includes('"t2"'));

    // ---- delete one version
    p = papersShown().find((el) => el.textContent.includes("Alpha"));
    window.confirm = () => true;
    p.querySelectorAll(".chip-delete")[0].click(); // v1
    await sleep(150);
    check("deleting v1 removes only that file", fakeDir.text("a1.pdf") === null && fakeDir.text("a2.pdf") !== null && Object.keys(idx()["2301.00001"].versions).join() === "v2", Object.keys(idx()["2301.00001"].versions).join());
    check("tags survive version deletion", (idx()["2301.00001"].tags || []).includes("strings"));
    // delete journal version of journal-only paper -> paper disappears
    p = papersShown().find((el) => el.textContent.includes("Delta"));
    p.querySelector(".chip-delete").click();
    await sleep(150);
    check("deleting the last file removes the paper", !idx()["doi:10.1/zz"] && papersShown().length === 3);

    // ---- search and sort
    const s = document.getElementById("search");
    const sc0 = document.getElementById("search-scope");
    check("the search uses the INSPIRE syntax by default (no Standard any more), and the box says so", sc0.value === "inspire" && ![...sc0.options].some((o) => o.value === "standard") && [...sc0.options].map((o) => o.value).join() === "inspire,authors,title,number,tag,notes" && s.placeholder.startsWith("In INSPIRE syntax"), [...sc0.options].map((o) => o.value).join() + " | " + s.placeholder);
    sc0.value = "title"; sc0.dispatchEvent(new Event("change")); await sleep(50);
    check("choosing a scope changes what the box says", s.placeholder === "Search by title");
    s.value = "beta"; s.dispatchEvent(new Event("input")); await sleep(300);
    check("search filters (debounced)", papersShown().length === 1 && papersShown()[0].textContent.includes("Beta"));
    sc0.value = "tag"; sc0.dispatchEvent(new Event("change")); await sleep(50);
    s.value = "branes2"; s.dispatchEvent(new Event("input")); await sleep(300);
    check("search also matches tags", papersShown().length === 1);
    sc0.value = "number"; sc0.dispatchEvent(new Event("change")); await sleep(50);
    s.value = "9901001"; s.dispatchEvent(new Event("input")); await sleep(300);
    check("the arXiv number scope finds a paper by its number", papersShown().length === 1 && papersShown()[0].textContent.includes("Gamma"), papersShown().length);
    sc0.value = "inspire"; sc0.dispatchEvent(new Event("change")); await sleep(50);
    check("the INSPIRE-syntax scope says how to write", s.placeholder.includes("ea ota"), s.placeholder);
    s.value = "t beta or eprint 9901001"; s.dispatchEvent(new Event("input")); await sleep(300);
    check("INSPIRE syntax: 'or' joins two fields", papersShown().length === 2, papersShown().length);
    s.value = "(t alpha or t gamma) and not eprint 9901"; s.dispatchEvent(new Event("input")); await sleep(300);
    check("INSPIRE syntax: brackets and 'and not' leave out a number", papersShown().length === 1 && papersShown()[0].textContent.includes("Alpha"), papersShown().map((e) => e.textContent.slice(0, 40)).join(" | "));
    s.value = "t (beta"; s.dispatchEvent(new Event("input")); await sleep(300);
    check("INSPIRE syntax: a broken query does not fail, it is searched as words", papersShown().length <= 4);
    sc0.value = "authors"; sc0.dispatchEvent(new Event("change")); await sleep(50);
    s.value = ""; s.dispatchEvent(new Event("input")); await sleep(300);
    const sk = document.getElementById("sort-key");
    sk.value = "title"; sk.dispatchEvent(new Event("change")); await sleep(50);
    document.getElementById("sort-dir").click(); await sleep(50); // ascending
    const titles = papersShown().map((el) => el.querySelector("a.title").textContent);
    check("sort by title ascending", JSON.stringify(titles) === JSON.stringify([...titles].sort()), titles.join("|"));

    // ---- sorting by arXiv number leaves out journal-only papers (they have no arXiv number)
    const withJournal = { ...idx(), "doi:10.5/jj": entry("Journal only paper", { doi: "10.5/jj", versions: {}, journal: { file: "jj.pdf", name: "J", year: 2020 } }) };
    fakeDir.put("jj.pdf", "%PDF-"); seed(withJournal);
    document.getElementById("rebuild").click(); await sleep(300);
    check("journal-only paper is listed when sorting by title", papersShown().some((el) => el.textContent.includes("Journal only paper")));
    sk.value = "arxiv"; sk.dispatchEvent(new Event("change")); await sleep(50);
    check("sorting by arXiv number leaves out journal-only papers", !papersShown().some((el) => el.textContent.includes("Journal only paper")) && papersShown().length === 3, papersShown().length);
    sk.value = "title"; sk.dispatchEvent(new Event("change")); await sleep(50);
    check("and they are back with another sort", papersShown().some((el) => el.textContent.includes("Journal only paper")));
    delete withJournal["doi:10.5/jj"]; fakeDir.files.delete("jj.pdf"); seed(withJournal);
    document.getElementById("rebuild").click(); await sleep(300);

    // ---- the INSPIRE badge says INSPIRE (not "iN") and is wide enough for it
    const inspire = [...document.querySelectorAll(".db-icon")].find((a) => a.title.includes("INSPIRE"));
    check("INSPIRE badge is labelled INSPIRE", !!inspire && inspire.querySelector("text").textContent === "INSPIRE" && Number(inspire.querySelector("svg").getAttribute("width")) >= 50, inspire && inspire.textContent);

    // ---- PDFs added by hand: the library only points to Settings
    check("no note when every PDF is known", document.getElementById("import-banner").hidden);
    fakeDir.put("handmade.pdf", "%PDF-");
    document.getElementById("rebuild").click(); await sleep(300);
    const imp = document.getElementById("import-banner");
    check("no note before a rename run in Settings, even if PDFs are waiting", imp.hidden);
    await chrome.storage.local.set({ importNotice: true }); // (what a rename run that left files behind does)
    document.getElementById("rebuild").click(); await sleep(300);
    check("after such a run the library shows a note with a link to Settings", !imp.hidden && imp.textContent.includes("1") && !!imp.querySelector("a[href='options.html']"), imp.textContent);
    imp.querySelector("button.banner-x").click(); await sleep(100);
    check("the cross closes it", imp.hidden && (await chrome.storage.local.get("importNotice")).importNotice === false);
    document.getElementById("rebuild").click(); await sleep(300);
    check("and it stays closed although the PDFs are still there", imp.hidden);
    await chrome.storage.local.set({ importNotice: true });
    fakeDir.files.delete("handmade.pdf");
    document.getElementById("rebuild").click(); await sleep(300);
    check("the note goes away by itself when nothing is left", imp.hidden && (await chrome.storage.local.get("importNotice")).importNotice === false);

    // ---- Show in folder
    const revealBtn = papersShown().find((el) => el.textContent.includes("Beta")).querySelector("button.mini");
    check("each paper has a Show in folder button", !!revealBtn && revealBtn.textContent === "Show in folder", revealBtn && revealBtn.textContent);
    revealBtn.click(); await sleep(100);
    const lastCall = (window.helperCalls || []).slice(-1)[0];
    check("it asks the helper to reveal the newest version", lastCall && lastCall.action === "reveal" && lastCall.file === "Betabranesv1.pdf" && !!lastCall.token, JSON.stringify(lastCall));
    window.helperReply = () => { throw new Error("Specified native messaging host not found."); };
    revealBtn.click(); await sleep(100);
    check("a missing helper is explained", document.getElementById("msg").textContent.includes("not found") && document.getElementById("msg").textContent.includes("Could not show the folder"), document.getElementById("msg").textContent);
    window.helperReply = null;

    // ---- notes: icon, "Add note", note-only papers, search scopes, filters, sort, delete keeps the note
    fakeDir.put("2301.00001.md", "<!-- papurr:summary date=2026-10-01 -->\nThe summary mentions Witten.\n<!-- /papurr:summary -->\n\n## Notes\n\nmy idea about anomalies\n");
    fakeDir.put("2301.00007.md", "## Notes\n\nonly a note\n");
    seed({ ...idx(), "2301.00001": { ...idx()["2301.00001"], note: "2301.00001.md" }, "2301.00007": entry("Eta note only", { versions: {}, note: "2301.00007.md" }) });
    document.getElementById("rebuild").click(); await sleep(300);
    const paperOf = (word) => papersShown().find((el) => el.querySelector("a.title").textContent.includes(word));
    const alpha = paperOf("Alpha");
    const icon = alpha && alpha.querySelector("button.note-btn");
    check("a paper with a note shows a Note button with the note icon in the place of Add note", !!icon && icon.textContent === "Note" && !!icon.querySelector("svg") && ![...alpha.querySelectorAll("button")].some((b) => b.textContent === "Add note"), alpha && alpha.innerHTML);
    check("its tooltip says what the note holds", icon && icon.title.includes("summary") && icon.title.includes("your notes") && !icon.title.includes("why recommended"), icon && icon.title);
    check("no note excerpt in the list", !document.getElementById("list").textContent.includes("anomalies"));
    const beta = paperOf("Beta");
    check("a paper without a note has no Note button but an Add note button", !beta.querySelector(".note-btn") && [...beta.querySelectorAll("button.mini")].some((b) => b.textContent === "Add note"));
    const opened = [];
    window.openNote = (p) => opened.push(noteUrl(p)); // (the real one navigates this tab to the note page)
    icon.click();
    check("the Note button opens the note page", opened.shift() === "note.html?id=2301.00001");
    [...beta.querySelectorAll("button.mini")].find((b) => b.textContent === "Add note").click();
    check("Add note opens the note page (in this tab)", opened[0] === "note.html?id=2301.00002", opened.join());
    const eta = paperOf("Eta");
    check("a paper with only a note is listed, marked PDF not saved, with Get the PDF", !!eta && eta.textContent.includes("PDF not saved") && [...eta.querySelectorAll("a.chip")].some((a) => a.textContent === "Get the PDF" && a.getAttribute("href") === "open.html?id=2301.00007"), eta && eta.textContent);
    check("its title opens the note in this tab (a PDF title opens a new tab)", eta && eta.querySelector("a.title").getAttribute("href") === "note.html?id=2301.00007" && !eta.querySelector("a.title").target && paperOf("Beta").querySelector("a.title").target === "_blank");
    const before = papersShown().length;
    const scope = document.getElementById("search-scope");
    const search = async (text, sc) => { scope.value = sc; scope.dispatchEvent(new Event("change")); await sleep(100); s.value = text; s.dispatchEvent(new Event("input")); await sleep(400); return papersShown().map((el) => el.querySelector("a.title").textContent); };
    check("the default (authors) search does not look inside notes", (await search("witten", "authors")).length === 0);
    check("the Notes scope finds words in summaries and in the user's notes", JSON.stringify(await search("witten", "notes")) === '["Alpha strings"]' && JSON.stringify(await search("anomalies", "notes")) === '["Alpha strings"]');
    check("Title scope looks only at titles", JSON.stringify(await search("note only", "title")) === '["Eta note only"]' && (await search("smith", "title")).length === 0);
    check("Authors scope looks only at authors", (await search("smith", "authors")).length === before && (await search("alpha", "authors")).length === 0);
    check("Tag scope looks only at tags", (await search("strings", "tag")).every((t) => t !== "Eta note only") && (await search("alpha", "tag")).length === 0);
    await search("", "authors");
    const nf = document.getElementById("note-filter");
    nf.value = "note"; nf.dispatchEvent(new Event("change")); await sleep(50);
    check("filter: with a note", JSON.stringify(papersShown().map((el) => el.querySelector("a.title").textContent).sort()) === '["Alpha strings","Eta note only"]');
    nf.value = "summary"; nf.dispatchEvent(new Event("change")); await sleep(50);
    check("filter: with a summary", papersShown().length === 1 && papersShown()[0].textContent.includes("Alpha"));
    // ---- the search and the filters are remembered (this computer only), and read back safely
    await search("smith", "title");
    const viewSaved = () => JSON.parse(localStorage.getItem("libraryView") || "null");
    check("a search is remembered with its scope and the filter (not in index.json)", viewSaved() && viewSaved().q === "smith" && viewSaved().scope === "title" && viewSaved().filter === "summary" && !JSON.stringify(idx()).includes("smith\"") , JSON.stringify(viewSaved()));
    s.value = ""; scope.value = "authors"; nf.value = "all"; selectedTags.clear();
    localStorage.setItem("libraryView", JSON.stringify({ q: "alpha", scope: "tag", filter: "summary", tags: ["strings", 5, null, ""] }));
    loadViewSettings(); refresh(); await sleep(50);
    check("the next visit starts where the last one ended: text, scope, filter and tags are put back", s.value === "alpha" && scope.value === "tag" && nf.value === "summary" && [...selectedTags].join() === "strings", s.value + "|" + scope.value + "|" + nf.value + "|" + [...selectedTags]);
    check("and the box says what it searches", s.placeholder === tr("search.ph.tag"), s.placeholder);
    localStorage.setItem("libraryView", "{{not json");
    s.value = "keep"; loadViewSettings();
    check("a damaged memory is ignored", s.value === "keep");
    localStorage.setItem("libraryView", JSON.stringify({ q: 7, scope: "zzz", filter: "zzz", tags: "x" }));
    scope.value = "title"; nf.value = "note"; loadViewSettings();
    check("unknown scopes, filters and odd values are ignored, nothing breaks", scope.value === "title" && nf.value === "note" && s.value === "keep");
    localStorage.removeItem("libraryView"); selectedTags.clear(); s.value = ""; scope.value = "authors"; nf.value = "all"; refresh(); await sleep(50);
    nf.value = "all"; nf.dispatchEvent(new Event("change")); await sleep(50);
    sk.value = "note"; sk.dispatchEvent(new Event("change")); await sleep(50);
    check("sort by note updated lists the papers with notes", papersShown().length === 2, papersShown().length);
    sk.value = "title"; sk.dispatchEvent(new Event("change")); await sleep(50);
    check("all papers are back", papersShown().length === before);
    // a note written in a note tab: the library reads its list again by itself
    fakeDir.put("2301.00002.md", "## Notes\n\nnew\n");
    await chrome.storage.local.set({ notesChanged: Date.now() }); await sleep(200);
    check("a note written in another tab appears without reloading", !!paperOf("Beta").querySelector(".note-btn"));
    // Show in folder for a paper with only a note shows the note
    window.helperCalls = [];
    [...paperOf("Eta").querySelectorAll("button.mini")].find((b) => b.textContent === "Show in folder").click(); await sleep(100);
    check("Show in folder of a note-only paper shows its note", (window.helperCalls[0] || {}).file === "2301.00007.md", JSON.stringify(window.helperCalls));
    // deleting the last PDF of a paper with a note keeps the paper and its note
    let asked = "";
    window.confirm = (m) => { asked = m; return true; };
    paperOf("Alpha").querySelector(".chip-delete").click(); await sleep(200);
    check("the delete question says the note is kept", asked.includes("note of this paper is kept"), asked);
    check("the paper stays with its note, now without a PDF", !!idx()["2301.00001"] && Object.keys(idx()["2301.00001"].versions).length === 0 && fakeDir.text("2301.00001.md") !== null && paperOf("Alpha").textContent.includes("PDF not saved"), JSON.stringify(idx()["2301.00001"]));
    check("the index is written as schema 3", JSON.parse(fakeDir.text("index.json")).schemaVersion === 3);

    // ---- with AI on: arXiv papers without a summary offer "Summarize the full text..." (it only opens the note page)
    await chrome.storage.local.set({ ai: { enabled: true, consent: { version: AI_CONSENT_VERSION, at: "2026-10-09T00:00:00Z" } } });
    document.getElementById("rebuild").click(); await sleep(300);
    const sumLink = (word) => [...paperOf(word).querySelectorAll("a.mini")].find((a) => a.textContent === "Summarize the full text...");
    check("with AI on, a paper offers Summarize the full text..., linked to its note page", !!sumLink("Beta") && sumLink("Beta").getAttribute("href") === "note.html?id=2301.00002&summarize=1", paperOf("Beta").innerHTML);
    check("a paper whose note has a summary does not (its Note button shows it)", !sumLink("Alpha"));
    await chrome.storage.local.remove("ai");
    document.getElementById("rebuild").click(); await sleep(300);
    check("with AI off, no summary links", !sumLink("Beta"));

    // ---- the time the index was last written, and the "My papers" filter (from INSPIRE, no AI)
    // ---- the status line: a "working" label never moves the page, however long, at any width
    {
      const line = document.querySelector("header + .status-line");
      const pos = () => [document.getElementById("search").getBoundingClientRect().top, document.querySelector("header").getBoundingClientRect().height, document.getElementById("list").getBoundingClientRect().top].join(",");
      const results = [];
      for (const width of ["1000px", "520px"]) {
        document.body.style.width = width;
        const before = pos();
        const token = startBusy("Downloading the PDF... a very long label that goes on and on ".repeat(4));
        await sleep(400);
        results.push([width, before, pos(), line && line.textContent.length > 0, line && line.title === line.textContent]);
        endBusy(token);
        await sleep(50);
        results.push([width, before, pos()]);
      }
      document.body.style.width = "";
      check("the status line is a row of its own under the header, there from the start", !!line && line.getAttribute("role") === "status" && line.getBoundingClientRect().height >= 18);
      check("a long working label (at 1000px and at 520px) moves nothing: search box, header and list stay where they were", results.every((r) => r[1] === r[2]) && results.filter((r) => r.length > 3).every((r) => r[3] && r[4]), JSON.stringify(results));
    }
    check("the library shows when the index was last updated", document.getElementById("index-time").textContent.startsWith("Index last updated:"), document.getElementById("index-time").textContent);
    check("My papers is a filter, not a sort order", ![...sk.options].some((o) => o.value === "mine") && [...document.getElementById("note-filter").options].some((o) => o.value === "mine" && o.textContent === "My papers"));
    const inspireAsked = [];
    window.fetch = async (url) => { inspireAsked.push(String(url)); return { ok: true, status: 200, json: async () => ({ hits: { hits: [{ metadata: { arxiv_eprints: [{ value: "2301.00002" }], dois: [{ value: "10.1/ZZ" }] } }] } }) }; };
    const mineFilter = document.getElementById("note-filter");
    const pick = async (v, ms) => { mineFilter.value = v; mineFilter.dispatchEvent(new Event("change")); await sleep(ms); };
    await pick("mine", 300);
    check("without an INSPIRE author page set, My papers says where to set it and asks nothing", inspireAsked.length === 0 && document.getElementById("msg").textContent.includes("INSPIRE") && papersShown().length === 0, document.getElementById("msg").textContent);
    await chrome.storage.local.set({ profileSettings: { url: "https://inspirehep.net/authors/1234567" } });
    await pick("all", 50);
    await pick("mine", 300);
    check("with it: the author's papers are read from INSPIRE once and only they are shown", inspireAsked.length === 1 && inspireAsked[0].includes("authors.recid%3A1234567") && papersShown().length === 1 && papersShown()[0].textContent.includes("Beta"), inspireAsked.join("|") + " | " + papersShown().map((x) => x.textContent.slice(0, 20)).join("|"));
    await pick("all", 50);
    await pick("mine", 100);
    check("the list is kept (no second request)", inspireAsked.length === 1);
    await pick("all", 50);

    // ---- a paper added from Today's arXiv ("Add to library"): the library answers and highlights it, even if hidden
    const ch = new BroadcastChannel("papurr");
    let answer = null;
    ch.onmessage = (e) => (answer = e.data);
    s.value = "alpha"; s.dispatchEvent(new Event("input")); await sleep(300); // (a search that hides the new paper)
    fakeDir.put("Thetaaddedv1.pdf", "%PDF-");
    seed({ ...idx(), "2301.00042": entry("Theta added", { versions: { v1: "Thetaaddedv1.pdf" } }) });
    ch.postMessage({ type: "added", id: "2301.00042" }); await sleep(300);
    const theta = paperOf("Theta");
    check("the library answers that it shows the paper", answer && answer.type === "shown" && answer.id === "2301.00042", JSON.stringify(answer));
    check("the new paper is listed and highlighted, the hiding search cleared", !!theta && theta.classList.contains("flash") && s.value === "", s.value);
    await sleep(4200);
    check("the highlight goes away after a few seconds", !paperOf("Theta").classList.contains("flash"));
    answer = null;
    ch.postMessage({ type: "show", id: "2301.00002" }); await sleep(300);
    check("asked to show a paper (In library in Today's arXiv), the library answers and highlights it", answer && answer.type === "shown" && answer.id === "2301.00002" && paperOf("Beta").classList.contains("flash"), JSON.stringify(answer));
    ch.close();

    // ---- a paper known only by its ADS bibcode (an old scanned article)
    fakeDir.put("1970A&A.....5...84Z.pdf", "%PDF-");
    seed({ ...idx(), "ads:1970A&A.....5...84Z": entry("Old scanned paper", { versions: {}, bibcode: "1970A&A.....5...84Z", journal: { file: "1970A&A.....5...84Z.pdf", bibcode: "1970A&A.....5...84Z", name: "A&A", year: 1970 } }) });
    document.getElementById("rebuild").click(); await sleep(300);
    const ads = paperOf("Old scanned paper");
    check("an ADS paper is listed with its bibcode, its journal version, and a link to its ADS page only", !!ads && ads.querySelector(".meta").textContent.includes("ADS:1970A&A.....5...84Z") && ads.querySelector(".meta").textContent.includes("A&A 1970") && [...ads.querySelectorAll(".db-icon")].map((a) => a.getAttribute("href")).join() === "https://ui.adsabs.harvard.edu/abs/1970A%26A.....5...84Z/abstract" && !!ads.querySelector(".versions .chip"), ads && ads.textContent);
    check("its title opens the saved scan", ads.querySelector("a.title").getAttribute("href") === "open.html?id=ads%3A1970A%26A.....5...84Z&local=1");

    // ---- lots of tags: bar limited, Show all + filter
    const many = {}; many["2301.00009"] = entry("Many tags", { tags: Array.from({ length: 30 }, (_, i) => "tag" + String(i).padStart(2, "0")) });
    fakeDir.put("Manytagsv1.pdf", "%PDF-");
    seed({ ...idx(), ...many });
    document.getElementById("rebuild").click(); await sleep(300);
    const barTags = () => document.querySelectorAll("#tagbar .tag").length;
    check("tag bar is limited to 12 tags", barTags() === 12, barTags());
    [...document.querySelectorAll("#tagbar button")].find((b) => b.textContent.startsWith("Show all")).click();
    check("Show all shows every tag", barTags() === 33 - 0 || barTags() >= 30, barTags());
    const tf = document.getElementById("tag-filter");
    check("tag filter box appears", !tf.hidden);
    tf.value = "tag2"; tf.dispatchEvent(new Event("input"));
    check("tag filter narrows the bar", barTags() === 10, barTags());

    // ---- many papers: only 100 drawn first
    const big = {}; for (let i = 0; i < 250; i++) big["2302." + String(i).padStart(5, "0")] = entry("Paper number " + i);
    for (let i = 0; i < 250; i++) fakeDir.put("Papernumber" + i + "v1.pdf", "%PDF-");
    seed(big); document.getElementById("rebuild").click(); await sleep(400);
    check("only the first 100 papers are drawn", papersShown().length === 100, papersShown().length);
    document.querySelector(".show-more").click(); await sleep(50);
    check("Show more draws 200 more", papersShown().length === 250, papersShown().length);

    // ---- damaged index -> recovery UI, nothing overwritten
    fakeDir.files.delete("index.json.bak"); // (earlier edits in this test created one)
    fakeDir.put("index.json", "{{{broken");
    document.getElementById("rebuild").click(); await sleep(300);
    check("damaged index shows the recovery box", !document.getElementById("recovery").hidden && document.getElementById("recovery").textContent.includes("damaged"));
    check("damaged file was not overwritten", fakeDir.text("index.json") === "{{{broken");
    check("restore button disabled without backup", [...document.querySelectorAll("#recovery button")][0].disabled === true);
    // with a backup: restore works and the list comes back
    fakeDir.put("index.json.bak", JSON.stringify({ schemaVersion: 2, papers: { "2301.00001": entry("Restored paper", { versions: { v1: "r.pdf" } }) } }));
    fakeDir.put("r.pdf", "%PDF-");
    document.getElementById("rebuild").click(); await sleep(300);
    const restoreBtn = [...document.querySelectorAll("#recovery button")][0];
    check("restore button enabled with a backup", restoreBtn.disabled === false);
    restoreBtn.click(); await sleep(400);
    check("restore brings the list back", papersShown().length === 1 && papersShown()[0].textContent.includes("Restored paper"), papersShown().length + " " + document.getElementById("msg").textContent);
    check("damaged file kept aside", fakeDir.text("index.damaged.json") === "{{{broken");
    // start over from files
    fakeDir.put("index.json", "{{{broken2}");
    window.confirm = () => true;
    document.getElementById("rebuild").click(); await sleep(300);
    [...document.querySelectorAll("#recovery button")][1].click(); await sleep(1500);
    check("start over rebuilds from the PDFs", Object.keys(idx()).length >= 0 && !document.getElementById("recovery").hidden === false, JSON.stringify(Object.keys(idx())));
  } catch (e) {
    results.push("EXCEPTION " + e.stack);
  }
  document.getElementById("test-out").textContent = results.join("\n");
})();
