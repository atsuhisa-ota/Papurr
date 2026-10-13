"""The AI part of the Papurr helper: ask the user's own AI command (`claude`, `codex` or `kimi`, their subscription) a question.

The rules this file enforces (see docs/DEVELOPMENT.md, "AI integration"):
  * Papurr never spends the user's quota by itself: this code runs only when the extension sends an `ai_run`
    request, and the extension sends one only after a click of the user.
  * Papurr never touches the user's normal environment: the command runs in safe mode (no CLAUDE.md, hooks, MCP,
    skills, plugins, memory), saves no session, may use no tools, and works in an empty temporary directory that
    is removed afterwards. The extension cannot loosen these flags: they are fixed here.
  * Papurr never bills an API key by accident: API-key variables are removed from the command's environment and a
    run is refused unless the command reports the subscription login (`claude auth status`: claude.ai;
    `codex login status`: ChatGPT).
For codex the same rules mean: `codex exec` with --ephemeral (no session files), --ignore-user-config (no config.toml:
no MCP servers, profiles or other settings), --ignore-rules, --sandbox read-only, web search off, the shell and every
other tool feature the installed version knows switched off, its internal databases (logs) kept in the temporary
directory, in an empty temporary directory.
For kimi (Kimi Code CLI) they mean: `kimi -p` with its whole data directory (KIMI_CODE_HOME) in the temporary directory, so
sessions, logs and caches never reach ~/.kimi-code; only the sign-in files are linked from there. The user's config.toml is
not used (it may hold hooks that run commands): a minimal one with only the signed-in (OAuth) provider and its models is
written instead. The request goes into a custom agent file with no tools and no sub-agents (`tools: []`), the user's skills
are replaced by an empty directory, and every KIMI_* variable of the environment (API keys, other providers) is dropped.
Python 3 standard library only.
"""
import glob
import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time

ALLOWED_COMMANDS = {"claude", "codex", "kimi"}
# Where the command is looked for: the places of the standard package managers (Chrome starts the helper with a minimal
# PATH and without ~/.zshrc, so they are listed here), then PATH. Copies bundled inside other apps (the ChatGPT app,
# VS Code, ...) are never used: only a command the user installed with a package manager (or the official installer).
# (Papurr never changes PATH: setting it up is the user's own business.)
PACKAGE_DIRS = [
    "/opt/homebrew/bin", "/usr/local/bin",                                  # Homebrew (Apple silicon / Intel); npm -g with Homebrew's Node
    "/home/linuxbrew/.linuxbrew/bin", "~/.linuxbrew/bin",                   # Homebrew on Linux
    "/usr/bin", "/bin", "/snap/bin",                                        # apt / dnf / apk, the system, snap
    "~/.npm-global/bin", "~/.local/bin",                                     # npm -g with a user prefix; claude's official installer
    "~/.kimi-code/bin",                                                      # kimi's official installer
]
BUNDLED_MARKERS = (".app/Contents/", "/.vscode/extensions/", "/.cursor/extensions/")  # inside another app: not used
# Tool features of codex that are switched off for Papurr's questions (only those the installed version knows: an unknown name is an error).
CODEX_OFF = ["shell_tool", "unified_exec", "shell_snapshot", "apps", "plugins", "remote_plugin", "browser_use", "browser_use_external",
             "browser_use_full_cdp_access", "in_app_browser", "computer_use", "image_generation", "view_image", "hooks", "multi_agent",
             "skill_search", "skill_mcp_dependency_install", "tool_suggest", "goals", "code_mode_host", "workspace_dependencies",
             "sleep_tool", "in_app_local_automation", "worktrees"]
SAFE_VALUE = re.compile(r"^[A-Za-z0-9._\[\]:/-]{1,64}$")  # model and effort names (kimi's aliases contain "/")
MAX_PROMPT = 400_000  # characters
MAX_SCHEMA = 20_000
MIN_TIMEOUT, MAX_TIMEOUT, DEFAULT_TIMEOUT = 10, 300, 180
SUBSCRIPTION_AUTH = "claude.ai"
LOCK_NAME = "papurr-ai.lock"

# Fixed, not under the control of the extension.
SAFE_FLAGS = ["-p", "--safe-mode", "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--output-format", "json"]


