// Today's arXiv ordered by relevance: nothing runs by itself, the rank button says what it costs, scores stay hidden and
// are reused, only unscored papers are sent, failures and cancel, reactions saved in the profile file.
(async () => {
  try {
    await sleep(3800); // (the feed, then the details after arXiv's pause)
    const q = new URLSearchParams(location.search);
    const ja = q.get("lang") === "ja";
    const T = (en, jp) => (ja ? jp : en);
    const $ = (id) => document.getElementById(id);
    const bar = $("today-ai");
    const itemOf2 = (t) => [...document.querySelectorAll("#list .paper")].find((el) => el.querySelector("a.title").textContent === t);
    const titles = () => [...document.querySelectorAll("#list .paper a.title")].map((a) => a.textContent);
    const chip = (en, jp) => [...bar.querySelectorAll(".tag")].find((c) => c.textContent === T(en, jp));
    const rankBtn = () => bar.querySelector("button.rank-btn");
    const file = () => JSON.parse(fakeDir.text("papurr-profile.json"));
    check("opening the page asks the AI nothing", connects === 0);

    if (q.has("off")) {
      check("AI off: no AI controls, no reaction buttons, no summary links", bar.hidden && !document.querySelector("#list .reactions button") && !document.querySelector("#list .reactions a") && titles().length === 3);
    } else if (q.has("noprofile")) {
      check("no profile yet: a short pointer to Settings, no reactions", !bar.hidden && bar.textContent.includes(T("create your research profile", "プロフィールを作成")) && !!bar.querySelector("a[href='options.html']") && !document.querySelector("#list .reactions button"), bar.textContent);
    } else if (q.has("noest")) {
      chip("By relevance (AI)", "関連度順(AI)").click(); await sleep(100);
      const rb = [...document.querySelectorAll("#list .reactions button")].find((b) => b.textContent.startsWith(T("Why recommended", "推薦理由を見る")));
      check("with estimates off, Why recommended has no number, and its tooltip says it uses quota", rb && rb.textContent === T("Why recommended", "推薦理由を見る") && rb.title.includes(T("subscription quota", "利用枠")) && !/\d{3,}/.test(rb.title), rb && rb.textContent + " | " + rb.title);
      check("with estimates off the button still says it uses quota, without numbers", rankBtn() && rankBtn().textContent.includes(T("uses quota", "利用枠を使用")) && rankBtn().textContent.length < 40 && !/\d{3,}/.test(rankBtn().textContent) && rankBtn().title.includes(T("subscription quota", "利用枠")) && connects === 0, rankBtn() && rankBtn().textContent);
    } else if (q.has("rerank")) {
      const re = () => [...bar.querySelectorAll("button.rank-btn")].find((b) => b.textContent.startsWith(T("Re-rank", "")) || /並べ直す|重新排序/.test(b.textContent));
      check("everything is scored by other models: the order is by those scores and there is no 'Rank' button, but a Re-rank one", titles().join("|") === "Dark energy sums|Newest on strings|Yesterday's lattice" && !!re() && !/AIで\d件を並べ替え|Rank \d/.test(bar.textContent), titles().join("|") + " | " + bar.textContent);
      check("it offers the two scored by another model or an unknown one, with the estimate, and its tooltip names the model and says nothing is sent before the click", /2/.test(re().textContent) && /~\d|約\d/.test(re().textContent) && re().textContent.length < 40 && re().title.includes("Haiku 5.5") && re().title.includes(T("before you click", "クリックするまで")) && connects === 0, re().textContent + " | " + re().title);
      nextReply = scoresReply([["2610.00002", 20], ["2610.00003", 80]]);
      re().click(); await sleep(400);
      const sent2 = lastPort.sent.prompt;
      check("the click sends exactly those two papers, not the one the current model already scored", connects === 1 && sent2.includes("Dark energy sums") && sent2.includes("Newest on strings") && !sent2.includes("Yesterday's lattice"), sent2.slice(-300));
      await sleep(300);
      const saved = (await chrome.storage.local.get("aiScores")).aiScores.scores;
      check("the new scores replace the old ones and carry the current model; the other score is kept", saved["2610.00002"].s === 20 && saved["2610.00003"].s === 80 && saved["2610.00002"].model === "claude-haiku-5-5" && saved["2610.00003"].model === "claude-haiku-5-5" && saved["2610.00001"].s === 10, JSON.stringify(saved));
      check("the order follows the new scores and the button is gone", titles().join("|") === "Newest on strings|Dark energy sums|Yesterday's lattice" && !re() && !rankBtn(), titles().join("|"));
    } else if (q.has("access")) {
      check("no folder access yet: the page asks for nothing by itself and offers a button", !bar.hidden && bar.textContent.includes(T("needs access", "アクセスを許可")) && !bar.querySelector(".tag"), bar.textContent);
      bar.querySelector("button").click(); await sleep(200);
      check("after allowing access the order choice appears", !!chip("Newest", "新着順") && !!chip("By relevance (AI)", "関連度順(AI)"));
    } else {
      const sumLinks = [...document.querySelectorAll("#list .reactions a.mini")];
      check("each paper offers Summarize the full text..., which only opens its note page", sumLinks.length === 3 && sumLinks[0].textContent === T("Summarize the full text...", "全文を要約…") && sumLinks[0].getAttribute("href") === "note.html?id=" + encodeURIComponent(document.querySelector("#list .paper .meta").textContent.match(/arXiv:(\S+?)v\d/)[1]) + "&summarize=1" && !sumLinks[0].target, sumLinks.map((a) => a.getAttribute("href")).join());
      check("the order choice is shown; newest is the default; no rank button in that order", !bar.hidden && chip("Newest", "新着順").classList.contains("selected") && !rankBtn());
      check("each paper has Interested / Not interested (and Why recommended)", [...document.querySelectorAll("#list .reactions")].every((r) => [...r.querySelectorAll("button")].map((b) => b.textContent).slice(0, 2).join("|") === T("Interested|Not interested", "興味あり|興味なし") && r.querySelectorAll("button").length === (ja ? 4 : 3)) && document.querySelectorAll("#list .reactions").length === 3);
      const newest = titles();
      chip("By relevance (AI)", "関連度順(AI)").click(); await sleep(100);
      check("by relevance: the button offers the latest announcement, says how many papers and about how many tokens, before anything is sent", rankBtn() && rankBtn().textContent.includes(T("Rank 3 papers", "AIで3件")) && rankBtn().textContent.length < 40 && /~\d|約\d/.test(rankBtn().textContent) && /[\d,]{4,}/.test(rankBtn().title) && rankBtn().title.includes(T("subscription quota", "利用枠")) && connects === 0, rankBtn() && rankBtn().textContent);
      check("the choice is remembered", localStorage.getItem("todaySort") === "relevance");

      // ---- a failure first: nothing is saved, the button stays
      nextReply = { ok: false, code: "limit", error: "usage limit" };
      rankBtn().click(); await sleep(250);
      check("a used-up quota is explained; nothing is scored; the button is still there", $("msg").textContent.includes(T("usage limit", "利用上限")) && rankBtn() && connects === 1 && !(await chrome.storage.local.get("aiScores")).aiScores, $("msg").textContent);

      // ---- cancel
      hang = true;
      rankBtn().click(); await sleep(400);
      const cancel = [...bar.querySelectorAll("button")].find((b) => b.textContent === T("Cancel", "キャンセル"));
      check("while it runs there is a Cancel button (and no second rank button)", !!cancel && !rankBtn());
      const line = document.querySelector(".status-line");
      check("while it runs the status line says which model and effort are used, once: the bar itself holds only Cancel", line.textContent.includes("Haiku 5.5") && line.textContent.includes("medium") && line.textContent.includes(T("Ranking with the AI", "AIで並べ替えています")) && !bar.textContent.includes("Haiku") && !bar.textContent.includes(T("Ranking with the AI", "AIで並べ替えています")), line.textContent + " | " + bar.textContent);
      cancel.click(); await sleep(150); hang = false;
      check("Cancel stops it, nothing is scored", lastPort.closed && $("msg").textContent.includes(T("Cancelled", "中止")) && rankBtn() && connects === 2);

      // ---- success, with one paper missing from the answer
      nextReply = scoresReply([["2610.00002", 90], ["2610.00003", 50], ["9999.99999", 99]]);
      rankBtn().click(); await sleep(300);
      const sent = lastPort.sent.prompt;
      check("the request holds the profile and all announced papers with their abstracts (also one arXiv held back)", connects === 3 && sent.includes("superconducting qubits") && sent.includes("id: 2610.00003\nTitle: Newest on strings") && sent.includes("Abstract: We study strings. more text") && sent.includes("Dark energy sums") && sent.includes("Yesterday's lattice") && lastPort.sent.schema.includes('"scores"'), sent.slice(0, 200));
      check("the list is ordered by score; the unscored paper comes last", titles().join("|") === "Dark energy sums|Newest on strings|Yesterday's lattice", titles().join("|"));
      check("scores are never shown", !/\b(90|50|99)\b/.test($("list").textContent));
      check("in this order each paper shows its date instead of day headings", !document.querySelector("#list .day") && document.querySelector("#list .paper .meta").textContent.includes("2026-10-08"));
      check("the result says how many were ranked and that one got no score", $("msg").textContent.includes(T("Ranked 2 papers", "2件を並べ替えました")) && $("msg").textContent.includes(T("1 papers got no score", "1件は採点されませんでした")), $("msg").textContent);
      check("the button now offers only the one left", rankBtn() && rankBtn().textContent.includes(T("Rank 1 papers", "AIで1件")), rankBtn() && rankBtn().textContent);
      const log = (await getAiUsage()).slice(-1)[0];
      check("the run is in the usage log", log.kind === "rank" && log.items === 3 && log.tokens === 3062 && log.ok, JSON.stringify(log));
      nextReply = scoresReply([["2610.00001", 10]]);
      rankBtn().click(); await sleep(300);
      check("the second click sends only that paper; then the whole announcement is ranked", connects === 4 && lastPort.sent.prompt.includes("Yesterday's lattice") && !lastPort.sent.prompt.includes("Dark energy sums") && !rankBtn(), lastPort.sent.prompt.slice(-400));

      // ---- the cache is used: no new request when switching back and forth
      chip("Newest", "新着順").click(); await sleep(80);
      check("newest order is back", titles().join("|") === newest.join("|"));
      chip("By relevance (AI)", "関連度順(AI)").click(); await sleep(80);
      // ---- levels of relevance: a badge with dots (no number), and the choice of what to show
      const badge = (t) => (itemOf2(t).querySelector(".meta .level") || {}).textContent || "";
      check("each ranked paper shows its level as dots, not as a number", badge("Dark energy sums").endsWith("\u25cf\u25cf\u25cf") && badge("Newest on strings").endsWith("\u25cf\u25cf\u25cb") && badge("Yesterday's lattice").endsWith("\u25cf\u25cb\u25cb") && !/\d/.test(badge("Dark energy sums")), badge("Dark energy sums") + "|" + badge("Newest on strings"));
      chip("Medium and high", "関連度 中以上").click(); await sleep(50);
      check("Medium and high hides the low one and says how many are hidden", titles().join("|") === "Dark energy sums|Newest on strings" && $("msg").textContent.includes("1"), titles().join("|") + " | " + $("msg").textContent);
      chip("High only", "関連度 大のみ").click(); await sleep(50);
      check("High only shows only the high one; the choice is remembered", titles().join("|") === "Dark energy sums" && localStorage.getItem("todayLevel") === "high" && connects === 4);
      chip("All", "すべて").click(); await sleep(50);
      check("relevance again, from the saved scores, nothing sent", titles().join("|") === "Dark energy sums|Newest on strings|Yesterday's lattice" && connects === 4 && !rankBtn());

      // ---- Load more: older papers are not part of the latest announcement and are not offered for ranking
      await sleep(3300);
      document.querySelector("#list .show-more").click(); await sleep(4500);
      check("older papers from Load more are listed after the ranked ones, and nothing is offered or sent", connects === 4 && !rankBtn() && titles().join("|") === "Dark energy sums|Newest on strings|Yesterday's lattice|Older still", titles().join("|"));

      // ---- reactions
      const itemOf = (t) => [...document.querySelectorAll("#list .paper")].find((el) => el.querySelector("a.title").textContent === t);
      const reactBtn = (t, en, jp) => [...itemOf(t).querySelectorAll(".reactions button")].find((b) => b.textContent === T(en, jp));
      reactBtn("Dark energy sums", "Not interested", "興味なし").click(); await sleep(200);
      check("Not interested is saved in the profile file with the title", file().feedback["2610.00002"] && file().feedback["2610.00002"].v === "not" && file().feedback["2610.00002"].t === "Dark energy sums");
      check("and that paper moves to the end of the ranked ones", titles().join("|") === "Newest on strings|Yesterday's lattice|Dark energy sums|Older still", titles().join("|"));
      check("the button shows that it is on", reactBtn("Dark energy sums", "Not interested", "興味なし").classList.contains("selected") && reactBtn("Dark energy sums", "Not interested", "興味なし").getAttribute("aria-pressed") === "true");
      check("a reaction does not change the profile version, so the scores stay valid", file().updatedAt === PROFILE.updatedAt && connects === 4 && !rankBtn());
      reactBtn("Dark energy sums", "Not interested", "興味なし").click(); await sleep(200);
      check("pressing it again removes it", !file().feedback["2610.00002"] && titles()[0] === "Dark energy sums");
      reactBtn("Older still", "Interested", "興味あり").click(); await sleep(200);
      check("Interested is saved too", file().feedback["2610.00000"].v === "interested");
      check("nothing in all this asked the AI without a click", connects === 4);

      // ---- Why recommended (one paper, on a click)
      const reasonBtn = (t) => [...itemOf(t).querySelectorAll(".reactions button")].pop();
      const b1 = reasonBtn("Newest on strings");
      check("each paper has Why recommended with a short estimate, and its tooltip gives the tokens", b1.textContent.startsWith(T("Why recommended · ~", "推薦理由を見る · 約")) && /\d(\.\d)?k$/.test(b1.textContent) && b1.title.includes(T("subscription quota", "利用枠")) && /\d,\d{3}/.test(b1.title) && connects === 4, b1.textContent + " | " + b1.title);
      nextReply = { ok: false, code: "limit", error: "usage limit" };
      b1.click(); await sleep(250);
      check("a failure is explained, nothing is kept, the button is still there", connects === 5 && $("msg").textContent.includes(T("usage limit", "利用上限")) && !(await chrome.storage.local.get("aiReasons")).aiReasons && !itemOf("Newest on strings").querySelector(".reason") && reasonBtn("Newest on strings").textContent.includes("~") === !ja, $("msg").textContent);
      hang = true;
      reasonBtn("Newest on strings").click(); await sleep(100);
      const box = itemOf("Newest on strings").querySelector(".reason");
      check("while asking: the paper shows the model, the seconds and a Cancel button; other reason buttons wait", !!box && box.textContent.includes("Haiku 5.5") && /\(\d+ ?(s|秒)\)/.test(box.textContent) && !!box.querySelector("button") && reasonBtn("Older still").disabled && !!box.querySelector("svg.mark"), box && box.textContent);
      box.querySelector("button").click(); await sleep(150); hang = false;
      check("Cancel stops it", lastPort.closed && $("msg").textContent.includes(T("Cancelled", "中止")) && !itemOf("Newest on strings").querySelector(".reason"));
      nextReply = reasonReply("It studies the same $\\Omega_{GW}$ spectrum as your work.");
      reasonBtn("Newest on strings").click(); await sleep(300);
      const asked = lastPort.sent;
      check("the request is about that one paper, in the page's language, with the reason schema", connects === 7 && asked.prompt.includes("Title: Newest on strings") && !asked.prompt.includes("Dark energy sums") && asked.prompt.includes(T("in English", "in Japanese")) && asked.schema.includes('"reason"'), asked.prompt.slice(-300));
      const shown = itemOf("Newest on strings").querySelector(".reason");
      check("the reason is shown between the abstract and the buttons, with the cat mark", !!shown && shown.textContent.includes("It studies the same") && shown.querySelector(".math .katex") && shown.querySelector(".math").title === "\\Omega_{GW}" && shown.previousElementSibling.classList.contains("abstract") && shown.nextElementSibling.classList.contains("paper-row") && !!shown.querySelector("svg.mark"));
      check("the button now hides it, and the result says what it used", reasonBtn("Newest on strings").textContent === T("Hide the reason", "推薦理由を隠す") && $("msg").textContent.includes("3,120"), $("msg").textContent);
      check("the reason is kept in the browser, and the run is in the usage log", (await chrome.storage.local.get("aiReasons")).aiReasons["2610.00003"][T("en", "ja")].text.includes("spectrum") && (await getAiUsage()).slice(-1)[0].kind === "reason");
      check("a paper without a note gets no note file", fakeDir.text("2610.00003.md") === null);
      reasonBtn("Newest on strings").click(); await sleep(50);
      check("hiding uses no quota", !itemOf("Newest on strings").querySelector(".reason") && connects === 7 && reasonBtn("Newest on strings").textContent === T("Why recommended", "推薦理由を見る"));
      reasonBtn("Newest on strings").click(); await sleep(50);
      check("showing again uses no quota", !!itemOf("Newest on strings").querySelector(".reason") && connects === 7);
      // ---- "Add to library" in the row of every paper: saved in a background tab, not opened; marked when the library has it
      const created = [];
      chrome.tabs.create = async (o) => created.push(o);
      const addBtn = () => [...itemOf("Newest on strings").querySelectorAll(".dbs button")].find((b) => b.textContent.startsWith(T("Add", "ライブラリに追加")) || b.textContent.startsWith(T("Adding", "追加中")));
      check("Add to library is in the paper's row (where In library is shown), not inside the reason", !!addBtn() && addBtn().textContent === T("Add to library", "ライブラリに追加") && !itemOf("Newest on strings").querySelector(".reason button") && !!itemOf("Older still").querySelector(".dbs button"));
      addBtn().click(); await sleep(100);
      check("it saves the paper in a tab in the background (folder already allowed), without opening the PDF, handing over the title", created.length === 1 && created[0].url.startsWith("open.html?id=2610.00003&v=v1&save=1&") && new URLSearchParams(created[0].url.split("?")[1]).get("title") === "Newest on strings" && created[0].active === false, JSON.stringify(created));
      check("while saving, the button says so and waits", addBtn() && addBtn().disabled && addBtn().textContent === T("Adding...", "追加中…"));
      const libCh = new BroadcastChannel("papurr");
      libCh.postMessage({ type: "added", id: "2610.00003" }); await sleep(100);
      check("when it is saved, the paper is marked In library in its row", !addBtn() && itemOf("Newest on strings").querySelector(".dbs .mini.done").textContent.includes(T("In library", "保存済み")));
      libCh.close();
      nextReply = reasonReply("Close to your plasma work.");
      reasonBtn("Dark energy sums").click(); await sleep(300);
      check("a paper already in the library shows In library instead of Add to library", !!itemOf("Dark energy sums").querySelector(".dbs .mini.done") && ![...itemOf("Dark energy sums").querySelectorAll("button")].some((b) => b.textContent === T("Add to library", "ライブラリに追加")));
      check("for a paper with a note, the reason is also written into the note (the user's text untouched)", (fakeDir.text("2610.00002.md") || "").includes("<!-- papurr:reason model=claude-haiku-5-5") && fakeDir.text("2610.00002.md").includes("Close to your plasma work.") && fakeDir.text("2610.00002.md").endsWith("## Notes\n\nmy note\n"), fakeDir.text("2610.00002.md"));
      // ---- another output language: the kept version stays, a version in the new language is added, chips switch (free)
      const st = (await chrome.storage.local.get("ai")).ai;
      await chrome.storage.local.set({ ai: { ...st, outputLang: "de" } }); await sleep(300);
      const make = () => [...itemOf("Newest on strings").querySelectorAll(".reason button")].find((b) => b.textContent.startsWith("Deutsch") || b.textContent.startsWith("Make it in Deutsch"));
      check("with German chosen in Settings, the kept reason is still shown, with Make it in German and its estimate", itemOf("Newest on strings").querySelector(".reason").textContent.includes("spectrum") && !!make() && /~|約/.test(make().textContent), itemOf("Newest on strings").querySelector(".reason").textContent);
      nextReply = reasonReply("Es untersucht dasselbe Spektrum.");
      const before = connects;
      make().click(); await sleep(300);
      check("the request asks for German; both versions are kept", connects === before + 1 && lastPort.sent.prompt.includes("in German") && Object.keys((await chrome.storage.local.get("aiReasons")).aiReasons["2610.00003"]).sort().join() === [T("en", "ja"), "de"].sort().join());
      const chips = () => [...itemOf("Newest on strings").querySelectorAll(".reason-langs .tag")];
      check("the German version is shown, with chips for both languages", itemOf("Newest on strings").querySelector(".reason").textContent.includes("dasselbe") && chips().map((c) => c.textContent).sort().join() === ["Deutsch", T("English", "日本語")].sort().join() && !make());
      chips().find((c) => c.textContent === T("English", "日本語")).click(); await sleep(50);
      check("a chip switches to the other version without asking the AI", itemOf("Newest on strings").querySelector(".reason").textContent.includes("spectrum") && connects === before + 1);
      await chrome.storage.local.set({ ai: { ...st, outputLang: "" } }); await sleep(300);
      nextReply = reasonReply("   ");
      reasonBtn("Older still").click(); await sleep(300);
      check("an empty answer saves nothing and says so", !(await chrome.storage.local.get("aiReasons")).aiReasons["2610.00000"] && $("msg").textContent.includes(T("no usable answer", "使える答え")), $("msg").textContent);
      // ---- translating an abstract (into the language of the AI's texts; abstracts are in English)
      const st2 = (await chrome.storage.local.get("ai")).ai;
      check("with English as the AI's language there is no Translate button", ![...itemOf("Older still").querySelectorAll(".reactions button")].some((b) => /^Translate|^翻訳/.test(b.textContent)) || ja);
      await chrome.storage.local.set({ ai: { ...st2, outputLang: "fr" } }); await sleep(300);
      const trBtn = (t) => [...itemOf(t).querySelectorAll(".reactions button")].find((b) => b.textContent.startsWith(T("Translate (Français)", "翻訳(Français)")) || b.textContent.startsWith(T("Show the translation", "訳を表示")) || b.textContent.startsWith(T("Hide the translation", "訳を隠す")));
      check("with another language: Translate (Français) with a short estimate, and the tooltip says it uses quota", !!trBtn("Older still") && /~|約/.test(trBtn("Older still").textContent) && trBtn("Older still").title.includes(T("subscription quota", "利用枠")), trBtn("Older still") && trBtn("Older still").textContent);
      const c0 = connects;
      nextReply = { ok: true, result: { translation: "Plus ancien. plus de texte $$\\int_0^\\infty \\frac{x^{2}}{e^{x}-1}\\,dx \;=\; \\sum_{n=1}^{\\infty}\\frac{1}{n^{3}}\\,\\Gamma(3)\;=\;2\\zeta(3)\;\\approx\;2.404113806319188570799476323022899981529972584680997205\;\\text{(unbreakable)}$$ fin." }, usage: { input_tokens: 500, output_tokens: 40 }, durationMs: 2000, models: ["claude-haiku-5-5"] };
      trBtn("Older still").click(); await sleep(300);
      check("the request asks for French and carries the abstract", connects === c0 + 1 && lastPort.sent.prompt.includes("into French") && lastPort.sent.prompt.includes("Older. more text") && lastPort.sent.schema.includes('"translation"'), lastPort.sent.prompt.slice(0, 200));
      const tbox = itemOf("Older still").querySelector(".translation");
      { const item = itemOf("Older still"), r = (e) => e.getBoundingClientRect();
        check("a long formula in a translation stays inside its box: the box and the paper do not grow (the formula scrolls)", !!tbox && !!tbox.querySelector(".katex") && r(tbox).right <= r(item).right + 1 && item.scrollWidth <= item.clientWidth + 1, tbox ? r(tbox).right + " / " + r(item).right : "no box"); }
      check("the translation is shown under the abstract, labelled with its language; kept and logged", !!tbox && tbox.textContent.includes("Plus ancien.") && tbox.textContent.includes("Français") && tbox.previousElementSibling.classList.contains("abstract") && (await chrome.storage.local.get("aiTranslations")).aiTranslations["2610.00000"].fr.text.startsWith("Plus") && (await getAiUsage()).slice(-1)[0].kind === "translation");
      trBtn("Older still").click(); await sleep(50);
      check("hiding and showing again uses no quota", !itemOf("Older still").querySelector(".translation") && connects === c0 + 1);
      nextReply = { ok: true, result: { translation: "Une très longue." }, usage: { input_tokens: 500, output_tokens: 40 }, durationMs: 2000, models: ["claude-haiku-5-5"] };
      trBtn("Dark energy sums").click(); await sleep(300);
      check("for a paper with a note, the translated abstract is also written into the note", (fakeDir.text("2610.00002.md") || "").includes("<!-- papurr:abstract model=claude-haiku-5-5") && fakeDir.text("2610.00002.md").includes("Une très longue.") && fakeDir.text("2610.00002.md").endsWith("## Notes\n\nmy note\n"), fakeDir.text("2610.00002.md"));
      await chrome.storage.local.set({ ai: { ...st2, outputLang: "" } }); await sleep(300);
    }
  } catch (e) {
    results.push("EXCEPTION " + e.stack);
  }
  document.getElementById("test-out").textContent = results.join("\n");
})();
