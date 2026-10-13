// Japanese interface: every marked text is translated, and texts built by scripts are Japanese too.
(async () => {
  try {
    await sleep(300);
    const ja = I18N.ja;
    const bad = [...document.querySelectorAll("[data-i18n]")].filter((el) => el.textContent !== ja[el.dataset.i18n]);
    check("every data-i18n text is Japanese", bad.length === 0, bad.map((e) => e.dataset.i18n + "=" + e.textContent).join("|"));
    const badPh = [...document.querySelectorAll("[data-i18n-placeholder]")].filter((el) => el.placeholder !== ja[el.dataset.i18nPlaceholder]);
    check("placeholders are Japanese", badPh.length === 0, badPh.map((e) => e.placeholder).join("|"));
    const badTitle = [...document.querySelectorAll("[data-i18n-title]")].filter((el) => el.title !== ja[el.dataset.i18nTitle] && el.id !== "sort-dir");
    check("tooltips are Japanese", badTitle.length === 0, badTitle.map((e) => e.title).join("|"));
    check("page language attribute", document.documentElement.lang === "ja");
    check("the header names every page in Japanese", [...document.querySelectorAll(".header-actions a")].map((a) => a.textContent).join("|") === "ライブラリ|今日のarXiv|INSPIRE|設定|使い方");
    check("empty state in Japanese", document.querySelector(".empty") && document.querySelector(".empty").textContent.includes("ライブラリはまだ空です"), document.getElementById("list").textContent);

    seed({
      "2301.00001": entry("Alpha strings", { tags: ["strings"], versions: { v1: "a1.pdf" }, journal: { file: "j.pdf", name: "JHEP", year: 2023 } }),
      "2301.00002": entry("Beta branes", { tags: ["strings"] }),
    });
    ["a1.pdf", "j.pdf", "Betabranesv1.pdf"].forEach((f) => fakeDir.put(f, "%PDF-"));
    document.getElementById("rebuild").click(); await sleep(400);
    const msg = document.getElementById("msg").textContent;
    check("paper count and index summary in Japanese", msg.includes("2件中2件を表示") && msg.includes("追加0件、削除0件"), msg);
    const p = [...document.querySelectorAll(".paper")].find((el) => el.textContent.includes("Alpha"));
    check("journal chip in Japanese", p.textContent.includes("ジャーナル版"));
    check("add-tag placeholder in Japanese", p.querySelector("input.tag-input").placeholder === "+ タグ");
    check("delete tooltip in Japanese", p.querySelector(".chip-delete").title === "v1を削除", p.querySelector(".chip-delete").title);
    check("sort direction tooltip in Japanese", document.getElementById("sort-dir").title.startsWith("降順"));

    // confirm / prompt texts
    let asked = "";
    window.confirm = (m) => { asked = m; return false; };
    window.prompt = (m) => { asked = m; return null; };
    p.querySelector(".chip-delete").click(); await sleep(100);
    check("delete confirmation in Japanese", asked.includes("「Alpha strings」から削除しますか?") && asked.includes("a1.pdf"), asked);
    document.getElementById("manage-tags").click();
    const row = [...document.querySelectorAll("#tag-manager .tag-row")][0];
    const buttons = row.querySelectorAll("button");
    check("tag manager buttons in Japanese", buttons[0].textContent === "名前を変更" && buttons[1].textContent === "削除");
    buttons[0].click(); await sleep(50);
    check("rename prompt in Japanese", asked.includes("タグ「strings」の新しい名前"), asked);
    buttons[1].click(); await sleep(50);
    check("tag delete confirmation in Japanese", asked.includes("タグ「strings」を2件の論文から削除しますか?"), asked);

    // damaged index -> recovery box in Japanese
    fakeDir.files.delete("index.json.bak");
    fakeDir.put("index.json", "{{{broken");
    document.getElementById("rebuild").click(); await sleep(400);
    const rec = document.getElementById("recovery").textContent;
    check("recovery box in Japanese", rec.includes("壊れているため、読み込めません") && rec.includes("PDFファイルは無事です") && rec.includes("バックアップから復元") && rec.includes("ファイルから作り直す"), rec);

    // folder missing -> message with a link in Japanese
    fakeDir.getFileHandle = async () => { const e = new Error("gone"); e.name = "NotFoundError"; throw e; };
    document.getElementById("rebuild").click(); await sleep(300);
  } catch (e) { results.push("EXCEPTION " + e.stack); }
  document.getElementById("test-out").textContent = results.join("\n");
})();
