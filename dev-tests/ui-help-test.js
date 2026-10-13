// The Help page: every section is there, in the interface language, with a table of contents; **bold** and `code`
// are shown as such (never as raw markers, never as HTML); the header marks Help as the current page.
(async () => {
  try {
    await sleep(800);
    const ja = new URLSearchParams(location.search).get("lang") === "ja";
    const D = I18N[ja ? "ja" : "en"];
    const sections = [...document.querySelectorAll("#help section")];
    check("every section of Help is shown", sections.length === HELP_SECTIONS.length && HELP_SECTIONS.every(([id]) => document.getElementById(id)), sections.map((s) => s.id).join());
    const toc = [...document.querySelectorAll(".help-toc a")];
    check("the contents list links to every section, with its title", toc.length === sections.length && toc.every((a, i) => a.getAttribute("href") === "#" + sections[i].id && a.textContent === sections[i].querySelector("h3").textContent));
    const text = document.getElementById("help").textContent;
    check("the texts are in the interface language", sections.every((s, i) => s.querySelector("h3").textContent === D[HELP_SECTIONS[i][1]]) && text.includes(D["help.folder.2"].replace(/\*\*|`/g, "").slice(0, 30)), text.slice(0, 120));
    check("no raw markers or dictionary keys are shown", !/\*\*|`|help\.[a-z]+\.\d/.test(text), (text.match(/.{20}(\*\*|`|help\.[a-z]+\.\d).{20}/) || [""])[0]);
    check("bold and code are real elements", document.querySelectorAll("#help strong").length > 20 && document.querySelectorAll("#help code").length > 5);
    check("no HTML from the texts (only p, ul, ol, li, strong, code, h3, section, nav, a)", [...document.querySelectorAll("#help *")].every((el) => ["P", "UL", "OL", "LI", "STRONG", "CODE", "H3", "SECTION", "NAV", "A"].includes(el.tagName)));
    const here = document.querySelector('.header-actions a[href="help.html"]');
    { const top = [...document.querySelectorAll("#openwith > ul > li")], nested = top[1] ? [...top[1].querySelectorAll(":scope > ul > li")] : [];
      check("the helper section: two ways (the AI installs it / you run it), the second with the Mac, Windows and Linux commands under it", top.length === 2 && nested.length === 3 && top[1].querySelector("strong") && /Mac/.test(nested[0].textContent) && /Windows/.test(nested[1].textContent) && /Linux/.test(nested[2].textContent), top.length + " " + nested.length); }
    check("the installed version is shown at the bottom (from the manifest)", document.getElementById("app-version").textContent === tr("app.version", { version: "9.8.7" }), document.getElementById("app-version").textContent);
    check("the header marks Help as the current page", !!here && here.classList.contains("current") && here.textContent === (ja ? "使い方" : "Help"));
    check("the cloud-sync note is in the folder section and stands out", !!document.querySelector("#folder strong") && document.querySelector("#folder").textContent.includes(ja ? "同期が済んでいるかはご自身で確認" : "checking that the sync has finished is up to you"));
  } catch (e) { results.push("EXCEPTION " + e.stack); }
  document.getElementById("test-out").textContent = results.join("\n");
})();