def find_command(name, custom=""):
    """The path of the command, or None. `custom` must be an absolute path whose file name is the command's name."""
    if name not in ALLOWED_COMMANDS:
        raise RuntimeError("Unsupported AI command: " + str(name))
    if custom:
        path = os.path.expanduser(custom)
        if os.path.basename(path) != name or not os.path.isfile(path) or not os.access(path, os.X_OK):
            raise RuntimeError("Not a usable " + name + " program: " + custom)
        if any(marker in os.path.realpath(path) for marker in BUNDLED_MARKERS):
            raise RuntimeError("A copy inside another app is not used; install " + name + " with a package manager: " + custom)
        return path
    for d in search_path():
        candidate = os.path.join(d, name)
        if not os.path.isfile(candidate) or not os.access(candidate, os.X_OK):
            continue  # (also skips a broken link)
        if any(marker in os.path.realpath(candidate) for marker in BUNDLED_MARKERS):
            continue
        return candidate
    return None


def search_path():
    """The package managers' places first, then the rest of PATH (without duplicates)."""
    dirs = []
    for d in [os.path.expanduser(x) for x in PACKAGE_DIRS] + os.environ.get("PATH", "").split(os.pathsep):
        if d and d not in dirs:
            dirs.append(d)
    return dirs


# KIMI_* covers kimi's API keys and environment-defined providers (KIMI_MODEL_*), MOONSHOT_* the platform's keys.
BILLING_PREFIXES = ("ANTHROPIC_", "CLAUDE_CODE_USE_", "OPENAI_", "AZURE_OPENAI_", "KIMI_", "MOONSHOT_")
BILLING_NAMES = {"CODEX_API_KEY"}


def clean_env():
    """The environment for the command: without anything that would switch it to API-key billing or another provider."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(BILLING_PREFIXES) and k not in BILLING_NAMES}
    env["NO_COLOR"] = "1"
    return env


def run(cmd, timeout, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=clean_env(), stdin=subprocess.DEVNULL, **kw)


def config_dir():
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")


def read_catalog():
    """Models and effort levels the command itself knows (its own cache file, read only). ([], []) if unavailable."""
    files = sorted(glob.glob(os.path.join(config_dir(), "cache", "model-catalog", "*.json")), key=os.path.getmtime)
    if not files:
        return [], []
    try:
        with open(files[-1], encoding="utf-8") as f:
            config = json.load(f)["catalog"]["config"]
        models = [{"id": m["id"], "name": m.get("name", m["id"]), "main": m.get("section") == "main"} for m in config.get("models", []) if m.get("id")]
        levels = config.get("settings_vocabulary", {}).get("effort_level", {})
        efforts = [k for k, _ in sorted(levels.items(), key=lambda kv: kv[1])] if isinstance(levels, dict) else []
        return models, efforts
    except (OSError, ValueError, KeyError, TypeError):
        return [], []


def efforts_from_help(path):
    """The effort levels named in `claude --help` ("--effort <level>  ... (low, medium, ...)"), or []."""
    try:
        text = run([path, "--help"], 20).stdout
    except (OSError, subprocess.TimeoutExpired):
        return []
    m = re.search(r"--effort <level>[^\n]*\n[^\n(]*\(([a-z, ]+)\)", text)
    return [x.strip() for x in m.group(1).split(",")] if m else []


def status(message, is_mac):
    """Is the command installed, which version, is the user logged in with a subscription, which models. Uses no quota."""
    name = message.get("command", "claude")
    path = find_command(name, message.get("path", ""))
    info = {"ok": True, "found": bool(path), "os": "mac" if is_mac else "linux"}
    if not path:
        return info
    info["path"] = path
    try:
        info["version"] = run([path, "--version"], 20).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        info["version"] = ""
    if name == "codex":
        info.update(codex_auth_status(path))
        info["models"], info["efforts"] = read_codex_models()
        return info
    if name == "kimi":
        setup = kimi_setup(path)
        info.update(setup["auth"])
        info["models"], info["efforts"] = setup["models"], setup["efforts"]
        return info
    info.update(auth_status(path))
    models, efforts = read_catalog()
    info["models"] = models
    info["efforts"] = efforts or efforts_from_help(path)
    return info


# ---- codex ----
def codex_home():
    return os.environ.get("CODEX_HOME") or os.path.expanduser("~/.codex")


def codex_auth_status(path):
    """`codex login status` (local, no quota): "Logged in using ChatGPT" is a subscription; an API key is not."""
    try:
        done = run([path, "login", "status"], 30)
        text = (done.stdout + "\n" + done.stderr).strip()
    except (OSError, subprocess.TimeoutExpired):
        text = ""
    if "Logged in using ChatGPT" in text:
        return {"loggedIn": True, "authMethod": "ChatGPT", "subscription": True}
    if "Logged in" in text:
        return {"loggedIn": True, "authMethod": "API key" if "API key" in text else text.splitlines()[0][:60], "subscription": False}
    return {"loggedIn": False, "authMethod": "", "subscription": False}


def read_codex_models():
    """Models and effort levels from codex's own cache (models_cache.json, read only). ([], []) if unavailable."""
    try:
        with open(os.path.join(codex_home(), "models_cache.json"), encoding="utf-8") as f:
            listed = [m for m in json.load(f).get("models", []) if isinstance(m, dict) and m.get("slug") and m.get("visibility") == "list"]
    except (OSError, ValueError, AttributeError):
        return [], []
    listed.sort(key=lambda m: m.get("priority", 999))
    models = [{"id": m["slug"], "name": m.get("display_name") or m["slug"], "main": True} for m in listed]
    efforts = []
    for m in listed:
        for level in m.get("supported_reasoning_levels") or []:
            name = level.get("effort") if isinstance(level, dict) else level
            if isinstance(name, str) and name not in efforts:
                efforts.append(name)
    return models, efforts


