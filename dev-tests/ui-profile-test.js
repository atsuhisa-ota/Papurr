// Settings -> My research: step 1 (no quota) and step 2 (the only click that spends), reading only what is new, errors.
(async () => {
  try {
    await sleep(400);
    const q = new URLSearchParams(location.search);
    const ja = q.get("lang") === "ja";
    const T = (en, jp) => (ja ? jp : en);
    const $ = (id) => document.getElementById(id);
    const file = () => (fakeDir.text("papurr-profile.json") ? JSON.parse(fakeDir.text("papurr-profile.json")) : null);
    const SUMMARY = "I work on the superconducting qubits, coherence and error correction in thermal environments.";
    const prepare = async () => { $("prof-create").click(); await sleep(250); };
    const run = async (wait = 200) => { $("prof-run").click(); await sleep(wait); };

    check("opening Settings starts nothing: no AI connection, no INSPIRE request", connects === 0 && inspireRequests.length === 0 && (window.helperCalls || []).every((c) => c.action === "ping"), connects + " " + inspireRequests.length);
    check("no profile yet; the button says Create", $("prof-status").textContent.includes(T("No profile yet", "まだありません")) && $("prof-create").textContent === T("Create profile", "プロフィールを作成") && $("prof-rebuild").hidden);
    check("defaults: 24 months, title and abstract; no setting for the number of papers (the whole latest announcement is ranked)", $("prof-months").value === "24" && $("prof-level").value === "abstract" && $("prof-level-rank").value === "abstract" && !$("prof-count"));
    check("title and abstract is marked as recommended, and the note says titles alone are less accurate; no full-text option", $("ai-profile").textContent.includes(T("recommended", "推奨")) && $("ai-profile").textContent.includes(T("less accurate", "精度が下がります")) && ![...$("ai-profile").querySelectorAll("option")].some((o) => /full|本文/i.test(o.textContent)), $("ai-profile").textContent.slice(0, 300));

    // ---- the INSPIRE author
    $("prof-url").value = "hello"; $("prof-lookup").click(); await sleep(100);
    check("a wrong address is explained", $("prof-author").textContent.includes("/authors/"), $("prof-author").textContent);
    $("prof-url").value = "https://inspirehep.net/authors/1234567"; $("prof-lookup").click(); await sleep(150);
    check("Look up shows the name of the author", $("prof-author").textContent.includes("Doe, Jane"), $("prof-author").textContent);
    $("prof-months").value = "24"; $("prof-add").value = "qubits\nerror correction"; $("prof-exclude").value = "lattice QCD, heavy quarks"; $("prof-months").dispatchEvent(new Event("change")); await sleep(50);
    const saved = (await chrome.storage.local.get("profileSettings")).profileSettings;
    check("the settings are remembered", saved.url.includes("1234567") && saved.add.join() === "qubits,error correction" && saved.exclude.join() === "lattice QCD,heavy quarks" && saved.months === 24, JSON.stringify(saved));

    // ---- step 1 uses no quota
    window.chosen = false;
    await prepare();
    check("without a folder: asks to choose one", $("prof-status").textContent.includes(T("Choose your papers folder", "論文フォルダを選んで")) && connects === 0, $("prof-status").textContent);
    window.chosen = true;
    await chrome.storage.local.set({ ai: { enabled: false, consent: { version: AI_CONSENT_VERSION, at: "x" } } });
    await prepare();
    check("with AI switched off: says so, nothing happens", $("prof-status").textContent.includes(T("turned off", "オフ")) && connects === 0 && $("prof-confirm").hidden, $("prof-status").textContent);
    await chrome.storage.local.set({ ai: { enabled: true, consent: { version: AI_CONSENT_VERSION, at: "x" }, showEstimate: true } });
    await prepare();
    check("step 1 reads INSPIRE and shows the number of papers and the estimate", !$("prof-confirm").hidden && $("prof-confirm-text").textContent.includes("3") && /[\d,]{4,}/.test($("prof-confirm-text").textContent) && inspireRequests.length >= 2, $("prof-confirm-text").textContent);
    check("the old paper (outside the period) is not included", $("prof-confirm-text").textContent.includes(T("read 3 papers", "3件の論文")), $("prof-confirm-text").textContent);
    check("step 1 did not use the AI", connects === 0);
    $("prof-cancel").click(); await sleep(50);
    check("Cancel leaves everything as it was", $("prof-confirm").hidden && connects === 0 && file() === null);
    await chrome.storage.local.set({ ai: { enabled: true, consent: { version: AI_CONSENT_VERSION, at: "x" }, showEstimate: false } });
    await prepare();
    check("with estimates off, the text still says that quota is used, without numbers", $("prof-confirm-text").textContent.includes(T("quota", "利用枠")) && !/\d{3,}/.test($("prof-confirm-text").textContent), $("prof-confirm-text").textContent);
    await chrome.storage.local.set({ ai: { enabled: true, consent: { version: AI_CONSENT_VERSION, at: "x" }, showEstimate: true } });

    // ---- step 2 spends, with this click only
    nextReply = GOOD(SUMMARY);
    await prepare();
    await run(300);
    check("Run asks the AI exactly once, with the papers and the user's topics", connects === 1 && lastPort.sent.action === "ai_run" && lastPort.sent.prompt.includes("Qubit coherence from damping") && lastPort.sent.prompt.includes("We compute the decay of qubit coherence.") && lastPort.sent.prompt.includes("lattice QCD") && lastPort.sent.prompt.includes("Task: CREATE") && !lastPort.sent.prompt.includes("An old paper"), lastPort.sent.prompt.slice(0, 300));
    check("the answer format is fixed", lastPort.sent.schema.includes('"summary"') && lastPort.sent.schema.includes('"keywords"') && lastPort.sent.timeout === 240);
    const f1 = file();
    check("the profile is saved in the papers folder", f1 && f1.inspireId === 1234567 && f1.summary === SUMMARY && f1.covered.join() === "101,102,103" && f1.coveredUntil === "2026-08-10" && f1.model === "claude-opus-5-5" && f1.settings.add.join() === "qubits,error correction", JSON.stringify(f1).slice(0, 300));
    check("the status shows the profile and the button now says Update", $("prof-status").textContent.includes("Doe, Jane") && $("prof-create").textContent === T("Update profile", "プロフィールを更新") && !$("prof-rebuild").hidden, $("prof-status").textContent);
    check("the saved profile can be read in the page", !$("prof-view").hidden && $("prof-summary").textContent.includes("superconducting qubits"));
    check("the usage list shows the run at once, without reloading", $("ai-usage").querySelectorAll("li").length === 1 && $("ai-usage").textContent.includes(T("profile", "プロフィール")) && !$("ai-usage").textContent.includes(T("not used your plan's quota yet", "まだプランの利用枠を使用していません")), $("ai-usage").textContent);
    const log1 = (await getAiUsage()).slice(-1)[0];
    check("the run is in the usage log", log1.kind === "profile" && log1.items === 3 && log1.tokens === 2702 && log1.ok, JSON.stringify(log1));

    // ---- nothing new: nothing is asked
    await prepare();
    check("Update with nothing new says so and asks nothing", $("prof-status").textContent.includes(T("up to date", "最新です")) && $("prof-confirm").hidden && connects === 1, $("prof-status").textContent);

    // ---- a new paper and a reaction: only they are read, together with the old profile
    inspirePapers.unshift({ n: 105, date: "2026-09-20", title: "Hawking radiation in squeezed states", abstract: "A new abstract." });
    const stored = file(); stored.feedback = { "2610.00005": { v: "interested", at: "2026-10-07T00:00:00Z", t: "A liked paper" } }; fakeDir.put("papurr-profile.json", JSON.stringify(stored));
    nextReply = GOOD(SUMMARY + " Recently also squeezed states.");
    await prepare();
    check("Update reads one paper (and the reaction)", !$("prof-confirm").hidden && $("prof-confirm-text").textContent.includes(T("read 1 papers", "1件の論文")), $("prof-confirm-text").textContent);
    await run(300);
    const sent = lastPort.sent.prompt;
    check("only the new paper is sent, with the previous profile and the reaction", connects === 2 && sent.includes("Task: UPDATE") && sent.includes("Hawking radiation in squeezed states") && !sent.includes("Qubit coherence from damping") && sent.includes(SUMMARY) && sent.includes("A liked paper"), sent.slice(0, 400));
    const f2 = file();
    check("the profile is updated, not replaced", f2.covered.join() === "101,102,103,105" && f2.createdAt === f1.createdAt && f2.coveredUntil === "2026-09-20" && f2.feedbackUsed.join() === "2610.00005" && f2.summary.includes("squeezed"), JSON.stringify(f2).slice(0, 200));

    // ---- failures never change the saved profile
    inspirePapers.unshift({ n: 106, date: "2026-09-25", title: "Another new paper", abstract: "More." });
    nextReply = { ok: false, code: "limit", error: "usage limit" };
    await prepare(); await run(300);
    check("a used-up quota is explained and nothing is saved", $("prof-status").textContent.includes(T("usage limit", "利用上限")) && file().covered.join() === "101,102,103,105");
    nextReply = GOOD("too short");
    await prepare(); await run(300);
    check("an answer that cannot be used is not saved", $("prof-status").textContent.includes(T("could not be read", "読み取れなかった")) && file().covered.join() === "101,102,103,105");
    hang = true;
    await prepare(); await run(100);
    const cancelBtn = $("prof-status").querySelector("button");
    check("while it runs there is a Cancel button", !!cancelBtn);
    cancelBtn.click(); await sleep(150); hang = false;
    check("Cancel stops the run and saves nothing", lastPort.closed && $("prof-status").textContent.includes(T("Cancelled", "中止")) && file().covered.join() === "101,102,103,105");
    const before = connects;
    nextReply = GOOD(SUMMARY + " Third.");
    const realCreate = fakeDir.getFileHandle.bind(fakeDir);
    let failOnce = true;
    fakeDir.getFileHandle = async (name, opts) => { const h = await realCreate(name, opts); if (failOnce && name === "papurr-profile.json" && opts && opts.create) { h.createWritable = async () => { failOnce = false; throw new Error("disk full"); }; } return h; };
    await prepare(); await run(300);
    check("if saving fails after the answer, the answer is kept and can be saved again", $("prof-status").textContent.includes("disk full") && !$("prof-savebtn").hidden && connects === before + 1 && file().covered.join() === "101,102,103,105", $("prof-status").textContent);
    $("prof-savebtn").click(); await sleep(250);
    check("Save again writes it without asking the AI again", file().covered.join() === "101,102,103,105,106" && connects === before + 1 && $("prof-savebtn").hidden, JSON.stringify(file()).slice(0, 200));

    // ---- from scratch, and another author
    nextReply = GOOD(SUMMARY + " Rebuilt.");
    $("prof-rebuild").click(); await sleep(250);
    check("from scratch reads every paper of the period again", $("prof-confirm-text").textContent.includes(T("read 5 papers", "5件の論文")), $("prof-confirm-text").textContent);
    await run(300);
    const f3 = file();
    check("a rebuild keeps the user's reactions", f3.summary.includes("Rebuilt") && f3.covered.length === 5 && f3.feedback["2610.00005"] && f3.feedback["2610.00005"].v === "interested", JSON.stringify(f3.feedback));
    $("prof-url").value = "https://inspirehep.net/authors/424242"; await prepare();
    check("another INSPIRE author means starting again, and says so", $("prof-status").textContent.includes(T("different INSPIRE author", "著者が変わった")) && !$("prof-confirm").hidden && $("prof-confirm-text").textContent.includes(T("read 5 papers", "5件の論文")), $("prof-status").textContent);
    check("nothing was spent by step 1 in all these preparations", connects === before + 2, connects + " vs " + (before + 2));
  } catch (e) {
    results.push("EXCEPTION " + e.stack);
  }
  document.getElementById("test-out").textContent = results.join("\n");
})();
