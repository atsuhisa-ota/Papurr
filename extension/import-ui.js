// Settings -> Folder: identify the PDFs that were added to the folder by hand, ask, rename (the work is done by import.js).
// The library page only shows a note that points here (updateImportBanner in library.js).
let importDir = null;
const importNoteEl = document.getElementById("import-note");
const importBtn = document.getElementById("import-btn");
const importStatusEl = document.getElementById("import-status");
const importPanelEl = document.getElementById("import-panel");

function importProblem(e) {
  importStatusEl.textContent = tr("err.generic", { msg: e.message }) + (e instanceof IndexError && e.kind !== "newer" ? tr("err.repair") : "");
}

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// The count of PDFs the library does not know yet, and the button that starts the identification.
async function refreshImportNote() {
  importDir = await loadDir();
  let names = [], unversioned = [];
  try {
    if (importDir) {
      names = await findUnmanagedPdfs(importDir);
      unversioned = await findUnversionedFiles(importDir);
    }
  } catch (e) {} // not essential
  const none = !(names.length || unversioned.length);
  importNoteEl.textContent = none ? "" : [names.length && tr("import.banner", { n: names.length }), unversioned.length && tr("import.banner.nover", { n: unversioned.length })].filter(Boolean).join(" ");
  importNoteEl.hidden = none || !importPanelEl.hidden;
  importBtn.hidden = none || !importPanelEl.hidden;
}

function closeImportPanel() {
  importPanelEl.hidden = true;
  importPanelEl.textContent = "";
  refreshImportNote();
}

let importRunning = false;
async function runImport() {
  if (importRunning) return;
  importRunning = true;
  const busy = startBusy(tr("busy.working"));
  let cancelled = false;
  importNoteEl.hidden = true;
  importBtn.hidden = true;
  importPanelEl.hidden = false;
  importPanelEl.textContent = "";
  const status = node("p");
  const cancel = node("button", "", tr("common.cancel"));
  cancel.onclick = () => {
    cancelled = true;
    cancel.disabled = true;
  };
  importPanelEl.append(node("h3", "", tr("import.title")), status, cancel);
  try {
    if ((await importDir.requestPermission({ mode: "readwrite" })) !== "granted") {
      importStatusEl.textContent = tr("err.noaccess");
      closeImportPanel();
      return;
    }
    status.textContent = tr("import.scanning", { a: 0, b: "..." });
    const plan = await planImport(importDir, { report: (text) => (status.textContent = text), isCancelled: () => cancelled });
    if (plan.cancelled) {
      importStatusEl.textContent = tr("import.stopped");
      closeImportPanel();
      return;
    }
    await rememberUnversionedChecked(plan.unresolved);
    renderImportReview(plan.items);
  } catch (e) {
    closeImportPanel();
    importProblem(e);
  } finally {
    endBusy(busy);
    importRunning = false;
  }
}

