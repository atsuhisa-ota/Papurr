// Settings -> Folder: PDFs added by hand -> note, review list with approval, renaming, "Yes to all", working indicator.
(async () => {
  try {
    await sleep(300);
    const ja = new URLSearchParams(location.search).get("lang") === "ja";
    const T = (en, jp) => (ja ? jp : en);
    const $ = (id) => document.getElementById(id);
    // ---- PDFs made in the page (one character = one byte). The first is compressed with the browser's own compressor.
    const deflate = async (text) => {
      const out = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer();
      return String.fromCharCode(...new Uint8Array(out));
    };
    const stream = (n, dict, body) => n + " 0 obj\n<< " + dict + " /Length " + body.length + " >>\nstream\n" + body + "\nendstream\nendobj\n";
    const stamped = async (stamp) => "%PDF-1.5\n" + stream(1, "/Filter /FlateDecode", await deflate("BT (A paper) Tj ET")) + stream(2, "/Filter /FlateDecode", await deflate("BT /arXivStAmP 20 Tf (" + stamp + ")Tj ET")) + "%%EOF\n";
    const plain = (stamp) => "%PDF-1.4\n" + stream(1, "", "q BT /R8 20 Tf (" + stamp + ")Tj ET Q") + "%%EOF\n";
    const withDoi = (doi) => "%PDF-1.5\n" + stream(1, "/Type /Metadata /Subtype /XML", "<prism:doi>" + doi + "</prism:doi>") + "%%EOF\n";

    window.fetchMetadataBatch = async (ids) => new Map(ids.map((id) => [id, { title: "Paper " + id, authors: ["Ann Smith"], authorCount: 1, doi: "" }]));
    window.fetchJournalMetadata = async (doi) => ({ title: "Journal " + doi, authors: ["Bo Chen"], authorCount: 1, journalName: "JHEP", year: 2024 });
    window.findArxivIdForDoi = async () => null;
    window.findDoiByTitle = async () => null;

    window.chosen = true; // (a folder has been chosen)
    check("no note and no button while the folder holds nothing to import", $("import-btn").hidden && $("import-note").hidden);
    fakeDir.put("scan001.pdf", await stamped("arXiv:2301.12345v2  [hep-th]  5 Jan 2023"));
    fakeDir.put("old paper.pdf", plain("arXiv:hep-th/9711200v3  22 Jan 1998"));
    fakeDir.put("prd.pdf", withDoi("10.1103/PhysRevD.108.045001"));
    fakeDir.put("mystery.pdf", "%PDF-1.4\nnothing to see\n");
    fakeDir.put("2401.00002v1.pdf", await stamped("arXiv:2401.00002v1  [hep-th]  1 Jan 2024")); // already well named, but not in the index
    await refreshImportNote();

    const note = $("import-note"), panel = $("import-panel"), btn = $("import-btn");
    check("the note counts the PDFs that are not in the library", !note.hidden && note.textContent.includes("5"), note.textContent);
    check("the note says they are not shown unless renamed", note.textContent.includes(T("not shown in the library correctly", "正しく表示されません")), note.textContent);
    check("the button sits in the Folder section, under Choose folder", !btn.hidden && btn.closest("section").querySelector("#choose") && btn.textContent === T("Identify and rename...", "判別して名前を変更…"));

    const fastBatch = window.fetchMetadataBatch;
    window.fetchMetadataBatch = async (ids) => { await sleep(700); return fastBatch(ids); }; // a slow lookup, to see the working indicator
    btn.click();
    await sleep(450);
    check("while PDFs are being identified the mark spins and a label says so", document.body.classList.contains("busy") && document.querySelector(".busy-label").textContent.length > 0, document.body.className + "|" + document.querySelector(".busy-label").textContent);
    await sleep(1200);
    window.fetchMetadataBatch = fastBatch;
    check("when the review list is ready it stops", !document.body.classList.contains("busy") && document.querySelector(".busy-label").textContent === "");
    const rows = () => [...panel.querySelectorAll(".row")];
    check("review panel lists the three files that need renaming", !panel.hidden && rows().length === 3, rows().length + " | " + panel.textContent.slice(0, 200));
    check("note and button are out of the way while the panel is open", note.hidden && btn.hidden);
    const rowOf = (name) => rows().find((r) => r.textContent.includes(name));
    check("row shows old and new name", rowOf("scan001.pdf").textContent.includes("2301.12345v2.pdf") && rowOf("old paper.pdf").textContent.includes("hep-th_9711200v3.pdf") && rowOf("prd.pdf").textContent.includes("10.1103_physrevd.108.045001.pdf"), rows().map((r) => r.textContent).join(" | "));
    check("row shows the title", rowOf("scan001.pdf").textContent.includes("Paper 2301.12345"));
    check("the correctly named file is only mentioned", !rowOf("2401.00002v1.pdf") && panel.textContent.includes(T("already have the right name", "すでに正しい名前")));
    check("the unrecognised file is listed with the reason", panel.textContent.includes("mystery.pdf"), panel.textContent);
    check("panel says unrenamed files are not shown", panel.textContent.includes(T("not shown in the library correctly", "正しく表示されません")));
    check("sure files start checked", rows().every((r) => r.querySelector("input").checked));
    check("nothing renamed before approval", fakeDir.files.has("scan001.pdf") && fakeDir.files.has("prd.pdf") && fakeDir.files.has("old paper.pdf") && !fakeDir.text("index.json"));
    if (new URLSearchParams(location.search).get("stop") === "review") { $("test-out").textContent = results.join("\n"); return; } // (for screenshots)

    // ---- decline one file, approve the others
    rowOf("prd.pdf").querySelector("input").click();
    await sleep(50);
    const buttons = () => [...panel.querySelectorAll(".actions button")];
    const applyBtn = buttons().find((b) => b.textContent.includes("2"));
    check("apply button counts the checked files", !!applyBtn, buttons().map((b) => b.textContent).join(" | "));
    applyBtn.click();
    await sleep(800);
    check("approved files were renamed", fakeDir.files.has("2301.12345v2.pdf") && fakeDir.files.has("hep-th_9711200v3.pdf") && !fakeDir.files.has("scan001.pdf") && !fakeDir.files.has("old paper.pdf"));
    check("renamed content is intact", fakeDir.files.get("2301.12345v2.pdf").text.includes("%PDF-1.5") && fakeDir.files.get("2301.12345v2.pdf").text.endsWith("%%EOF\n"));
    check("the declined file is untouched and not indexed", fakeDir.files.has("prd.pdf") && !JSON.stringify(idx()).includes("prd.pdf") && !JSON.stringify(idx()).includes("physrevd"));
    check("index has the new papers, and the already well named one", JSON.stringify(idx()["2301.12345"].versions) === '{"v2":"2301.12345v2.pdf"}' && !!idx()["hep-th/9711200"] && !!idx()["2401.00002"], JSON.stringify(Object.keys(idx())));
    check("summary counts renamed and added files", panel.textContent.includes(T("2 files renamed, 3 files added", "2件の名前を変更し、3件")), panel.textContent);
    check("summary mentions the declined file", panel.textContent.includes(T("were not renamed", "名前を変更しなかった")), panel.textContent);
    check("a run that left files behind switches the library note on", (await chrome.storage.local.get("importNotice")).importNotice === true);
    panel.querySelector("button").click();
    await sleep(200);
    check("panel closes; the note remains for what is left (declined + unrecognised)", panel.hidden && !note.hidden && note.textContent.includes("2"), note.textContent);

    // ---- second round: "Yes to all"
    btn.click();
    await sleep(800);
    check("the declined file is offered again", rows().length === 1 && rows()[0].textContent.includes("prd.pdf"), rows().length);
    const yes = buttons().find((b) => b.textContent.includes(T("Yes to all", "すべて承諾")));
    check("Yes to all button exists", !!yes);
    yes.click();
    await sleep(800);
    check("Yes to all renames everything offered", fakeDir.files.has("10.1103_physrevd.108.045001.pdf") && !fakeDir.files.has("prd.pdf"));
    check("journal-only paper is in the index with its DOI", idx()["doi:10.1103/physrevd.108.045001"] && idx()["doi:10.1103/physrevd.108.045001"].journal.file === "10.1103_physrevd.108.045001.pdf", JSON.stringify(Object.keys(idx())));
    check("summary has no 'not renamed' warning when nothing was declined", !panel.textContent.includes(T("were not renamed", "名前を変更しなかった")), panel.textContent);
    panel.querySelector("button").click();
    await sleep(200);
    check("only the unrecognised file is left in the note", !note.hidden && note.textContent.includes("1"), note.textContent);

    // ---- a run that leaves nothing behind switches the library note off
    fakeDir.files.delete("mystery.pdf");
    fakeDir.put("2405.00001v1.pdf", await stamped("arXiv:2405.00001v1  [hep-th]  1 May 2024"));
    await refreshImportNote();
    btn.click();
    await sleep(800);
    buttons().find((b) => b.textContent.includes(T("Yes to all", "すべて承諾")) || b.textContent.includes(T("Add the", "追加"))).click();
    await sleep(800);
    check("a run that leaves nothing behind switches the note off", (await chrome.storage.local.get("importNotice")).importNotice === false, JSON.stringify(await chrome.storage.local.get("importNotice")));
    panel.querySelector("button").click();
    await sleep(200);

    // ---- a damaged index is explained, not overwritten
    fakeDir.put("index.json", "{{{broken");
    btn.click();
    await sleep(800);
    check("a damaged index is reported and left alone", fakeDir.text("index.json") === "{{{broken" && $("import-status").textContent.length > 0 && panel.hidden, $("import-status").textContent);
  } catch (e) {
    results.push("EXCEPTION " + e.stack);
  }
  document.getElementById("test-out").textContent = results.join("\n");
})();
