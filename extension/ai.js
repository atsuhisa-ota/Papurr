// AI-assisted features: the one place that may ask the user's own AI command (`claude`, `codex` or `kimi`, their subscription) a question.
//
// The rules (docs/DEVELOPMENT.md, "AI integration") that this file enforces:
//  1. Nothing is spent without the user's knowledge: aiRun() needs a token that only a real click can create
//     (aiClick), the settings must have AI switched on and the notice agreed to, and every run is written to a log
//     the user can read in Settings. There are no timers, no start-up work and no automatic retries.
//  2. Nothing is wasted: one run at a time, and callers show an estimate (estimateTokens) before the click.
//  3. The user's normal environment is not touched: the helper (native/ai_runner.py) fixes the safety flags; this file
//     cannot loosen them.
// aiRun() is called from exactly the places listed in AI_CALL_SITES (a test checks this).

const AI_CONSENT_VERSION = 6; // raise it when what is sent changes: the user is asked again (2: codex / OpenAI added; 3: kimi / Moonshot AI added; 4: full text for summaries; 5: the text names everything sent (name, INSPIRE ID, own papers, topics, reactions) and paid extra usage; 6: the user's own instructions for summaries)
// The fixed cost of one question (the command's own instructions), for the estimates, measured with the real commands:
// claude about 2,560 input tokens with an answer format; codex about 10,500; kimi about 300 (Papurr's own short agent).
const AI_FIXED_TOKENS_BY_COMMAND = { claude: 2600, codex: 10500, kimi: 400 };
const AI_FIXED_TOKENS = AI_FIXED_TOKENS_BY_COMMAND.claude;
const AI_LOG_MAX = 200;
const AI_DEFAULTS = { enabled: false, command: "claude", path: "", model: "", effort: "", showEstimate: true, consent: null, status: null, outputLang: "", summaryLevel: "standard", summaryNote: "" }; // outputLang "": the interface language
// The AI commands Papurr can use, with the package-manager commands to copy per OS (checked against the official pages:
// code.claude.com/docs/en/setup, github.com/openai/codex and moonshotai.github.io/kimi-code). Kept here so that they are easy
// to update. `login` is the sign-in command to copy (default: the command itself); `aptNote` adds that the official
// instructions also cover apt / dnf.
const AI_COMMANDS = {
  claude: {
    plan: "Claude", loginKey: "ai.login.text", docs: "https://code.claude.com/docs/en/setup", aptNote: true,
    install: { mac: [["Homebrew", "brew install --cask claude-code"]], linux: [["npm (Node.js 22+)", "npm install -g @anthropic-ai/claude-code"]] },
  },
  codex: {
    plan: "ChatGPT", loginKey: "ai.login.codex", docs: "https://github.com/openai/codex", aptNote: true,
    install: { mac: [["Homebrew", "brew install --cask codex"]], linux: [["npm", "npm install -g @openai/codex"]] },
  },
  kimi: {
    plan: "Kimi Code", loginKey: "ai.login.kimi", login: "kimi login", docs: "https://moonshotai.github.io/kimi-code/en/guides/getting-started",
    install: { mac: [["npm (Node.js 22.19+)", "npm install -g @moonshot-ai/kimi-code"]], linux: [["npm (Node.js 22.19+)", "npm install -g @moonshot-ai/kimi-code"]] },
  },
};
const AI_COMMAND_KEYS = { claude: "ai.command.claude", codex: "ai.command.codex", kimi: "ai.command.kimi" };
const aiCommandOf = (settings) => (AI_COMMANDS[settings.command] ? settings.command : "claude");
const AI_ERROR_KEYS = {
  noclick: "ai.err.noclick", disabled: "ai.err.disabled", consent: "ai.err.consent", platform: "ai.err.platform", busy: "ai.err.busy",
  limit: "ai.err.limit", login: "ai.err.login", notsubscription: "ai.err.notsubscription", missing: "ai.err.missing",
  timeout: "ai.err.timeout", cancelled: "ai.err.cancelled", error: "ai.err.error",
};
const AI_KIND_KEYS = { profile: "ai.kind.profile", rank: "ai.kind.rank", reason: "ai.kind.reason", summary: "ai.kind.summary", translation: "ai.kind.translation" };