def codex_features(path):
    """The feature names the installed codex knows (`codex features list`, local)."""
    try:
        out = run([path, "features", "list"], 30).stdout
    except (OSError, subprocess.TimeoutExpired):
        return set()
    return {line.split()[0] for line in out.splitlines() if line.strip()}


def strict_schema(node):
    """codex wants every object closed (additionalProperties: false) and every property required."""
    if isinstance(node, dict):
        node = {k: strict_schema(v) for k, v in node.items()}
        if node.get("type") == "object":
            node["additionalProperties"] = False
            node["required"] = list((node.get("properties") or {}).keys())
        return node
    if isinstance(node, list):
        return [strict_schema(x) for x in node]
    return node


def codex_command(path, cwd, schema_file, answer_file, model, effort):
    known = codex_features(path)
    # codex keeps internal databases (including a log that records the request) in ~/.codex; for Papurr's questions they
    # go into the temporary directory instead and are removed with it (checked with the real command).
    state = os.path.join(cwd, "codex-state")
    os.makedirs(state, exist_ok=True)
    cmd = [path, "exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check",
           "--sandbox", "read-only", "-C", cwd, "-c", 'web_search="disabled"', "-c", "project_doc_max_bytes=0",
           "-c", 'sqlite_home="' + state + '"']
    for feature in CODEX_OFF:
        if feature in known:
            cmd += ["--disable", feature]
    if schema_file:
        cmd += ["--output-schema", schema_file]
    cmd += ["-o", answer_file]
    if model:
        cmd += ["-m", model]
    if effort:
        cmd += ["-c", 'model_reasoning_effort="' + effort + '"']
    return cmd + ["-"]  # the request comes through stdin


# ---- kimi (Kimi Code CLI) ----
KIMI_LINKED = ("credentials", "oauth", "device_id", "region")  # the sign-in and the device identity: nothing else of ~/.kimi-code
KIMI_PROMPT = "Carry out the request in your instructions."
KIMI_TEMPLATE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")  # ${name} is a placeholder in an agent file


def kimi_home():
    """The user's real data directory of kimi (read before the KIMI_* variables are removed for the command)."""
    return os.environ.get("KIMI_CODE_HOME") or os.path.expanduser("~/.kimi-code")


