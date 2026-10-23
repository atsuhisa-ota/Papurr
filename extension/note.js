// The note of one paper (note.html?id=<key>): a Markdown file in the papers folder (see "Notes" in common.js).
// Opening the page creates the note if there is none. Only the user's own section is edited here, and only saved on
// request (button or Ctrl/Cmd+S; no autosave, so half-written text never reaches other computers). Papurr's sections
// (summary, why recommended) are shown read-only and can be deleted; the reason can be redone with the current model
// (redoReason). A full-text summary takes two steps: first the LaTeX source is fetched and the estimate shown (no quota),
// then the "Summarize" button sends it (runSummary). redoReason and runSummary are the only places here that ask the AI.
// note.html?id=<id>&summarize=1 starts the first step at once; for a paper that is not in the library yet, the paper
// (note-only) and its note are created only when the summary has been made.
const msgEl = document.getElementById("msg");
const grantBtn = document.getElementById("grant");
const grantHint = document.getElementById("grant-hint");
const paperEl = document.getElementById("paper");
const blocksEl = document.getElementById("blocks");
const mineEl = document.getElementById("mine");
const viewEl = document.getElementById("mine-view");
const editEl = document.getElementById("mine-edit");
const editBtn = document.getElementById("edit");
const saveBtn = document.getElementById("save");
const cancelBtn = document.getElementById("cancel");
const saveHint = document.getElementById("save-hint");
const conflictEl = document.getElementById("conflict");
const fileRow = document.getElementById("file-row");
const pageParams = new URLSearchParams(location.search);
const paperId = pageParams.get("id");
const summaryPanel = document.getElementById("summary-panel");

let dir = null;
let paperEntry = null; // the paper's index entry
let fileName = "";
let loaded = null; // { lastModified, note, body }: the file as last read
let editing = false;
let editBase = ""; // the user's section when editing started (to notice changes made elsewhere meanwhile)
let aiState = null; // when the AI can be used here: { settings, profile (or null), arxiv (the paper from arXiv: abstract, latest version), error }
let sumState = null; // the summary steps: { phase: "preparing" | "ready" | "running" | "error", ... }
let pendingPaper = false; // the paper is not in the library yet (opened to summarize it)
let redoing = null; // the running request for a section: { job, since, name: "reason" | "summary", label } (a redone reason, a translated summary)
let outLang = "en"; // the language the AI writes in (Settings, else the interface language)
const viewLang = {}; // block name -> the language version shown ("" = an earlier version without a language)

const dirty = () => editing && editEl.value !== editBase;
const say = (text) => (msgEl.textContent = text);
// Tell open library tabs that a note changed (they read their list again).
const announce = () => chrome.storage.local.set({ notesChanged: Date.now() }).catch(() => {});

async function readFromDisk() {
  const file = await (await dir.getFileHandle(fileName)).getFile();
  const note = parseNote(await file.text());
  loaded = { lastModified: file.lastModified, note, body: noteUserBody(note.user) };
}

// ---- A small Markdown renderer: builds elements (never HTML from the file), so a note can never run code ----
const BLOCK_START = /^(\s*(`{3,}|~{3,})|\s*\$\$|#{1,6}\s|\s*>|\s*([-*+]|\d+[.)])\s+| {0,3}([-*_])( *\4){2,} *$)/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/; // |---|:-:|--:|
const indentOf = (line) => line.replace(/\t/g, "    ").match(/^ */)[0].length;
// The cells of a table row: "| a | b |" -> ["a", "b"] ("\|" is a | inside a cell).
const tableCells = (line) => line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
const isTableStart = (lines, i) => lines[i].includes("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes("-");

function renderMarkdown(text, into) {
  into.textContent = "";
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) {
      i++;
    } else if ((m = /^\s*(`{3,}|~{3,})/.exec(line))) { // fenced code
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(m[1]); i++) body.push(lines[i]);
      i++;
      const pre = document.createElement("pre");
      pre.append(el("code", body.join("\n")));
      into.append(pre);
    } else if (/^\s*\$\$/.test(line)) { // displayed formula: kept as LaTeX text
      const body = [line];
      let closed = /\$\$\s*$/.test(line.trim().slice(2));
      for (i++; !closed && i < lines.length; i++) {
        body.push(lines[i]);
        closed = /\$\$\s*$/.test(lines[i]);
      }
      into.append(mathElement(body.join("\n").trim().replace(/^\$\$/, "").replace(/\$\$$/, "").trim(), true));
    } else if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      const h = document.createElement("h" + Math.min(6, m[1].length + 2));
      inline(m[2], h);
      into.append(h);
      i++;
    } else if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) {
      into.append(document.createElement("hr"));
      i++;
    } else if (/^\s*>/.test(line)) {
      const body = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*> ?/, ""));
      const quote = document.createElement("blockquote");
      renderMarkdown(body.join("\n"), quote);
      into.append(quote);
    } else if (LIST_ITEM.test(line)) {
      i = renderList(lines, i, into);
    } else if (isTableStart(lines, i)) {
      const head = tableCells(line);
      const align = tableCells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : /^:-/.test(c) ? "left" : ""));
      const table = document.createElement("table");
      const row = (cells, tag) => {
        const tr = document.createElement("tr");
        head.forEach((_, k) => {
          const cell = tr.appendChild(document.createElement(tag));
          if (align[k]) cell.style.textAlign = align[k];
          inline(cells[k] || "", cell);
        });
        return tr;
      };
      table.appendChild(document.createElement("thead")).append(row(head, "th"));
      const tbody = table.appendChild(document.createElement("tbody"));
      for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes("|"); i++) tbody.append(row(tableCells(lines[i]), "td"));
      const wrap = document.createElement("div");
      wrap.className = "table-wrap"; // (a wide table scrolls by itself, the page does not)
      wrap.append(table);
      into.append(wrap);
    } else {
      const body = [];
      for (; i < lines.length && lines[i].trim() && !(body.length && (BLOCK_START.test(lines[i]) || isTableStart(lines, i))); i++) body.push(lines[i]);
      const p = document.createElement("p");
      inline(body.join("\n"), p);
      into.append(p);
    }
  }
}