class AiError extends Error {
  constructor(code, detail) {
    super(tr(AI_ERROR_KEYS[code] || AI_ERROR_KEYS.error, { detail: detail || "" }));
    this.name = "AiError";
    this.code = code;
  }
}

// ---- Settings (per computer: chrome.storage.local) ----
async function getAiSettings() {
  const { ai } = await chrome.storage.local.get("ai");
  return { ...AI_DEFAULTS, ...(ai || {}) };
}

async function saveAiSettings(patch) {
  const next = { ...(await getAiSettings()), ...patch };
  await chrome.storage.local.set({ ai: next });
  return next;
}

// The technical level of a summary (author, 2026-10-12): three steps, chosen in Settings (here, because Settings does not load
// summary.js). The text is the instruction for the AI; the user's own instructions are added after the rules, as data.
const SUMMARY_LEVELS = {
  overview: "- Level: overview. The reader is a physicist outside this subfield. Use plain words and explain each specialist term in a clause; give the idea and the result, with at most one or two key equations and no derivation details. Keep every section short.",
  standard: "- Level: standard. The reader is a researcher in the same broad field: name the objects, assumptions, key equations and the numbers that matter.",
  technical: "- Level: technical. The reader is a specialist in this subfield. Keep the paper's notation; give the key equations, the logic of the derivation step by step, the approximations and where they hold, the numbers with their uncertainties and the comparison with earlier results. No popularisation; do not explain textbook material.",
};
const SUMMARY_NOTE_MAX = 600; // characters of the user's own instructions
const cleanSummaryNote = (note) => String(note || "").replace(/[<>]{3,}/g, " ").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, SUMMARY_NOTE_MAX);

const aiConsentGiven = (settings) => !!(settings.consent && settings.consent.version === AI_CONSENT_VERSION);

// The AI part of the helper runs on Mac and Linux (the rest of the helper also on Windows).
async function aiPlatform() {
  try {
    return (await chrome.runtime.getPlatformInfo()).os; // "mac", "linux", "win", ...
  } catch (e) {
    return "unknown";
  }
}

// ---- Estimating what a run will use (shown to the user before they click) ----
function estimateTokens(text) {
  let plain = 0, other = 0;
  for (const ch of text) (ch.charCodeAt(0) < 128 ? plain++ : other++);
  return Math.ceil(plain / 2.8) + other; // measured on paper abstracts: about 2.85 characters per token (a little generous on purpose)
}

// A short form for small buttons: 3,512 -> "3.5k".
const shortTokens = (n) => (n >= 1000 ? (Math.round(n / 100) / 10).toLocaleString() + "k" : String(n));

function estimateRun(prompt, expectedOutputTokens, command = "claude") {
  const input = (AI_FIXED_TOKENS_BY_COMMAND[command] || AI_FIXED_TOKENS) + estimateTokens(prompt);
  return { input, output: expectedOutputTokens, total: input + expectedOutputTokens };
}

// ---- The command's status (asks the helper; uses no quota; only when the user presses "Check") ----
async function aiStatus(settings) {
  let reply;
  try {
    reply = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: "ai_status", command: aiCommandOf(settings), path: settings.path });
  } catch (e) {
    throw new Error(tr("helper.unreachable", { msg: e.message }));
  }
  if (!reply || !reply.ok) throw new Error((reply && reply.error) || tr("helper.noanswer"));
  return reply;
}

// ---- Usage log (per computer) ----
async function getAiUsage() {
  const { aiUsageLog } = await chrome.storage.local.get("aiUsageLog");
  return Array.isArray(aiUsageLog) ? aiUsageLog : [];
}