def kimi_setup(path):
    """Read kimi's providers and models (`kimi provider list --json`, local, no quota). Only providers signed in through
    OAuth (the Kimi Code plan) count: a provider with an API key would bill that key, so it is never offered or used."""
    env = dict(clean_env(), KIMI_CODE_HOME=kimi_home())
    empty = {"auth": {"loggedIn": False, "authMethod": "", "subscription": False}, "providers": {}, "models": [], "efforts": [], "byId": {}, "default": ""}
    try:
        done = subprocess.run([path, "provider", "list", "--json"], capture_output=True, text=True, timeout=30, env=env, stdin=subprocess.DEVNULL)
        data = json.loads(done.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return empty
    providers = data.get("providers") if isinstance(data, dict) else None
    models = data.get("models") if isinstance(data, dict) else None
    if not isinstance(providers, dict) or not isinstance(models, dict):
        return empty
    oauth = {k: v for k, v in providers.items() if isinstance(v, dict) and isinstance(v.get("oauth"), dict) and v.get("type") == "kimi"}
    signed_in = bool(oauth) and bool(glob.glob(os.path.join(kimi_home(), "credentials", "*.json")))
    if signed_in:
        auth = {"loggedIn": True, "authMethod": "Kimi Code (OAuth)", "subscription": True}
    elif providers:
        auth = {"loggedIn": True, "authMethod": "API key", "subscription": False}
    else:
        auth = dict(empty["auth"])
    by_id, listed, efforts = {}, [], []
    for alias, m in models.items():
        if not isinstance(m, dict) or m.get("provider") not in oauth or not SAFE_VALUE.match(alias):
            continue
        by_id[alias] = m
        listed.append({"id": alias, "name": m.get("displayName") or alias, "main": True})
        for level in m.get("supportEfforts") or []:
            if isinstance(level, str) and level not in efforts:
                efforts.append(level)
    default = ""
    try:
        with open(os.path.join(kimi_home(), "config.toml"), encoding="utf-8") as f:
            found = re.search(r'^default_model\s*=\s*"([^"]+)"', f.read(), re.M)
        default = found.group(1) if found and found.group(1) in by_id else ""
    except OSError:
        pass
    return {"auth": auth, "providers": oauth, "models": listed, "efforts": efforts, "byId": by_id, "default": default}


def kimi_config(setup, model):
    """A minimal config.toml: only the signed-in provider(s) and their models. No hooks, MCP, permissions or services."""
    q = json.dumps  # (TOML basic strings use the same escapes)
    lines = ["default_model = " + q(model), ""]
    for name, p in setup["providers"].items():
        lines += ["[providers." + q(name) + "]", "type = " + q(p.get("type", "kimi")), "base_url = " + q(p.get("baseUrl", "")), 'api_key = ""', "",
                  "[providers." + q(name) + ".oauth]", "storage = " + q(p["oauth"].get("storage", "file")), "key = " + q(p["oauth"].get("key", "")), ""]
    for alias, m in setup["byId"].items():
        lines += ["[models." + q(alias) + "]", "provider = " + q(m["provider"]), "model = " + q(m.get("model", ""))]
        if isinstance(m.get("maxContextSize"), int):
            lines.append("max_context_size = " + str(m["maxContextSize"]))
        for key, toml_key in (("capabilities", "capabilities"), ("supportEfforts", "support_efforts")):
            if isinstance(m.get(key), list):
                lines.append(toml_key + " = " + q([x for x in m[key] if isinstance(x, str)]))
        for key, toml_key in (("displayName", "display_name"), ("defaultEffort", "default_effort")):
            if isinstance(m.get(key), str):
                lines.append(toml_key + " = " + q(m[key]))
        lines.append("")
    return "\n".join(lines)


def kimi_agent_file(prompt, schema):
    """The request goes into the system prompt of an agent with no tools (a file, so its length is not limited like an
    argument). ${name} would be a placeholder there, so such text in the request (rare in abstracts) is defused."""
    body = KIMI_TEMPLATE.sub(lambda m: "$ {" + m.group(1) + "}", prompt)
    if schema:
        body += "\n\nAnswer with one JSON value that follows this JSON Schema, and nothing else (no prose, no code fence):\n" + schema
    return "---\nname: papurr\ndescription: Answers one request from Papurr without tools.\ntools: []\nsubagents: []\n---\nYou have no tools. Carry out the request below and answer exactly as it asks.\n\n" + body + "\n"


def kimi_prepare(cwd, setup, model, prompt, schema):
    """Build the temporary data directory, the agent file and the empty skills directory. Returns (home, work, agent, skills)."""
    home, work, skills = os.path.join(cwd, "kimi-home"), os.path.join(cwd, "work"), os.path.join(cwd, "skills")
    for d in (home, work, skills):
        os.makedirs(d)
    for name in KIMI_LINKED:
        source = os.path.join(kimi_home(), name)
        if os.path.exists(source):
            os.symlink(source, os.path.join(home, name))
    with open(os.path.join(home, "config.toml"), "w", encoding="utf-8") as f:
        f.write(kimi_config(setup, model))
    agent = os.path.join(cwd, "papurr-agent.md")
    with open(agent, "w", encoding="utf-8") as f:
        f.write(kimi_agent_file(prompt, schema))
    return home, work, agent, skills


def kimi_unlink(cwd):
    """Remove the links to the sign-in files first, so that cleaning up can never reach the real ones."""
    home = os.path.join(cwd, "kimi-home")
    for name in KIMI_LINKED:
        link = os.path.join(home, name)
        if os.path.islink(link):
            os.unlink(link)


def read_kimi_run(out, home):
    """The answer text (stream-json on stdout), the usage (the session's own record in the temporary data directory)
    and whether any tool was offered or used."""
    answer, tools = None, False
    for line in out.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if not isinstance(e, dict):
            continue
        if e.get("role") == "tool" or e.get("tool_calls"):
            tools = True
        if e.get("role") == "assistant" and isinstance(e.get("content"), str) and e["content"].strip():
            answer = e["content"]
    usage = {"input_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "output_tokens": 0}
    seen = False
    for wire in glob.glob(os.path.join(home, "sessions", "*", "*", "agents", "*", "wire.jsonl")):
        try:
            lines = open(wire, encoding="utf-8").read().splitlines()
        except OSError:
            continue
        for line in lines:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if not isinstance(e, dict):
                continue
            if e.get("type") == "llm.tools_snapshot" and e.get("tools"):
                tools = True
            message = e.get("message") if isinstance(e.get("message"), dict) else {}
            if isinstance(message.get("message"), dict):
                message = message["message"]
            if message.get("toolCalls"):
                tools = True
            if e.get("type") == "usage.record" and isinstance(e.get("usage"), dict):
                u, seen = e["usage"], True
                usage["input_tokens"] += int(u.get("inputOther") or 0)
                usage["cache_read_input_tokens"] += int(u.get("inputCacheRead") or 0)
                usage["cache_creation_input_tokens"] += int(u.get("inputCacheCreation") or 0)
                usage["output_tokens"] += int(u.get("output") or 0)
    return answer, (usage if seen else None), tools


def kimi_result(returncode, out, err, home, model, started):
    answer, usage, tools = read_kimi_run(out, home)
    if tools:  # the agent has no tools; if one appears anyway, the answer is not trusted
        return {"ok": False, "code": "error", "error": "The AI was offered or used a tool; the answer was discarded"}
    if returncode != 0 or answer is None:
        text = err or out
        return {"ok": False, "code": classify(text), "error": str(text).strip()[-500:]}
    parsed = loose_json(answer)
    result = answer if parsed is None else parsed
    return {
        "ok": True,
        "result": result,
        "usage": usage or {"input_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "output_tokens": 0},
        "costUsd": None,
        "durationMs": int((time.time() - started) * 1000),
        "models": [model],
    }


TOOL_ITEMS = {"command_execution", "file_change", "mcp_tool_call", "web_search", "collab_tool_call", "image_generation"}


def read_codex_events(out):
    """From the JSON lines of `codex exec --json`: usage, an error message, and the kinds of tools that were used."""
    usage, error, tools = None, "", set()
    for line in out.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if not isinstance(e, dict):
            continue
        kind = e.get("type", "")
        if kind == "turn.completed":
            usage = e.get("usage") or {}
        elif kind == "turn.failed":
            error = str((e.get("error") or {}).get("message") or "failed")
        elif kind == "error":
            error = str(e.get("message") or "error")
        item = e.get("item") if isinstance(e.get("item"), dict) else None
        if item and item.get("type") in TOOL_ITEMS:
            tools.add(item["type"])
    return usage, error, tools


def auth_status(path):
    """{loggedIn, authMethod, subscription}. `claude auth status` is local; it uses no quota."""
    try:
        data = json.loads(run([path, "auth", "status", "--json"], 30).stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return {"loggedIn": False, "authMethod": "", "subscription": False}
    method = str(data.get("authMethod", ""))
    logged_in = bool(data.get("loggedIn"))
    return {"loggedIn": logged_in, "authMethod": method, "subscription": logged_in and method == SUBSCRIPTION_AUTH}


def classify(text):
    """A short code for an error message of the command (the extension shows a matching explanation)."""
    t = (text or "").lower()
    if "usage limit" in t or "rate limit" in t or "limit reached" in t or "quota" in t:
        return "limit"
    if "not logged in" in t or "/login" in t or "log in" in t or "authentication" in t or "unauthorized" in t or "oauth" in t:
        return "login"
    return "error"


def acquire_lock():
    path = os.path.join(tempfile.gettempdir(), LOCK_NAME)
    for _ in range(2):
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return path
        except FileExistsError:
            try:
                with open(path) as f:
                    pid = int(f.read().strip() or 0)
                os.kill(pid, 0)  # still running?
                return None
            except (OSError, ValueError):
                try:
                    os.remove(path)  # a leftover of a run that died
                except OSError:
                    pass
    return None


def release(lock, cwd):
    if cwd:
        kimi_unlink(cwd)
        shutil.rmtree(cwd, ignore_errors=True)
    if lock:
        try:
            os.remove(lock)
        except OSError:
            pass


def kill(proc):
    if proc and proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        try:
            proc.wait(timeout=5)  # reap it, so that nothing is left behind
        except subprocess.TimeoutExpired:
            pass


def usage_of(data):
    u = data.get("usage") or {}
    keys = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
    return {k: int(u.get(k) or 0) for k in keys}


def loose_json(text):
    """The JSON value in an AI's answer, or None. Models sometimes wrap it in a code fence or a sentence, write a raw
    line break inside a string, or write a LaTeX backslash without doubling it (\\gamma is not valid JSON; \\frac and \\beta
    are valid, but mean a form feed and a backspace there). All of that is read here: a backslash before a letter that
    starts a LaTeX command is kept as a backslash (not for \\n: a line break is far more likely than \\nu)."""
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    candidates = [t]
    a, b = t.find("{"), t.rfind("}")
    if 0 <= a < b:
        candidates.append(t[a:b + 1])

    def broken(value):  # a form feed or a backspace inside a text: a LaTeX command that was read as an escape
        if isinstance(value, str):
            return "\x0c" in value or "\x08" in value
        if isinstance(value, dict):
            return any(broken(v) for v in value.values())
        if isinstance(value, list):
            return any(broken(v) for v in value)
        return False

    for c in candidates:
        fixed = re.sub(r'\\(?!["\\/bfnrtu])|\\(?=[bfrt][A-Za-z])', lambda m: "\\\\", c)
        first = None
        try:
            first = json.loads(c, strict=False)
        except ValueError:
            pass
        if first is not None and not broken(first):
            return first
        try:
            return json.loads(fixed, strict=False)
        except ValueError:
            if first is not None:
                return first
    return None


def result_of(data):
    """The answer: the structured output if there is one, otherwise the text (parsed as JSON when it is JSON)."""
    if data.get("structured_output") is not None:
        return data["structured_output"]
    text = data.get("result")
    if isinstance(text, str):
        parsed = loose_json(text)
        return text if parsed is None else parsed
    return text


def execute(message, holder):
    """Run one question. `holder` receives the process and the temporary directory so that a cancel can clean up."""
    name = message.get("command", "claude")
    path = find_command(name, message.get("path", ""))
    if not path:
        return {"ok": False, "code": "missing", "error": name + " is not installed"}
    prompt, schema = message.get("prompt", ""), message.get("schema", "")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT:
        return {"ok": False, "code": "error", "error": "The request is empty or too large"}
    parsed_schema = None
    if schema:
        if not isinstance(schema, str) or len(schema) > MAX_SCHEMA:
            return {"ok": False, "code": "error", "error": "Bad answer format"}
        try:
            parsed_schema = json.loads(schema)  # must be JSON
        except ValueError:
            return {"ok": False, "code": "error", "error": "Bad answer format"}
    values = {}
    for key in ("model", "effort"):
        value = message.get(key, "")
        if value and (not isinstance(value, str) or not SAFE_VALUE.match(value)):
            return {"ok": False, "code": "error", "error": "Bad " + key + " name"}
        values[key] = value or ""
    timeout = max(MIN_TIMEOUT, min(MAX_TIMEOUT, int(message.get("timeout", DEFAULT_TIMEOUT))))

    kimi = kimi_setup(path) if name == "kimi" else None
    auth = codex_auth_status(path) if name == "codex" else kimi["auth"] if kimi else auth_status(path)  # never bill an API key by accident
    if not auth["loggedIn"]:
        return {"ok": False, "code": "login", "error": "Not logged in"}
    if not auth["subscription"]:
        return {"ok": False, "code": "notsubscription", "error": "Login method is " + auth["authMethod"] + ", not a subscription"}

    if kimi:  # the model must belong to the signed-in plan; an effort is passed only where the model declares it
        model = values["model"] or kimi["default"] or (kimi["models"][0]["id"] if kimi["models"] else "")
        if model not in kimi["byId"]:
            return {"ok": False, "code": "error", "error": "Model not available with the signed-in Kimi plan: " + (model or "(none)")}
        values["model"] = model
        if values["effort"] not in (kimi["byId"][model].get("supportEfforts") or []):
            values["effort"] = ""

    lock = acquire_lock()
    if not lock:
        return {"ok": False, "code": "busy", "error": "Another AI request is running"}
    holder["lock"] = lock
    cwd = tempfile.mkdtemp(prefix="papurr-ai-")
    holder["cwd"] = cwd
    started = time.time()
    try:
        run_env, run_cwd, kimi_home_dir = clean_env(), cwd, ""
        if kimi:
            kimi_home_dir, run_cwd, agent, skills = kimi_prepare(cwd, kimi, values["model"], prompt, schema)
            cmd = [path, "-p", KIMI_PROMPT, "-m", values["model"], "--output-format", "stream-json", "--agent-file", agent, "--skills-dir", skills]
            run_env.update({"KIMI_CODE_HOME": kimi_home_dir, "KIMI_DISABLE_TELEMETRY": "1", "KIMI_CODE_NO_AUTO_UPDATE": "1"})
            if values["effort"]:
                run_env["KIMI_MODEL_THINKING_EFFORT"] = values["effort"]
        elif name == "codex":
            schema_file = ""
            if parsed_schema is not None:
                schema_file = os.path.join(cwd, "answer-schema.json")
                with open(schema_file, "w", encoding="utf-8") as f:
                    json.dump(strict_schema(parsed_schema), f)
            answer_file = os.path.join(cwd, "answer.txt")
            cmd = codex_command(path, cwd, schema_file, answer_file, values["model"], values["effort"])
        else:
            cmd = [path] + SAFE_FLAGS + (["--json-schema", schema] if schema else [])
            if values["model"]:
                cmd += ["--model", values["model"]]
            if values["effort"]:
                cmd += ["--effort", values["effort"]]
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL if kimi else subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                cwd=run_cwd, env=run_env, text=True, start_new_session=True)
        holder["proc"] = proc
        try:
            out, err = proc.communicate(None if kimi else prompt, timeout=timeout)
        except subprocess.TimeoutExpired:
            kill(proc)
            return {"ok": False, "code": "timeout", "error": "No answer within " + str(timeout) + " seconds"}
        if kimi:
            return kimi_result(proc.returncode, out, err, kimi_home_dir, values["model"], started)
        if name == "codex":
            return codex_result(proc.returncode, out, err, answer_file, values["model"], started)
        try:
            data = json.loads(out)
        except ValueError:
            data = None
        if proc.returncode != 0 or not isinstance(data, dict) or data.get("is_error"):
            text = (data.get("result") if isinstance(data, dict) else "") or err or out
            return {"ok": False, "code": classify(text), "error": str(text).strip()[:500]}
        return {
            "ok": True,
            "result": result_of(data),
            "usage": usage_of(data),
            "costUsd": data.get("total_cost_usd"),
            "durationMs": data.get("duration_ms") or int((time.time() - started) * 1000),
            "models": list((data.get("modelUsage") or {}).keys()),
        }
    finally:
        release(lock, cwd)


def codex_result(returncode, out, err, answer_file, model, started):
    usage, error, tools = read_codex_events(out)
    if tools:  # the tools were switched off; if one was used anyway, the answer is not trusted
        return {"ok": False, "code": "error", "error": "The AI used a tool (" + ", ".join(sorted(tools)) + "); the answer was discarded"}
    if returncode != 0 or error or usage is None:
        text = error or err or out
        return {"ok": False, "code": classify(text), "error": str(text).strip()[-500:]}
    try:
        with open(answer_file, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return {"ok": False, "code": "error", "error": "No answer was written"}
    parsed = loose_json(text)
    result = text if parsed is None else parsed
    cached = int(usage.get("cached_input_tokens") or 0)
    return {
        "ok": True,
        "result": result,
        "usage": {"input_tokens": max(0, int(usage.get("input_tokens") or 0) - cached), "cache_creation_input_tokens": 0,
                  "cache_read_input_tokens": cached, "output_tokens": int(usage.get("output_tokens") or 0)},
        "costUsd": None,
        "durationMs": int((time.time() - started) * 1000),
        "models": [model] if model else [],
    }
