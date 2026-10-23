(async () => {
  try {
    await sleep(300);
    const $ = (id) => document.getElementById(id);
    check("the installed version is shown at the bottom (from the manifest)", $("app-version").textContent === tr("app.version", { version: "9.8.7" }), $("app-version").textContent);
    const themeSel = $("theme");
    check("the colour theme is chosen in Settings: automatic, light, dark and four more", [...themeSel.options].map((x) => x.value).join() === "auto,light,dark,lavender,rose,plum,midnight" && themeSel.value === "auto");
    themeSel.value = "plum"; themeSel.dispatchEvent(new Event("change"));
    check("choosing one applies it at once and remembers it", document.documentElement.getAttribute("data-theme") === "plum" && localStorage.getItem("theme") === "plum" && getComputedStyle(document.body).backgroundColor === "rgb(30, 20, 38)", getComputedStyle(document.body).backgroundColor);
    themeSel.value = "auto"; themeSel.dispatchEvent(new Event("change"));
    check("automatic removes the choice (the system decides)", !document.documentElement.hasAttribute("data-theme"));
    check("the header here has every page and the switch, Settings marked", ["library.html", "today.html", "options.html"].every((h) => document.querySelector("header a[href='" + h + "']")) && document.querySelector("header a.current").getAttribute("href") === "options.html" && !!$("capture-toggle"));
    const sites = () => [...document.querySelectorAll("#sites li span")].map((s) => s.textContent);
    const dbs = () => [...document.querySelectorAll("#sites-db li span")].map((s) => s.textContent);
    check("databases and journal sites are listed apart", dbs().length === 3 && ["arxiv.org", "inspirehep.net", "ui.adsabs.harvard.edu"].every((h) => dbs().some((s) => s.startsWith(h))) && sites().length === DEFAULT_SITES.length - 3 && sites().some((s) => s.startsWith("journals.aps.org")) && !sites().some((s) => s.startsWith("arxiv.org")), dbs().join("|") + " // " + sites().join("|"));
    check("folder status shows none", $("folder-status").textContent.includes("No folder"));
    // choose folder
    window.showDirectoryPicker = async () => fakeDir;
    $("choose").click(); await sleep(100);
    check("choosing a folder is remembered", $("folder-status").textContent.includes("Papers"));
    // add a database (with its link icon)
    $("new-db-site").value = "https://scholar.google.com/scholar?q=x"; $("new-name").value = "Scholar"; $("new-template").value = "https://scholar.google.com/scholar?q=arxiv:{id}";
    $("add-db").click(); await sleep(150);
    check("database added to the databases", dbs().some((s) => s.startsWith("scholar.google.com") && s.includes("link icon")) && !sites().some((s) => s.startsWith("scholar")), dbs().join("|"));
    check("permission was requested for that site", permRequests.join() === "https://scholar.google.com/*", permRequests.join());
    const links = (await chrome.storage.local.get("dbLinks")).dbLinks;
    check("link icon stored with template", links.some((l) => l.host === "scholar.google.com" && l.name === "Scholar" && l.label === "Sch" && l.template.includes("{id}")), JSON.stringify(links));
    check("default link icons kept", ["arxiv.org", "inspirehep.net", "ui.adsabs.harvard.edu"].every((h) => links.some((l) => l.host === h)));
    $("new-db-site").value = "base.example.org"; $("new-name").value = ""; $("new-template").value = ""; $("add-db").click(); await sleep(50);
    check("a database needs its name and link", $("db-status").textContent.includes("https://") && !dbs().some((s) => s.startsWith("base.example.org")), $("db-status").textContent);
    $("new-db-site").value = "example.org"; $("new-name").value = "Ex"; $("new-template").value = "http://example.org/{id}"; $("add-db").click(); await sleep(50);
    check("non-https / missing-{id} link rejected", $("db-status").textContent.includes("https://") && !dbs().some((s) => s.startsWith("example.org")));
    // journal sites
    $("new-site").value = "not a site"; $("add").click(); await sleep(50);
    check("invalid site rejected", $("site-status").textContent.includes("site name"));
    $("new-site").value = "https://journals.example.org/abs/1"; $("add").click(); await sleep(150);
    check("journal site added to the journal sites (no icon)", sites().some((s) => s === "journals.example.org") && !dbs().some((s) => s.startsWith("journals.example.org")), sites().join("|"));
    permDeny = true; $("new-site").value = "denied.org"; $("add").click(); await sleep(50); permDeny = false;
    check("denied permission adds nothing", !sites().some((s) => s.startsWith("denied.org")) && $("site-status").textContent.includes("denied.org"));
    // remove
    [...document.querySelectorAll("#sites-db li")].find((li) => li.textContent.startsWith("scholar")).querySelector("button").click(); await sleep(100);
    check("remove drops the database and its icon", !dbs().some((s) => s.startsWith("scholar")) && !(await chrome.storage.local.get("dbLinks")).dbLinks.some((l) => l.host === "scholar.google.com") && $("db-status").textContent.includes("scholar"));
    // restore defaults
    $("new-site").value = "foo.org"; $("add").click(); await sleep(100);
    $("new-db-site").value = "scholar.google.com"; $("new-name").value = "Scholar"; $("new-template").value = "https://scholar.google.com/scholar?q={id}"; $("add-db").click(); await sleep(150);
    $("reset").click(); await sleep(150);
    check("restoring the journal sites resets only them (the added database stays)", sites().length === DEFAULT_SITES.length - 3 && !sites().some((s) => s.startsWith("foo.org")) && !sites().some((s) => s.startsWith("journals.example.org")) && dbs().some((s) => s.startsWith("scholar")) && $("site-status").textContent !== "", dbs().join("|"));
    $("reset-db").click(); await sleep(150);
    check("restoring the databases resets only them, with the built-in icons", dbs().length === 3 && !dbs().some((s) => s.startsWith("scholar")) && sites().length === DEFAULT_SITES.length - 3 && (await chrome.storage.local.get("dbLinks")).dbLinks === undefined && $("db-status").textContent !== "", dbs().join("|"));
    // open mode
    document.querySelector('input[value="external"]').checked = true; document.querySelector('input[value="external"]').dispatchEvent(new Event("change"));
    $("viewer").value = " evince "; $("viewer").dispatchEvent(new Event("change")); await sleep(50);
    const st = await chrome.storage.local.get(["openMode", "viewer"]);
    check("open mode and viewer saved (trimmed)", st.openMode === "external" && st.viewer === "evince", JSON.stringify(st));
    chrome.runtime.sendNativeMessage = async (h, m) => ({ ok: true });
    $("test-viewer").click(); await sleep(100);
    check("Test button reports success", $("open-status").textContent.startsWith("OK"), $("open-status").textContent);
    chrome.runtime.sendNativeMessage = async (h, m) => ({ ok: true, app: { name: "Skim", path: "/Applications/Skim.app" } });
    $("test-viewer").click(); await sleep(100);
    check("Test names the app that will open the PDFs", $("open-status").textContent.includes("Skim") && $("open-app").textContent.includes("Skim") && $("open-app").textContent.includes("/Applications/Skim.app"), $("open-status").textContent + " | " + $("open-app").textContent);
    chrome.runtime.sendNativeMessage = async () => { throw new Error("Specified native messaging host not found."); };
    $("test-viewer").click(); await sleep(100);
    check("Test button explains a missing helper", $("open-status").textContent.includes("not installed"), $("open-status").textContent);
    // ---- the helper: registered or not, and where to read how
    chrome.runtime.sendNativeMessage = async () => ({ ok: true });
    await loadOpenSettings();
    check("a registered helper is reported, with no setup steps", $("helper-status").textContent.includes("set up") && !$("helper-status").textContent.includes("not set up") && $("helper-setup").textContent === "", $("helper-status").textContent + "|" + $("helper-setup").textContent);
    chrome.runtime.sendNativeMessage = async () => { throw new Error("Specified native messaging host not found."); };
    await loadOpenSettings();
    const helpLink = $("helper-status").querySelector("a");
    check("without the helper: says what it is for and links to Help (the steps for this system stay below)", $("helper-status").textContent.includes("not set up yet") && $("helper-status").textContent.includes("AI features") && !!helpLink && helpLink.getAttribute("href") === "help.html#openwith" && $("helper-setup").textContent.includes("Install helper"), $("helper-status").textContent + "|" + $("helper-setup").textContent);
    // ---- the folder's full path and the app that opens the PDFs (both come from the helper)
    let calls = [];
    const byAction = (replies) => { calls = []; chrome.runtime.sendNativeMessage = async (h, m) => { calls.push(m); const r = replies[m.action]; if (r instanceof Error) throw r; return r; }; };
    byAction({ ping: { ok: true, app: { name: "Preview", path: "/System/Applications/Preview.app" } }, locate: { ok: true, path: "/Users/me/Dropbox/Papers" } });
    window.chosen = true; fakeDir.files.delete(".paper-folder-id");
    await refreshFolder();
    check("the full path of the folder is shown", $("folder-path").textContent === "/Users/me/Dropbox/Papers" && $("folder-status").textContent.includes("Papers"), $("folder-path").textContent);
    check("the helper finds it by the marker file", fakeDir.text(".paper-folder-id") && calls.find((c) => c.action === "locate").token === fakeDir.text(".paper-folder-id").trim());
    byAction({ locate: { ok: true, path: "/Users/me/Dropbox/Papers" } });
    await refreshFolder();
    check("with the marker already there, only the path is asked", calls.map((c) => c.action).join() === "locate", calls.map((c) => c.action).join());
    fakeDir.files.delete(".paper-folder-id");
    byAction({ ping: new Error("Specified native messaging host not found."), locate: new Error("x") });
    await refreshFolder();
    check("without the helper: a short note, and no marker file is put into the folder", $("folder-path").textContent.includes("helper") && !fakeDir.files.has(".paper-folder-id"), $("folder-path").textContent);
    byAction({ ping: { ok: true, app: { name: "Preview", path: "/System/Applications/Preview.app" } } });
    await chrome.storage.local.set({ openMode: "external", viewer: "" });
    await showOpenApp();
    check("external app with an empty box: the system's default app is named", $("open-app").textContent.includes("Preview") && $("open-app").textContent.includes("/System/Applications/Preview.app"), $("open-app").textContent);
    await chrome.storage.local.set({ openMode: "chrome" });
    await showOpenApp();
    check("Chrome tab: no app line", $("open-app").textContent === "");
    byAction({ ping: { ok: false, error: "PDF app not found: Skimm" } });
    await chrome.storage.local.set({ openMode: "external", viewer: "Skimm" });
    await showOpenApp();
    check("a wrong app name is explained right there", $("open-app").textContent.includes("Skimm"), $("open-app").textContent);

    // ---- Today's arXiv categories
    const chips = () => [...document.querySelectorAll("#arxiv-cats .tag")];
    const chosenCats = async () => (await chrome.storage.local.get("arxivCategories")).arxivCategories || [];
    check("category buttons are listed, none selected at first", chips().length >= 15 && chips().every((c) => !c.classList.contains("selected")) && chips().some((c) => c.textContent === "hep-th"), chips().length);
    chips().find((c) => c.textContent === "hep-th").click(); await sleep(80);
    chips().find((c) => c.textContent === "astro-ph.CO").click(); await sleep(80);
    check("clicking a category selects and saves it", JSON.stringify(await chosenCats()) === '["hep-th","astro-ph.CO"]' && chips().find((c) => c.textContent === "hep-th").classList.contains("selected"), JSON.stringify(await chosenCats()));
    chips().find((c) => c.textContent === "hep-th").click(); await sleep(80);
    check("clicking again removes it", JSON.stringify(await chosenCats()) === '["astro-ph.CO"]');
    $("new-cat").value = "not a category!"; $("add-cat").click(); await sleep(50);
    check("an invalid category is refused with a hint", $("cat-status").textContent.includes("hep-th") && (await chosenCats()).length === 1, $("cat-status").textContent);
    $("new-cat").value = " cs.LG "; $("add-cat").click(); await sleep(80);
    check("another category can be added, and shows up as a button", (await chosenCats()).includes("cs.LG") && chips().some((c) => c.textContent === "cs.LG" && c.classList.contains("selected")) && $("new-cat").value === "");
    press($("new-cat"), "q-bio.NC"); await sleep(80);
    check("Enter in the box adds the category too", (await chosenCats()).includes("q-bio.NC"));
    chips().find((c) => c.textContent === "q-bio.NC").click(); await sleep(80);
    check("a custom category disappears when it is unselected", !chips().some((c) => c.textContent === "q-bio.NC"));
    // the notification for a new announcement
    const nt = $("today-notify"), notifyOn = async () => (await chrome.storage.local.get("todayNotify")).todayNotify;
    check("the notification switch is in the Today's arXiv section and is off at first; nothing was asked", !!nt && !nt.checked && !!nt.closest("section").querySelector("#arxiv-cats") && permAsked.length === 0 && !(await notifyOn()));
    permDeny = true; nt.click(); await sleep(80); permDeny = false;
    check("without the permission it stays off and says why", !nt.checked && !(await notifyOn()) && $("notify-status").textContent === tr("today.notify.denied"), $("notify-status").textContent);
    nt.click(); await sleep(80);
    check("switching it on asks for the permission to show notifications (from the click) and is remembered", nt.checked && permAsked.join() === "notifications,notifications" && (await notifyOn()) === true && $("notify-status").textContent === "", permAsked.join());
    nt.click(); await sleep(60);
    check("switching it off is remembered", !nt.checked && (await notifyOn()) === false);
    notifyLevel = "denied"; nt.click(); await sleep(80); notifyLevel = "granted";
    check("when the system does not let Chrome show notifications, it says so", nt.checked && $("notify-status").textContent === tr("today.notify.blocked"), $("notify-status").textContent);
  } catch (e) { results.push("EXCEPTION " + e.stack); }
  document.getElementById("test-out").textContent = results.join("\n");
})();