async function recordAiUsage(entry) {
  const log = (await getAiUsage()).concat(entry).slice(-AI_LOG_MAX);
  await chrome.storage.local.set({ aiUsageLog: log });
}

async function clearAiUsage() {
  await chrome.storage.local.remove("aiUsageLog");
}

// Totals of the runs since a time (milliseconds since 1970).
function summarizeAiUsage(log, sinceMs) {
  const recent = log.filter((e) => Date.parse(e.at) >= sinceMs);
  return { runs: recent.length, tokens: recent.reduce((n, e) => n + (e.tokens || 0), 0) };
}

// ---- The only way to ask the AI ----
const aiTokens = new WeakSet();
let aiBusy = false;

// Proof that the user clicked. Pass the event of a click handler; a script cannot make one (events it creates are not "trusted").
function aiClick(event) {
  const trusted = event && event.type === "click" && (event.isTrusted || (typeof window !== "undefined" && window.__papurrTest === true));
  if (!trusted) throw new AiError("noclick");
  const token = Object.freeze({});
  aiTokens.add(token);
  return token;
}

// Ask one question. `click` comes from aiClick(); request = { kind: "profile" | "rank" | "reason" | "summary" | "translation", items, prompt, schema, timeout? }.
// Returns { promise, cancel }; the promise resolves to { result, usage, tokens, costUsd, durationMs }.
function aiRun(click, request) {
  let port = null, cancelled = false;
  const promise = (async () => {
    if (!aiTokens.delete(click)) throw new AiError("noclick"); // one click, one run
    const settings = await getAiSettings();
    if (!settings.enabled) throw new AiError("disabled");
    if (!aiConsentGiven(settings)) throw new AiError("consent");
    const os = await aiPlatform();
    if (os !== "mac" && os !== "linux") throw new AiError("platform");
    if (aiBusy) throw new AiError("busy");
    aiBusy = true;
    const started = Date.now();
    const base = { at: new Date(started).toISOString(), kind: request.kind, items: request.items || 0 };
    try {
      const reply = await new Promise((resolve, reject) => {
        if (cancelled) return reject(new AiError("cancelled"));
        port = chrome.runtime.connectNative(NATIVE_HOST);
        port.onMessage.addListener(resolve);
        port.onDisconnect.addListener(() => reject(cancelled ? new AiError("cancelled") : new Error(tr("helper.unreachable", { msg: (chrome.runtime.lastError && chrome.runtime.lastError.message) || "" }))));
        port.postMessage({
          action: "ai_run", command: aiCommandOf(settings), path: settings.path, model: settings.model, effort: settings.effort,
          prompt: request.prompt, schema: request.schema || "", timeout: request.timeout || 180,
        });
      });
      try { port.disconnect(); } catch (e) {} // (the helper is done; this lets it exit)
      if (!reply || !reply.ok) {
        await recordAiUsage({ ...base, ok: false, code: (reply && reply.code) || "error", tokens: 0, durationMs: Date.now() - started });
        throw new AiError((reply && reply.code) || "error", reply && reply.error);
      }
      const u = reply.usage || {};
      const tokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
      await recordAiUsage({ ...base, ok: true, tokens, durationMs: reply.durationMs || Date.now() - started, model: (reply.models || [])[0] || "", costUsd: reply.costUsd });
      return { result: reply.result, usage: u, tokens, costUsd: reply.costUsd, durationMs: reply.durationMs, models: reply.models || [] };
    } catch (e) {
      if (e instanceof AiError && e.code === "cancelled") await recordAiUsage({ ...base, ok: false, code: "cancelled", tokens: 0, durationMs: Date.now() - started });
      throw e;
    } finally {
      aiBusy = false;
    }
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (port) port.disconnect(); // the helper stops the command and removes its temporary files
    },
  };
}
