// The note page: created on first open, edit only the user's section, explicit save (button and Ctrl/Cmd+S), changes made
// elsewhere (conflict: reload or keep mine; changes to Papurr's sections only: no question), delete a Papurr section,
// safe Markdown, helper "edit", unsaved-changes warning. ?id=... chooses the paper.
(async () => {
  const q = new URLSearchParams(location.search);
  const id = q.get("id");
  const ja = q.get("lang") === "ja";
  const T = (en, j) => (ja ? j : en);
  const $ = (sel) => document.querySelector(sel);
  const msg = () => $("#msg").textContent;
  const visible = (el) => el && !el.hidden;
  const key = (k, mods) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
  try {
    await sleep(500);
    if (id === "9999.99999") {
      check("a paper not in the library: said so, no file made", msg().includes(T("not in the library", "ライブラリにありません")) && fakeDir.text("9999.99999.md") === null, msg());
      return;
    }
    if (id === "doi:10.1/zz") {
      check("a journal-only paper's note is shown", $("#mine-view").textContent.includes("journal note"), $("#mine-view").textContent);
      check("without a PDF: PDF not saved, and Get the PDF goes to the publisher", $("#paper-links").textContent.includes(T("PDF not saved", "PDF未保存")) && $("#paper-links a.chip").href === "https://doi.org/10.1/zz", $("#paper-links").innerHTML);
      return;
    }
    if (id === "2301.00011" && q.has("nohtml")) {
      check("a paper without arXiv's HTML version: the reason is said, nothing is sent", $("#summary-panel").textContent.includes(T("no HTML version", "HTML版がありません")) && connects === 0, $("#summary-panel").textContent);
      return;
    }
    if (id === "2301.00011" && q.has("long")) {
      check("a long paper: the estimate comes with the question whether to run it", $("#summary-panel").textContent.includes(T("longer than usual", "いつもより長く")) && connects === 0, $("#summary-panel").textContent);
      return;
    }
    if (id === "2301.00011" && q.has("summarize")) {
      const panel = $("#summary-panel");
      const btn = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith(text));
      check("summarize: arXiv's HTML version of the newest saved version is fetched, and the estimate shown, before anything is sent", htmlCalls.length === 1 && htmlCalls[0] === "https://arxiv.org/html/2301.00011v2" && panel.textContent.includes("arXiv:2301.00011v2") && /\d{3}/.test(panel.textContent) && connects === 0, panel.textContent + " | " + htmlCalls.join());
      const run = btn(T("Summarize · ~", "要約する · 約"));
      check("the Summarize button is short and shows the estimate; its tooltip says it uses quota and that nothing is sent before the click", !!run && run.textContent.length < 24 && run.title.includes(T("subscription quota", "利用枠")) && run.title.includes(T("before you click", "クリックするまで")), panel.innerHTML);
      hang = true;
      run.click(); await sleep(400);
      const line = document.querySelector(".status-line");
      check("while summarizing: the status line says the model; the panel holds only Cancel (said once)", line.textContent.includes("Haiku 5.5") && !panel.textContent.includes("Haiku") && !!btn(T("Cancel", "キャンセル")) && connects === 1, line.textContent + " | " + panel.textContent);
      await sleep(3300);
      check("and after a few seconds the status line counts them", /\(\d+ ?(s|秒)\)/.test(line.textContent), line.textContent);
      btn(T("Cancel", "キャンセル")).click(); await sleep(150); hang = false;
      check("Cancel: nothing saved, and Try again shows the estimate again (no new download, nothing sent)", !fakeDir.text("2301.00011.md").includes("papurr:summary") && !!btn(T("Try again", "もう一度試す")));
      btn(T("Try again", "もう一度試す")).click(); await sleep(50);
      check("(the estimate is back)", !!btn(T("Summarize · ~", "要約する · 約")) && htmlCalls.length === 1 && connects === 1);
      nextReply = { ok: true, result: { summary: "### Gist\n\nThe paper computes the damping rate $\\gamma$ of plasma waves." }, usage: { input_tokens: 9000, output_tokens: 800 }, durationMs: 9000, models: ["claude-haiku-5-5"] };
      btn(T("Summarize · ~", "要約する · 約")).click(); await sleep(300);
      const sent = lastPort.sent;
      check("the request carries the full text from the HTML version: formulas as LaTeX, figures as captions, no bibliography, no menus; the language and the summary schema", sent.prompt.includes("We compute the plasma damping rate $\\gamma$.") && sent.prompt.includes("$$\\gamma=\\omega^{2}$$") && sent.prompt.includes("[Figure: Figure 1: The rate $\\gamma(k)$.]") && !sent.prompt.includes("Some reference") && !sent.prompt.includes("Menu") && !sent.prompt.includes("x1.png") && sent.prompt.includes(T("in English", "in Japanese")) && sent.schema.includes('"summary"') && sent.timeout >= 300, sent.prompt.slice(0, 600));
      check("the summary uses the level chosen in Settings (the middle one by default) and the user's own instructions, if any", q.has("level") ? lastPort.sent.prompt.includes("Level: technical") && lastPort.sent.prompt.includes("<<<READER NOTES\nMention the observational constraints.\n>>>") : lastPort.sent.prompt.includes("Level: standard") && !lastPort.sent.prompt.includes("READER NOTES"), lastPort.sent.prompt.slice(-700));
      const f = fakeDir.text("2301.00011.md");
      check("the summary is saved in the note: its language, model, date and version", f.includes("<!-- papurr:summary model=claude-haiku-5-5 date=") && f.includes("version=v2 lang=" + T("en", "ja")) && f.includes("damping rate"), f);
      const sec = [...document.querySelectorAll("#blocks section.note-ai")].find((x) => x.textContent.includes(T("Summary", "要約")));
      check("it is shown, with the version, and the panel is gone", !!sec && sec.textContent.includes("v2") && sec.textContent.includes("damping rate") && panel.hidden && msg().includes("9,800"), msg());
      check("the run is logged as a summary", (await getAiUsage()).slice(-1)[0].kind === "summary");
      [...sec.querySelectorAll("button")].find((b) => b.textContent.startsWith(T("Redo...", "やり直す…"))).click(); await sleep(300);
      check("Redo uses the text kept from before (no new download) and shows the estimate again", htmlCalls.length === 1 && !!btn(T("Summarize · ~", "要約する · 約")) && connects === 2);
      btn(T("Cancel", "キャンセル")).click(); await sleep(50);
      // translating the summary into another language (cheaper than summarizing again)
      const st = (await chrome.storage.local.get("ai")).ai;
      await chrome.storage.local.set({ ai: { ...st, outputLang: "de" } }); await sleep(300);
      const sumSec = () => [...document.querySelectorAll("#blocks section.note-ai")].find((x) => x.querySelector("h3").textContent.includes(T("Summary", "要約")));
      const trans = () => [...sumSec().querySelectorAll("button")].find((b) => b.textContent.startsWith("Translate into Deutsch") || b.textContent.startsWith("Deutschに翻訳"));
      check("with German chosen: Translate into Deutsch (with a short estimate) next to Make it in Deutsch...", !!trans() && /~|約/.test(trans().textContent) && [...sumSec().querySelectorAll("button")].some((b) => b.textContent.includes("Deutsch") && b !== trans()), sumSec().textContent);
      nextReply = { ok: true, result: { translation: "### Kern\n\nDas Papier berechnet die Dämpfungsrate $\\gamma$." }, usage: { input_tokens: 300, output_tokens: 100 }, durationMs: 2000, models: ["claude-haiku-5-5"] };
      const c1 = connects;
      trans().click(); await sleep(300);
      const g2 = fakeDir.text("2301.00011.md");
      check("the request carries only the summary (not the full text), to be translated into German", connects === c1 + 1 && lastPort.sent.prompt.includes("into German") && lastPort.sent.prompt.includes("damping rate $\\gamma$") && !lastPort.sent.prompt.includes("Words. Words."), lastPort.sent.prompt.slice(0, 300));
      check("the translation is added as the German summary, saying where it came from; the original stays", g2.includes("lang=de") && g2.includes("from=" + T("en", "ja")) && g2.includes("Dämpfungsrate") && g2.includes("computes the damping rate") && sumSec().textContent.includes(T("translated from", "から翻訳")) && sumSec().querySelectorAll(".reason-langs .tag").length === 2, g2);
      await chrome.storage.local.set({ ai: { ...st, outputLang: "" } }); await sleep(200);
      return;
    }
    if (id === "2301.00012" && q.has("summarize")) {
      check("a paper not in the library: shown from arXiv, nothing written yet, the estimate shown", $("#paper-title").textContent === "Reason paper" && !idx()["2301.00012"] && fakeDir.text("2301.00012.md") === null && $("#summary-panel").textContent.includes("arXiv:2301.00012v1") && $("#paper-links").textContent.includes(T("PDF not saved", "PDF未保存")) && $("#mine").hidden, $("#summary-panel").textContent);
      nextReply = { ok: true, result: { summary: "### Gist\n\nA summary made before the PDF was saved." }, usage: { input_tokens: 9000, output_tokens: 800 }, durationMs: 9000, models: ["claude-haiku-5-5"] };
      [...document.querySelectorAll("#summary-panel button")][0].click(); await sleep(400);
      const e = idx()["2301.00012"];
      check("the summary makes the paper (no PDF, only a note) and its note", !!e && Object.keys(e.versions).length === 0 && e.note === "2301.00012.md" && e.title === "Reason paper" && (fakeDir.text("2301.00012.md") || "").includes("before the PDF was saved") && !$("#mine").hidden && !$("#file-row").hidden, JSON.stringify(e));
      return;
    }
    if (id === "2301.00009" && q.has("ai")) {
      const sec = () => $("#blocks section.note-ai");
      const redo = () => [...sec().querySelectorAll("button")].find((b) => b.textContent.startsWith(T("Redo ·", "やり直す ·")));
      check("opening asked the AI nothing; the abstract came from arXiv (no quota)", connects === 0 && arxivCalls === 1);
      check("the reason has Redo with the current model, with the estimate", !!redo() && /~\d|約\d/.test(redo().textContent) && redo().title.includes(T("subscription quota", "利用枠")), redo() && redo().textContent);
      hang = true;
      redo().click(); await sleep(400);
      check("while asking: the status line says the model (once), the section shows Cancel, Delete waits", document.querySelector(".status-line").textContent.includes("Haiku 5.5") && !sec().textContent.includes("Haiku") && [...sec().querySelectorAll("button")].some((b) => b.textContent === T("Cancel", "キャンセル")) && [...sec().querySelectorAll("button")].find((b) => b.textContent === T("Delete", "削除")).disabled);
      [...sec().querySelectorAll("button")].find((b) => b.textContent === T("Cancel", "キャンセル")).click(); await sleep(150); hang = false;
      check("Cancel leaves the old reason", lastPort.closed && fakeDir.text("2301.00009.md").includes("An old reason.") && msg().includes(T("Cancelled", "中止")), msg());
      nextReply = { ok: true, result: { reason: "A new reason." }, usage: { input_tokens: 3000, output_tokens: 100 }, durationMs: 2000, models: ["claude-haiku-5-5"] };
      redo().click(); await sleep(300);
      const f = fakeDir.text("2301.00009.md");
      check("the request carries the abstract from arXiv and the profile", lastPort.sent.prompt.includes("We study plasma waves.") && lastPort.sent.prompt.includes("Works on quantum devices.") && connects === 2);
      check("redo replaces only the reason (new model and date); the user's text stays", f.includes("A new reason.") && !f.includes("An old reason.") && f.includes("model=claude-haiku-5-5") && f.endsWith("## Notes\n\nkeep me\n") && sec().textContent.includes("A new reason."), f);
      check("the earlier version without a language was replaced by one in the output language", f.includes("lang=" + T("en", "ja")) && (f.match(/<!-- papurr:reason/g) || []).length === 1, f);
      // another output language: Make it in German adds a version; chips switch; Delete removes only the shown one
      const st = (await chrome.storage.local.get("ai")).ai;
      await chrome.storage.local.set({ ai: { ...st, outputLang: "de" } }); await sleep(300);
      const make = () => [...sec().querySelectorAll("button")].find((b) => b.textContent.includes("Deutsch"));
      check("with German chosen in Settings: Make it in German, with the estimate", !!make() && /~|約/.test(make().textContent), sec().textContent);
      check("changing a setting does not ask arXiv again (what it said is kept)", arxivCalls === 1, arxivCalls);
      nextReply = { ok: true, result: { reason: "Ein neuer Grund." }, usage: { input_tokens: 3000, output_tokens: 100 }, durationMs: 2000, models: ["claude-haiku-5-5"] };
      make().click(); await sleep(300);
      const g = fakeDir.text("2301.00009.md");
      check("the German version is added; the other language stays", g.includes("lang=de") && g.includes("Ein neuer Grund.") && g.includes("A new reason.") && lastPort.sent.prompt.includes("in German"), g);
      const chips = () => [...sec().querySelectorAll(".reason-langs .tag")];
      check("chips show both languages; the German one is shown", chips().length === 2 && sec().textContent.includes("Ein neuer Grund.") && !sec().textContent.includes("A new reason."));
      chips().find((c) => c.textContent === T("English", "日本語")).click(); await sleep(50);
      check("a chip switches without asking the AI", sec().textContent.includes("A new reason.") && connects === 3);
      window.confirm = () => true;
      [...sec().querySelectorAll("button")].find((b) => b.textContent === T("Delete", "削除")).click(); await sleep(300);
      check("Delete removes only the version shown", !fakeDir.text("2301.00009.md").includes("A new reason.") && fakeDir.text("2301.00009.md").includes("Ein neuer Grund.") && fakeDir.text("2301.00009.md").endsWith("## Notes\n\nkeep me\n"), fakeDir.text("2301.00009.md"));
      check("the new reason is kept in the browser too, and logged", (await chrome.storage.local.get("aiReasons")).aiReasons["2301.00009"][T("en", "ja")].text === "A new reason." && (await getAiUsage()).slice(-1)[0].kind === "reason");
      return;
    }
    if (id === "2301.00001" && q.has("ai")) {
      check("a reason asked earlier in Today's arXiv goes into the new note", (fakeDir.text("2301.00001.md") || "").includes("<!-- papurr:reason") && fakeDir.text("2301.00001.md").includes("Asked earlier in Today's arXiv.") && $("#blocks").textContent.includes("Asked earlier"), fakeDir.text("2301.00001.md"));
      check("and no AI was asked", connects === 0);
      return;
    }
    if (id === "2301.00007") {
      check("without AI switched on, a reason can only be deleted (no redo)", [...$("#blocks section.note-ai").querySelectorAll("button:not(.move-btn)")].map((b) => b.textContent).join() === T("Delete", "削除"));
      const copies = $("#copies");
      check("a conflict copy made by the cloud is pointed out, with ways to look at it (nothing merged)", !copies.hidden && copies.textContent.includes("2301.00007 (conflicted copy 2026-10-08).md") && copies.querySelectorAll("button").length === 2 && fakeDir.text("2301.00007 (conflicted copy 2026-10-08).md") !== null, copies.textContent);
      window.helperCalls = [];
      copies.querySelector("button").click(); await sleep(100);
      check("it can be opened in the editor", (window.helperCalls[0] || {}).action === "edit" && window.helperCalls[0].file === "2301.00007 (conflicted copy 2026-10-08).md", JSON.stringify(window.helperCalls));
      check("an existing note opens as a view (not in editing)", visible($("#mine-view")) && !visible($("#mine-edit")) && $("#mine-view").textContent.includes("written earlier"));
      check("the head block is not repeated as a section", !$("#blocks").textContent.includes("Only a note") && $("#paper-title").textContent === "Only a note");
      check("without a PDF: Get the PDF saves the latest arXiv version", $("#paper-links a.chip").getAttribute("href") === "open.html?id=2301.00007");
      check("nothing was written just by opening", fakeDir.text("2301.00007.md").includes("written earlier") && !(await chrome.storage.local.get("notesChanged")).notesChanged);
      const sectionOrder = () => [...$("#blocks").children].map((x) => (x.id === "mine" ? "notes" : x.querySelector("h3").textContent));
      check("each section can be moved (up / down), the first cannot go up", sectionOrder().length === 2 && $("#mine").querySelectorAll(".move-btn").length === 2 && $("#blocks section.note-ai .move-btn").disabled === true, sectionOrder().join());
      $("#mine").querySelector(".move-btn").click(); await sleep(300); // (the user's notes up)
      const moved = fakeDir.text("2301.00007.md");
      check("moving the user's notes up puts them first, on the page and in the file", sectionOrder()[0] === "notes" && moved.includes("order=notes+reason") && moved.indexOf("written earlier") < moved.indexOf("papurr:reason") && moved.indexOf("papurr:head") < moved.indexOf("written earlier"), moved);
      $("#mine").querySelectorAll(".move-btn")[1].click(); await sleep(300);
      check("and down again", sectionOrder()[1] === "notes" && fakeDir.text("2301.00007.md").includes("order=reason+notes"), sectionOrder().join());
      return;
    }

    // ---- 2301.00001: a saved paper without a note
    const file = () => fakeDir.text("2301.00001.md");
    check("opening the note creates it", file() !== null && file().includes("# Alpha strings") && file().includes("[arXiv:2301.00001](https://arxiv.org/abs/2301.00001)"), file());
    check("the new note's own section has a heading in the UI language", file().includes(T("## Notes", "## メモ")), file());
    check("the index records the note", idx()["2301.00001"].note === "2301.00001.md" && JSON.parse(fakeDir.text("index.json")).schemaVersion === 3);
    {
      // A note with a long summary and reason: the room below the last section stays below it (it used to be lost).
      const tall = document.createElement("section");
      tall.style.height = "3000px";
      document.getElementById("blocks").append(tall);
      const room = document.documentElement.scrollHeight - (tall.getBoundingClientRect().bottom + window.scrollY);
      tall.remove();
      check("a long note keeps room below its last section", room >= 60, room);
    }
    check("open library tabs are told", !!(await chrome.storage.local.get("notesChanged")).notesChanged);
    check("a new, empty note starts in editing", visible($("#mine-edit")) && visible($("#save")) && !visible($("#edit")));
    check("the PDF can be opened from the note", $("#paper-links a.chip").getAttribute("href") === "open.html?id=2301.00001&local=1");
    check("the file name is shown", $("#file-name").textContent.includes("2301.00001.md"));

    // unsaved changes: leaving asks
    $("#mine-edit").value = "**bold** and $x_1 + y_2$ and `code`\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1)) [good](https://arxiv.org)\n\n- one\n- two\n\n$$E=mc^{2}$$\n\nand $\\notamacro{x}$ stays text";
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    check("leaving with unsaved changes asks first", leave.defaultPrevented);
    check("nothing is saved automatically", !file().includes("bold"));
    key("s", { ctrlKey: true });
    await sleep(300);
    check("Ctrl+S saves the user's section", file().includes(T("## Notes", "## メモ") + "\n\n**bold** and $x_1") && file().startsWith("<!-- papurr:head -->"), file());
    check("after saving: view mode and a message", visible($("#mine-view")) && !visible($("#mine-edit")) && msg() === T("Saved.", "保存しました。"), msg());
    const v = $("#mine-view");
    check("Markdown is shown: bold, list, code", !!v.querySelector("strong") && v.querySelectorAll("li").length === 2 && !!v.querySelector("code"));
    check("formulas are typeset (KaTeX), keeping their LaTeX; no italics from x_1 + y_2", !!v.querySelector(".math .katex") && v.querySelector(".math annotation").textContent === "x_1 + y_2" && v.querySelector(".math").title === "x_1 + y_2" && !v.querySelector("em"), v.innerHTML.slice(0, 300));
    check("a displayed formula is typeset as a display", !!v.querySelector("div.math.display .katex-display"), v.innerHTML.slice(-600));
    check("a formula KaTeX cannot read is shown as its LaTeX text", [...v.querySelectorAll(".math")].some((m) => m.textContent === "$\\notamacro{x}$" && !m.querySelector(".katex")), [...v.querySelectorAll(".math")].map((m) => m.textContent.slice(0, 30)).join("|"));
    check("HTML in a note is never run or shown as an element", !v.querySelector("img") && v.textContent.includes("<img src=x onerror=alert(1)>"));
    check("only http(s) links become links", [...v.querySelectorAll("a")].map((a) => a.getAttribute("href")).join() === "https://arxiv.org", v.innerHTML);
    {
      // Tables, checklists, nested lists, numbered lists that start elsewhere, strikethrough (GitHub-style Markdown)
      const box = document.createElement("div");
      renderMarkdown(["| Model | $\\Omega$ | Note |", "|:--|:-:|--:|", "| A | 0.31 | **b** |", "| x \\| y | <b>no</b> | ~~old~~ |", "",
        "- [x] done", "- [ ] todo", "  - nested one", "  - nested two", "    1. deep", "- plain", "", "3. three", "4. four"].join("\n"), box);
      const table = box.querySelector(".table-wrap > table");
      const cells = table ? [...table.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent)) : [];
      check("a Markdown table becomes a table (header, rows, alignment, \\| inside a cell)", !!table && table.querySelectorAll("th").length === 3 && cells.length === 3 && cells[2][0] === "x | y" &&
        table.querySelector("th").style.textAlign === "left" && table.querySelectorAll("th")[1].style.textAlign === "center" && table.querySelectorAll("th")[2].style.textAlign === "right" &&
        !!table.querySelector("td strong") && !!table.querySelector("th .math") && !!table.querySelector("td del"), JSON.stringify(cells));
      check("HTML in a table cell stays text", !table.querySelector("b") && cells[2][1] === "<b>no</b>");
      const boxes = [...box.querySelectorAll("li.task > input[type=checkbox]")];
      check("checklist items show read-only checkboxes", boxes.length === 2 && boxes[0].checked && !boxes[1].checked && boxes.every((b) => b.disabled) && boxes[0].parentElement.textContent === "done");
      const todo = boxes[1] && boxes[1].parentElement;
      check("indented items are nested under their item (and deeper)", !!todo && todo.querySelectorAll(":scope > ul > li").length === 2 && !!todo.querySelector(":scope > ul > li > ol > li") && todo.firstChild === boxes[1] && todo.textContent.startsWith("todo"), todo && todo.innerHTML);
      const ol = box.querySelector(":scope > ol");
      check("a numbered list keeps its first number", !!ol && ol.start === 3 && ol.children.length === 2);
    }
    const leave2 = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave2);
    check("no question when everything is saved", !leave2.defaultPrevented);

    // another computer adds a summary: coming back to the tab shows it
    fakeDir.put("2301.00001.md", file().replace("<!-- /papurr:head -->", "<!-- /papurr:head -->\n\n<!-- papurr:summary model=claude-sonnet date=2026-10-09T10:00:00Z version=v2 -->\n## Summary\n\nA *short* summary.\n<!-- /papurr:summary -->"));
    window.dispatchEvent(new Event("focus")); await sleep(200);
    const sec = $("#blocks section.note-ai");
    check("Papurr's section is shown read-only, with when and how it was made", !!sec && sec.textContent.includes(T("Summary", "要約")) && sec.textContent.includes("claude-sonnet") && sec.textContent.includes("2026-10-09") && sec.textContent.includes("v2") && !sec.querySelector("textarea"), sec && sec.textContent);

    // editing: a change elsewhere only in Papurr's sections -> saved without a question, the new section kept
    $("#edit").click();
    check("Edit shows only the user's section", $("#mine-edit").value.startsWith("**bold**") && !$("#mine-edit").value.includes("summary") && !$("#mine-edit").value.includes("## "), $("#mine-edit").value);
    fakeDir.put("2301.00001.md", file().replace("A *short* summary.", "A newer summary."));
    $("#mine-edit").value += "\n\nsecond thought";
    $("#save").click(); await sleep(300);
    check("a change to Papurr's sections only: saved without asking, both kept", $("#conflict").hidden && file().includes("A newer summary.") && file().includes("second thought"), file());

    // editing: the user's section was changed elsewhere -> asked; nothing overwritten until chosen
    $("#edit").click();
    fakeDir.put("2301.00001.md", file().replace("second thought", "changed on the laptop"));
    $("#mine-edit").value = "my desk version";
    key("s", { metaKey: true }); await sleep(300);
    check("Cmd+S too; a conflicting change is not overwritten, and the user is asked", !$("#conflict").hidden && file().includes("changed on the laptop") && !file().includes("my desk version"));
    $("#conflict-overwrite").click(); await sleep(300);
    check("Save my version: the user's section is replaced, Papurr's section kept", file().includes("my desk version") && !file().includes("changed on the laptop") && file().includes("A newer summary.") && $("#conflict").hidden, file());
    $("#edit").click();
    fakeDir.put("2301.00001.md", file().replace("my desk version", "laptop again"));
    $("#mine-edit").value = "discard me";
    $("#save").click(); await sleep(300);
    $("#conflict-reload").click(); await sleep(300);
    check("Load that version: the file wins and editing ends", $("#mine-view").textContent.includes("laptop again") && !visible($("#mine-edit")) && file().includes("laptop again"));

    // Cancel with changes asks
    $("#edit").click();
    $("#mine-edit").value = "typed";
    let asked = 0;
    window.confirm = () => { asked++; return false; };
    $("#cancel").click();
    check("Cancel with changes asks first (and No keeps editing)", asked === 1 && visible($("#mine-edit")));
    window.confirm = () => true;
    $("#cancel").click();
    check("Cancel discards", !visible($("#mine-edit")) && !file().includes("typed"));

    // delete Papurr's section
    [...$("#blocks section.note-ai").querySelectorAll("button")].find((b) => b.textContent === T("Delete", "削除")).click(); await sleep(300);
    check("deleting Papurr's section removes only it", !file().includes("papurr:summary") && file().includes("laptop again") && !$("#blocks").textContent.includes(T("Summary", "要約")), file());

    // open in my editor (helper)
    window.helperCalls = [];
    $("#editor").click(); await sleep(100);
    check("Open in my editor asks the helper to open the note", (window.helperCalls[0] || {}).action === "edit" && window.helperCalls[0].file === "2301.00001.md", JSON.stringify(window.helperCalls));
    window.helperReply = () => { throw new Error("Specified native messaging host not found."); };
    $("#editor").click(); await sleep(100);
    check("without the helper, the reason is shown", msg().includes("not found"), msg());
    window.helperReply = null;

    // the note file was deleted while the page was open: saving writes it again
    fakeDir.files.delete("2301.00001.md");
    $("#edit").click();
    $("#mine-edit").value = "rescued";
    $("#save").click(); await sleep(300);
    check("saving after the file was deleted writes it again", (file() || "").includes("rescued") && idx()["2301.00001"].note === "2301.00001.md", file());
  } catch (e) {
    results.push("EXCEPTION " + e.stack);
  } finally {
    document.getElementById("test-out").textContent = results.join("\n");
  }
})();
