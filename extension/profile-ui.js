// Settings -> AI -> "My research": the INSPIRE author, what to read, and the buttons that create / update the profile.
//
// Two steps, so that nothing is spent by surprise:
//   1. "Create / Update profile" reads the author's papers from INSPIRE and shows how many papers and about how many
//      tokens the request will use. This step uses no quota.
//   2. "Use quota and run" (a second, separate click) is the only thing that calls aiRun().
// If there is nothing new to read (no new papers, no new reactions) step 2 does not even appear: nothing is sent.
const pEl = (id) => document.getElementById(id);
const PROFILE_MONTHS = [6, 12, 24, 36, 60];
const parseKeywords = (text) => [...new Set(String(text || "").split(/[\n,;、，]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 50);

function profNode(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

let profPending = null; // what step 1 prepared: { dir, author, settings, papers, rebuild, previous, reactions, prompt, estimate }
let profUnsaved = null; // an answer that arrived but could not be written to the folder (kept so that it can be saved again for free)
let profRunning = false;

function profSay(text) {
  pEl("prof-status").textContent = text;
}

function profFillForm(s) {
  pEl("prof-url").value = s.url;
  pEl("prof-months").value = String(s.months);
  pEl("prof-level").value = s.level;
  pEl("prof-level-rank").value = s.levelRank;
  pEl("prof-add").value = s.add.join("\n");
  pEl("prof-exclude").value = s.exclude.join("\n");
}

function profReadForm() {
  return {
    url: pEl("prof-url").value.trim(),
    months: Number(pEl("prof-months").value),
    level: pEl("prof-level").value,
    levelRank: pEl("prof-level-rank").value,
    add: parseKeywords(pEl("prof-add").value),
    exclude: parseKeywords(pEl("prof-exclude").value),
  };
}

async function profRenderStatus() {
  const view = pEl("prof-view");
  view.hidden = true;
  let profile = null;
  try {
    const dir = await loadDir();
    if (dir && (await dir.queryPermission({ mode: "readwrite" })) === "granted") profile = await readProfile(dir); // reading only
  } catch (e) {}
  pEl("prof-create").textContent = profile ? tr("prof.update") : tr("prof.create");
  pEl("prof-rebuild").hidden = !profile;
  if (!profile) return profSay(tr("prof.status.none"));
  profSay(tr("prof.status", { name: profile.authorName, n: profile.covered.length, date: profile.coveredUntil, time: new Date(profile.updatedAt).toLocaleString(dateLocale()) }));
  pEl("prof-summary").textContent = profile.summary + "\n\n" + profile.keywords.join(", ");
  view.hidden = false;
}

// Step 1 (no quota): read INSPIRE, decide what has to be read, show the estimate and the second button.
async function profPrepare(rebuild) {
  if (profRunning) return;
  pEl("prof-confirm").hidden = true;
  profPending = null;
  const settings = await saveProfileSettings(profReadForm());
  const id = parseInspireAuthorId(settings.url);
  if (!id) return profSay(tr("prof.author.bad"));
  const ai = await getAiSettings();
  if (!ai.enabled) return profSay(new AiError("disabled").message);
  if (!aiConsentGiven(ai)) return profSay(new AiError("consent").message);
  const dir = await loadDir();
  if (!dir) return profSay(tr("prof.nofolder"));
  if ((await dir.requestPermission({ mode: "readwrite" })) !== "granted") return profSay(tr("err.noaccess"));
  const busy = startBusy(tr("busy.fetching"));
  try {
    profSay(tr("busy.fetching"));
    const author = { id, name: (await fetchInspireAuthor(id)).name };
    const previous = await readProfile(dir, { merge: true });
    if (previous && previous.inspireId !== id) { // a profile of somebody else: start again
      rebuild = true;
      profSay(tr("prof.changed.author"));
    }
    const papers = await fetchInspirePapers(id, settings.months);
    const toRead = papersToRead(papers, previous, rebuild);
    const reactions = rebuild ? [] : pendingReactions(previous).map((r) => ({ ...r, title: (previous.feedback[r.id] || {}).t || "" }));
    if (!toRead.length && !reactions.length) {
      return profSay(previous && !rebuild ? tr("prof.uptodate") : tr("prof.nopapers", { n: settings.months }));
    }
    const prompt = buildProfilePrompt({ author, papers: toRead, level: settings.level, add: settings.add, exclude: settings.exclude, previous: rebuild ? null : previous, reactions });
    const estimate = estimateRun(prompt, PROFILE_OUTPUT_TOKENS, aiCommandOf(ai));
    profPending = { dir, author, settings, papers: toRead, rebuild, previous, reactions, prompt, estimate };
    pEl("prof-confirm-text").textContent = ai.showEstimate ? tr("prof.confirm", { n: toRead.length, tokens: estimate.total.toLocaleString() }) : tr("prof.confirm.plain");
    pEl("prof-confirm").hidden = false;
    if (pEl("prof-status").textContent === tr("busy.fetching")) profSay(""); // (keep a message such as "the author changed")
  } catch (e) {
    profSay(e.message);
  } finally {
    endBusy(busy);
  }
}

// Save the answer into the folder (computed from the stored profile, so that a change made by another computer is not lost).
async function profSave(p, answer, usage) {
  const saved = await updateProfile(p.dir, (current) => profileAfterAnswer({
    previous: current, rebuild: p.rebuild || !current, author: p.author,
    settings: { months: p.settings.months, level: p.settings.level, add: p.settings.add, exclude: p.settings.exclude },
    papers: p.papers, answer, reactions: p.reactions, model: usage.model,
  }));
  profUnsaved = null;
  pEl("prof-savebtn").hidden = true;
  profSay(tr("prof.saved", { n: p.papers.length, tokens: usage.tokens.toLocaleString() }));
  await profRenderStatus();
  return saved;
}

// Step 2: the only place that spends quota. It needs this very click.
async function profRun(event) {
  if (!profPending || profRunning) return;
  const p = profPending;
  profRunning = true;
  pEl("prof-confirm").hidden = true;
  const job = aiRun(aiClick(event), { kind: "profile", items: p.papers.length, prompt: p.prompt, schema: PROFILE_ANSWER_SCHEMA, timeout: 240 });
  const cancel = profNode("button", "mini", tr("common.cancel"));
  cancel.onclick = () => job.cancel();
  pEl("prof-status").textContent = tr("prof.working") + " ";
  pEl("prof-status").append(cancel);
  const busy = startBusy(tr("prof.working"));
  try {
    const reply = await job.promise;
    const answer = parseProfileAnswer(reply.result);
    if (!answer) return profSay(tr("prof.err.answer"));
    const usage = { tokens: reply.tokens, model: reply.models[0] || "" };
    try {
      await profSave(p, answer, usage);
    } catch (e) {
      profUnsaved = { p, answer, usage };
      pEl("prof-savebtn").hidden = false;
      profSay(tr("prof.err.save", { msg: e.message }));
    }
    profPending = null;
  } catch (e) {
    profSay(e.message);
  } finally {
    endBusy(busy);
    profRunning = false;
  }
}

async function initProfileSettings() {
  profFillForm(await getProfileSettings());
  pEl("prof-months").replaceChildren(...PROFILE_MONTHS.map((n) => new Option(tr("prof.months.n", { n }), String(n))));
  pEl("prof-months").value = String((await getProfileSettings()).months);
  for (const id of ["prof-level", "prof-level-rank"]) pEl(id).replaceChildren(new Option(tr("prof.level.title"), "title"), new Option(tr("prof.level.abstract"), "abstract"));
  profFillForm(await getProfileSettings());
  for (const id of ["prof-url", "prof-months", "prof-level", "prof-level-rank", "prof-add", "prof-exclude"]) pEl(id).addEventListener("change", () => saveProfileSettings(profReadForm()));
  pEl("prof-lookup").addEventListener("click", async () => {
    const id = parseInspireAuthorId(pEl("prof-url").value);
    const out = pEl("prof-author");
    if (!id) return (out.textContent = tr("prof.author.bad"));
    await saveProfileSettings(profReadForm());
    try {
      out.textContent = tr("prof.author.found", { name: (await fetchInspireAuthor(id)).name });
    } catch (e) {
      out.textContent = e.message;
    }
  });
  pEl("prof-create").addEventListener("click", () => profPrepare(false));
  pEl("prof-rebuild").addEventListener("click", () => profPrepare(true));
  pEl("prof-run").addEventListener("click", profRun);
  pEl("prof-cancel").addEventListener("click", () => {
    profPending = null;
    pEl("prof-confirm").hidden = true;
  });
  pEl("prof-savebtn").addEventListener("click", async () => {
    if (!profUnsaved) return;
    try {
      if ((await profUnsaved.p.dir.requestPermission({ mode: "readwrite" })) !== "granted") return profSay(tr("err.noaccess"));
      await profSave(profUnsaved.p, profUnsaved.answer, profUnsaved.usage);
    } catch (e) {
      profSay(tr("prof.err.save", { msg: e.message }));
    }
  });
  await profRenderStatus();
}