// A list starting at lines[i] (items may hold indented continuation lines and nested lists; "[ ]" / "[x]" at the
// start of an item is a checkbox, shown read-only). Returns the index of the first line after the list.
function renderList(lines, i, into) {
  const first = LIST_ITEM.exec(lines[i]);
  const base = indentOf(lines[i]);
  const ordered = /\d/.test(first[2]);
  const list = document.createElement(ordered ? "ol" : "ul");
  if (ordered && parseInt(first[2], 10) !== 1) list.start = parseInt(first[2], 10);
  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i]);
    if (!m || indentOf(lines[i]) !== base || /\d/.test(m[2]) !== ordered) break;
    const li = list.appendChild(document.createElement("li"));
    let text = m[3];
    const task = /^\[([ xX])\]\s+/.exec(text);
    if (task) {
      const box = li.appendChild(document.createElement("input"));
      box.type = "checkbox";
      box.checked = task[1] !== " ";
      box.disabled = true; // (the note is changed only by editing it)
      li.className = "task";
      text = text.slice(task[0].length);
    }
    const rest = []; // the item's following lines: continuation text, then perhaps a nested list or other blocks
    for (i++; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) {
        if (i + 1 < lines.length && indentOf(lines[i + 1]) > base && lines[i + 1].trim()) { rest.push(""); continue; }
        break;
      }
      if (indentOf(line) > base) rest.push(line);
      else if (!rest.length && !BLOCK_START.test(line) && !isTableStart(lines, i)) rest.push(line); // a lazy continuation line
      else break;
    }
    const nested = rest.findIndex((l) => LIST_ITEM.test(l) || BLOCK_START.test(l.trim()));
    const own = (nested < 0 ? rest : rest.slice(0, nested)).map((l) => l.trim()).filter(Boolean);
    inline([text, ...own].join("\n"), li);
    if (nested >= 0) {
      const inner = rest.slice(nested);
      const cut = Math.min(...inner.filter((l) => l.trim()).map(indentOf));
      const box = document.createElement("div"); // (renderMarkdown empties its target: render apart, then move in)
      renderMarkdown(inner.map((l) => l.replace(/\t/g, "    ").slice(cut)).join("\n"), box);
      li.append(...box.childNodes);
    }
    while (i < lines.length && !lines[i].trim() && i + 1 < lines.length && LIST_ITEM.test(lines[i + 1]) && indentOf(lines[i + 1]) === base) i++; // (a blank line between items)
  }
  into.append(list);
  return i;
}

// Inline marks: `code`, $formula$ (typeset), [text](https://...), **bold**, *italic*, ~~struck~~, bare https:// links.
const INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\s](?:[^*]*?[^*\s])?)\*|(?<!\w)_([^_\s](?:[^_]*?[^_\s])?)_(?!\w)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|~~([^~\n](?:[^~]*?[^~\n])?)~~/g;

function inline(text, into) {
  let last = 0;
  const plain = (s) => s.split("\n").forEach((part, k) => (k && into.append(document.createElement("br")), part && into.append(part)));
  for (const m of text.matchAll(INLINE)) {
    plain(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) into.append(el("code", m[2]));
    else if (m[3] !== undefined) into.append(mathElement(m[3], true, "span"));
    else if (m[4] !== undefined) into.append(mathElement(m[4], false));
    else if (m[5] !== undefined) into.append(/^(https?:|mailto:)/i.test(m[6]) ? link(m[6], m[5]) : m[0]);
    else if (m[7] !== undefined || m[8] !== undefined) inline(m[7] !== undefined ? m[7] : m[8], into.appendChild(document.createElement("strong")));
    else if (m[9] !== undefined || m[10] !== undefined) inline(m[9] !== undefined ? m[9] : m[10], into.appendChild(document.createElement("em")));
    else if (m[11]) into.append(link(m[11], m[11]));
    else if (m[12] !== undefined) inline(m[12], into.appendChild(document.createElement("del")));
  }
  plain(text.slice(last));
}

