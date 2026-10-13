# Installing Papurr for a user — instructions for AI assistants

Read this file if the user asked you to **install, set up or update Papurr** (for example "Papurrをインストールして",
"install Papurr", "set this up"). These instructions replace the development instructions in `CLAUDE.md`,
`AGENTS.md` and `docs/DEVELOPMENT.md`; those are for changing Papurr's code and do not apply here.

If the user asked for something else (changing the code, fixing a bug), stop reading this file and follow `CLAUDE.md`.

## What you are doing

Papurr is a Chrome extension that lives in the folder `extension/` of this repository. Installing it means:

1. Chrome loads `extension/` as an "unpacked extension" (**the user does this in Chrome; you cannot**).
2. Optionally, a small helper program is registered with Chrome (**you can do this**: `native/install.py`).
3. The user chooses their papers folder in Papurr's Settings (**the user does this; you cannot**).
4. Optionally, the AI features are set up (**mostly the user**; see step 6).

Your job: do the parts you can do, and guide the user through the rest **one step at a time**, in the user's
language, with the exact text of the buttons they will see. After each step that the user must do, stop and wait
until they say it is done.

## Rules — read all of them before you start

1. **Do not change this repository.** Do not edit, create, delete, rename, commit or push any file in it, and do not
   run `git commit`, `git push`, `git reset`, `git stash`, `git checkout` or anything that rewrites history or discards
   changes. The **only** git command that changes files which you may run is `git pull --ff-only`, in step 1, after the
   user agreed. Do not run the tests in `dev-tests/`. Do not update the documentation. (What `native/install.py` itself
   does inside `native/` — writing launcher scripts, on Windows a manifest, and making `paper_opener.py` executable —
   is expected; that is not you changing the repository.)
2. **Do not install anything without asking first.** This includes Python, Homebrew, npm packages, the AI command-line
   tools, and anything with `sudo` or administrator rights. Say what you want to install, why, and the exact command,
   and wait for a yes.
3. **Never sign in for the user, and never handle passwords, API keys or tokens.** Sign-ins are done by the user in
   their own terminal or browser. Do not read, print or copy credential files.
4. **Do not touch Chrome's own files or settings.** Do not edit Chrome's `Preferences` / `Secure Preferences`, do not
   start Chrome with `--load-extension` or other flags, do not add policies, do not install the extension by any route
   other than the user's own "Load unpacked" click. The **only** change to the browser setup you may make is running
   `native/install.py` (it registers the helper: a small file in the browser's settings folder, or a registry key
   under `HKEY_CURRENT_USER` on Windows).
5. **Do not choose, create, move or copy the user's papers folder or their PDFs.** The folder is chosen by the user in
   Papurr's Settings, because Chrome only gives a folder to the extension through the user's own click.
6. **Do not agree to anything on the user's behalf.** The AI features ask the user to read and accept a notice; only the
   user may do that.
7. **Report honestly.** If a command fails, show its output and explain it; do not claim that a step worked unless you
   saw it work (or the user confirmed it).

## Steps

### Step 0 — Where things are

- Check that you are in Papurr's repository: the current folder contains `extension/manifest.json` and
  `native/install.py`. If not, ask the user where the repository is; do not clone a second copy without asking.
- Find the absolute path of this repository and of its `extension/` folder, and show it to the user. They will need it
  in step 2.
- Tell the user: **the folder must stay where it is.** If it is moved later, Chrome loses the extension; it then has to
  be loaded again (step 2) and the helper registered again (step 3).
- If the user tells you where their papers folder is (the folder where they keep their PDFs) and the repository is
  inside it, say so and suggest a separate place; the two should not be the same folder. Do not search the computer
  for it.
- Find the operating system (macOS, Linux, Windows). On **Linux**, check how Chrome is installed: if the `google-chrome`
  or `chromium` command points into `/snap/` or Chrome comes from Flatpak, tell the user that the helper (step 3) will
  not work with that Chrome; the extension itself still works. A Chrome from Google's `.deb` / `.rpm` package is fine.

### Step 1 — Is the extension already installed? (updates)

Ask the user whether Papurr is already loaded in Chrome (`chrome://extensions` shows "Papurr").

- **Not yet:** go to step 2.
- **Already loaded, and they want something else set up** (the helper, the papers folder, the AI features): go to that
  step (3, 4, 5 or 6).
- **Already loaded, they want the newest version:** run `git status` first; if it shows local changes, stop and tell
  the user (do not stash, reset or discard anything). Otherwise ask, then run `git pull --ff-only`; if it fails, show
  the output and stop.
  After the pull, the user opens `chrome://extensions`, presses the **update** (reload) button, and reloads the tabs
  that were open. Run `native/install.py` again only if the folder moved. Then you are done.

### Step 2 — The user loads the extension (user's step)

Tell the user exactly this (in their language), with the path from step 0:

1. Open `chrome://extensions` in Chrome (type it into the address bar).
2. Turn on **Developer mode** (switch in the top right corner; Japanese Chrome: 「デベロッパー モード」).
3. Press **Load unpacked** (Japanese Chrome: 「パッケージ化されていない拡張機能を読み込む」).
4. Choose the folder `<absolute path>/extension` — the `extension` folder itself, not the repository folder above it.
5. "Papurr" appears in the list. If Chrome shows an error, copy its text to you.