// The list the user approves: every file with its old and new name, a checkbox each, and "Yes to all".
const IMPORT_ROWS = 200;
function renderImportReview(items) {
  const panel = importPanelEl;
  const renames = items.filter((it) => it.status === "rename");
  const same = items.filter((it) => it.status === "same");
  const blocked = items.filter((it) => it.status === "duplicate" || it.status === "unknown");
  renames.forEach((it) => (it.checked = it.sure)); // files that need a second look start unchecked
  panel.textContent = "";
  panel.append(node("h3", "", tr("import.title")));
  if (!renames.length && !same.length) panel.append(node("p", "", tr("import.nothing")));
  else panel.append(node("p", "", tr("import.explain")));

  const actions = node("div", "actions");
  const rows = node("div", "rows");
  const applyBtn = node("button");
  const yesAllBtn = node("button", "", tr("import.yesall", { n: renames.length }));
  const checkAllBtn = node("button", "", tr("import.checkall"));
  const uncheckAllBtn = node("button", "", tr("import.uncheckall"));
  const closeBtn = node("button", "", tr("import.close"));
  const boxes = [];
  const updateButtons = () => {
    const n = renames.filter((it) => it.checked).length;
    applyBtn.textContent = n ? tr("import.apply", { n }) : tr("import.addonly", { n: same.length });
    applyBtn.hidden = !n && !same.length;
    boxes.forEach(([box, it]) => (box.checked = it.checked));
  };
  let shown = 0;
  const showRows = (count) => {
    for (const it of renames.slice(shown, shown + count)) {
      const label = node("label", "row");
      const box = node("input");
      box.type = "checkbox";
      box.onchange = () => {
        it.checked = box.checked;
        updateButtons();
      };
      boxes.push([box, it]);
      const names = node("span", "names");
      names.append(it.name, node("span", "arrow", " \u2192 "), it.newName);
      label.append(box, " ", names);
      const notes = [it.title || (it.bibcode ? "ADS " + it.bibcode : ""), ...it.notes.map((key) => tr(key))].filter(Boolean).join(" \u2014 ");
      const detail = node("div", "detail");
      if (!it.sure) detail.append(node("span", "flag", tr("import.check") + ". "));
      detail.append(notes);
      label.append(detail);
      rows.append(label);
    }
    shown = Math.min(renames.length, shown + count);
    updateButtons();
    more.hidden = shown >= renames.length;
    more.textContent = tr("import.more", { n: renames.length - shown });
  };
  const more = node("button", "show-more");
  more.onclick = () => showRows(IMPORT_ROWS);

  const finish = async (selected) => {
    // Everything below needs the folder to be writable; ask now, while the click is fresh.
    if ((await importDir.requestPermission({ mode: "readwrite" })) !== "granted") {
      importStatusEl.textContent = tr("err.noaccess");
      return;
    }
    await applyChosen(selected, renames.filter((it) => !it.checked).length, blocked.length);
  };
  applyBtn.onclick = () => finish([...same, ...renames.filter((it) => it.checked)]);
  yesAllBtn.onclick = () => {
    renames.forEach((it) => (it.checked = true));
    finish([...same, ...renames]);
  };
  checkAllBtn.onclick = () => {
    renames.forEach((it) => (it.checked = true));
    updateButtons();
  };
  uncheckAllBtn.onclick = () => {
    renames.forEach((it) => (it.checked = false));
    updateButtons();
  };
  closeBtn.onclick = closeImportPanel;
  if (renames.length) actions.append(checkAllBtn, uncheckAllBtn);
  actions.append(applyBtn);
  if (renames.length) actions.append(yesAllBtn);
  actions.append(closeBtn);
  panel.append(actions);
  if (same.length) panel.append(node("p", "muted", tr("import.same", { n: same.length })));
  if (renames.length) panel.append(rows, more);
  showRows(IMPORT_ROWS);

  for (const [status, titleKey] of [["duplicate", "import.dups"], ["unknown", "import.unknown"]]) {
    const group = blocked.filter((it) => it.status === status);
    if (!group.length) continue;
    const details = node("details");
    details.append(node("summary", "", tr(titleKey, { n: group.length })));
    const list = node("ul");
    for (const it of group) list.append(node("li", "", it.name + (it.why ? " \u2014 " + it.why : "")));
    details.append(list);
    panel.append(details);
  }
  if (blocked.length) panel.append(node("p", "muted", tr("import.unknown.hint")));
}

// Rename the approved files, record them, and say what happened (including what was left as it was).
async function applyChosen(selected, declined, unrecognised) {
  const panel = importPanelEl;
  let cancelled = false;
  panel.textContent = "";
  const status = node("p");
  const cancel = node("button", "", tr("common.cancel"));
  cancel.onclick = () => {
    cancelled = true;
    cancel.disabled = true;
  };
  panel.append(node("h3", "", tr("import.title")), status, cancel);
  const busy = startBusy(tr("busy.working"));
  try {
    const r = await applyImport(importDir, selected, { report: (text) => (status.textContent = text), isCancelled: () => cancelled });
    // The library shows its "not shown correctly" note only after a rename run that left files behind (until the user closes it).
    await chrome.storage.local.set({ importNotice: declined + unrecognised > 0 });
    let text = tr("import.done", { renamed: r.renamed, added: r.added });
    if (declined) text += tr("import.done.left", { n: declined });
    if (r.cancelled) text += " " + tr("rebuild.stopped").trim();
    if (r.failed.length) text += tr("import.done.failed", { n: r.failed.length, list: r.failed.slice(0, 5).map((f) => f.name + " (" + f.error + ")").join(", ") });
    panel.textContent = "";
    const close = node("button", "", tr("import.close"));
    close.onclick = closeImportPanel;
    panel.append(node("h3", "", tr("import.title")), node("p", "", text), close);
  } catch (e) {
    closeImportPanel();
    importProblem(e);
  } finally {
    endBusy(busy);
  }
}

importBtn.addEventListener("click", runImport);
