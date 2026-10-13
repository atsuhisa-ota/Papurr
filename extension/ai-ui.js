// Settings -> "AI-assisted ranking": the notice the user must agree to, the switch, the check of the claude command
// (with install / sign-in help), model and effort, the token-estimate switch and the log of what Papurr has used.
// Nothing here asks the AI anything (that is aiRun in ai.js); the check only asks the helper about the command and uses no quota.
const aiEl = (id) => document.getElementById(id);

function aiNode(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// One command with a Copy button.
function aiCommandRow(label, command) {
  const row = aiNode("div", "ai-cmd");
  row.append(aiNode("span", "muted", label + ": "), aiNode("code", "", command));
  const copy = aiNode("button", "mini", tr("ai.copy"));
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(command);
      copy.textContent = tr("ai.copied");
    } catch (e) {} // (the text can still be selected by hand)
  };
  row.append(" ", copy);
  return row;
}

function aiShowInstall(os, cmd) {
  const box = aiEl("ai-install");
  const info = AI_COMMANDS[cmd];
  box.textContent = "";
  box.append(aiNode("p", "", tr("ai.install.title", { cmd })));
  for (const [label, command] of info.install[os] || info.install.linux) box.append(aiCommandRow(label, command));
  const docs = aiNode("a", "", tr("ai.install.docs"));
  docs.href = info.docs;
  docs.target = "_blank";
  box.append(docs);
  if (os === "linux" && info.aptNote) box.append(aiNode("p", "muted", tr("ai.install.docs.linux")));
  box.append(aiNode("p", "muted", tr("ai.install.after")));
  box.hidden = false;
}

function aiShowLogin(cmd) {
  const box = aiEl("ai-install");
  box.textContent = "";
  box.append(aiNode("p", "", tr(AI_COMMANDS[cmd].loginKey)), aiCommandRow(tr("ai.login.title"), AI_COMMANDS[cmd].login || cmd));
  box.hidden = false;
}

// Model and effort: choices read from the command itself, or a free text box when it does not tell.
function aiChoice(label, key, values, placeholderKey, current, onChange) {
  const row = aiNode("div", "inline-row");
  row.append(aiNode("label", "", label));
  let control;
  if (values.length) {
    control = document.createElement("select");
    control.append(new Option(tr("ai.default"), ""));
    for (const [value, text] of values) control.append(new Option(text, value));
    if (current && !values.some(([v]) => v === current)) control.append(new Option(current, current)); // a saved value that is no longer offered
  } else {
    control = document.createElement("input");
    control.type = "text";
    control.placeholder = tr(placeholderKey);
  }
  control.value = current || "";
  control.addEventListener("change", () => onChange(control.value.trim()));
  row.append(control);
  return row;
}

function aiShowOptions(status, settings) {
  const box = aiEl("ai-options");
  box.textContent = "";
  const models = (status.models || []).map((m) => [m.id, m.name + (m.main ? "" : " (" + m.id + ")")]);
  const efforts = (status.efforts || []).map((e) => [e, e]);
  box.append(
    aiChoice(tr("ai.model"), "model", models, "ai.model.placeholder", settings.model, (v) => saveAiSettings({ model: v })),
    aiChoice(tr("ai.effort"), "effort", efforts, "ai.effort.placeholder", settings.effort, (v) => saveAiSettings({ effort: v })),
  );
  box.hidden = false;
}

// Describe a status answer of the helper (also used for the answer remembered from the last check).
function aiRenderStatus(status, settings, os) {
  const line = aiEl("ai-status");
  const cmd = aiCommandOf(settings);
  aiEl("ai-install").hidden = true;
  aiEl("ai-options").hidden = true;
  if (!status || status.command !== cmd) {
    line.textContent = tr("ai.status.unknown");
  } else if (!status.found) {
    line.textContent = tr("ai.status.missing", { cmd });
    aiShowInstall(os, cmd);
  } else if (!status.loggedIn) {
    line.textContent = tr("ai.status.notlogged", { cmd, version: status.version, path: status.path });
    aiShowLogin(cmd);
  } else if (!status.subscription) {
    line.textContent = tr("ai.status.notsub", { cmd, method: status.authMethod });
    aiShowLogin(cmd);
  } else {
    line.textContent = tr("ai.status.ready", { version: status.version, path: status.path, plan: AI_COMMANDS[cmd].plan });
    aiShowOptions(status, settings);
  }
}

async function aiRenderUsage() {
  const box = aiEl("ai-usage");
  box.textContent = "";
  const log = await getAiUsage();
  const title = aiNode("h4", "");
  title.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 13l4-4M12 5V3"/></svg>'; // (fixed markup: the icon)
  title.append(aiNode("span", "", tr("ai.usage.title")));
  box.append(title);
  if (!log.length) {
    box.append(aiNode("div", "status", tr("ai.usage.none")));
    return;
  }
  const week = summarizeAiUsage(log, Date.now() - 7 * 24 * 3600 * 1000);
  box.append(aiNode("div", "status", tr("ai.usage.week", { runs: week.runs, tokens: week.tokens.toLocaleString() })));
  const list = aiNode("ul", "status");
  for (const e of log.slice(-10).reverse()) {
    const result = e.ok ? tr("ai.usage.ok") : e.code === "cancelled" ? tr("ai.usage.cancelled") : tr("ai.usage.failed");
    const kind = AI_KIND_KEYS[e.kind] ? tr(AI_KIND_KEYS[e.kind]) : e.kind;
    list.append(aiNode("li", "", tr("ai.usage.row", { time: new Date(e.at).toLocaleString(dateLocale()), kind, items: e.items, tokens: (e.tokens || 0).toLocaleString(), result })));
  }
  const clear = aiNode("button", "mini", tr("ai.usage.clear"));
  clear.onclick = async () => {
    await clearAiUsage();
    await aiRenderUsage();
  };
  box.append(clear, list); // (the button above the list, so that it does not move when the list grows)
}

