// Today's arXiv and the clock (node, sandboxed vm): which announcement is the last one made, and how long a kept list is fresh.
// Conditions: every weekday and hour around the announcement time, a weekend, the daylight-saving change, a clock set back.
const fs = require("fs"), vm = require("vm"), path = require("path");
const ext = path.join(__dirname, "..", "extension");
const common = fs.readFileSync(path.join(ext, "common.js"), "utf8");
const today = fs.readFileSync(path.join(ext, "today.js"), "utf8");
const cut = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); if (a < 0 || b < 0) throw new Error("marker not found: " + from); return src.slice(a, b); };
// the clock itself lives in common.js (Today's arXiv and the notification in background.js share it); the freshness of the kept list in today.js
const code = common.slice(common.indexOf("const ARXIV_DEADLINE_HOUR")); // (the clock is the last part of common.js)
const code2 = code + cut(today, "const ESTIMATE_CACHE_MS", "\n") + "\n" + cut(today, "// A kept list is fresh", "// The submission window") +
  "\nthis.api = { lastAnnouncedDate, cacheIsFresh, nextWeekday, announcedAt, easternMoment, ESTIMATE_CACHE_MS };";
const ctx = vm.createContext({});
vm.runInContext(code2.replace(/\bconst /g, "var "), ctx);
const { lastAnnouncedDate: last, cacheIsFresh: fresh, nextWeekday, announcedAt, easternMoment } = ctx.api;
const results = []; let failed = 0;
const t = (name, ok, extra) => { results.push((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " -> " + extra)); if (!ok) failed++; };
const utc = (y, m, d, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);

// 2026-10-10 is a Saturday (summer time in New York: Eastern = UTC - 4).
t("Saturday: the last announcement made is Friday's (made on Thursday evening)", last(utc(2026, 10, 10, 12)) === "2026-10-09", last(utc(2026, 10, 10, 12)));
t("Sunday before 20:00 Eastern: still Friday's", last(utc(2026, 10, 11, 23, 30)) === "2026-10-09", last(utc(2026, 10, 11, 23, 30)));
t("Sunday after 20:00 Eastern: Monday's", last(utc(2026, 10, 12, 0, 30)) === "2026-10-12", last(utc(2026, 10, 12, 0, 30)));
const week = [["Mon 19:00", utc(2026, 10, 12, 23), "2026-10-12"], ["Mon 21:00", utc(2026, 10, 13, 1), "2026-10-13"], ["Tue 21:00", utc(2026, 10, 14, 1), "2026-10-14"],
  ["Wed 21:00", utc(2026, 10, 15, 1), "2026-10-15"], ["Thu 21:00", utc(2026, 10, 16, 1), "2026-10-16"], ["Fri 21:00", utc(2026, 10, 17, 1), "2026-10-16"], ["Sat noon", utc(2026, 10, 17, 16), "2026-10-16"]];
for (const [name, now, want] of week) t("through the week (Eastern): " + name + " -> " + want, last(now) === want, last(now));
const days = []; for (let h = 0; h < 24 * 14; h++) days.push(last(utc(2026, 10, 1) + h * 3600000));
t("the date never goes back as the clock moves forward, and is always a weekday", days.every((d, i) => (i === 0 || d >= days[i - 1]) && ![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay())), "");
t("the next weekday after Friday is Monday", nextWeekday("2026-10-09") === "2026-10-12" && nextWeekday("2026-10-10") === "2026-10-12" && nextWeekday("2026-10-08") === "2026-10-09");
// daylight saving ends on Sunday 2026-11-01 (Eastern = UTC - 5 afterwards)
t("daylight saving change: Sunday 19:30 Eastern is before the announcement, 20:30 after it", last(utc(2026, 11, 2, 0, 30)) === "2026-10-30" && last(utc(2026, 11, 2, 1, 30)) === "2026-11-02", last(utc(2026, 11, 2, 0, 30)) + " " + last(utc(2026, 11, 2, 1, 30)));
t("announcement moments follow summer and winter time", announcedAt("2026-10-09") === utc(2026, 10, 9, 0) && announcedAt("2026-11-02") === utc(2026, 11, 2, 1), announcedAt("2026-11-02"));
t("the 14:00 deadline moment", easternMoment("2026-10-09", 14) === utc(2026, 10, 9, 18) && easternMoment("2026-11-02", 14) === utc(2026, 11, 2, 19));

// freshness
const cache = (time, estimated) => ({ v: 3, time, announced: estimated ? { estimated: true } : { date: "2026-10-09" }, papers: [] });
const sat = utc(2026, 10, 10, 10);
t("a list fetched on Saturday is fresh all weekend, until the Sunday announcement", fresh(cache(sat), utc(2026, 10, 10, 20)) && fresh(cache(sat), utc(2026, 10, 11, 20)));
t("and not any more once the Sunday announcement is made and the feed has had time to show it", !fresh(cache(sat), utc(2026, 10, 12, 1)), "");
t("within the margin after the announcement the old list is still used", fresh(cache(sat), utc(2026, 10, 12, 0, 10)));
t("a list fetched after the announcement is fresh until the next one", fresh(cache(utc(2026, 10, 12, 2)), utc(2026, 10, 13, 0)) && !fresh(cache(utc(2026, 10, 12, 2)), utc(2026, 10, 13, 2)));
t("a list fetched inside the margin (the feed may not show the news yet) is fetched again later", !fresh(cache(utc(2026, 10, 12, 0, 10)), utc(2026, 10, 12, 1)));
t("an estimated list is kept for six hours only", fresh(cache(sat, true), sat + 5 * 3600000) && !fresh(cache(sat, true), sat + 7 * 3600000));
t("a clock set back, an old format or no list: fetch again", !fresh(cache(sat + 3600000), sat) && !fresh({ ...cache(sat), v: 2 }, sat + 60000) && !fresh(null, sat));
t("a list kept for a week is stale (a new announcement came meanwhile)", !fresh(cache(sat), sat + 7 * 86400000));
console.log(results.join("\n"));
process.exitCode = failed ? 1 : 0;