function el(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

function link(href, text) {
  const a = el("a", text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

// ---- The page ----
function showPaper() {
  paperEl.hidden = false;
  document.getElementById("paper-title").textContent = paperEntry.title || paperId;
  document.title = (paperEntry.title || paperId) + " — " + tr("note.title");
  const names = (paperEntry.authors || []).join(", ") + (paperEntry.authorCount > (paperEntry.authors || []).length ? ", et al." : "");
  const idLabel = paperLabel(paperId, paperEntry);
  const journal = paperEntry.journal ? [paperEntry.journal.name, paperEntry.journal.year].filter(Boolean).join(" ") : "";
  document.getElementById("paper-meta").textContent = [names, idLabel, journal].filter(Boolean).join(" — ");
  const links = document.getElementById("paper-links");
  links.textContent = "";
  const chip = (text, href, title) => {
    const a = link(href, text);
    a.className = "chip solo";
    if (title) a.title = title;
    return a;
  };
  if (hasPdf(paperEntry)) links.append(chip(tr("note.pdf.open"), "open.html?id=" + encodeURIComponent(paperId) + "&local=1"));
  else {
    links.append(el("span", tr("paper.nopdf"), "nopdf"));
    const kind = paperKind(paperId);
    links.append(kind === "doi"
      ? chip(tr("paper.getpdf"), "https://doi.org/" + paperEntry.doi, tr("paper.getpdf.doi.tip"))
      : kind === "ads"
        ? chip(tr("paper.getpdf"), adsAbstractUrl(paperId.slice(4)), tr("paper.getpdf.ads.tip"))
        : chip(tr("paper.getpdf"), "open.html?id=" + encodeURIComponent(paperId), tr("paper.getpdf.tip")));
  }
}

const BLOCK_TITLES = { abstract: "note.block.abstract", reason: "note.block.reason", summary: "note.block.summary" };

// Papurr's sections, read-only, each with its own Delete button.
function renderBlocks() {
  if (mineEl.parentNode === blocksEl) blocksEl.after(mineEl); // (the user's section is placed again below)
  blocksEl.textContent = "";
  if (!loaded) return;
  const blocks = loaded.note.blocks;
  const byName = {};
  for (const key of Object.keys(blocks)) (byName[noteBlockName(key)] = byName[noteBlockName(key)] || []).push(key);
  // The sections in the order chosen with the up / down buttons (kept in the note itself; see noteOrder in common.js).
  const order = noteOrder(loaded.note);
  for (const [index, name] of order.entries()) {
    if (name === "notes") {
      blocksEl.append(mineEl);
      document.getElementById("mine-move").replaceChildren(...moveButtons(order, index));
      continue;
    }
    // One section per kind; with several languages kept, chips switch between them (no quota).
    const langs = byName[name].map(noteBlockLang).sort();
    const newest = byName[name].slice().sort((x, y) => (blocks[y].attrs.date || "").localeCompare(blocks[x].attrs.date || ""))[0];
    const lang = langs.includes(viewLang[name]) ? viewLang[name] : langs.includes(outLang) ? outLang : noteBlockLang(newest);
    const key = noteBlockKey(name, lang);
    const block = blocks[key];
    const title = BLOCK_TITLES[name] ? tr(BLOCK_TITLES[name]) : tr("note.block.other", { name });
    const section = el("section");
    section.className = "note-ai";
    const head = el("div", undefined, "section-head");
    const h = el("h3", title);
    h.title = tr("note.block.readonly");
    const del = el("button", tr("note.block.delete"));
    del.onclick = () => deleteBlock(key, langs.length > 1 ? title + " (" + languageLabel(lang) + ")" : title);
    del.disabled = !!redoing;
    const actions = el("div", undefined, "actions");
    actions.append(...moveButtons(order, index));
    if (name === "reason" && aiState && aiState.profile && !redoing) {
      actions.append(reasonButton(lang || outLang, key, "note.block.redo.plain", "note.block.redo")); // (an earlier version without a language is redone in the output language)
      if (lang !== outLang && !langs.includes(outLang)) actions.append(reasonButton(outLang, "", "today.reason.make", "today.reason.make.est"));
    }
    if (name === "summary" && aiState && !sumState) { // (these only fetch the source and show the estimate: no quota yet)
      const redo = el("button", tr("summary.redo"));
      redo.title = tr("summary.redo.tip");
      redo.onclick = () => prepareSummary(lang || outLang, key);
      actions.append(redo);
      if (lang !== outLang && !langs.includes(outLang) && !redoing) {
        actions.append(translateSummaryButton(block, lang)); // (cheaper than summarizing again)
        const make = el("button", tr("summary.make", { lang: languageLabel(outLang) }));
        make.onclick = () => prepareSummary(outLang, "");
        actions.append(make);
      }
    }
    actions.append(del);
    head.append(h, actions);
    section.append(head);
    if (langs.length > 1) {
      const chips = el("div", undefined, "reason-langs");
      for (const l of langs) {
        const chip = el("span", languageLabel(l), "tag" + (l === lang ? " selected" : ""));
        chip.onclick = () => {
          viewLang[name] = l;
          renderBlocks();
        };
        chips.append(chip);
      }
      section.append(chips);
    }
    const a = block.attrs || {};
    const saved = paperEntry && sortedVersions(paperEntry).filter((v) => v !== UNVERSIONED).pop();
    const made = [a.model && a.date ? tr("note.block.made", { model: a.model, date: a.date.slice(0, 10) }) : "", a.version ? tr("note.block.version", { version: a.version }) : "",
      a.version && saved && saved !== a.version ? tr("summary.otherversion", { version: saved }) : "", a.from ? tr("note.block.from", { lang: languageLabel(a.from) }) : ""].filter(Boolean).join(" \u00b7 ");
    if (made) section.append(el("p", made, "muted"));
    const body = el("div", undefined, "md");
    if (redoing && redoing.name === name) {
      const cancel = el("button", tr("common.cancel"), "mini");
      cancel.onclick = () => redoing && redoing.job.cancel();
      body.append(cancel); // (what is running is said in the status line under the header)
    } else renderMarkdown(block.body, body);
    section.append(body);
    blocksEl.append(section);
  }
}

// "Move up" / "Move down" for a section (none when the note has only one section).
function moveButtons(order, index) {
  if (order.length < 2) return [];
  const button = (text, tip, delta) => {
    const b = el("button", text, "mini move-btn");
    b.title = tr(tip);
    b.disabled = index + delta < 0 || index + delta >= order.length;
    b.onclick = () => moveSection(order, index, delta);
    return b;
  };
  return [button("\u2191", "note.move.up", -1), button("\u2193", "note.move.down", 1)];
}

// The new order is written into the note (the head block's `order`), from the file as it is now.
async function moveSection(order, index, delta) {
  const next = order.slice();
  [next[index], next[index + delta]] = [next[index + delta], next[index]];
  try {
    if ((await dir.requestPermission({ mode: "readwrite" })) !== "granted") return say(tr("err.noaccess"));
    await editNote(dir, fileName, (note) => {
      const head = note.blocks.head || { attrs: {}, body: noteHead(paperId, paperEntry) };
      note.blocks.head = { ...head, attrs: { ...head.attrs, order: next.join("+") } };
    });
    await readFromDisk();
    renderBlocks();
    if (!editing) renderMine();
    announce();
  } catch (e) {
    say(tr("err.generic", { msg: e.message }));
  }
}

// ---- Redo the reason with the current model (AI) ----
// Only with AI on and agreed to, on Mac/Linux, for an arXiv paper, with a research profile. Reading these uses no quota.
async function loadAiState() {
  const known = aiState && aiState.arxiv; // (what arXiv said is kept when only the settings changed: no second request)
  aiState = null;
  try {
    const settings = await getAiSettings();
    const os = await aiPlatform();
    if (!settings.enabled || !aiConsentGiven(settings) || (os !== "mac" && os !== "linux") || !isArxivKey(paperId)) return;
    aiState = { settings, profile: await readProfile(dir), arxiv: known || null, error: "" }; // (the profile is needed for reasons, optional for summaries)
  } catch (e) {} // not essential
}

// The paper as arXiv lists it (abstract, latest version; no quota). Asked only when it is needed (arXiv limits how often
// its API may be asked): a reason that can be redone, a paper not in the library, or a summary of a paper without a saved
// version (`force`).
async function loadArxivData(force) {
  if (!aiState || aiState.arxiv) return;
  const needed = force || (aiState.profile && loaded && Object.keys(loaded.note.blocks).some((k) => noteBlockName(k) === "reason"));
  if (!needed) return;
  try {
    aiState.arxiv = await fetchArxivPaper(paperId);
    aiState.error = "";
  } catch (e) {
    aiState.error = e.message;
  }
}

function modelAndEffort() {
  const s = aiState.settings;
  const known = ((s.status && s.status.models) || []).find((m) => m.id === s.model);
  return { model: s.model ? (known && known.name) || s.model : tr("today.rank.default.model"), effort: s.effort || tr("today.rank.default.effort") };
}

// A button that asks the AI for the reason in `lang` (replacing the block `replaceKey`, if given). Its label shows the
// estimate when estimates are on; pressing it is the consent.
function reasonButton(lang, replaceKey, key, keyEst) {
  const vars = { lang: languageLabel(lang) };
  if (!aiState.arxiv) {
    const b = el("button", tr(key, vars));
    b.disabled = true;
    b.title = tr("note.block.redo.noabstract", { msg: aiState.error || tr("loading") });
    return b;
  }
  const prompt = buildReasonPrompt({ profile: aiState.profile, paper: aiState.arxiv, lang });
  const tokens = estimateRun(prompt, REASON_OUTPUT_TOKENS, aiCommandOf(aiState.settings)).total;
  const b = el("button", tr(aiState.settings.showEstimate ? keyEst : key, { ...vars, tokens: shortTokens(tokens) }));
  b.title = tr("note.block.redo.tip");
  b.addEventListener("click", (event) => redoReason(event, lang, replaceKey, prompt));
  return b;
}

async function redoReason(event, lang, replaceKey, prompt) {
  if (redoing) return;
  const job = aiRun(aiClick(event), { kind: "reason", items: 1, prompt, schema: REASON_ANSWER_SCHEMA, timeout: 120 });
  redoing = { job, since: Date.now(), name: "reason", label: "reason.working" };
  renderBlocks();
  const busy = startBusy(tr("reason.working", modelAndEffort()));
  try {
    const reply = await job.promise;
    const text = parseReasonAnswer(reply.result);
    if (!text) say(tr("reason.empty"));
    else {
      const reason = { text, at: new Date().toISOString(), model: (reply.models || [])[0] || aiState.settings.model || aiCommandOf(aiState.settings) };
      await saveReason(paperId, lang, reason);
      await editNote(dir, fileName, (note) => {
        if (replaceKey) delete note.blocks[replaceKey]; // (the version being redone; other languages stay)
        note.blocks[noteBlockKey("reason", lang)] = reasonBlock(lang, reason);
      });
      viewLang.reason = lang;
      await readFromDisk();
      say(tr("reason.done", { tokens: reply.tokens.toLocaleString() }));
      announce();
    }
  } catch (e) {
    say(e.message);
  } finally {
    endBusy(busy);
    redoing = null;
    renderBlocks();
  }
}

// ---- Full-text summary (two steps) ----
// The version summarized: the newest saved arXiv version, else the latest one on arXiv.
function summaryVersion() {
  const saved = paperEntry && sortedVersions(paperEntry).filter((v) => v !== UNVERSIONED).pop();
  return saved || (aiState && aiState.arxiv && aiState.arxiv.version) || "";
}

// Step 1 (no quota): get the source (or the text kept from an earlier try), assemble it and show the estimate.
async function prepareSummary(lang, replaceKey) {
  if (!aiState || sumState) return;
  sumState = { phase: "preparing" };
  renderSummaryPanel();
  renderBlocks();
  try {
    if (!summaryVersion()) await loadArxivData(true); // (no saved version: ask arXiv which one is the latest)
    const version = summaryVersion();
    const keepKey = paperId + version;
    let text = await getKeptSource(keepKey);
    if (!text) {
      text = await withBusy(tr("summary.fetching"), () => fetchFullText(paperId, version));
      await keepSource(keepKey, text);
    }
    const textTokens = estimateTokens(text);
    if (textTokens > SUMMARY_MAX_TOKENS) throw new SourceError("toolong", textTokens.toLocaleString());
    const prompt = buildSummaryPrompt({ profile: aiState.profile, paper: { id: paperId, version }, text, lang, level: aiState.settings.summaryLevel, note: aiState.settings.summaryNote });
    const estimate = estimateRun(prompt, SUMMARY_OUTPUT_TOKENS, aiCommandOf(aiState.settings));
    sumState = { phase: "ready", prompt, estimate, textTokens, long: textTokens > SUMMARY_LONG_TOKENS, lang, replaceKey, version };
  } catch (e) {
    sumState = { phase: "error", message: e.message };
  }
  renderSummaryPanel();
  renderBlocks();
}

function renderSummaryPanel() {
  summaryPanel.textContent = "";
  const offer = !sumState && aiState && isArxivKey(paperId) && loaded && !Object.keys(loaded.note.blocks).some((k) => noteBlockName(k) === "summary");
  summaryPanel.hidden = !sumState && !offer;
  if (summaryPanel.hidden) return;
  const head = el("div", undefined, "section-head");
  head.append(el("h3", tr("note.block.summary")));
  summaryPanel.append(head);
  const actions = el("div", undefined, "actions");
  if (!sumState) { // no summary yet: offer one (the first step uses no quota)
    summaryPanel.append(el("p", tr("summary.offer"), "muted"));
    const start = el("button", tr("summary.start"));
    start.onclick = () => prepareSummary(outLang, "");
    actions.append(start);
  } else if (sumState.phase === "preparing") {
    summaryPanel.append(el("p", tr("summary.fetching"), "status"));
  } else if (sumState.phase === "ready") {
    const s = sumState;
    const vars = { id: paperId + s.version, lang: languageLabel(s.lang), text: s.textTokens.toLocaleString(), tokens: s.estimate.total.toLocaleString() };
    summaryPanel.append(el("p", tr(aiState.settings.showEstimate ? "summary.ready" : "summary.ready.plain", vars)));
    if (s.long) summaryPanel.append(el("p", tr("summary.long"), "warning"));
    const run = el("button", tr(aiState.settings.showEstimate ? "summary.run" : "summary.run.plain", { tokens: shortTokens(s.estimate.total) }), "rank-btn");
    run.title = tr(aiState.settings.showEstimate ? "summary.run.tip" : "summary.run.tip.plain", { tokens: s.estimate.total.toLocaleString() });
    run.addEventListener("click", (event) => runSummary(event));
    const cancel = el("button", tr("common.cancel"));
    cancel.onclick = () => {
      sumState = null;
      renderSummaryPanel();
      renderBlocks();
    };
    actions.append(run, cancel);
  } else if (sumState.phase === "running") {
    const cancel = el("button", tr("common.cancel"));
    cancel.onclick = () => sumState.job.cancel();
    actions.append(cancel);
  } else {
    summaryPanel.append(el("p", sumState.message, "warning"));
    const again = el("button", sumState.ready ? tr("summary.again") : tr("summary.close"));
    again.onclick = () => {
      sumState = sumState.ready || null; // (try again: the estimate is shown again and needs another click)
      renderSummaryPanel();
      renderBlocks();
    };
    actions.append(again);
  }
  summaryPanel.append(actions);
}

// Step 2: the only place that sends the full text, from the click on the button that shows the estimate.
async function runSummary(event) {
  if (!sumState || sumState.phase !== "ready" || redoing) return;
  const ready = sumState;
  const job = aiRun(aiClick(event), { kind: "summary", items: 1, prompt: ready.prompt, schema: SUMMARY_ANSWER_SCHEMA, timeout: 600 });
  sumState = { phase: "running", job, since: Date.now() };
  renderSummaryPanel();
  const busy = startBusy(tr("summary.working", modelAndEffort()));
  try {
    const reply = await job.promise;
    const text = parseSummaryAnswer(reply.result);
    if (!text) {
      sumState = { phase: "error", message: tr("reason.empty"), ready };
      return;
    }
    const summary = { text, at: new Date().toISOString(), model: (reply.models || [])[0] || aiState.settings.model || aiCommandOf(aiState.settings), version: ready.version };
    if (pendingPaper) await addPendingPaper(); // (only now: the summary makes the paper and its note)
    await editNote(dir, fileName, (note) => {
      if (ready.replaceKey) delete note.blocks[ready.replaceKey]; // (the version being redone; other languages stay)
      note.blocks[noteBlockKey("summary", ready.lang)] = summaryBlock(ready.lang, summary);
    });
    viewLang.summary = ready.lang;
    await readFromDisk();
    sumState = null;
    say(tr("summary.done", { tokens: reply.tokens.toLocaleString() }));
    announce();
  } catch (e) {
    sumState = { phase: "error", message: e.message, ready };
  } finally {
    endBusy(busy);
    renderSummaryPanel();
    renderBlocks();
    if (loaded && !editing) renderMine();
  }
}

// A paper that is not in the library: add it (no PDF, only the note) and create its note.
async function addPendingPaper() {
  const p = aiState.arxiv || {};
  await updateIndex(dir, (papers) => {
    if (papers[paperId]) return;
    const now = new Date().toISOString();
    papers[paperId] = { title: p.title || "", authors: (p.authors || []).slice(0, MAX_AUTHORS), authorCount: p.authorCount || 0, added: now, modified: now, versions: {} };
  });
  fileName = await ensureNote(dir, paperId);
  paperEntry = (await readIndex(dir))[paperId];
  const kept = (await getReasons())[paperId];
  if (kept) await writeReasonsToNote(dir, paperId, kept);
  const translated = (await getTranslations())[paperId];
  if (translated) await writeTranslationsToNote(dir, paperId, translated);
  pendingPaper = false;
  showPaper();
  fileRow.hidden = false;
  document.getElementById("file-name").textContent = tr("note.file", { name: fileName });
}

// ---- Translating a summary into the output language (cheaper than summarizing again) ----
function translateSummaryButton(block, fromLang) {
  const prompt = buildTranslatePrompt({ text: block.body, lang: outLang });
  const tokens = estimateRun(prompt, translateOutputTokens(block.body), aiCommandOf(aiState.settings)).total;
  const vars = { lang: languageLabel(outLang), tokens: shortTokens(tokens) };
  const b = el("button", tr(aiState.settings.showEstimate ? "summary.translate" : "summary.translate.plain", vars));
  b.title = tr("summary.translate.tip");
  b.addEventListener("click", (event) => translateSummary(event, prompt, fromLang, block.attrs.version || ""));
  return b;
}

async function translateSummary(event, prompt, fromLang, version) {
  if (redoing || sumState) return;
  const lang = outLang;
  const job = aiRun(aiClick(event), { kind: "translation", items: 1, prompt, schema: TRANSLATE_ANSWER_SCHEMA, timeout: 300 });
  redoing = { job, since: Date.now(), name: "summary", label: "translate.working" };
  renderBlocks();
  const busy = startBusy(tr("translate.working", modelAndEffort()));
  try {
    const reply = await job.promise;
    const text = parseTranslateAnswer(reply.result);
    if (!text) say(tr("reason.empty"));
    else {
      const model = (reply.models || [])[0] || aiState.settings.model || aiCommandOf(aiState.settings);
      await editNote(dir, fileName, (note) => {
        note.blocks[noteBlockKey("summary", lang)] = { attrs: { model, date: new Date().toISOString(), ...(version ? { version } : {}), ...(fromLang ? { from: fromLang } : {}), lang }, body: text };
      });
      viewLang.summary = lang;
      await readFromDisk();
      say(tr("reason.done", { tokens: reply.tokens.toLocaleString() }));
      announce();
    }
  } catch (e) {
    say(e.message);
  } finally {
    endBusy(busy);
    redoing = null;
    renderBlocks();
  }
}

function renderMine() {
  mineEl.hidden = false;
  document.getElementById("mine-title").textContent = tr("note.heading");
  viewEl.hidden = editing;
  editEl.hidden = !editing;
  saveHint.hidden = !editing;
  editBtn.hidden = editing;
  saveBtn.hidden = cancelBtn.hidden = !editing;
  if (editing) return;
  if (loaded.body.trim()) renderMarkdown(loaded.body, viewEl);
  else viewEl.replaceChildren(el("p", tr("note.empty"), "muted"));
}

function startEdit() {
  editing = true;
  editBase = loaded.body;
  editEl.value = loaded.body;
  renderMine();
  editEl.focus();
}

function stopEdit() {
  editing = false;
  conflictEl.hidden = true;
  renderMine();
}

async function save(overwrite) {
  if (!editing) return;
  conflictEl.hidden = true;
  try {
    if ((await dir.requestPermission({ mode: "readwrite" })) !== "granted") return say(tr("err.noaccess"));
    const body = editEl.value;
    const result = await withBusy(tr("busy.saving"), () => withNoteLock(async () => {
      const text = await readFileText(dir, fileName); // the file as it is now (another computer or an editor may have changed it)
      const note = text === null ? newNote(paperId, paperEntry) : parseNote(text);
      if (!overwrite && text !== null && noteUserBody(note.user) !== editBase) return "conflict";
      note.user = withNoteBody(note.user, body);
      await writeFileText(dir, fileName, buildNote(note));
      return text === null ? "recreated" : "saved";
    }));
    if (result === "conflict") {
      conflictEl.hidden = false;
      return;
    }
    if (result === "recreated") await ensureNote(dir, paperId); // (the file had been deleted: the index learns about it again)
    await readFromDisk();
    renderBlocks();
    stopEdit();
    say(tr("note.saved"));
    announce();
  } catch (e) {
    say(tr("err.generic", { msg: e.message }));
  }
}

async function reloadFromDisk(message) {
  await readFromDisk();
  await loadArxivData(); // (a reason may have arrived from elsewhere)
  renderBlocks();
  stopEdit();
  say(message || "");
}

async function deleteBlock(key, title) {
  if (!confirm(tr("note.block.delete.confirm", { name: title }))) return;
  try {
    if ((await dir.requestPermission({ mode: "readwrite" })) !== "granted") return say(tr("err.noaccess"));
    await withBusy(tr("busy.saving"), () => editNote(dir, fileName, (note) => {
      delete note.blocks[key];
    }));
    await readFromDisk();
    renderBlocks();
    if (!editing) renderMine();
    announce();
  } catch (e) {
    say(tr("err.generic", { msg: e.message }));
  }
}

async function load() {
  const before = (await readIndex(dir))[paperId];
  outLang = aiOutputLang(await getAiSettings());
  if (!before && pageParams.get("summarize") === "1" && /^(?!doi:)/.test(paperId)) return loadPending();
  if (!before) return say(tr("note.notinlibrary"));
  const existed = !!before.note && (await readFileText(dir, before.note)) !== null;
  fileName = await withBusy(tr("busy.loading"), () => ensureNote(dir, paperId));
  if (!fileName) return say(tr("note.notinlibrary"));
  paperEntry = (await readIndex(dir))[paperId];
  if (!existed) {
    const kept = (await getReasons())[paperId]; // reasons and translations asked in Today's arXiv go into the new note
    if (kept) await writeReasonsToNote(dir, paperId, kept);
    const translated = (await getTranslations())[paperId];
    if (translated) await writeTranslationsToNote(dir, paperId, translated);
  }
  await readFromDisk();
  await loadAiState();
  await loadArxivData();
  say("");
  showPaper();
  renderBlocks();
  renderMine();
  renderSummaryPanel();
  await showConflictCopies().catch(() => {});
  const hasSummary = Object.keys(loaded.note.blocks).includes(noteBlockKey("summary", outLang));
  if (pageParams.get("summarize") === "1" && aiState && !hasSummary) prepareSummary(outLang, "");
  fileRow.hidden = false;
  document.getElementById("file-name").textContent = tr("note.file", { name: fileName });
  if (!existed) {
    announce();
    if (!loaded.body.trim() && Object.keys(loaded.note.blocks).length <= 1 && pageParams.get("summarize") !== "1") startEdit(); // a new, empty note: start writing (not when it was opened to summarize)
  }
}

// Conflict copies of this note made by the cloud service: named, with a way to look at them (not merged automatically).
async function showConflictCopies() {
  const box = document.getElementById("copies");
  const copies = noteConflictCopies(fileName, await listFiles(dir));
  box.hidden = !copies.length;
  box.textContent = "";
  if (!copies.length) return;
  box.append(el("p", tr("note.copies", { n: copies.length })));
  for (const name of copies) {
    const row = el("div", undefined, "copy-row");
    const open = el("button", tr("note.editor"), "mini");
    open.onclick = () => askHelper(dir, "edit", name).catch((e) => say(tr("note.editor.failed", { msg: e.message })));
    const reveal = el("button", tr("paper.reveal"), "mini");
    reveal.onclick = () => revealInFolder(dir, name).catch((e) => say(tr("reveal.failed", { msg: e.message })));
    row.append(el("code", name), open, reveal);
    box.append(row);
  }
}

// Opened to summarize a paper that is not in the library: show it from arXiv; nothing is written until the summary is made.
async function loadPending() {
  await loadAiState();
  if (!aiState) return say(tr("summary.noai"));
  await loadArxivData(true);
  if (!aiState.arxiv) return say(aiState.error || tr("reason.noabstract"));
  pendingPaper = true;
  const p = aiState.arxiv;
  paperEntry = { title: p.title, authors: p.authors.slice(0, MAX_AUTHORS), authorCount: p.authorCount, versions: {} };
  say("");
  showPaper();
  prepareSummary(outLang, "");
}

function fail(e) {
  if (e instanceof IndexError) say(e.message + (e.kind !== "newer" ? tr("err.repair") : ""));
  else if (e.name === "NotFoundError") say(tr("folder.notfound"));
  else say(tr("err.generic", { msg: e.message }));
}

async function main() {
  await i18nReady;
  editBtn.textContent = tr("note.edit");
  saveBtn.textContent = tr("note.save");
  cancelBtn.textContent = tr("common.cancel");
  saveHint.textContent = tr("note.savehint");
  document.getElementById("conflict-text").textContent = tr("note.changed");
  document.getElementById("conflict-reload").textContent = tr("note.reload");
  document.getElementById("conflict-overwrite").textContent = tr("note.overwrite");
  const editorBtn = document.getElementById("editor");
  const revealBtn = document.getElementById("reveal");
  editorBtn.textContent = tr("note.editor");
  editorBtn.title = tr("note.editor.tip");
  revealBtn.textContent = tr("paper.reveal");
  revealBtn.title = tr("note.reveal.tip");
  say(tr("loading"));
  if (!paperId) return say(tr("open.nopaper"));
  dir = await loadDir();
  if (!dir) return say(tr("open.nofolder"));

  editBtn.onclick = startEdit;
  saveBtn.onclick = () => save(false);
  cancelBtn.onclick = () => {
    if (!dirty() || confirm(tr("note.discard"))) stopEdit();
  };
  document.getElementById("conflict-reload").onclick = () => reloadFromDisk(tr("note.reloaded")).catch(fail);
  document.getElementById("conflict-overwrite").onclick = () => save(true);
  editorBtn.onclick = async () => {
    try {
      await askHelper(dir, "edit", fileName);
      say("");
    } catch (e) {
      say(tr("note.editor.failed", { msg: e.message }));
    }
  };
  revealBtn.onclick = async () => {
    try {
      await withBusy("", () => revealInFolder(dir, fileName));
    } catch (e) {
      say(tr("reveal.failed", { msg: e.message }));
    }
  };

  if ((await dir.queryPermission({ mode: "readwrite" })) !== "granted") {
    say(tr("grant.msg", { name: dir.name }));
    grantBtn.hidden = grantHint.hidden = false;
    grantBtn.onclick = async () => {
      if ((await dir.requestPermission({ mode: "readwrite" })) === "granted") {
        grantBtn.hidden = grantHint.hidden = true;
        load().catch(fail);
      }
    };
    return;
  }
  await load();
}

// Ctrl+S / Cmd+S saves; leaving with unsaved changes asks first.
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save(false);
  }
});
window.addEventListener("beforeunload", (e) => {
  if (!dirty()) return;
  e.preventDefault();
  e.returnValue = "";
});
// AI settings changed in Settings (e.g. the output language): show the matching buttons.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes.ai || !loaded) return;
  outLang = aiOutputLang(await getAiSettings());
  await loadAiState();
  await loadArxivData();
  renderBlocks();
});

// Coming back to the tab (e.g. after editing the file in another editor): show the file as it is now. While editing,
// nothing is replaced; saving then notices the change and asks.
window.addEventListener("focus", async () => {
  if (!loaded || editing) return;
  try {
    const file = await (await dir.getFileHandle(fileName)).getFile();
    if (file.lastModified !== loaded.lastModified) await reloadFromDisk(tr("note.reloaded"));
  } catch (e) {}
});

main().catch(fail);
