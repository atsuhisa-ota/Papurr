// The colour theme (chosen in Settings; remembered in the browser) and the header shared by the pages: the page you are
// on is marked, and the "Handle PDF links" switch works on every page.
// Also the "working" indicator: while something takes time, the ring of the mark spins and a short label appears in
// the status line, a row of its own under the header that always keeps its height (so nothing moves when a label comes
// or goes; a label too long for the row ends in "…" and is shown in full as its tooltip).
const THEMES = ["auto", "light", "dark", "lavender", "rose", "plum", "midnight"]; // (auto: light or dark, as the system)
(function () {
  function load() {
    try {
      const t = localStorage.getItem("theme");
      return THEMES.includes(t) ? t : "auto";
    } catch (e) {
      return "auto";
    }
  }

  function apply(theme) {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }

  apply(load()); // runs in <head>, before the page is drawn, so there is no flash

  // Choose a theme (Settings); other open pages follow through the browser's storage event.
  window.setTheme = function (theme) {
    if (!THEMES.includes(theme)) return;
    try {
      localStorage.setItem("theme", theme);
    } catch (e) {}
    apply(theme);
  };
  window.currentTheme = load;
  window.addEventListener("storage", (e) => {
    if (e.key === "theme") apply(load());
  });

  document.addEventListener("DOMContentLoaded", () => {
    statusLine(); // (reserved from the start)
    // The installed version (Settings and Help have the place for it), so that a user can tell which one they have.
    const versionEl = document.getElementById("app-version");
    if (versionEl && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest && typeof i18nReady !== "undefined") {
      i18nReady.then(() => (versionEl.textContent = tr("app.version", { version: chrome.runtime.getManifest().version })));
    }
    // The page you are on, in the header.
    const here = (document.body.dataset.page || "") + ".html"; // (each page says which it is)
    for (const a of document.querySelectorAll(".header-actions a[href]")) {
      if (a.getAttribute("href") === here) {
        a.classList.add("current");
        a.setAttribute("aria-current", "page");
      }
    }
    // "Handle PDF links" (the same switch on every page; stored as captureEnabled).
    const toggle = document.getElementById("capture-toggle");
    if (!toggle || typeof chrome === "undefined" || !chrome.storage) return;
    chrome.storage.local.get("captureEnabled").then(({ captureEnabled }) => (toggle.checked = captureEnabled !== false));
    toggle.addEventListener("change", () => chrome.storage.local.set({ captureEnabled: toggle.checked }));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.captureEnabled) toggle.checked = changes.captureEnabled.newValue !== false;
    });
  });
})();

// The status line under the header (created once; null on a page without a header).
function statusLine() {
  let line = document.querySelector(".status-line");
  const header = document.querySelector("body > header, #top > header");
  if (!line && header) {
    line = document.createElement("div");
    line.className = "status-line busy-label";
    line.setAttribute("role", "status");
    header.after(line);
  }
  return line;
}

// ---- "Working" indicator ----
// startBusy(label) returns a token; endBusy(token) ends it. withBusy(label, fn) does both around an async function.
// Several activities can overlap; the newest label is shown. Nothing is shown for the first 250 ms, so quick actions do not flicker.
(function () {
  const active = [];
  let timer = null;

  function update() {
    const on = active.length > 0;
    document.body.classList.toggle("busy", on);
    const label = statusLine();
    if (!label) return;
    const top = on ? active[active.length - 1] : null;
    label.textContent = top ? top.label : "";
    label.title = label.textContent;
    if (top) label.append(elapsedSpan(top.since, 3)); // ("(12 s)": the only place that says how long it has been running)
  }

  window.startBusy = function (label) {
    const token = { label: label || tr("busy.working"), since: Date.now() };
    active.push(token);
    if (active.length === 1) timer = setTimeout(update, 250);
    else update();
    return token;
  };

  window.endBusy = function (token) {
    const i = active.indexOf(token);
    if (i >= 0) active.splice(i, 1);
    if (!active.length) clearTimeout(timer);
    update();
  };

  // " (12 s)" after "Asking the AI...": a text that counts the seconds since `since` (ms) while it is on the page
  // (empty for the first `quietSeconds`, so that quick actions show no number).
  let ticker = null;
  const tick = (el) => {
    const s = Math.max(0, Math.floor((Date.now() - Number(el.dataset.since)) / 1000));
    el.textContent = s < Number(el.dataset.quiet || 0) ? "" : tr("busy.elapsed", { s });
  };
  window.elapsedSpan = function (since, quietSeconds) {
    const el = document.createElement("span");
    el.className = "elapsed";
    el.dataset.since = String(since);
    el.dataset.quiet = String(quietSeconds || 0);
    tick(el);
    if (!ticker) {
      ticker = setInterval(() => {
        const all = document.querySelectorAll(".elapsed[data-since]");
        all.forEach(tick);
        if (!all.length) ticker = clearInterval(ticker) || null; // nothing waits any more
      }, 1000);
    }
    return el;
  };

  window.withBusy = async function (label, fn) {
    const token = startBusy(label);
    try {
      return await fn();
    } finally {
      endBusy(token);
    }
  };
})();
