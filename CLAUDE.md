# Papurr — instructions for AI assistants

> **Asked to install, set up or update Papurr** (e.g. "Papurrをインストールして", "install Papurr", "update Papurr")?
> Then follow **only** [`docs/INSTALL-AGENT.md`](docs/INSTALL-AGENT.md). Everything below is for changing Papurr's code
> and does not apply: do not edit, commit or push files, do not run the tests, do not update the documentation.

**Read `docs/DEVELOPMENT.md` first** (concept, architecture, data format, rules). The essentials:

## What this is
A Manifest V3 Chrome extension (plain JS, no build; one bundled, unmodified third-party library: KaTeX in `extension/vendor/katex`, for formulas). Clicking a PDF link on arXiv/INSPIRE/ADS/journal sites
opens the copy already saved in the user's chosen folder, or saves it there first. The folder holds the PDFs and one
`index.json` (shared between computers through cloud sync). Optional helper (`native/`) opens PDFs in an external app and runs the user's own AI command.

## Rules that must not be broken
1. Change `index.json` only through `updateIndex()` (`extension/common.js`); never overwrite an unreadable index; compute new state from the *stored* state inside `updateIndex`, not from UI state.
2. Keep per-computer data (last opened) out of `index.json`. Schema changes → bump `SCHEMA_VERSION` + migration + tests.
3. UI text only via `tr("key")` with keys in **all** of `I18N.en`, `I18N.ja` and `I18N.zh` (`extension/i18n.js`); elements filled by scripts get no `data-i18n`; never name a global `t`.
4. Code comments, docs and commit messages in English. The credit line stays English.
5. No popup for the folder picker; call `requestPermission()` from user gestures.
6. Do not rename the internal identifiers (`.paper-folder-id`, `com.paper_folder_manager.opener`, …).
7. Never rename, overwrite or delete a user's PDF without their approval. Notes (`<id>.md`) belong to the user too: Papurr changes only its own marked blocks, re-reads the file right before writing, never autosaves.
8. **AI features:** read "AI integration" in `docs/DEVELOPMENT.md` §9 before touching anything AI-related. Top rules: never use the user's subscription quota without them knowing (only from an explicit click, with an estimate, nothing automatic), never waste it (cache, no automatic retries), never affect the user's normal environment (no tools, temporary directory, no config changes).
9. The licence is **MIT** (`LICENSE`). Do not change it. Do not push, publish, or rename the remote unless the maintainer asks.

## Working loop
1. Read the relevant code (`common.js` is the core; pages: `open.js`, `library.js`, `options.js`).
2. Make the change; when bulk-editing with scripts, assert every replacement matched.
3. Add or update tests in `dev-tests/`, then run **`dev-tests/run-all.sh`** (needs `node`, `python3`, `google-chrome`; about 4 minutes — run it in the background and poll the output). All checks must pass.
4. Update `docs/DEVELOPMENT.md` for what you changed, and the Help page (`extension/help.js` + the `help.*` keys in all three dictionaries) briefly: one short clause where a user would otherwise not find the feature; leave out how to operate what is plainly on the screen, pointers to other sections and figures that go stale.
5. Tell the maintainer what you changed, how to try it (update button on `chrome://extensions`, reload open tabs), and what you could **not** verify (real publisher sites, real Mac, real cloud sync, real installed extension).
