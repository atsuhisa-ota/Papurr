// One scenario per page load (open.js reads its request from the page address). Scenario name = ?s=...
(async () => {
  const S = new URLSearchParams(location.search).get("s");
  const out = [];
  try {
    await sleep(1200);
    const calls = window.fetchCalls;
    const idxNow = () => { try { return fakeDir.text("index.json") ? idx() : {}; } catch (e) { return {}; } };
    const msg = document.getElementById("msg").textContent;
    const pdfFetches = calls.filter((u) => u.includes("/pdf/") || u.includes("publisher.example")).length;
    const stillOpen = (id) => (window.localOpened || {})[id];
    const opened = (await chrome.storage.local.get("opened")).opened || {};
    const E1 = idxNow();
    const shown = window.shownName;
    switch (S) {
      case "A_new_arxiv": {
        check("A saved as <id><latest>.pdf", fakeDir.text("2301.12345v2.pdf") !== null);
        check("A shown", shown === "2301.12345v2.pdf", shown + " | " + msg);
        check("A index has title/authors/version", E1["2301.12345"] && E1["2301.12345"].title === "Some Title" && E1["2301.12345"].versions.v2 === "2301.12345v2.pdf" && E1["2301.12345"].authors.length === 5 && E1["2301.12345"].authorCount === 7, JSON.stringify(E1));
        check("A last-opened kept locally, not in index", !!opened["2301.12345"] && !("lastOpened" in E1["2301.12345"]));
        break;
      }
      case "B_saved_latest": {
        check("B no pdf download", pdfFetches === 0, pdfFetches);
        check("B shown saved v2", shown === "2301.12345v2.pdf", shown + " | " + msg);
        break;
      }
      case "C_v1_saved_latest_v2": {
        check("C v2 downloaded", fakeDir.text("2301.12345v2.pdf") !== null && fakeDir.text("2301.12345v1.pdf") !== null);
        check("C both versions in index, tags kept", Object.keys(E1["2301.12345"].versions).sort().join() === "v1,v2" && E1["2301.12345"].tags.join() === "keep", JSON.stringify(E1));
        check("C shown v2", shown === "2301.12345v2.pdf");
        break;
      }
      case "D_explicit_v1": {
        check("D no pdf download", pdfFetches === 0);
        check("D shown v1", shown === "2301.12345v1.pdf", shown);
        break;
      }
      case "E_local": {
        check("E offline: no network at all", calls.length === 0, calls.join());
        check("E shown newest saved (v2)", shown === "2301.12345v2.pdf", shown);
        break;
      }
      case "E2_local_journal_only": {
        check("E2 local on journal-only paper opens the journal file", shown === "j.pdf", shown + " | " + msg);
        break;
      }
      case "F_journal_chip": {
        check("F shown journal file", shown === "j.pdf", shown + " | " + msg);
        break;
      }
      case "G_journal_new_with_arxiv": {
        check("G journal file saved under DOI name", fakeDir.text("10.1103_physrevd.108.045001.pdf") !== null, [...fakeDir.files.keys()].join());
        const e = E1["2301.00001"];
        check("G filed under the arXiv ID with journal info", e && e.doi === "10.1103/physrevd.108.045001" && e.journal.file === "10.1103_physrevd.108.045001.pdf" && e.journal.name === "Physical Review D" && e.journal.year === 2023, JSON.stringify(E1));
        check("G shown", shown === "10.1103_physrevd.108.045001.pdf", shown + " | " + msg);
        break;
      }
      case "H_journal_only": {
        const e = E1["doi:10.1103/physrevd.108.045001"];
        check("H filed as journal-only entry with Crossref data", e && e.title === "Crossref Title" && e.authors.join() === "Ann Smith" && !!e.journal, JSON.stringify(E1) + " | " + msg);
        break;
      }
      case "I_journal_saved": {
        check("I no download and no lookups", calls.length === 0, calls.join());
        check("I shown saved journal file", shown === "j.pdf", shown + " | " + msg);
        break;
      }
      case "J_journal_html": {
        check("J error explained", msg.includes("web page instead of a PDF"), msg);
        check("J fallback link visible", !document.getElementById("fallback").hidden && document.getElementById("fallback").href.includes("publisher.example"));
        check("J nothing saved", Object.keys(E1).length === 0 && !shown);
        break;
      }
      case "P_page_retry": {
        const c = scriptCalls[0];
        check("P refused: the publisher's own tab is asked, once, for exactly that PDF", scriptCalls.length === 1 && c.target.tabId === 7 && c.args[0] === "https://publisher.example/x.pdf" && c.func.name === "pagePdfFetch", JSON.stringify(scriptCalls.map((x) => [x.target, x.args])));
        check("P the PDF is saved under the DOI name and recorded", fakeDir.text("10.1103_physrevd.108.045001.pdf") !== null && E1["doi:10.1103/physrevd.108.045001"] && E1["doi:10.1103/physrevd.108.045001"].journal.file === "10.1103_physrevd.108.045001.pdf", JSON.stringify(E1));
        check("P and opened", shown === "10.1103_physrevd.108.045001.pdf" && document.getElementById("fallback").hidden && document.getElementById("manual").hidden, shown + " | " + msg);
        // the function that runs in the page
        const real = window.fetch;
        const reply = (text, ok = true, status = 200) => async () => ({ ok, status, arrayBuffer: async () => new TextEncoder().encode(text).buffer });
        window.fetch = reply("%PDF-1.4 abc");
        const r1 = await pagePdfFetch("https://publisher.example/x.pdf", 1000);
        window.fetch = reply("<html>please log in</html>");
        const r2 = await pagePdfFetch("https://publisher.example/x.pdf", 1000);
        window.fetch = reply("", false, 403);
        const r3 = await pagePdfFetch("https://publisher.example/x.pdf", 1000);
        window.fetch = reply("%PDF-1.4 " + "x".repeat(100));
        const r4 = await pagePdfFetch("https://publisher.example/x.pdf", 50);
        window.fetch = async () => { throw new Error("offline"); };
        const r5 = await pagePdfFetch("https://publisher.example/x.pdf", 1000);
        window.fetch = real;
        check("P in the page: a PDF comes back intact", r1.ok && atob(r1.data) === "%PDF-1.4 abc", JSON.stringify(r1));
        check("P in the page: a login page, a refusal, a huge file or an error give nothing", r2.status === "notpdf" && r3.status === 403 && r4.status === "toolarge" && r5.status === "error" && ![r2, r3, r4, r5].some((r) => r.ok));
        break;
      }
      case "Q_page_fails":
      case "Q_page_fails_ja": {
        const manual = document.getElementById("manual");
        check("Q the page was asked too", scriptCalls.length === 1);
        check("Q nothing saved", Object.keys(E1).length === 0 && !shown);
        check("Q the error is shown with the normal link", msg.includes("403") && !document.getElementById("fallback").hidden);
        if (S === "Q_page_fails") check("Q it suggests saving the PDF into the papers folder and identifying it", !manual.hidden && manual.textContent.includes("papers folder") && manual.textContent.includes("Papers") && manual.textContent.includes("Identify and rename"), manual.textContent);
        else check("Q (ja) the suggestion is in Japanese", !manual.hidden && manual.textContent.includes("論文フォルダ") && manual.textContent.includes("判別して名前を変更"), manual.textContent);
        break;
      }
      case "R_other_site": {
        check("R a PDF of another site is not fetched through the page", scriptCalls.length === 0 && !document.getElementById("fallback").hidden && !document.getElementById("manual").hidden && !shown);
        break;
      }
      case "S_no_tab": {
        check("S without the original tab nothing is tried, the normal link and the suggestion are shown", scriptCalls.length === 0 && !document.getElementById("fallback").hidden && !document.getElementById("manual").hidden && !shown);
        break;
      }
      case "J_journal_html_ja": {
        check("Ja: error explained in Japanese", msg.includes("PDFではなくWebページが返されました"), msg);
        check("Ja: fallback link text in Japanese", document.getElementById("fallback").textContent === "通常の方法でPDFを開く", document.getElementById("fallback").textContent);
        break;
      }
      case "A_new_arxiv_ja": {
        check("Ja: saved and shown", shown === "2301.12345v2.pdf", shown + " | " + msg);
        check("Ja: page title in Japanese", document.title === "論文を開いています…", document.title);
        break;
      }
      case "L_damaged_ja": {
        check("Ja: damaged index message in Japanese", msg.includes("壊れているため、読み込めません") && msg.includes("ライブラリを開いて修復してください"), msg);
        break;
      }
      case "N_external_fails_ja": {
        check("Ja: external app failure in Japanese", msg.includes("外部アプリで開けませんでした") && document.getElementById("inchrome").textContent === "代わりにChromeで開く", msg);
        break;
      }
      case "W_ads": {
        const e = E1["ads:1970A&A.....5...84Z"];
        check("W ADS scan: saved under its bibcode and shown", fakeDir.text("1970A&A.....5...84Z.pdf") !== null && shown === "1970A&A.....5...84Z.pdf" && fetchCalls.some((u) => u.startsWith("https://articles.adsabs.harvard.edu/pdf/")), shown + " | " + msg);
        check("W recorded as ads:<bibcode> with the page's title and authors, the PDF as its journal version", e && e.title === "Black holes in 1970" && e.authors.join() === "Ann Zel,Bo Novikov" && e.journal.file === "1970A&A.....5...84Z.pdf" && e.journal.name === "A&A" && e.journal.year === 1970 && Object.keys(e.versions).length === 0 && !!opened["ads:1970A&A.....5...84Z"], JSON.stringify(E1));
        break;
      }
      case "X_ads_saved": {
        check("X a saved ADS scan opens without downloading again", shown === "1970A&A.....5...84Z.pdf" && !fetchCalls.some((u) => u.includes("adsabs")), shown + " | " + fetchCalls.join());
        break;
      }
      case "T_save_new":
      case "V_save_saved": {
        await sleep(300);
        check(S[0] + " Add to library: the PDF is saved" + (S[0] === "V" ? " (already there: not downloaded again)" : ""), fakeDir.text("2301.12345v2.pdf") !== null && idxNow()["2301.12345"].versions.v2 === "2301.12345v2.pdf" && pdfFetches === (S[0] === "V" ? 0 : 1), pdfFetches);
        check(S[0] + " but not opened, and not marked as opened", shown === undefined && !opened["2301.12345"], shown);
        check(S[0] + " the library tab is told, and this tab does not become the library", window.libraryHeard && window.libraryHeard.type === "added" && window.libraryHeard.id === "2301.12345" && !window.wentTo, JSON.stringify(window.libraryHeard));
        break;
      }
      case "AG_save_quiet": { // saved from a list inside the library (an INSPIRE result): the library is only told to read again
        await sleep(300);
        check("AG quiet save: the PDF is saved, not opened, not marked as opened", fakeDir.text("2301.12345v2.pdf") !== null && idxNow()["2301.12345"] && shown === undefined && !opened["2301.12345"], String(shown));
        check("AG and the library is told quietly (no jump, no highlight asked for), this tab does not become the library", window.libraryHeard && window.libraryHeard.type === "added" && window.libraryHeard.quiet === true && !window.wentTo, JSON.stringify(window.libraryHeard));
        break;
      }
      case "AA_existing_arxiv":
      case "AB_existing_journal":
      case "AC_existing_ads": {
        const [name, key, text] = { AA_existing_arxiv: ["2301.12345v2.pdf", "2301.12345", "%PDF- my annotated copy"], AB_existing_journal: ["10.1103_physrevd.108.045001.pdf", "doi:10.1103/physrevd.108.045001", "%PDF- my annotated journal copy"], AC_existing_ads: ["1970A&A.....5...84Z.pdf", "ads:1970A&A.....5...84Z", "%PDF- my annotated scan"] }[S];
        const e = E1[key];
        check(S.slice(0, 2) + " a PDF of that name already in the folder (not in the library) is never overwritten and not downloaded again", fakeDir.text(name) === text && pdfFetches === 0 && !fetchCalls.some((u) => u.includes("adsabs")), fakeDir.text(name) + " | " + fetchCalls.join(","));
        check(S.slice(0, 2) + " it is added to the library as it is and opened", !!e && JSON.stringify(e).includes(JSON.stringify(name)) && shown === name, JSON.stringify(E1) + " | " + shown + " | " + msg);
        break;
      }
      case "AD_existing_notpdf": {
        check("AD a file of that name that is not a PDF is left alone, nothing is recorded, and the message says why", fakeDir.text("2301.12345v2.pdf") === "my own notes, not a PDF" && !E1["2301.12345"] && msg.includes("2301.12345v2.pdf") && pdfFetches === 0, msg + " | " + JSON.stringify(E1));
        break;
      }
      case "Z_bad_request": {
        await sleep(300);
        check("Z a malformed request (paper number, version or bibcode) is refused: nothing fetched, nothing written", fetchCalls.length === 0 && !fakeDir.text("index.json") && [...fakeDir.files.keys()].length === 0 && document.getElementById("msg").textContent === tr("open.nopaper"), fetchCalls.join(",") + " | " + [...fakeDir.files.keys()] + " | " + document.getElementById("msg").textContent);
        break;
      }
      case "Y_save_busy": {
        await sleep(300);
        const e = idxNow()["2301.12345"];
        check("Y Add to library while arXiv's API refuses: saved with the title and authors Today's arXiv handed over", fakeDir.text("2301.12345v2.pdf") !== null && e && e.title === "Waves in plasma" && JSON.stringify(e.authors) === '["Ann Lee","Bo Kim"]' && e.authorCount === 5, JSON.stringify(e));
        break;
      }
      case "U_save_nolib": {
        await sleep(1500);
        check("U Add to library with no library tab: saved, not opened, and this tab becomes the library with the paper highlighted", fakeDir.text("2301.12345v2.pdf") !== null && shown === undefined && window.wentTo === "library.html?highlight=2301.12345", window.wentTo + " | " + msg);
        break;
      }
      case "K_merge_doi_entry": {
        check("K journal-only entry merged into the arXiv entry", !E1["doi:10.1/x"] && E1["2301.12345"] && E1["2301.12345"].journal && E1["2301.12345"].journal.file === "10.1_x.pdf" && E1["2301.12345"].versions.v2, JSON.stringify(E1));
        check("K its note moves to the arXiv name (and its tags come along)", E1["2301.12345"].note === "2301.12345.md" && fakeDir.text("10.1_x.md") === null && (fakeDir.text("2301.12345.md") || "").includes("written while journal-only") && JSON.stringify(E1["2301.12345"].tags) === '["j"]', JSON.stringify(E1) + " | " + fakeDir.text("2301.12345.md"));
        break;
      }
      case "L_damaged": {
        check("L damaged index: clear message, file untouched", msg.includes("damaged") && msg.includes("Open the Library") && fakeDir.text("index.json") === "{{{", msg);
        break;
      }
      case "M_external": {
        check("M external app asked to open the file", window.nativeCalls.length === 1 && window.nativeCalls[0].action === "open" && window.nativeCalls[0].file === "2301.12345v2.pdf", JSON.stringify(window.nativeCalls));
        check("M marker file created once, token passed", fakeDir.text(".paper-folder-id").length > 10 && window.nativeCalls[0].token === fakeDir.text(".paper-folder-id"));
        check("M Chrome viewer not used", !shown);
        break;
      }
      case "N_external_fails": {
        check("N failure explained, fallback button shown", msg.includes("Could not open with the external app") && !document.getElementById("inchrome").hidden, msg);
        document.getElementById("inchrome").click(); await sleep(50);
        check("N fallback opens in Chrome", window.shownName === "2301.12345v2.pdf", window.shownName);
        break;
      }
      case "O_sanitize": {
        check("O old-style id gets a safe file name", fakeDir.text("hep-th_9901001v3.pdf") !== null, [...fakeDir.files.keys()].join());
        check("O keyed by the real id", !!E1["hep-th/9901001"]);
        break;
      }
    }
  } catch (e) {
    out.push("EXCEPTION " + e.stack);
  }
  document.getElementById("test-out").textContent = results.concat(out).join("\n") || "no checks ran";
})();
