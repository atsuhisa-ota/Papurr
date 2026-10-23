// The top-level rules of the AI integration, checked on the source code (docs/DEVELOPMENT.md, "AI integration"):
// nothing may ask the AI by itself, and nothing may start it in the background.
const fs = require("fs"), path = require("path");
const ext = path.join(__dirname, "..", "extension");
const files = fs.readdirSync(ext).filter((f) => /\.(js|html)$/.test(f));
const read = (f) => fs.readFileSync(path.join(ext, f), "utf8");
const code = (f) => read(f).replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, ""); // without comments (they may talk about aiRun)
const results = []; let failed = 0;
const t = (name, ok, extra) => { results.push((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " -> " + extra)); if (!ok) failed++; };

// The places that may call aiRun() (each of them only from a click handler). Add a file here only together with a test of its button.
const AI_CALL_SITES = ["note.js", "profile-ui.js", "today.js"]; // the note page's "Redo with the current model"; the "Use quota and run" button of the profile (step 2); the rank and "Why recommended" buttons of Today's arXiv
const callers = files.filter((f) => f !== "ai.js" && /\baiRun\(/.test(code(f)));
t("aiRun() is called only from the listed places", JSON.stringify(callers) === JSON.stringify(AI_CALL_SITES), callers.join());
for (const f of AI_CALL_SITES) t("the call in " + f + " sits inside a click handler", /addEventListener\("click"|\.onclick\s*=/.test(read(f)) && /aiClick\(/.test(read(f)));

// profile-ui.js: the only call sits in profRun, which is bound to the run button only; the preparation (step 1) never spends.
const pui = code("profile-ui.js");
const calls = [...pui.matchAll(/\baiRun\(/g)].map((m) => m.index);
const runStart = pui.indexOf("async function profRun(event)");
const runEnd = pui.indexOf("async function initProfileSettings");
t("the profile has one single aiRun call, and it is inside profRun", calls.length === 1 && calls[0] > runStart && calls[0] < runEnd, calls.join());
t("profRun is started only by the run button, and takes the click from that very event", /pEl\("prof-run"\)\.addEventListener\("click", profRun\)/.test(pui) && /aiClick\(event\)/.test(pui) && (pui.match(/\bprofRun\b/g) || []).length === 2, (pui.match(/\bprofRun\b/g) || []).length);
const prepStart = pui.indexOf("async function profPrepare");
const prepEnd = pui.indexOf("async function profSave");
t("the preparation step never calls the AI", !/aiRun|aiClick|connectNative/.test(pui.slice(prepStart, prepEnd)));
t("nothing in profile.js asks the AI", !/aiRun|aiClick|connectNative|sendNativeMessage/.test(code("profile.js")));

// today.js: two calls, one in rankClick (the rank button) and one in reasonClick (a paper's "Why recommended" button).
const tj = code("today.js");
const tCalls = [...tj.matchAll(/\baiRun\(/g)].map((m) => m.index);
const inside = (at, start, end) => at > tj.indexOf(start) && at < tj.indexOf(end);
t("Today has three aiRun calls: in rankClick, reasonClick and translateClick", tCalls.length === 3 && inside(tCalls[0], "async function rankClick(event, todo, prompt)", "async function reasonClick(") && inside(tCalls[1], "async function reasonClick(event, paper, lang, prompt)", "function askReasonButton(") && inside(tCalls[2], "async function translateClick(event, paper, lang, prompt)", "function translateButton("), tCalls.join());
t("translateClick is started only by a Translate button's click; a kept translation is shown without the AI", /b\.addEventListener\("click", \(event\) => translateClick\(event, p, lang, prompt\)\)/.test(tj) && (tj.match(/\btranslateClick\b/g) || []).length === 2 && !/aiRun|aiClick/.test(tj.slice(tj.indexOf("function translateButton("), tj.indexOf("const prompt = buildTranslatePrompt"))) && !/aiRun|aiClick|translateClick/.test(tj.slice(tj.indexOf("function translationBox("), tj.indexOf("function libraryButton("))));
t("rankClick is started only by the rank button's and the re-rank button's click, with that click", /btn\.addEventListener\("click", \(event\) => rankClick\(event, todo, prompt\)\)/.test(tj) && /btn\.addEventListener\("click", \(event\) => rankClick\(event, again, prompt\)\)/.test(tj) && (tj.match(/\brankClick\b/g) || []).length === 3 && (tj.match(/aiRun\(aiClick\(event\)/g) || []).length === 3);
t("reasonClick is started only by a reason button's click, with that click", /b\.addEventListener\("click", \(event\) => reasonClick\(event, p, lang, prompt\)\)/.test(tj) && (tj.match(/\breasonClick\b/g) || []).length === 2);
t("a kept reason is shown (and its languages switched) without asking the AI", tj.indexOf("return askReasonButton(") > tj.indexOf("function reasonButton(") && !/aiRun|aiClick/.test(tj.slice(tj.indexOf("function reasonButton("), tj.indexOf("return askReasonButton("))) && !/aiRun|aiClick|reasonClick/.test(tj.slice(tj.indexOf("function reasonBox("), tj.indexOf("async function translateClick("))));
// note.js: one call, in redoReason, started only by the redo button's click.
const nj = code("note.js");
const nCalls = [...nj.matchAll(/\baiRun\(/g)].map((m) => m.index);
const nIn = (at, a, b) => at > nj.indexOf(a) && at < nj.indexOf(b);
t("the note page has three aiRun calls: in redoReason, runSummary and translateSummary", nCalls.length === 3 && nIn(nCalls[0], "async function redoReason(event, lang, replaceKey, prompt)", "function summaryVersion(") && nIn(nCalls[1], "async function runSummary(event)", "async function addPendingPaper(") && nIn(nCalls[2], "async function translateSummary(event, prompt, fromLang, version)", "function renderMine("), nCalls.join());
t("translateSummary is started only by its button's click", /b\.addEventListener\("click", \(event\) => translateSummary\(event, prompt, fromLang, block\.attrs\.version \|\| ""\)\)/.test(nj) && (nj.match(/\btranslateSummary\b/g) || []).length === 2);
t("nothing in translate.js asks the AI", !/aiRun|aiClick|connectNative|sendNativeMessage/.test(code("translate.js")));
t("runSummary is started only by the Summarize button's click, after the estimate (step 1 never asks the AI)", /run\.addEventListener\("click", \(event\) => runSummary\(event\)\)/.test(nj) && (nj.match(/\brunSummary\b/g) || []).length === 2 && !/aiRun|aiClick/.test(nj.slice(nj.indexOf("async function prepareSummary("), nj.indexOf("function renderSummaryPanel("))));
t("nothing in summary.js asks the AI", !/aiRun|aiClick|connectNative|sendNativeMessage/.test(code("summary.js")));
t("redoReason is started only by the redo button's click, with that click", /b\.addEventListener\("click", \(event\) => redoReason\(event, lang, replaceKey, prompt\)\)/.test(nj) && (nj.match(/\bredoReason\b/g) || []).length === 2 && /aiRun\(aiClick\(event\)/.test(nj));
t("opening a note never asks the AI", !/aiRun|aiClick/.test(nj.slice(nj.indexOf("async function load()"), nj.indexOf("function fail("))) && !/aiRun|aiClick/.test(nj.slice(nj.indexOf("async function loadPending("), nj.indexOf("function fail("))) && !/aiRun|aiClick/.test(nj.slice(nj.indexOf("async function loadAiState"), nj.indexOf("function modelAndEffort"))));
t("nothing in reason.js asks the AI", !/aiRun|aiClick|connectNative|sendNativeMessage/.test(code("reason.js")));
t("loading Today and its AI state never asks the AI", !/aiRun|aiClick|connectNative/.test(tj.slice(tj.indexOf("async function loadAi"), tj.indexOf("function renderAiBar"))) && !/aiRun|aiClick/.test(tj.slice(tj.indexOf("async function main"))));
t("nothing in rank.js asks the AI", !/aiRun|aiClick|connectNative|sendNativeMessage/.test(code("rank.js")));

const talkers = files.filter((f) => f !== "ai.js" && /connectNative|"ai_run"/.test(read(f)));
t("only ai.js talks to the AI part of the helper", talkers.length === 0, talkers.join());

const ai = read("ai.js");
t("ai.js has no timers, alarms or start-up hooks", !/setInterval|setTimeout|chrome\.alarms|onInstalled|onStartup|onAlarm/.test(ai), "found");
t("aiRun needs a click token, the switch, the agreement and a supported OS", /aiTokens\.delete\(click\)/.test(ai) && /settings\.enabled/.test(ai) && /aiConsentGiven\(settings\)/.test(ai) && /os !== "mac" && os !== "linux"/.test(ai));
t("there is no retry loop in ai.js", !/retry|attempts|for \(let attempt/i.test(ai));

const bg = read("background.js");
t("the service worker and the content script know nothing about the AI", !/aiRun|aiStatus|getAiSettings|connectNative|importScripts\([^)]*ai\.js/.test(bg) && !/\bai\b/i.test(read("content.js")));
const manifest = JSON.parse(read("manifest.json"));
t("no AI file among the content scripts", !JSON.stringify(manifest.content_scripts || []).includes("ai"));
// The alarm (permission "alarms") exists only for the notification of Today's arXiv in background.js, which knows nothing about the AI.
t("the alarms are used by background.js alone (never by an AI file or a page)", fs.readdirSync(path.join(__dirname, "..", "extension")).filter((f) => f.endsWith(".js") && f !== "background.js").every((f) => !/chrome\.alarms/.test(read(f))));

const ui = read("ai-ui.js");
const checkAt = ui.indexOf('aiEl("ai-check").addEventListener("click"');
const statusCalls = [...ui.matchAll(/aiStatus\(/g)].map((m) => m.index);
t("the command is checked only when the Check button is pressed", checkAt > 0 && statusCalls.length === 1 && statusCalls[0] > checkAt, statusCalls.join());

const py = fs.readFileSync(path.join(__dirname, "..", "native", "ai_runner.py"), "utf8");
t("the safety flags are fixed in the helper", ["--safe-mode", "--no-session-persistence", '"--tools", ""', "--strict-mcp-config", "--disable-slash-commands"].every((s) => py.includes(s)));
t("the helper never uses --bare (it would ignore the subscription login)", !/"--bare"/.test(py));
t("the helper removes API-billing variables (Anthropic and OpenAI)", /"ANTHROPIC_"/.test(py) && /CLAUDE_CODE_USE_/.test(py) && /"OPENAI_"/.test(py) && /CODEX_API_KEY/.test(py));
t("codex runs with no session files, no user config, no rules, a read-only sandbox, no web search, tools off", ["\"--ephemeral\"", "\"--ignore-user-config\"", "\"--ignore-rules\"", "\"read-only\"", 'web_search="disabled"', "\"--disable\"", "\"shell_tool\""].every((x) => py.includes(x)), "missing");
t("codex keeps its internal databases (a log of the request) in the temporary directory", /sqlite_home=/.test(py));
t("codex is never given a dangerous sandbox or an approval bypass", !/danger-full-access|workspace-write|--yolo|--dangerously-bypass|--full-auto/.test(py));
t("an answer of codex that used a tool anyway is thrown away", /if tools:/.test(py) && /command_execution/.test(py));
t("kimi: its data directory is temporary, only the sign-in files are linked, the user's config.toml is not used", /KIMI_CODE_HOME/.test(py) && /KIMI_LINKED = \("credentials", "oauth", "device_id", "region"\)/.test(py) && !/KIMI_LINKED = \([^)]*config\.toml/.test(py) && /def kimi_config/.test(py));
t("kimi: the agent has no tools and no sub-agents, the user's skills are replaced", /tools: \[\]\\nsubagents: \[\]/.test(py) && /"--skills-dir"/.test(py) && /"--agent-file"/.test(py));
t("kimi: never an approval bypass, every KIMI_* variable dropped, only OAuth models used", !/"--yolo"|"--auto"|"-y"/.test(py) && /"KIMI_"/.test(py) && /isinstance\(v\.get\("oauth"\), dict\)/.test(py));
t("kimi: an answer with a tool offered or used is thrown away, the links are removed before cleaning up", /if tools:  # the agent has no tools/.test(py) && /kimi_unlink\(cwd\)/.test(py));
t("Papurr never changes PATH for the command", !/env\["PATH"\]\s*=/.test(py));
t("copies inside other apps are not looked for", !/ChatGPT\.app|\.vscode/.test(py.slice(py.indexOf("PACKAGE_DIRS = ["), py.indexOf("]", py.indexOf("PACKAGE_DIRS = [")))));
console.log(results.join("\n"));
process.exitCode = failed ? 1 : 0;
