// Settings -> AI: the platform note, the agreement, the switch, checking the claude command (install / sign-in help,
// models), the estimate switch, the usage log, and the rules of aiRun (no click, no run; nothing runs by itself).
(async () => {
  try {
    await sleep(300);
    const q = new URLSearchParams(location.search);
    const ja = q.get("lang") === "ja";
    const T = (en, jp) => (ja ? jp : en);
    const $ = (id) => document.getElementById(id);
    const stored = async () => (await chrome.storage.local.get("ai")).ai || {};
    window.__papurrTest = true; // (page tests cannot make trusted clicks)
    const click = (el) => { el.click(); };
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { copied = t; } } });

    if (q.get("os") === "win") {
      check("Windows: the feature is explained as unavailable and the controls are hidden", !$("ai-platform").hidden && $("ai-body").hidden && $("ai-platform").textContent.includes(T("Windows", "Windows")), $("ai-platform").textContent);
      await chrome.storage.local.set({ ai: { enabled: true, consent: { version: AI_CONSENT_VERSION, at: "x" } } });
      let err = null;
      try { await aiRun(aiClick({ type: "click", isTrusted: true }), { kind: "rank", prompt: "x" }).promise; } catch (e) { err = e; }
      check("Windows: aiRun refuses even if the settings say yes", err && err.code === "platform", err && err.code);
      check("Windows: opening Settings only pings the helper (no command, no connection)", (window.helperCalls || []).every((c) => c.action === "ping") && !window.connected);
      window.helperReply = () => { throw new Error("no host"); }; await loadOpenSettings(); // (without the helper the steps for this system are shown)
      check("Windows: the helper setup and the PDF app example are for Windows only", $("helper-setup").textContent.includes("Install helper (Windows).bat") && $("viewer").placeholder.includes("SumatraPDF") && !/Mac|Linux|Finder|\.command/.test($("helper-setup").textContent + $("viewer").placeholder), $("helper-setup").textContent + " | " + $("viewer").placeholder);
      check("Windows: the page never mentions other systems", !/\bMac\b|macOS|Linux/.test(document.body.innerText), (document.body.innerText.match(/.{0,60}(\bMac\b|macOS|Linux).{0,60}/) || [""])[0]);
    } else {
      const asked = JSON.stringify(window.helperCalls);
      window.helperReply = () => { throw new Error("no host"); }; await loadOpenSettings(); // (without the helper the steps for this system are shown)
      check("Mac: the helper setup and the PDF app example are for the Mac only, and no system is named elsewhere", $("helper-setup").textContent.includes("Install helper (Mac).command") && $("viewer").placeholder.includes("Skim") && !/Windows|Linux/.test(document.body.innerText), (document.body.innerText.match(/.{0,60}(Windows|Linux).{0,60}/) || [""])[0]);
      // ---- nothing starts by itself
      check("opening Settings does not start the command: the helper is only pinged", JSON.parse(asked || "[]").every((c) => c.action === "ping"), asked);
      check("AI is off and not agreed to at first", !$("ai-consent").checked && !$("ai-enabled").checked && $("ai-enabled").disabled && (await stored()).enabled !== true);
      check("while AI is not used, everything below the switch is folded away", $("ai-details").hidden && !$("ai-consent").closest("[hidden]"));
      {
        const text = $("ai-consent").parentElement.textContent;
        check("the notice names everything the profile sends (name, INSPIRE ID, own papers, topics, previous profile, reactions) and paid extra usage", [T("my name", "私の名前"), "INSPIRE", T("topics", "テーマ"), T("previous profile", "以前のプロフィール"), T("Interested / Not interested", "興味あり/なし"), T("extra usage", "追加利用")].every((w) => text.includes(w)), text);
        const stale = { enabled: true, consent: { version: AI_CONSENT_VERSION - 1, at: "2026-10-01T00:00:00Z" } };
        check("an agreement to the earlier text no longer counts (the user is asked again)", !aiConsentGiven(stale));
      }
      check("the notice says what is sent, to whom, and that quota is used", $("ai-consent").parentElement.textContent.includes(T("quota", "利用枠")) && $("ai-consent").parentElement.textContent.includes(T("titles and abstracts", "タイトルとアブストラクト")) && $("ai-consent").parentElement.textContent.includes(T("provider", "提供元")));
      const guide = $("ai-guide");
      check("the quota guide comes first in the section, before the first checkbox", guide && !!(guide.compareDocumentPosition($("ai-consent")) & Node.DOCUMENT_POSITION_FOLLOWING) && ![...$("ai-section").querySelectorAll("input[type=checkbox]")].some((c) => c.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING));
      check("the guide: share of the 5-hour limit per model, plan, date, an estimate, not guaranteed", (guide.textContent.includes("1–1.5%") || guide.textContent.includes("1〜1.5%")) && guide.textContent.includes("Pro") && guide.textContent.includes(T("October 2026", "2026年10月")) && guide.textContent.includes(T("estimate", "推定値")) && guide.textContent.includes(T("not guaranteed", "保証するものではありません")), guide.textContent);
      check("the description says nothing runs by itself and no API key is billed", $("ai-section").textContent.includes(T("Each run uses your plan's quota", "実行ごとにプランの利用枠を消費します")) && $("ai-section").textContent.includes(T("No API key is ever billed", "課金は一切発生しません")));

      // ---- agreement and switch
      click($("ai-consent")); await sleep(50);
      check("agreeing allows the switch (still off)", !$("ai-enabled").disabled && !$("ai-enabled").checked && (await stored()).consent.version === AI_CONSENT_VERSION && !(await stored()).enabled);
      click($("ai-enabled")); await sleep(50);
      check("the switch turns AI on", (await stored()).enabled === true);
      check("and unfolds the AI settings, with the token switch first", !$("ai-details").hidden && $("ai-details").firstElementChild.contains($("ai-estimate")));
      click($("ai-consent")); await sleep(50);
      check("withdrawing the agreement turns AI off again", (await stored()).enabled === false && (await stored()).consent === null && $("ai-enabled").disabled && !$("ai-enabled").checked && $("ai-details").hidden);
      click($("ai-consent")); await sleep(50);
      click($("ai-enabled")); await sleep(50);

      // ---- checking the command: each answer of the helper has its own help
      const reply = (r) => { chrome.runtime.sendNativeMessage = async (h, m) => { (window.helperCalls = window.helperCalls || []).push(m); return r; }; };
      reply({ ok: true, found: false, os: "mac" });
      click($("ai-check")); await sleep(100);
      const lastCall = window.helperCalls.slice(-1)[0];
      check("Check asks only for the status", lastCall.action === "ai_status" && lastCall.command === "claude");
      check("not installed: says so and offers the package manager's command for this OS (only that)", $("ai-status").textContent.includes(T("not found", "見つかりません")) && !$("ai-install").hidden && $("ai-install").textContent.includes("brew install --cask claude-code") && !$("ai-install").textContent.includes("curl"), $("ai-install").textContent);
      check("and says what to do if it is installed elsewhere (PATH is the user's business; or a full path)", $("ai-install").textContent.includes("PATH"));
      click($("ai-install").querySelector("button")); await sleep(50);
      check("the Copy button copies the command", copied === "brew install --cask claude-code", copied);
      check("a link to the official instructions is given", !!$("ai-install").querySelector("a[href='" + AI_COMMANDS.claude.docs + "']"));
      reply({ ok: true, found: true, version: "2.1.9 (Claude Code)", path: "/opt/homebrew/bin/claude", loggedIn: false, authMethod: "", subscription: false, models: [], efforts: [] });
      click($("ai-check")); await sleep(100);
      check("not signed in: asks the user to sign in themselves", $("ai-status").textContent.includes(T("not signed in", "サインインしていません")) && $("ai-install").textContent.includes("claude") && $("ai-install").textContent.includes(T("Papurr never signs in for you", "サインインを代行することはありません")), $("ai-install").textContent);
      reply({ ok: true, found: true, version: "2.1.9", loggedIn: true, authMethod: "api_key", subscription: false, models: [], efforts: [] });
      click($("ai-check")); await sleep(100);
      check("an API-key sign-in is refused with the reason", $("ai-status").textContent.includes("api_key") && $("ai-options").hidden, $("ai-status").textContent);
      reply({ ok: true, found: true, version: "2.1.9 (Claude Code)", path: "/opt/homebrew/bin/claude", loggedIn: true, authMethod: "claude.ai", subscription: true,
        models: [{ id: "claude-opus-5-5", name: "Opus 5.5", main: true }, { id: "claude-opus-4-6", name: "Opus 4.6", main: false }], efforts: ["low", "medium", "high"] });
      click($("ai-check")); await sleep(100);
      check("ready: says which command was found, where, and the plan", $("ai-status").textContent.includes("/opt/homebrew/bin/claude") && $("ai-status").textContent.includes("Claude"), $("ai-status").textContent);
      check("ready: the model and effort lists come from the command", $("ai-status").textContent.includes("2.1.9") && !$("ai-options").hidden && $("ai-options").querySelectorAll("select").length === 2 && [...$("ai-options").querySelectorAll("select")[0].options].map((o) => o.value).join() === ",claude-opus-5-5,claude-opus-4-6" && [...$("ai-options").querySelectorAll("select")[1].options].map((o) => o.value).join() === ",low,medium,high", $("ai-options").innerHTML);
      const modelSel = $("ai-options").querySelectorAll("select")[0];
      modelSel.value = "claude-opus-5-5"; modelSel.dispatchEvent(new Event("change")); await sleep(50);
      check("the chosen model is saved", (await stored()).model === "claude-opus-5-5");
      check("the last status is remembered (so that opening Settings never starts the command)", (await stored()).status && (await stored()).status.version === "2.1.9 (Claude Code)");
      reply({ ok: true, found: true, version: "2.1.9", loggedIn: true, authMethod: "claude.ai", subscription: true, models: [], efforts: [] });
      click($("ai-check")); await sleep(100);
      check("if the command lists no models, free text boxes are shown", $("ai-options").querySelectorAll("input[type=text]").length === 2 && $("ai-options").querySelectorAll("select").length === 0);
      chrome.runtime.sendNativeMessage = async () => { throw new Error("Specified native messaging host not found."); };
      click($("ai-check")); await sleep(100);
      check("a missing helper is explained", $("ai-status").textContent.includes("not installed") || $("ai-status").textContent.includes("インストールされていない"), $("ai-status").textContent);

      // ---- Codex CLI
      check("the command can be chosen: claude, codex or kimi (shown by their command names)", [...$("ai-command").options].map((o) => o.value + "=" + o.textContent).join() === "claude=claude,codex=codex,kimi=kimi" && $("ai-command").value === "claude", [...$("ai-command").options].map((o) => o.textContent).join());
      $("ai-command").value = "codex"; $("ai-command").dispatchEvent(new Event("change")); await sleep(80);
      check("choosing codex forgets the other command's model and status", (await stored()).command === "codex" && (await stored()).model === "" && (await stored()).status === null && $("ai-status").textContent.includes(T("Not checked yet", "まだ確認していません")), $("ai-status").textContent);
      reply({ ok: true, found: false, os: "mac" });
      click($("ai-check")); await sleep(100);
      check("Check asks about codex", window.helperCalls.slice(-1)[0].command === "codex");
      check("codex not installed: Homebrew's command for codex", $("ai-install").textContent.includes("brew install --cask codex") && $("ai-status").textContent.includes("codex") && !!$("ai-install").querySelector("a[href='" + AI_COMMANDS.codex.docs + "']"), $("ai-install").textContent);
      reply({ ok: true, found: true, version: "codex-cli 0.161.0", path: "/opt/homebrew/bin/codex", loggedIn: false, authMethod: "", subscription: false });
      click($("ai-check")); await sleep(100);
      check("codex not signed in: 'Sign in with ChatGPT' in the Terminal", $("ai-install").textContent.includes("Sign in with ChatGPT") && $("ai-install").textContent.includes("codex"), $("ai-install").textContent);
      reply({ ok: true, found: true, version: "codex-cli 0.161.0", path: "/opt/homebrew/bin/codex", loggedIn: true, authMethod: "ChatGPT", subscription: true, models: [{ id: "gpt-a", name: "GPT-A", main: true }], efforts: ["low", "medium"] });
      click($("ai-check")); await sleep(100);
      check("codex ready: the ChatGPT plan, its models and efforts", $("ai-status").textContent.includes("ChatGPT") && $("ai-status").textContent.includes("/opt/homebrew/bin/codex") && [...$("ai-options").querySelectorAll("select")[0].options].map((o) => o.value).join() === ",gpt-a", $("ai-status").textContent);
      $("ai-path").value = "/somewhere/codex"; $("ai-path").dispatchEvent(new Event("change")); await sleep(80);
      check("a full path can be given (it clears the old status)", (await stored()).path === "/somewhere/codex" && (await stored()).status === null);
      click($("ai-check")); await sleep(100);
      check("and is sent with the check", window.helperCalls.slice(-1)[0].path === "/somewhere/codex");
      // ---- Kimi Code CLI
      $("ai-command").value = "kimi"; $("ai-command").dispatchEvent(new Event("change")); await sleep(80);
      check("choosing kimi forgets the other command's status", (await stored()).command === "kimi" && (await stored()).status === null);
      reply({ ok: true, found: false, os: "linux" });
      click($("ai-check")); await sleep(100);
      check("Check asks about kimi", window.helperCalls.slice(-1)[0].command === "kimi");
      check("kimi not installed: the npm command, the official page, no apt/dnf remark", $("ai-install").textContent.includes("npm install -g @moonshot-ai/kimi-code") && !!$("ai-install").querySelector("a[href='" + AI_COMMANDS.kimi.docs + "']") && !$("ai-install").textContent.includes("apt"), $("ai-install").textContent);
      reply({ ok: true, found: true, version: "2.1.1", path: "/home/u/.kimi-code/bin/kimi", loggedIn: false, authMethod: "", subscription: false });
      click($("ai-check")); await sleep(100);
      check("kimi not signed in: 'kimi login' to copy", [...$("ai-install").querySelectorAll("code")].some((c) => c.textContent === "kimi login") || $("ai-install").textContent.includes("kimi login"), $("ai-install").textContent);
      reply({ ok: true, found: true, version: "2.1.1", path: "/home/u/.kimi-code/bin/kimi", loggedIn: true, authMethod: "API key", subscription: false });
      click($("ai-check")); await sleep(100);
      check("kimi with only an API-key provider: not a plan, so not used", $("ai-status").textContent.includes("API key") && $("ai-options").hidden, $("ai-status").textContent);
      reply({ ok: true, found: true, version: "2.1.1", path: "/home/u/.kimi-code/bin/kimi", loggedIn: true, authMethod: "Kimi Code (OAuth)", subscription: true, models: [{ id: "kimi-code/k3", name: "K3", main: true }], efforts: ["low", "high", "max"] });
      click($("ai-check")); await sleep(100);
      check("kimi ready: the Kimi Code plan, its models (aliases with /) and efforts", $("ai-status").textContent.includes("Kimi Code") && [...$("ai-options").querySelectorAll("select")[0].options].map((o) => o.value).join() === ",kimi-code/k3" && [...$("ai-options").querySelectorAll("select")[1].options].map((o) => o.value).join() === ",low,high,max", $("ai-status").textContent);
      check("estimates use kimi's small fixed cost", estimateRun("x".repeat(280), 300, "kimi").total === AI_FIXED_TOKENS_BY_COMMAND.kimi + 100 + 300);
      $("ai-command").value = "claude"; $("ai-command").dispatchEvent(new Event("change")); await sleep(80);
      check("back to claude (path cleared)", (await stored()).command === "claude" && (await stored()).path === "" && $("ai-path").value === "");
      reply({ ok: true, found: true, version: "2.1.9 (Claude Code)", path: "/opt/homebrew/bin/claude", loggedIn: true, authMethod: "claude.ai", subscription: true, models: [{ id: "claude-opus-5-5", name: "Opus 5.5", main: true }], efforts: ["low"] });
      click($("ai-check")); await sleep(100);
      modelSel.value = "claude-opus-5-5"; $("ai-options").querySelectorAll("select")[0].value = "claude-opus-5-5"; $("ai-options").querySelectorAll("select")[0].dispatchEvent(new Event("change")); await sleep(50);

      // ---- the estimate switch (on by default)
      const langSel = $("ai-lang");
      check("the AI's language follows the interface by default, and names it", langSel.value === "" && langSel.options[0].textContent.includes(T("English", "日本語")) && [...langSel.options].some((o) => o.value === "de" && o.textContent === "Deutsch"), langSel.options[0].textContent);
      langSel.value = "de"; langSel.dispatchEvent(new Event("change")); await sleep(50);
      check("choosing a language saves it", (await stored()).outputLang === "de");
      langSel.value = ""; langSel.dispatchEvent(new Event("change")); await sleep(50);
      check("and back to the interface language", (await stored()).outputLang === "");
      // ---- the summary: three technical levels and the user's own instructions
      const lvl = $("ai-summary-level"), own = $("ai-summary-note");
      check("the summary level has three steps and the middle one is chosen by default", [...lvl.options].map((o) => o.value).join() === "overview,standard,technical" && lvl.value === "standard" && [...lvl.options].every((o) => o.textContent.length > 10), [...lvl.options].map((o) => o.textContent).join(" | "));
      lvl.value = "technical"; lvl.dispatchEvent(new Event("change")); await sleep(50);
      check("choosing a level saves it", (await stored()).summaryLevel === "technical");
      lvl.value = "standard"; lvl.dispatchEvent(new Event("change")); await sleep(50);
      check("the own-instructions box starts empty, has a limit and says what happens to the text", own.value === "" && own.maxLength === 600 && own.parentElement.textContent.includes(T("sent to the AI", "AIへ送信")), own.parentElement.textContent);
      own.value = "  Say which experiments could test it. >>>x<<<  "; own.dispatchEvent(new Event("change")); await sleep(50);
      check("the instructions are saved cleaned (no marker that could close the block, trimmed)", (await stored()).summaryNote === "Say which experiments could test it.  x", JSON.stringify((await stored()).summaryNote) + " | " + own.value);
      own.value = ""; own.dispatchEvent(new Event("change")); await sleep(50);
      check("and can be emptied", (await stored()).summaryNote === "");
      check("token estimates are on by default", $("ai-estimate").checked && (await stored()).showEstimate !== false);
      click($("ai-estimate")); await sleep(50);
      check("and can be turned off; then the usage list is not shown either", (await stored()).showEstimate === false && $("ai-usage").hidden);
      click($("ai-estimate")); await sleep(50);
      check("on again: the usage list is back", !$("ai-usage").hidden);

      // ---- aiRun: the rules
      const settingsNow = await stored();
      const port = (replyMsg, opts = {}) => {
        const l = { msg: [], disc: [] };
        const p = { sent: null, closed: false, onMessage: { addListener: (f) => l.msg.push(f) }, onDisconnect: { addListener: (f) => l.disc.push(f) },
          postMessage(m) { p.sent = m; if (!opts.hang) setTimeout(() => l.msg.forEach((f) => f(replyMsg)), 20); },
          disconnect() { p.closed = true; l.disc.forEach((f) => f()); } };
        return p;
      };
      let connects = 0, last = null;
      const connectWith = (p) => { window.fakeConnect = () => { connects++; last = p; return p; }; };
      const asClick = () => aiClick({ type: "click", isTrusted: false });
      const attempt = async (token, req = { kind: "rank", items: 3, prompt: "Rank these." }) => { try { return await aiRun(token, req).promise; } catch (e) { return e; } };
      const OKREPLY = { ok: true, result: [{ id: "a", score: 70 }], usage: { input_tokens: 2, cache_creation_input_tokens: 1500, cache_read_input_tokens: 500, output_tokens: 9 }, costUsd: 0.01, durationMs: 1234, models: ["claude-opus-5-5"] };

      window.__papurrTest = false;
      let err = null;
      try { aiClick({ type: "click", isTrusted: false }); } catch (e) { err = e; }
      check("a click made by a script is not accepted", err && err.code === "noclick");
      window.__papurrTest = true;
      check("no token, no run", (await attempt({})).code === "noclick" && connects === 0);
      let t = asClick(); connectWith(port(OKREPLY));
      const ok = await attempt(t, { kind: "rank", items: 3, prompt: "Rank these.", schema: "{}" });
      check("a run needs a click token and returns answer, usage and tokens", ok.result[0].score === 70 && ok.tokens === 2011 && connects === 1, JSON.stringify(ok));
      check("the helper got the settings and the request, nothing else", last.sent.action === "ai_run" && last.sent.command === "claude" && last.sent.model === "claude-opus-5-5" && last.sent.prompt === "Rank these." && Object.keys(last.sent).sort().join() === "action,command,effort,model,path,prompt,schema,timeout", Object.keys(last.sent).join());
      check("the connection is closed after the answer", last.closed);
      check("one click, one run", (await attempt(t)).code === "noclick" && connects === 1);
      const log = await getAiUsage();
      check("every run is logged with its tokens", log.length === 1 && log[0].ok && log[0].tokens === 2011 && log[0].kind === "rank" && log[0].items === 3 && log[0].model === "claude-opus-5-5");
      await chrome.storage.local.set({ ai: { ...settingsNow, enabled: false } });
      t = asClick();
      check("switched off: no run", (await attempt(t)).code === "disabled" && connects === 1);
      await chrome.storage.local.set({ ai: { ...settingsNow, enabled: true, consent: null } });
      t = asClick();
      check("not agreed: no run", (await attempt(t)).code === "consent" && connects === 1);
      await chrome.storage.local.set({ ai: { ...settingsNow, enabled: true, consent: { version: AI_CONSENT_VERSION - 1, at: "x" } } });
      t = asClick();
      check("an agreement to an older notice does not count", (await attempt(t)).code === "consent" && connects === 1);
      await chrome.storage.local.set({ ai: settingsNow });
      t = asClick(); connectWith(port({ ok: false, code: "limit", error: "usage limit" }));
      const lim = await attempt(t);
      check("a used-up quota is explained and logged as failed", lim.code === "limit" && lim.message.includes(T("usage limit", "利用上限")) && (await getAiUsage()).slice(-1)[0].ok === false && (await getAiUsage()).slice(-1)[0].tokens === 0);
      t = asClick(); const hanging = port(null, { hang: true }); connectWith(hanging);
      const run1 = aiRun(t, { kind: "rank", items: 1, prompt: "slow" });
      await sleep(50);
      const second = await attempt(asClick());
      check("only one question at a time", second.code === "busy");
      run1.cancel();
      let cancelErr = null;
      try { await run1.promise; } catch (e) { cancelErr = e; }
      check("Cancel closes the connection and is logged as cancelled", cancelErr && cancelErr.code === "cancelled" && hanging.closed && (await getAiUsage()).slice(-1)[0].code === "cancelled");
      check("after a cancel a new run is possible", (await (async () => { connectWith(port(OKREPLY)); return attempt(asClick()); })()).tokens === 2011);

      // ---- the usage list
      await initAiSettings();
      check("the usage list shows the runs and the week's total", $("ai-usage").querySelectorAll("li").length === 4 && $("ai-usage").textContent.includes("4"), $("ai-usage").textContent);
      const clearBtn = $("ai-usage").querySelector("button.mini"), list = $("ai-usage").querySelector("ul");
      check("Clear this list sits above the list", !!(clearBtn.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING));
      click($("ai-usage").querySelector("button.mini")); await sleep(80);
      check("the list can be cleared", (await getAiUsage()).length === 0 && $("ai-usage").textContent.includes(T("not used your plan's quota yet", "まだプランの利用枠を使用していません")));
      check("estimates: a fixed cost plus the text (about 2.8 characters per token, measured)", estimateRun("x".repeat(280), 300).total === AI_FIXED_TOKENS + 100 + 300 && estimateTokens("あいう") === 3 && estimateRun("x".repeat(280), 0, "codex").total === AI_FIXED_TOKENS_BY_COMMAND.codex + 100);
    }
  } catch (e) {
    results.push("EXCEPTION " + e.stack);
  }
  document.getElementById("test-out").textContent = results.join("\n");
})();
