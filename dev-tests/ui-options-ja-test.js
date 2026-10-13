(async () => {
  try {
    await sleep(300);
    const ja = I18N.ja;
    const bad = [...document.querySelectorAll("[data-i18n]")].filter((el) => el.textContent !== ja[el.dataset.i18n]);
    check("every data-i18n text is Japanese", bad.length === 0, bad.map((e) => e.dataset.i18n + "=" + e.textContent).join("|"));
    const badPh = [...document.querySelectorAll("[data-i18n-placeholder]")].filter((el) => el.placeholder !== ja[el.dataset.i18nPlaceholder]);
    check("placeholders are Japanese", badPh.length === 0, badPh.map((e) => e.placeholder).join("|"));
    check("language selector shows the stored language", document.getElementById("language").value === "ja");
    check("folder status in Japanese", document.getElementById("folder-status").textContent === "フォルダがまだ選ばれていません。", document.getElementById("folder-status").textContent);
    const dbs = [...document.querySelectorAll("#sites-db li span")].map((s) => s.textContent);
    const sites = [...document.querySelectorAll("#sites li span")].map((s) => s.textContent);
    check("site lists in Japanese", dbs[0].includes("(初期設定)") && dbs[0].includes("リンクアイコンあり") && sites[0].includes("(初期設定)"), dbs[0] + " / " + sites[0]);
    document.getElementById("new-site").value = "not a site";
    document.getElementById("add").click(); await sleep(50);
    check("error message in Japanese", document.getElementById("site-status").textContent.includes("サイト名を入力してください"), document.getElementById("site-status").textContent);
    document.getElementById("new-db-site").value = "example.org"; document.getElementById("new-name").value = "Ex"; document.getElementById("new-template").value = "http://x/{id}";
    document.getElementById("add-db").click(); await sleep(50);
    check("link error in Japanese", document.getElementById("db-status").textContent.includes("{id} を含むリンク"), document.getElementById("db-status").textContent);
    chrome.runtime.sendNativeMessage = async () => ({ ok: true });
    document.getElementById("test-viewer").click(); await sleep(100);
    check("test result in Japanese", document.getElementById("open-status").textContent.startsWith("OK: 補助プログラム"), document.getElementById("open-status").textContent);
    // (Choosing a language reloads the page, so that cannot be exercised inside a single test page.)
  } catch (e) { results.push("EXCEPTION " + e.stack); }
  document.getElementById("test-out").textContent = results.join("\n");
})();
