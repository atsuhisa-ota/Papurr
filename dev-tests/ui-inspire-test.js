// The INSPIRE page: its own box; the API is asked only on Enter (or the Search button); results as cards with at most 5 authors,
// BibTeX, Cited by, References, links and the author links; the order; errors in words; In library / Add to library.
(async () => {
  try {
    await sleep(500); // inspire-page.js has run and read the library
    const $ = (id) => document.getElementById(id);
    const s = $("search");
    const msg = () => $("msg").textContent;
    const cards = () => [...document.querySelectorAll("#list .inspire-hit")];
    const btn = (card, re) => [...card.querySelectorAll("button, a.mini")].find((b) => re.test(b.textContent));
    const enter = async (text) => { s.value = text; s.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await sleep(350); };
    const ja = new URLSearchParams(location.search).get("lang") === "ja";
    const T = (en, jp) => (ja ? jp : en);

    check("the page opens with its own box, which says what to type, and asks for Enter; nothing was asked", s.placeholder === tr("search.ph.inspire") && !!document.querySelector("#list .empty") && inspireRequests.length === 0 && cards().length === 0, s.placeholder + " " + inspireRequests.length);
    check("the header marks this page as the current one, and its link goes to this page", document.querySelector('.header-actions a[href="inspire.html"]').classList.contains("current") && document.querySelector('.header-actions a[href="inspire.html"]').textContent === "INSPIRE" && !document.querySelector('.header-actions a[href="inspire.html"]').target);
    check("the empty page links to inspirehep.net for those who want the website", document.querySelector('#list .empty a[href="https://inspirehep.net/"]').target === "_blank");
    s.value = "a fake"; s.dispatchEvent(new Event("input")); await sleep(400);
    check("typing asks nothing (only Enter or the button does)", inspireRequests.length === 0);
    s.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })); await sleep(200);
    check("an Enter that only confirms an IME conversion asks nothing either", inspireRequests.length === 0);
    s.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await sleep(400);
    check("Enter asks INSPIRE's API once: the query, a page of 25, newest first, the fields of a list", inspireRequests.length === 1 && inspireRequests[0].startsWith("https://inspirehep.net/api/literature?q=a%20fake&size=25&page=1&sort=mostrecent") && inspireRequests[0].includes("authors.full_name") && !inspireRequests[0].includes("citation_count"), inspireRequests.join("|"));
    check("25 results are listed, with how many were found, and text is shown as text", cards().length === 25 && msg().includes("30") && !document.querySelector("#list .inspire-hit b") && cards()[0].querySelector("a.title").textContent === "Fake result 1 <b>bold</b>", msg() + " " + cards().length);
    check("a card shows at most 5 authors then 'et al.' (as the library does), year, journal and arXiv number (no citation count)", cards()[0].querySelector(".meta").textContent.startsWith("Ann Smith, Bo Chen, Cy Dee, Di Eve, Ed Fox, et al. — 2026 — JHEP 10 — arXiv:2610.10000") && cards()[2].querySelector(".meta").textContent === "Ann Smith, Bo Chen, Cy Dee, Di Eve — 2026 — JHEP 10 — arXiv:2610.10002", cards()[0].querySelector(".meta").textContent + " | " + cards()[2].querySelector(".meta").textContent);
    check("an arXiv paper's title opens it through Papurr (so it is saved); one without arXiv opens its INSPIRE record", cards()[1].querySelector("a.title").getAttribute("href") === "open.html?id=2610.10001" && cards()[4].querySelector("a.title").getAttribute("href") === "https://inspirehep.net/literature/1004" && cards()[1].querySelector("a.title").target === "_blank");
    check("each card has links: PDF (through Papurr), arXiv, the DOI when there is one, INSPIRE", btn(cards()[0], /^PDF$/).getAttribute("href") === "open.html?id=2610.10000" && btn(cards()[0], /^arXiv$/).getAttribute("href") === "https://arxiv.org/abs/2610.10000" && btn(cards()[0], /^DOI$/).getAttribute("href") === "https://doi.org/10.1/x" && !btn(cards()[1], /^DOI$/) && btn(cards()[1], /^INSPIRE$/).getAttribute("href") === "https://inspirehep.net/literature/1001" && btn(cards()[1], /^INSPIRE$/).target === "_blank" && !btn(cards()[4], /^PDF$/));
    // authors
    check("a paper with more than 5 authors offers all of them, with no new request, and takes them back", !!btn(cards()[0], /7/) && !btn(cards()[1], /All|すべて|全部/));
    const requestsBefore = inspireRequests.length;
    btn(cards()[0], /7/).click(); await sleep(100);
    check("all 7 names are shown (no request was made); the button then says 'fewer'", cards()[0].querySelector(".meta").textContent.startsWith("Ann Smith, Bo Chen, Cy Dee, Di Eve, Ed Fox, Fay Gu, Gil Ho —") && !cards()[0].querySelector(".meta").textContent.includes("et al.") && inspireRequests.length === requestsBefore && !!btn(cards()[0], /Fewer|減らす|收起/));
    btn(cards()[0], /Fewer|減らす|收起/).click(); await sleep(100);
    check("and back to 5", cards()[0].querySelector(".meta").textContent.includes("et al."));
    const beforeAuthor = inspireRequests.length;
    cards()[2].querySelector(".meta a.author:nth-of-type(2)").click(); await sleep(400);
    check("a click on an author name searches INSPIRE for that author's papers with ea (the query is in the box)", inspireRequests.length === beforeAuthor + 1 && decodeURIComponent(inspireRequests[beforeAuthor]).includes("q=ea Bo Chen") && s.value === "ea Bo Chen" && cards().length === 25, s.value + " | " + inspireRequests[beforeAuthor]);
    check("every shown name is such a link, and the line still reads as plain text", cards()[0].querySelectorAll(".meta a.author").length === 5 && cards()[0].querySelector(".meta").textContent.startsWith("Ann Smith, Bo Chen, Cy Dee, Di Eve, Ed Fox, et al."));
    await enter("a fake");
    // BibTeX
    btn(cards()[1], /^BibTeX$/).click(); await sleep(300);
    check("BibTeX is read from INSPIRE and copied; the button says Copied and the line says so", inspireRequests[inspireRequests.length - 1].endsWith("/literature/1001?format=bibtex") && window.__clip === "@article{Fake:2026ab,\n    title = \"Fake result 2\"\n}" && /Copied|コピーしました|已复制/.test(btn(cards()[1], /Copied|コピーしました|已复制/).textContent) && msg() === tr("inspire.bibtex.done"), String(window.__clip));
    await sleep(2300);
    check("after two seconds the button is BibTeX again", !!btn(cards()[1], /^BibTeX$/));
    btn(cards()[2], /^BibTeX$/).click(); await sleep(300);
    check("a BibTeX that INSPIRE does not have is explained in words", msg().includes("404"), msg());
    // library
    check("a paper already in the library says so instead of offering to add it", /In library|保存済み/.test(cards()[1].textContent) && !/Add to library|ライブラリに追加/.test(cards()[1].textContent) && /Add to library|ライブラリに追加/.test(cards()[2].textContent) && !/Add to library|ライブラリに追加/.test(cards()[4].textContent));
    [...cards()[2].querySelectorAll("button")][0].click(); await sleep(200);
    check("Add to library saves in a background tab, quietly (this list stays), and the button waits", __tabs.length === 1 && __tabs[0].url === "open.html?id=2610.10002&save=1&quiet=1" && __tabs[0].active === false && cards().length === 25 && [...cards()[2].querySelectorAll("button")][0].disabled, JSON.stringify(__tabs));
    const answer = new BroadcastChannel("papurr"); answer.postMessage({ type: "added", id: "2610.10002", quiet: true }); await sleep(400);
    check("when the saving tab reports, the list stays where it is", cards().length === 25 && s.value === "a fake", cards().length);
    document.querySelector("#list .show-more").click(); await sleep(400);
    check("Show more asks for page 2 and adds the other 5", inspireRequests.filter((u) => u.includes("page=2")).length === 1 && cards().length === 30 && !document.querySelector("#list .show-more"), inspireRequests.join("|") + " " + cards().length);
    const chips = () => [...document.querySelectorAll("#list .inspire-order .tag")];
    check("the order can be chosen: newest (chosen) or oldest", chips().length === 2 && chips()[0].classList.contains("selected") && /Newest|新しい順|最新/.test(chips()[0].textContent) && /Oldest|古い順|最早/.test(chips()[1].textContent));
    const beforeSort = inspireRequests.length;
    chips()[1].click(); await sleep(400);
    check("choosing 'oldest' asks again, from page 1, with that order, and it is remembered", inspireRequests.length === beforeSort + 1 && inspireRequests[beforeSort].includes("sort=leastrecent") && inspireRequests[beforeSort].includes("page=1") && cards().length === 25 && cards()[0].querySelector("a.title").textContent.includes("(oldest first)") && localStorage.getItem("inspireSort") === "leastrecent", inspireRequests[beforeSort]);
    chips()[0].click(); await sleep(400);
    check("and back to newest", inspireRequests[inspireRequests.length - 1].includes("sort=mostrecent") && localStorage.getItem("inspireSort") === "mostrecent");
    const beforeCites = inspireRequests.length;
    check("the button is just 'Cited by' (no number anywhere)", /^(Cited by|被引用)$/.test(btn(cards()[1], /Cited by|被引用/).textContent));
    btn(cards()[1], /Cited by|被引用/).click(); await sleep(400);
    check("'Cited by' puts the INSPIRE query in the box and lists the citing papers", inspireRequests.length === beforeCites + 1 && decodeURIComponent(inspireRequests[beforeCites]).includes("q=refersto:recid:1001") && s.value === "refersto:recid:1001" && cards().length === 3 && cards()[0].querySelector("a.title").textContent.startsWith("Citing paper 1"), s.value);
    await enter("a fake");
    const beforeRefs = inspireRequests.length;
    btn(cards()[2], /^References$|^参考文献$|^参考文献$/).click(); await sleep(400);
    check("'References' asks citedby:recid:<number>", decodeURIComponent(inspireRequests[beforeRefs]).includes("q=citedby:recid:1002") && s.value === "citedby:recid:1002", s.value);
    await enter("nothing");
    check("no result: says so", cards().length === 0 && msg() === tr("inspire.none"), msg());
    await enter("bad");
    check("an error from INSPIRE is explained in words, with its number", cards().length === 0 && msg().includes("400"), msg());
    await enter("busy");
    check("too many requests is explained", msg() === tr("prof.err.ratelimit"), msg());
    await enter("boom");
    check("a lost connection is explained", msg() === tr("inspire.err.network"), msg());
    await enter("garbage");
    check("an answer that cannot be read is explained", msg() === tr("inspire.err.format"), msg());
  } catch (e) { results.push("EXCEPTION " + e.stack); }
  document.getElementById("test-out").textContent = results.join("\n");
})();