Wait until the user confirms. If there is an error, read it and help; do not change any file to "fix" it (rule 1).

### Step 3 — The helper (optional; you do this)

Explain what the helper is for, and ask whether the user wants it:

- opening PDFs in an external PDF app (Skim, SumatraPDF, Evince, …) instead of Chrome,
- "Show in folder" (shows a PDF in Finder / File Explorer),
- "Open in my editor" for notes,
- the AI features (step 6; macOS and Linux only).

If they want it:

1. Check that Python 3 is available (`python3 --version`; on Windows `py -3 --version` or `python --version`).
   If it is missing, say how to get it and ask before installing anything (rule 2): macOS `xcode-select --install`;
   Windows https://www.python.org/downloads/ or `winget install Python.Python.3.13`; Linux the distribution's package.
2. Run the installer from the repository folder:
   - macOS / Linux: `python3 native/install.py`
   - Windows: `py -3 native\install.py` (or `python native\install.py`)
3. Read its output. Success looks like `Registered for Google Chrome (extension ID: …)` (one line per browser it found).
   `No supported browser found.` means no Chrome / Chromium / Brave / Edge settings folder was found: ask the user
   whether Chrome has been started at least once on this computer and which browser they use; do not create folders.
4. Tell the user to **quit Chrome completely and start it again** (all windows; on macOS, Chrome → Quit Chrome).
   Chrome reads the helper registration only when it starts.
5. On macOS, the first time the helper runs, macOS may ask whether it may access the Documents folder or a cloud
   folder; the user should allow it.

### Step 4 — The papers folder (user's step)

Tell the user:

1. Click Papurr's icon in Chrome's toolbar (pin it from the puzzle-piece menu if it is not visible). The **Library**
   opens; press **Settings** in its top right corner (Japanese: 「設定」).
2. Under **Folder**, press **Choose folder** and choose the folder where they want to keep their papers (an empty
   folder, or one that already has PDFs). When Chrome asks for permission, allow it; if Chrome offers
   **"Allow on every visit"**, choose it.
3. If the folder already contains PDFs, Settings offers **Identify and rename...**. Nothing is renamed without the
   user's approval; it is their decision whether and when to use it.

Also tell the user, plainly: **if the papers folder is synced by a cloud service (iCloud Drive, Dropbox, Google Drive,
OneDrive, …), checking that the sync has finished is up to them.** Papurr does not check the sync state.

### Step 5 — External PDF app (optional; user's step, needs step 3)

In Settings → **Open with**, the user chooses **External PDF app**, enters the app's name (e.g. `Skim` on macOS,
`SumatraPDF` on Windows, `evince` on Linux) or leaves it empty for the system's default app, and presses **Test**.
If Test fails, read the message to them; usual causes: the helper is not registered (step 3), Chrome was not
restarted, or (Linux) a snap / Flatpak Chrome.

### Step 6 — AI features (optional; only if the user asks for them)

Do not start this step unless the user wants the AI features. Explain first:

- They are optional, need the helper (step 3), and work on **macOS and Linux only**.
- They use the user's **own subscription plan**: Claude (Pro, Max, Team or Enterprise) with Claude Code (`claude`),
  ChatGPT (Plus, Pro, Business, Edu or Enterprise) with the Codex CLI (`codex`), or a Kimi Code plan with the Kimi Code
  CLI (`kimi`). Papurr never uses an API key. Each run uses the plan's quota; if the plan's **paid extra usage** is
  turned on, use beyond the quota may be charged.
- Installing the command-line tool needs the user's yes (rule 2). Use the official way the user prefers, e.g.
  `brew install --cask claude-code`, `brew install --cask codex`, or `npm install -g @moonshot-ai/kimi-code`.
- **Signing in is the user's step** (rule 3): they run the tool's sign-in themselves in their own terminal (for example
  `kimi login`; for `claude` and `codex`, starting the tool once and following its sign-in) and finish it in the
  browser. Do not run the sign-in for them and do not read any credentials.

Then the user, in Papurr's Settings → **AI features**: reads the notice and ticks the agreement **themselves** (rule 6),
turns on **Use AI features**, chooses the command and presses **Check the command**. Settings shows what is missing
(installation or sign-in). The research profile and everything that uses quota start only from the user's own clicks.

### Step 7 — Finish

Tell the user, briefly:

- what was done (by you and by them), and what was skipped;
- how to use it: click a PDF link on arXiv, INSPIRE, NASA ADS or a journal site — Papurr saves the paper in the
  papers folder and opens it; the toolbar icon opens the library; **Help** (Japanese: 「使い方」) in the top right
  corner of every Papurr page explains everything else;
- how to update later: ask an AI assistant to update Papurr (step 1), or run `git pull` and press the update button on
  `chrome://extensions`;
- that the folder of this repository must not be moved (or, if moved: steps 2 and 3 again).

Do not create any summary file, note or log in the repository (rule 1).
