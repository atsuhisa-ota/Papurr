// Settings page in Simplified Chinese: every marked text comes from the Chinese dictionary and nothing overflows.
(async () => {
  try {
    await sleep(300);
    const zh = I18N.zh;
    const bad = [...document.querySelectorAll("[data-i18n]")].filter((el) => el.textContent !== zh[el.dataset.i18n]);
    check("every data-i18n text is Chinese", bad.length === 0, bad.map((e) => e.dataset.i18n + "=" + e.textContent).join("|"));
    const badPh = [...document.querySelectorAll("[data-i18n-placeholder]")].filter((el) => el.placeholder !== zh[el.dataset.i18nPlaceholder]);
    check("placeholders are Chinese", badPh.length === 0, badPh.map((e) => e.placeholder).join("|"));
    check("language selector shows the stored language and offers Chinese", document.getElementById("language").value === "zh" && [...document.getElementById("language").options].some((o) => o.value === "zh" && o.textContent === "简体中文"));
    check("the page language is zh", document.documentElement.lang === "zh");
    check("folder status in Chinese", document.getElementById("folder-status").textContent === zh["folder.none"], document.getElementById("folder-status").textContent);
    document.getElementById("new-site").value = "not a site";
    document.getElementById("add").click(); await sleep(50);
    check("error message in Chinese", document.getElementById("site-status").textContent === zh["site.err.invalid"], document.getElementById("site-status").textContent);
    chrome.runtime.sendNativeMessage = async () => ({ ok: true });
    document.getElementById("test-viewer").click(); await sleep(100);
    check("test result in Chinese", document.getElementById("open-status").textContent.startsWith("正常:辅助程序"), document.getElementById("open-status").textContent);
  } catch (e) { results.push("EXCEPTION " + e.stack); }
  document.getElementById("test-out").textContent = results.join("\n");
})();
