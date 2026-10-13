// Today's arXiv: list, abstracts, filter, "In library", caching, refresh, errors, empty state, working indicator.
(async () => {
  try {
    const q = new URLSearchParams(location.search);
    const ja = q.get("lang") === "ja";
    const T = (en, jp) => (ja ? jp : en);
    const items = () => [...document.querySelectorAll("#list .paper")];
    const itemOf = (t) => items().find((el) => el.querySelector("a.title").textContent === t);
    if (q.has("nocats")) {
      await sleep(400);
      check("without categories the page points to Settings", document.getElementById("list").textContent.includes(T("Settings", "設定")) && !!document.querySelector("#list a[href='options.html']") && items().length === 0 && requests.length === 0, document.getElementById("list").textContent);
    } else if (q.has("history")) {
      await sleep(1000);
      const chips = () => [...document.querySelectorAll("#today-days .tag")];
      check("the latest announcement and the 4 announcement days (weekdays) before it can be chosen", !document.getElementById("today-days").hidden && chips().map((c) => c.textContent).length === 5 && chips()[0].textContent === T("Latest", "最新") && chips()[0].classList.contains("selected") && chips()[1].textContent.includes("7") && chips()[4].textContent.includes("2"), chips().map((c) => c.textContent).join("|"));
      const kept = (await chrome.storage.local.get("todayHistory")).todayHistory;
      check("the latest list is kept too; beyond 5 days the oldest is dropped; other categories stay apart", kept.filter((h) => h.categories.join() === "hep-th,astro-ph.CO").map((h) => h.date).join() === "2026-10-08,2026-10-07,2026-10-06,2026-10-02,2026-10-01" && kept.some((h) => h.categories[0] === "math.AG") && kept[0].papers.length === 3, kept.map((h) => h.date + ":" + h.categories[0]).join());
      const before = requests.length;
      chips()[1].click(); await sleep(100);
      check("a kept day is shown without asking arXiv, with its own count and no Load more", items().length === 1 && items()[0].textContent.includes("Kept from Oct 7") && requests.length === before && !document.querySelector("#list .show-more") && document.getElementById("msg").textContent.includes("2026") && chips()[1].classList.contains("selected"), document.getElementById("msg").textContent);
      chips()[3].click(); await sleep(100); // Oct 5: not kept
      await sleep(4000); // (arXiv's pause between API requests)
      const asked = requests.slice(before);
      check("a day that is not kept is asked from arXiv's API once, by the submission times of that announcement (Mon Oct 5: Thu 14:00 to Fri 14:00 US Eastern)", asked.length === 1 && asked[0].startsWith("https://export.arxiv.org/api/query?search_query=") && decodeURIComponent(asked[0]).includes("(cat:hep-th+OR+cat:astro-ph.CO)+AND+submittedDate:[202610011800+TO+202610021759]"), asked.join("|"));
      check("its papers are listed: primary category followed = new, otherwise cross-list; nothing outside the window", items().map((el) => el.querySelector("a.title").textContent).join("|") === "Fetched new one|Fetched cosmology|Fetched cross one" && items()[0].querySelector("a.title").getAttribute("href") === "open.html?id=2610.05001&v=v1" && chips()[3].classList.contains("selected"), items().map((el) => el.textContent.slice(0, 40)).join("|"));
      check("the count says what that day had, and that it is an estimate", document.getElementById("msg").textContent.includes(T("2 new, 1 cross-lists", "新着 2件、クロスリスト 1件")) && document.getElementById("msg").textContent.includes(T("estimated from submission times", "投稿時刻からの推定")), document.getElementById("msg").textContent);
      chips()[1].click(); await sleep(100); chips()[3].click(); await sleep(100);
      check("then it is kept: choosing it again asks nothing", requests.length === before + 1 && items().length === 3);
      chips()[0].click(); await sleep(300);
      check("Latest goes back to the latest list (from the short-term cache: no request)", items().length === 3 && requests.length === before + 1 && chips()[0].classList.contains("selected"), items().length + " " + requests.length);
    } else if (q.has("bare")) {
      await sleep(3800); // (a feed without details: then the details of the announced papers by id, after arXiv's pause)
      check("a feed without details: the details are asked from the API by id (replacements not)", requests.length === 2 && requests[1].includes("id_list=2610.00003,2610.00001,2610.00002") && !requests[1].includes("2609.00500") && items().length === 3, requests.join("|"));
    } else if (q.has("busy")) {
      await sleep(4000); // (the feed is refused, then the listing after arXiv's pause)
      check("arXiv asking to slow down (429) is explained in plain words", document.getElementById("msg").textContent.includes(T("limiting requests", "制限しています")) && document.getElementById("msg").textContent.includes("429"), document.getElementById("msg").textContent);
    } else if (q.has("fail")) {
      await sleep(3800); // (the feed fails, then the listing after arXiv's pause)
      check("a failed request is explained", document.getElementById("msg").textContent.includes("503"), document.getElementById("msg").textContent);
    } else if (q.has("bigday")) {
      await sleep(7500); // (empty feed, then two pages of the listing, with arXiv's pause between requests)
      check("without the feed (weekend), the first load reads the listing until the whole latest announcement is in", requests.length === 3 && requests[0].includes("/rss/") && requests[2].includes("start=3") && items().length === 4 && !document.querySelector("#list .show-more"), requests.join(" | ") + " " + items().length);
      check("the row of earlier days is there although the feed gave no date (it starts with the last announcement made, by the clock)", !document.getElementById("today-days").hidden && document.querySelectorAll("#today-days .tag").length === 5 && document.querySelector("#today-days .tag").textContent === T("Latest", "最新"), document.getElementById("today-days").textContent);
      check("and says that the announcement was estimated", document.getElementById("msg").textContent.includes(T("estimated from submission times", "投稿時刻から推定")) && document.getElementById("msg").textContent.includes("3"), document.getElementById("msg").textContent);
    } else if (q.has("cached")) {
      await sleep(500);
      check("a list fetched a moment ago is shown at once, without asking arXiv", requests.length === 0 && items().length === 1 && items()[0].querySelector("a.title").textContent === "From the kept list", requests.join("|") + " " + items().length);
      document.getElementById("today-refresh").click();
      await sleep(1500);
      check("Refresh still asks arXiv", requests.length >= 1 && requests[0].includes("/rss/") && items().length === 3, requests.length + " " + items().length);
    } else if (q.has("quota")) {
      await sleep(1500);
      check("when the storage is full the list is still shown, with no error", items().length === 3 && !document.getElementById("msg").textContent.includes(T("Could not load", "読み込めません")), document.getElementById("msg").textContent + " " + items().length);
      check("and the row of earlier days is shown", !document.getElementById("today-days").hidden && document.querySelectorAll("#today-days .tag").length === 5);
    } else if (q.has("garbage") || q.has("emptybody")) {
      await sleep(20000); // (the feed, then the listing after arXiv's pauses)
      const m = document.getElementById("msg").textContent;
      check("answers that are not what was asked for (a web page, or nothing) never leave the page blank or broken: it says something and shows no list", m.length > 0 && items().length === 0 && !document.body.classList.contains("busy") && !document.querySelector("#list .loading"), m + " | " + items().length + " | " + document.body.className);
      check("and the message says in plain words that arXiv's answer could not be read (not \"no papers found\")", m.includes("cannot read") && !m.includes("No papers found"), m);
      document.getElementById("today-refresh").click(); await sleep(1000);
      check("the Refresh button still works afterwards", requests.length >= 3, requests.length);
    } else if (q.has("huge")) {
      await sleep(1500);
      check("400 announced papers: all are listed, in the page's own time, and the count says so", items().length === 400 && document.getElementById("msg").textContent.includes("400"), items().length + " " + document.getElementById("msg").textContent);
      check("the page's own storage use for them stays small (well under the 10 MB limit)", JSON.stringify((await chrome.storage.local.get(null))).length < 3 * 1024 * 1024, JSON.stringify(await chrome.storage.local.get(null)).length);
    } else if (q.has("slow")) {
      await sleep(450);
      check("the mark spins and says what is going on while the list is fetched", document.body.classList.contains("busy") && document.querySelector(".busy-label").textContent.includes(T("Fetching", "取得中")), document.body.className + "|" + (document.querySelector(".busy-label") || {}).textContent);
      check("a big spinning mark is shown where the list will be", !!document.querySelector("#list .loading svg.mark .ring") && document.querySelector("#list .loading").textContent.includes(T("Fetching", "取得中")) && items().length === 0);
      await sleep(4500);
      check("and stops when it is done", !document.body.classList.contains("busy") && document.querySelector(".busy-label").textContent === "" && items().length === 3 && !document.querySelector("#list .loading"));
    } else {
      await sleep(800);
      check("one request: arXiv's feed of the latest announcement for all followed categories (its details are enough; the API is not asked)", requests.length === 1 && requests[0] === "https://export.arxiv.org/rss/hep-th+astro-ph.CO", requests.join("|"));
      check("the announced papers are listed (new and cross-lists, also one submitted before the deadline), replacements are not", items().length === 3, items().length);
      check("the count is arXiv's count of the announcement, with its date, and says replacements are not listed", document.getElementById("msg").textContent.includes(T("3 papers announced on", "公開分 3件")) && document.getElementById("msg").textContent.includes(T("2 new, 1 cross-lists", "新着 2件、クロスリスト 1件")) && document.getElementById("msg").textContent.includes(T("1 replacements", "改訂版 1件")) && document.getElementById("msg").textContent.includes("2026"), document.getElementById("msg").textContent);
      const first = items()[0];
      check("title, authors, id and categories are shown", first.querySelector("a.title").textContent === "Newest on strings" && first.querySelector(".meta").textContent.includes("Ann Smith, Bo Chen") && first.querySelector(".meta").textContent.includes("arXiv:2610.00003v1") && first.querySelector(".meta").textContent.includes("hep-th gr-qc"), first.querySelector(".meta").textContent);
      check("the title opens the PDF through Papurr", first.querySelector("a.title").getAttribute("href") === "open.html?id=2610.00003&v=v1", first.querySelector("a.title").getAttribute("href"));
      check("the abstract is shown (white space tidied)", first.querySelector(".abstract").textContent === "We study strings. more text", first.querySelector(".abstract").textContent);
      check("headings as on arXiv's page: new submissions, then cross-lists", [...document.querySelectorAll("#list .day")].map((d) => d.textContent).join("|") === T("New submissions|Cross-lists", "新着|クロスリスト") && items().map((el) => el.querySelector("a.title").textContent).join("|") === "Newest on strings|Yesterday's lattice|Dark energy sums", items().map((el) => el.querySelector("a.title").textContent).join("|"));
      check("a paper already in the library is marked", itemOf("Dark energy sums").textContent.includes(T("In library", "保存済み")) && !first.textContent.includes(T("In library", "保存済み")));
      check("the others offer Add to library (also without AI), and the row's links look like the small buttons", [...first.querySelectorAll(".dbs button.mini")].some((b) => b.textContent === T("Add to library", "ライブラリに追加")) && first.querySelector(".dbs a.mini").textContent === T("arXiv page", "arXivで見る"));
      // "In library" leads to the paper in the library: an open library tab shows it, otherwise the library opens on it
      const created = [];
      chrome.tabs.create = async (o) => created.push(o);
      const saved = itemOf("Dark energy sums").querySelector(".dbs .mini.done");
      saved.click(); await sleep(1300);
      check("In library with no library tab open: the library opens on that paper", created.length === 1 && created[0].url === "library.html?highlight=2610.00002" && created[0].active === true, JSON.stringify(created));
      const lib = new BroadcastChannel("papurr");
      let asked = null;
      lib.onmessage = (e) => { asked = e.data; lib.postMessage({ type: "shown", id: e.data.id }); };
      saved.click(); await sleep(300);
      check("with a library tab open: that tab is asked to show it, nothing new is opened", asked && asked.type === "show" && asked.id === "2610.00002" && created.length === 1, JSON.stringify(asked));
      lib.close();
      const long = itemOf("Dark energy sums");
      check("a short abstract has no More button", first.querySelector("button.mini").hidden && !long.querySelector("button.mini").hidden);
      const abstract = long.querySelector(".abstract");
      check("long abstracts are cut short", abstract.classList.contains("clamped"));
      long.querySelector("button.mini").click();
      check("More shows the whole abstract, Less cuts it again", !abstract.classList.contains("clamped") && long.querySelector("button.mini").textContent === T("Less", "折りたたむ"));
      long.querySelector("button.mini").click();
      check("(and back)", abstract.classList.contains("clamped"));
      const chips = [...document.querySelectorAll("#today-cats .tag")];
      check("filter chips: All plus each category", chips.map((c) => c.textContent).join("|") === T("All", "すべて") + "|hep-th|astro-ph.CO", chips.map((c) => c.textContent).join("|"));
      chips[2].click();
      check("a category chip filters the list", items().length === 1 && items()[0].textContent.includes("Dark energy"), items().length);
      document.querySelectorAll("#today-cats .tag")[1].click();
      check("cross-listed papers appear under every category", items().length === 2, items().length);
      document.querySelectorAll("#today-cats .tag")[0].click();
      check("All shows everything again", items().length === 3);
      check("the update time is shown", document.getElementById("today-updated").textContent !== "");
      // load more
      await sleep(3300); // (the page keeps a pause between arXiv requests)
      document.querySelector("#list .show-more").click();
      await sleep(4500);
      check("Load more reads the newest submissions from the API, skips what is listed already, and goes on until it adds something", requests.length === 3 && requests[1].includes("search_query=cat%3Ahep-th+OR+cat%3Aastro-ph.CO") && requests[1].includes("sortBy=submittedDate") && requests[1].includes("sortOrder=descending") && requests[1].includes("start=0") && requests[2].includes("start=3") && items().length === 4 && !document.querySelector("#list .show-more"), requests.join(" | ") + " " + items().length);
      check("older papers are headed by their submission date", [...document.querySelectorAll("#list .day")].pop().textContent.includes("2026"), [...document.querySelectorAll("#list .day")].pop().textContent);
      check("the count adds the older papers", document.getElementById("msg").textContent.includes(T("+ 1 older papers", "それ以前の論文 1件")), document.getElementById("msg").textContent);
      // cache: the list is kept, Refresh asks again
      const cached = (await chrome.storage.local.get("todayCache")).todayCache;
      check("the list is kept for a while", cached && cached.papers.length >= 3 && JSON.stringify(cached.categories) === '["hep-th","astro-ph.CO"]');
      document.getElementById("today-refresh").click();
      await sleep(7000);
      check("Refresh fetches again (the feed only)", requests.length === 4 && requests[3].includes("/rss/") && items().length === 3, requests.length + " " + items().length);
      check("the header links to every page (this one marked) and has the Handle PDF links switch", ["library.html", "today.html", "options.html"].every((h) => document.querySelector("header a[href='" + h + "']")) && document.querySelector("header a.current").getAttribute("href") === "today.html" && !!document.getElementById("capture-toggle"));
      document.getElementById("capture-toggle").click(); await sleep(50);
      check("the switch works here too", (await chrome.storage.local.get("captureEnabled")).captureEnabled === false);
      document.getElementById("capture-toggle").click(); await sleep(50);
    }
  } catch (e) {
    results.push("EXCEPTION " + e.stack);
  }
  document.getElementById("test-out").textContent = results.join("\n");
})();