async function initAiSettings() {
  const os = await aiPlatform();
  if (os !== "mac" && os !== "linux") {
    aiEl("ai-platform").textContent = tr(os === "win" ? "ai.platform.unsupported" : "ai.platform.other"); // (only Windows users are told about Windows)
    aiEl("ai-platform").hidden = false;
    aiEl("ai-body").hidden = true;
    return;
  }
  let settings = await getAiSettings();
  const consent = aiEl("ai-consent"), enabled = aiEl("ai-enabled"), estimate = aiEl("ai-estimate");
  const commandSel = aiEl("ai-command"), pathEl = aiEl("ai-path");
  commandSel.replaceChildren(...Object.keys(AI_COMMANDS).map((c) => new Option(tr(AI_COMMAND_KEYS[c]), c)));
  commandSel.value = aiCommandOf(settings);
  // The language of the AI's texts (reasons, summaries): the interface language unless one is chosen here.
  const langSel = aiEl("ai-lang");
  langSel.replaceChildren(new Option(tr("ai.lang.auto", { lang: languageLabel(aiOutputLang(null)) }), ""), ...Object.keys(AI_OUTPUT_LANGUAGES).map((c) => new Option(languageLabel(c), c)));
  langSel.value = AI_OUTPUT_LANGUAGES[settings.outputLang] ? settings.outputLang : "";
  langSel.addEventListener("change", async () => {
    settings = await saveAiSettings({ outputLang: langSel.value });
  });
  // The technical level of summaries, and the user's own instructions for them (added to the fixed prompt, never replacing it).
  const levelSel = aiEl("ai-summary-level"), noteEl = aiEl("ai-summary-note");
  const levelKeys = { overview: "ai.summary.level.overview", standard: "ai.summary.level.standard", technical: "ai.summary.level.technical" };
  levelSel.replaceChildren(...Object.keys(SUMMARY_LEVELS).map((k) => new Option(tr(levelKeys[k]), k)));
  levelSel.value = SUMMARY_LEVELS[settings.summaryLevel] ? settings.summaryLevel : "standard";
  levelSel.addEventListener("change", async () => {
    settings = await saveAiSettings({ summaryLevel: levelSel.value });
  });
  noteEl.value = settings.summaryNote || "";
  noteEl.addEventListener("change", async () => {
    settings = await saveAiSettings({ summaryNote: cleanSummaryNote(noteEl.value) });
    noteEl.value = settings.summaryNote;
  });
  pathEl.value = settings.path || "";
  // Another command: its own models, efforts and status (nothing of the other one is kept).
  commandSel.addEventListener("change", async () => {
    settings = await saveAiSettings({ command: commandSel.value, path: "", model: "", effort: "", status: null });
    pathEl.value = "";
    aiRenderStatus(null, settings, os);
  });
  pathEl.addEventListener("change", async () => {
    settings = await saveAiSettings({ path: pathEl.value.trim(), status: null });
    aiRenderStatus(null, settings, os);
  });
  const sync = () => {
    consent.checked = aiConsentGiven(settings);
    enabled.disabled = !consent.checked;
    enabled.checked = consent.checked && settings.enabled;
    estimate.checked = settings.showEstimate;
    aiEl("ai-details").hidden = !enabled.checked; // not used: everything below the switch is folded away
    aiEl("ai-usage").hidden = !settings.showEstimate; // token counts not wanted: no usage list either
  };
  sync();
  consent.addEventListener("change", async () => {
    // Agreeing is what allows the switch; withdrawing it switches AI off again.
    settings = await saveAiSettings(consent.checked ? { consent: { version: AI_CONSENT_VERSION, at: new Date().toISOString() } } : { consent: null, enabled: false });
    sync();
  });
  enabled.addEventListener("change", async () => {
    settings = await saveAiSettings({ enabled: enabled.checked && aiConsentGiven(settings) });
    sync();
  });
  estimate.addEventListener("change", async () => {
    settings = await saveAiSettings({ showEstimate: estimate.checked });
    sync();
  });
  aiEl("ai-check").addEventListener("click", async () => {
    const line = aiEl("ai-status");
    line.textContent = tr("ai.checking");
    const busy = startBusy(tr("busy.working"));
    try {
      const status = await aiStatus(settings);
      settings = await saveAiSettings({ status: { ...status, command: aiCommandOf(settings), at: new Date().toISOString() } }); // remembered, so that opening Settings never starts the command
      aiRenderStatus(settings.status, settings, os); // (the saved one: it knows which command it is about)
    } catch (e) {
      line.textContent = e.message;
    } finally {
      endBusy(busy);
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.aiUsageLog) aiRenderUsage(); // a run has just been recorded (or the list cleared)
  });
  aiRenderStatus(settings.status, settings, os);
  if (!settings.status) aiEl("ai-status").textContent = "";
  await aiRenderUsage();
  await initProfileSettings();
}
